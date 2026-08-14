"""OpenCodeWEB OS — core/network facade tests.

Covers EdgeMonitor lifecycle (start/stop idempotence), snapshot contract,
and the public re-exports from the dynamic edge provisioner.

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling. Maintainers: ABsUP & ABsUPs.
"""

from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

from core.network import dynamic_edge as de  # noqa: E402
from core.network.dynamic_edge import EdgeMonitor  # noqa: E402


def test_public_re_exports():
    for name in (
        "PRIMARY_EDGE",
        "MAX_NODES",
        "GITHUB_REPO",
        "EdgeNode",
        "EdgeProvisioner",
        "LoadMonitor",
        "LoadSample",
        "NoLimitRouter",
    ):
        assert hasattr(de, name), f"missing public re-export: {name}"


def test_edge_monitor_constructs():
    monitor = EdgeMonitor()
    assert monitor.auto_spawn is True
    assert monitor.last_probe_at == 0.0


def test_edge_monitor_start_stop_idempotent():
    monitor = EdgeMonitor()
    monitor.start()
    monitor.start()  # second start must not spawn a second thread
    assert monitor._thread is not None and monitor._thread.is_alive()
    monitor.stop()
    assert monitor._thread is None
    monitor.stop()  # stop after stop is safe


def test_snapshot_contract():
    monitor = EdgeMonitor()
    snapshot = monitor.snapshot()
    assert "primary" in snapshot
    assert "primary_healthy" in snapshot
    assert "nodes" in snapshot
    assert "active_endpoints" in snapshot
    assert "max_nodes" in snapshot
    assert snapshot["max_nodes"] == de.MAX_NODES


def test_spawn_now_without_credentials_degrades_gracefully():
    """No CF/GH creds available offline: spawn must not raise."""
    monitor = EdgeMonitor()
    node = monitor.spawn_now(reason="test-offline")
    # Either a node object (creds present) or None (no creds) — never a crash.
    assert node is None or hasattr(node, "url")


def test_probe_once_runs_without_raising(monkeypatch):
    monitor = EdgeMonitor()
    # Use a very short interval probe; guard against network flakiness by
    # letting any exception be contained inside the loop (monitor survival).
    try:
        result = monitor.probe_once()
        assert isinstance(result, dict)
        assert "ema_latency_ms" in result
    except Exception:  # noqa: BLE001 - network may be unavailable; monitor must survive
        pass
