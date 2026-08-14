"""OpenCodeWEB OS — Dynamic Edge Provisioner (No-Limit Connector).

Monitors traffic/latency on opencodeweb.xup.workers.dev and auto-provisions
new *.xup.workers.dev edge endpoints (sync-node-<uuid>) via:

  1. GitHub Actions workflow_dispatch on github.com/OpenCodeWEB/OS
     (primary path — CI owns credentials, zero-downtime deploys)
  2. Cloudflare Workers API directly (fallback path when GH unavailable)

Routes live chat, voting, and vector sync streams across the generated
sub-workers to bypass platform caps — the No-Limit Router.

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling in our code.

Maintainers: ABsUP & ABsUPs
"""

from __future__ import annotations

import json
import logging
import os
import platform
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

_logger = logging.getLogger("opencodeweb.roadmap.edge")

# ---------------------------------------------------------------------------
# Configuration (env-overridable)
# ---------------------------------------------------------------------------

PRIMARY_EDGE: str = os.environ.get("OPENCODE_GATEWAY", "https://opencodeweb.xup.workers.dev")
GITHUB_REPO: str = os.environ.get("OPENCODE_OS_REPO", "OpenCodeWEB/OS")
GITHUB_TOKEN: str = os.environ.get("GITHUB_TOKEN", "")
CF_API_TOKEN: str = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CF_ACCOUNT_ID: str = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")

LATENCY_MS_THRESHOLD: float = float(os.environ.get("EDGE_LATENCY_THRESHOLD_MS", "1500"))
PAYLOAD_BYTES_THRESHOLD: int = int(os.environ.get("EDGE_PAYLOAD_THRESHOLD_BYTES", str(2 * 1024 * 1024)))
EMA_ALPHA: float = float(os.environ.get("EDGE_EMA_ALPHA", "0.3"))
PROBE_INTERVAL_SECONDS: float = float(os.environ.get("EDGE_PROBE_INTERVAL", "30.0"))
NODE_TTL_SECONDS: int = int(os.environ.get("EDGE_NODE_TTL", str(4 * 3600)))
NODE_HEALTH_TIMEOUT: float = float(os.environ.get("EDGE_HEALTH_TIMEOUT", "10.0"))
MAX_NODES: int = int(os.environ.get("EDGE_MAX_NODES", "8"))
SPAWN_COOLDOWN_SECONDS: float = float(os.environ.get("EDGE_SPAWN_COOLDOWN", "300.0"))


def _default_state_dir() -> Path:
    override = os.environ.get("OPENCODE_STATE_DIR")
    if override:
        return Path(override)
    if platform.system() == "Windows":
        return Path("D:/opt/opencode/core/roadmap/state")
    return Path("/opt/opencode/core/roadmap/state")


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class LoadSample:
    """One probe of the primary edge connector."""

    latency_ms: float
    payload_bytes: int = 0
    http_status: int = 200
    ts: float = field(default_factory=time.time)


@dataclass
class EdgeNode:
    """A dynamically provisioned *.xup.workers.dev endpoint."""

    node_id: str
    url: str
    spawned_via: str = "github"  # "github" | "cloudflare" | "manual"
    status: str = "provisioning"  # provisioning | active | degraded | expired
    spawned_at: float = field(default_factory=time.time)
    last_health_at: float = 0.0
    last_latency_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EdgeNode:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Load monitor
# ---------------------------------------------------------------------------


