"""OpenCodeWEB OS — Dynamic Edge Connector (core/network facade).

Re-exports the public provisioning API from
``core/roadmap/dynamic_edge_provisioner.py`` (single source of truth) and
adds ``EdgeMonitor``: a background thread that probes the primary edge
(EMA latency/payload/429), auto-spawns ``sync-node-<uuid>.xup.workers.dev``
links via GitHub Actions workflow_dispatch (Cloudflare API fallback), and
health-gates nodes into the active set.

No-Limit Router: active nodes by lowest latency, primary edge as the
guaranteed final fallback.

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling in our code.

Maintainers: ABsUP & ABsUPs
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from core.roadmap.dynamic_edge_provisioner import (  # noqa: F401 - public re-exports
    CF_ACCOUNT_ID,
    CF_API_TOKEN,
    GITHUB_REPO,
    GITHUB_TOKEN,
    MAX_NODES,
    NODE_HEALTH_TIMEOUT,
    NODE_TTL_SECONDS,
    PRIMARY_EDGE,
    PROBE_INTERVAL_SECONDS,
    SPAWN_COOLDOWN_SECONDS,
    EdgeNode,
    EdgeProvisioner,
    LoadMonitor,
    LoadSample,
    NoLimitRouter,
)

_logger = logging.getLogger("opencodeweb.network")


class EdgeMonitor:
    """Background edge supervisor: probe -> threshold -> spawn -> health gate.

    A single monitor owns one ``LoadMonitor`` + one ``EdgeProvisioner`` and
    runs a daemon thread that probes on ``probe_interval_s``. When the load
    monitor reports a spawn trigger, the provisioner spawns a new node
    (GitHub dispatch primary, Cloudflare API fallback) and health-gates it.
    """

    def __init__(
        self,
        monitor: LoadMonitor | None = None,
        provisioner: EdgeProvisioner | None = None,
        probe_interval_s: float = PROBE_INTERVAL_SECONDS,
        auto_spawn: bool = True,
    ) -> None:
        self.monitor = monitor or LoadMonitor()
        self.provisioner = provisioner or EdgeProvisioner()
        self.probe_interval_s = probe_interval_s
        self.auto_spawn = auto_spawn
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_probe_at: float = 0.0
        self.last_reasons: list[str] = []

    # -- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        """Start the background probe loop (idempotent)."""
        if self._thread is not None and self._thread.is_alive():
            return
        self.provisioner.load_registry()
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="edge-monitor", daemon=True)
        self._thread.start()
        _logger.info("EdgeMonitor started (probe interval %.1fs)", self.probe_interval_s)

    def stop(self) -> None:
        """Stop the background probe loop."""
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=3.0)
            self._thread = None

    # -- probe loop ------------------------------------------------------------

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.probe_once()
            except Exception as exc:  # noqa: BLE001 - monitor must survive
                _logger.warning("edge probe loop error: %s", exc)
            self._stop.wait(self.probe_interval_s)

    def probe_once(self) -> dict[str, Any]:
        """Run one probe + (optional) spawn cycle. Returns a status dict."""
        sample = self.monitor.probe()
        self.last_probe_at = time.time()

        # Health-gate existing nodes; prune expired ones.
        for node in list(self.provisioner.nodes):
            if time.time() - node.last_health_at > self.probe_interval_s * 4:
                self.provisioner.verify_health(node)
        expired = self.provisioner.prune_expired()

        spawn, reasons = self.monitor.should_spawn()
        self.last_reasons = reasons
        spawned: EdgeNode | None = None
        if spawn and self.auto_spawn:
            spawned = self.provisioner.spawn(reason="; ".join(reasons) if reasons else "auto-scale")
            self.monitor.reset_429_flag()
            if spawned is not None:
                # Best-effort health gate (may remain provisioning if no creds).
                self.provisioner.verify_health(spawned)

        return {
            "sample": sample.to_dict() if hasattr(sample, "to_dict") else vars(sample),
            "ema_latency_ms": round(self.monitor.ema_latency_ms, 1),
            "ema_payload_bytes": int(self.monitor.ema_payload_bytes),
            "reasons": reasons,
            "spawned": spawned.to_dict() if spawned else None,
            "expired": expired,
            "nodes": [n.to_dict() for n in self.provisioner.nodes],
            "primary": self.provisioner.__class__.__module__ and self.monitor.primary,
        }

    # -- snapshot ---------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """Current edge status: primary health + node registry + routing."""
        nodes = self.provisioner.nodes
        router = NoLimitRouter(primary=self.monitor.primary)
        return {
            "primary": self.monitor.primary,
            "primary_healthy": bool(
                self.monitor.last_sample and self.monitor.last_sample.http_status == 200
            ),
            "last_probe_at": self.last_probe_at,
            "ema_latency_ms": round(self.monitor.ema_latency_ms, 1),
            "nodes": [n.to_dict() for n in nodes],
            "active_endpoints": router.route(nodes),
            "max_nodes": MAX_NODES,
        }

    def spawn_now(self, reason: str = "manual") -> EdgeNode | None:
        """Manually trigger a spawn (bypasses threshold check)."""
        node = self.provisioner.spawn(reason=reason)
        if node is not None:
            self.provisioner.verify_health(node)
        return node