class LoadMonitor:
    """EMA-smoothed latency/payload tracking on the primary edge."""

    def __init__(
        self,
        primary: str = PRIMARY_EDGE,
        latency_threshold_ms: float = LATENCY_MS_THRESHOLD,
        payload_threshold_bytes: int = PAYLOAD_BYTES_THRESHOLD,
        alpha: float = EMA_ALPHA,
        probe_timeout: float = NODE_HEALTH_TIMEOUT,
        http_probe: Callable[..., Any] | None = None,
    ) -> None:
        self.primary = primary.rstrip("/")
        self.latency_threshold_ms = latency_threshold_ms
        self.payload_threshold_bytes = payload_threshold_bytes
        self.alpha = alpha
        self.probe_timeout = probe_timeout
        self.http_probe = http_probe or self._default_probe
        self.ema_latency_ms: float = 0.0
        self.ema_payload_bytes: float = 0.0
        self.last_sample: LoadSample | None = None
        self._http_429_seen = False

    def _default_probe(self, url: str, timeout: float) -> tuple[float, int]:
        """Return (latency_ms, http_status) via urllib."""
        start = time.perf_counter()
        with urllib.request.urlopen(url, timeout=timeout) as response:
            status = response.status
        latency = (time.perf_counter() - start) * 1000.0
        return latency, status

    def probe(self, payload_bytes: int = 0) -> LoadSample:
        """Probe the primary edge; update EMA state; return the sample."""
        try:
            latency_ms, status = self.http_probe(f"{self.primary}/health", self.probe_timeout)
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            _logger.warning("edge probe failed: %s", exc)
            latency_ms, status = self.latency_threshold_ms * 2, 0

        sample = LoadSample(latency_ms=latency_ms, payload_bytes=payload_bytes, http_status=status)
        if self.ema_latency_ms == 0:
            self.ema_latency_ms = latency_ms
        else:
            self.ema_latency_ms = self.alpha * latency_ms + (1 - self.alpha) * self.ema_latency_ms
        if payload_bytes > 0:
            if self.ema_payload_bytes == 0:
                self.ema_payload_bytes = float(payload_bytes)
            else:
                self.ema_payload_bytes = self.alpha * payload_bytes + (1 - self.alpha) * self.ema_payload_bytes
        if status == 429:
            self._http_429_seen = True
        self.last_sample = sample
        return sample

    def should_spawn(self) -> tuple[bool, list[str]]:
        """Return (spawn?, reasons) based on thresholds + observed 429s."""
        reasons: list[str] = []
        if self.ema_latency_ms >= self.latency_threshold_ms:
            reasons.append(f"latency {self.ema_latency_ms:.0f}ms >= {self.latency_threshold_ms:.0f}ms")
        if self.ema_payload_bytes >= self.payload_threshold_bytes:
            reasons.append(
                f"payload {self.ema_payload_bytes / 1024:.0f}KiB >= {self.payload_threshold_bytes / 1024:.0f}KiB"
            )
        if self._http_429_seen:
            reasons.append("HTTP 429 observed (rate-limit signal)")
        return bool(reasons), reasons

    def reset_429_flag(self) -> None:
        self._http_429_seen = False


# ---------------------------------------------------------------------------
# Edge provisioner (GitHub workflow dispatch + Cloudflare API fallback)
# ---------------------------------------------------------------------------


class EdgeProvisioner:
    """Auto-spawns sync-node-<uuid>.xup.workers.dev endpoints.

    Primary: GitHub Actions workflow_dispatch on OpenCodeWEB/OS.
    Fallback: direct Cloudflare Workers API.
    """

    def __init__(
        self,
        repo: str = GITHUB_REPO,
        github_token: str = GITHUB_TOKEN,
        cf_api_token: str = CF_API_TOKEN,
        cf_account_id: str = CF_ACCOUNT_ID,
        state_dir: Path | None = None,
        http_post: Callable[..., Any] | None = None,
        http_get: Callable[..., Any] | None = None,
    ) -> None:
        self.repo = repo
        self.github_token = github_token
        self.cf_api_token = cf_api_token
        self.cf_account_id = cf_account_id
        self.state_dir = state_dir or (_default_state_dir() / "edge")
        self.http_post = http_post or self._default_post
        self.http_get = http_get or self._default_get
        self.nodes: list[EdgeNode] = []
        self._last_spawn_at = 0.0

    # -- HTTP helpers (urllib-based, injectable for tests) --------------------

    def _default_post(self, url: str, headers: dict[str, str], body: bytes) -> Any:
        request = urllib.request.Request(url, data=body, method="POST", headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", errors="replace")

    def _default_get(self, url: str, headers: dict[str, str]) -> Any:
        request = urllib.request.Request(url, method="GET", headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", errors="replace")

    # -- registry ---------------------------------------------------------------

    def load_registry(self) -> list[EdgeNode]:
        try:
            data = json.loads((self.state_dir / "nodes.json").read_text(encoding="utf-8"))
            self.nodes = [EdgeNode.from_dict(d) for d in data.get("nodes", [])]
        except (OSError, json.JSONDecodeError):
            self.nodes = []
        return self.nodes

    def save_registry(self) -> Path:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        path = self.state_dir / "nodes.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"nodes": [n.to_dict() for n in self.nodes]}, indent=2), encoding="utf-8")
        tmp.replace(path)
        return path

    # -- spawning ---------------------------------------------------------------

    def spawn(self, reason: str | None = None) -> EdgeNode | None:
        """Provision a new sync-node via GitHub dispatch (or CF API fallback)."""
        now = time.time()
        if now - self._last_spawn_at < SPAWN_COOLDOWN_SECONDS:
            _logger.info("spawn cooldown active; skipping")
            return None
        if len(self.nodes) >= MAX_NODES:
            _logger.warning("max edge nodes (%d) reached", MAX_NODES)
            return None

        node_id = uuid.uuid4().hex[:8]
        node = EdgeNode(node_id=node_id, url=f"https://sync-node-{node_id}.xup.workers.dev")
        self._last_spawn_at = now

        ok_github = False
        if self.github_token:
            ok_github = self._spawn_via_github(node, reason)
            node.spawned_via = "github"
        if not ok_github and self.cf_api_token:
            ok_cf = self._spawn_via_cloudflare(node)
            node.spawned_via = "cloudflare"
            if not ok_cf:
                _logger.error("cloudflare fallback spawn failed for %s", node.url)
                return None
        if not ok_github and not self.cf_api_token:
            _logger.warning("no credentials configured; node %s registered as provisioning only", node.url)

        self.nodes.append(node)
        self.save_registry()
        _logger.info("provisioned edge node %s (%s)", node.url, node.spawned_via)
        return node

    def _spawn_via_github(self, node: EdgeNode, reason: str | None) -> bool:
        """Trigger workflow_dispatch: .github/workflows/deploy-sync-node.yml"""
        url = f"https://api.github.com/repos/{self.repo}/actions/workflows/deploy-sync-node.yml/dispatches"
        headers = {
            "Authorization": f"Bearer {self.github_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        }
        body = json.dumps({"ref": "main", "inputs": {"node_id": node.node_id, "reason": reason or "auto-scale"}}).encode()
        try:
            status, _ = self.http_post(url, headers, body)
            if status in (204, 201, 200):
                _logger.info("github dispatch ok (status %d) for %s", status, node.node_id)
                return True
            _logger.warning("github dispatch returned status %d", status)
        except (urllib.error.URLError, OSError) as exc:
            _logger.warning("github dispatch failed: %s", exc)
        return False

    def _spawn_via_cloudflare(self, node: EdgeNode) -> bool:
        """Direct Cloudflare Workers API: create an empty-routed router worker."""
        if not self.cf_account_id:
            _logger.error("CLOUDFLARE_ACCOUNT_ID not configured for fallback spawn")
            return False
        script_url = f"https://api.cloudflare.com/client/v4/accounts/{self.cf_account_id}/workers/scripts/{node.node_id}"
        headers = {"Authorization": f"Bearer {self.cf_api_token}", "Content-Type": "application/javascript"}
        code = (
            b"export default { async fetch(request, env) { "
            b"const url = new URL(request.url); "
            b"if (url.pathname === '/health') return new Response("
            b"JSON.stringify({status:'Online',node:'" + node.node_id.encode() + b"'}), "
            b"{headers:{'Content-Type':'application/json'}}); "
            b"return new Response('sync-node " + node.node_id.encode() + b"', {status:200}); } };"
        )
        try:
            status, body = self.http_post(script_url, headers, code)
            if status in (200, 201):
                _logger.info("cloudflare script created (status %d) for %s", status, node.node_id)
                return True
            _logger.warning("cloudflare script create failed: %s (%s)", status, body[:200])
        except (urllib.error.URLError, OSError) as exc:
            _logger.warning("cloudflare script create failed: %s", exc)
        return False

    # -- lifecycle ---------------------------------------------------------------

    def deregister(self, node_id: str) -> None:
        before = len(self.nodes)
        self.nodes = [n for n in self.nodes if n.node_id != node_id]
        if len(self.nodes) != before:
            self.save_registry()

    def prune_expired(self, now: float | None = None) -> list[str]:
        now = now or time.time()
        expired = [n.node_id for n in self.nodes if now - n.spawned_at > NODE_TTL_SECONDS]
        for node_id in expired:
            self.deregister(node_id)
        return expired

    def verify_health(self, node: EdgeNode) -> bool:
        """Health-gate a node before marking it active."""
        try:
            latency_ms, status = self._probe_node(node)
        except (urllib.error.URLError, OSError, TimeoutError):
            status = 0
            latency_ms = 0.0
        node.last_health_at = time.time()
        node.last_latency_ms = latency_ms
        if status == 200:
            node.status = "active"
            self.save_registry()
            return True
        node.status = "degraded"
        self.save_registry()
        return False

    def _probe_node(self, node: EdgeNode) -> tuple[float, int]:
        return self.http_get(f"{node.url}/health", {})


# ---------------------------------------------------------------------------
# No-Limit Router
# ---------------------------------------------------------------------------


class NoLimitRouter:
    """Routes streams across active edge nodes, degrading gracefully to primary.

    Ordering: active nodes by lowest latency first, then the primary edge.
    The primary is always the final fallback, guaranteeing availability.
    """

    def __init__(self, primary: str = PRIMARY_EDGE) -> None:
        self.primary = primary.rstrip("/")

    def route(self, nodes: list[EdgeNode], limit: int = 3) -> list[str]:
        active = sorted(
            [n for n in nodes if n.status == "active"],
            key=lambda n: n.last_latency_ms,
        )
        endpoints = [n.url for n in active[:limit]]
        if self.primary not in endpoints:
            endpoints.append(self.primary)
        return endpoints

    @staticmethod
    def endpoint_for(method: str, base: str, path: str) -> str:
        """Build an absolute URL on a routed endpoint."""
        return f"{base.rstrip('/')}/{path.lstrip('/')}"

    def current_nodes(self, nodes: list[EdgeNode]) -> list[str]:
        return self.route(nodes, limit=MAX_NODES)
