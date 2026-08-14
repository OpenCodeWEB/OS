"""Tests for the OpenCodeWEB OS Dynamic Edge Provisioner.

Covers: load monitoring with EMA + thresholds, spawn decisions, GitHub
workflow dispatch + Cloudflare API fallback, registry persistence, health
gating, expiry pruning, and NoLimitRouter ordering.
"""

from __future__ import annotations

import json
import time

import pytest

from core.roadmap.dynamic_edge_provisioner import (
    PRIMARY_EDGE,
    EdgeNode,
    EdgeProvisioner,
    LoadMonitor,
    NoLimitRouter,
)

# ---------------------------------------------------------------------------
# Load monitor
# ---------------------------------------------------------------------------


class TestLoadMonitor:
    def test_low_load_no_spawn(self) -> None:
        def probe(url, timeout):  # noqa: ARG001
            return 200.0, 200

        mon = LoadMonitor(http_probe=probe)
        mon.probe()
        spawn, reasons = mon.should_spawn()
        assert spawn is False
        assert reasons == []

    def test_high_latency_triggers_spawn(self) -> None:
        def probe(url, timeout):  # noqa: ARG001
            return 5000.0, 200

        mon = LoadMonitor(http_probe=probe, latency_threshold_ms=1500)
        mon.probe()
        spawn, reasons = mon.should_spawn()
        assert spawn is True
        assert any("latency" in r for r in reasons)

    def test_payload_threshold_triggers_spawn(self) -> None:
        def probe(url, timeout):  # noqa: ARG001
            return 100.0, 200

        mon = LoadMonitor(http_probe=probe, payload_threshold_bytes=1024)
        mon.probe(payload_bytes=5 * 1024 * 1024)
        spawn, reasons = mon.should_spawn()
        assert spawn is True
        assert any("payload" in r for r in reasons)

    def test_429_triggers_spawn(self) -> None:
        def probe(url, timeout):  # noqa: ARG001
            return 100.0, 429

        mon = LoadMonitor(http_probe=probe)
        mon.probe()
        spawn, reasons = mon.should_spawn()
        assert spawn is True
        assert any("429" in r for r in reasons)

    def test_ema_smoothing(self) -> None:
        values = iter([100.0, 5000.0, 100.0])

        def probe(url, timeout):  # noqa: ARG001
            return next(values), 200

        mon = LoadMonitor(http_probe=probe, alpha=0.5)
        mon.probe()
        assert mon.ema_latency_ms == 100.0
        mon.probe()
        assert mon.ema_latency_ms == pytest.approx(2550.0)
        mon.probe()
        assert mon.ema_latency_ms == pytest.approx(1325.0)

    def test_probe_failure_sets_degraded(self) -> None:
        def probe(url, timeout):  # noqa: ARG001
            raise TimeoutError("down")

        mon = LoadMonitor(http_probe=probe)
        sample = mon.probe()
        assert sample.http_status == 0
        assert sample.latency_ms >= mon.latency_threshold_ms


# ---------------------------------------------------------------------------
# Edge provisioner
# ---------------------------------------------------------------------------


class TestEdgeProvisioner:
    @pytest.fixture()
    def provisioner(self, tmp_path) -> EdgeProvisioner:
        return EdgeProvisioner(
            github_token="gh_test",
            cf_api_token="cf_test",
            cf_account_id="acct_1",
            state_dir=tmp_path / "edge",
        )

    def test_spawn_via_github_dispatch(self, provisioner: EdgeProvisioner) -> None:
        calls: list[tuple[str, dict, bytes]] = []

        def fake_post(url, headers, body):  # noqa: ARG001
            calls.append((url, headers, body))
            return 204, ""

        provisioner.http_post = fake_post
        node = provisioner.spawn(reason="test")
        assert node is not None
        assert node.url.startswith("https://sync-node-")
        assert node.url.endswith(".xup.workers.dev")
        assert node.spawned_via == "github"
        assert len(calls) == 1
        assert "actions/workflows/deploy-sync-node.yml/dispatches" in calls[0][0]
        payload = json.loads(calls[0][2])
        assert payload["inputs"]["node_id"] == node.node_id

    def test_fallback_to_cloudflare_when_github_fails(self, provisioner: EdgeProvisioner) -> None:
        def fail_github(url, headers, body):  # noqa: ARG001
            return 403, "forbidden"

        def ok_cf(url, headers, body):  # noqa: ARG001
            assert "/workers/scripts/" in url
            return 200, "ok"

        provisioner.http_post = fail_github
        node = provisioner.spawn()
        assert node is None  # github failed AND no cf token fallback path used yet

        provisioner2 = EdgeProvisioner(
            github_token="gh_test",
            cf_api_token="cf_test",
            cf_account_id="acct_1",
            state_dir=provisioner.state_dir,
        )
        provisioner2.http_post = lambda url, headers, body: fail_github(url, headers, body)
        node2 = provisioner2.spawn()
        assert node2 is None  # both failed

        provisioner3 = EdgeProvisioner(
            github_token="gh_test",
            cf_api_token="cf_test",
            cf_account_id="acct_1",
            state_dir=provisioner.state_dir,
        )

        def route_post(url, headers, body):  # noqa: ARG001
            if "api.github.com" in url:
                return fail_github(url, headers, body)
            return ok_cf(url, headers, body)

        provisioner3.http_post = route_post
        node3 = provisioner3.spawn()
        assert node3 is not None
        assert node3.spawned_via == "cloudflare"

    def test_spawn_cooldown(self, provisioner: EdgeProvisioner) -> None:
        provisioner.http_post = lambda url, headers, body: (204, "")  # type: ignore[assignment]
        node1 = provisioner.spawn()
        assert node1 is not None
        node2 = provisioner.spawn()
        assert node2 is None  # cooldown

    def test_registry_persistence_round_trip(self, tmp_path) -> None:
        prov = EdgeProvisioner(state_dir=tmp_path / "edge")
        prov.http_post = lambda url, headers, body: (204, "")  # type: ignore[assignment]
        node = prov.spawn()
        assert node is not None
        prov2 = EdgeProvisioner(state_dir=tmp_path / "edge")
        loaded = prov2.load_registry()
        assert len(loaded) == 1
        assert loaded[0].node_id == node.node_id

    def test_health_gate_activates_node(self, provisioner: EdgeProvisioner) -> None:
        def fake_get(url, headers):  # noqa: ARG001
            return 12.0, 200  # (latency_ms, status)

        provisioner.http_get = fake_get
        node = EdgeNode(node_id="abc123", url="https://sync-node-abc123.xup.workers.dev")
        assert provisioner.verify_health(node) is True
        assert node.status == "active"
        assert node.last_latency_ms == 12.0

    def test_health_gate_rejects_down_node(self, provisioner: EdgeProvisioner) -> None:
        def fake_get(url, headers):  # noqa: ARG001
            raise TimeoutError("down")

        provisioner.http_get = fake_get
        node = EdgeNode(node_id="abc123", url="https://sync-node-abc123.xup.workers.dev")
        assert provisioner.verify_health(node) is False
        assert node.status == "degraded"

    def test_prune_expired(self, provisioner: EdgeProvisioner) -> None:
        provisioner.http_post = lambda url, headers, body: (204, "")  # type: ignore[assignment]
        node = provisioner.spawn()
        assert node is not None
        now = time.time() + 10 * 3600
        expired = provisioner.prune_expired(now)
        assert node.node_id in expired
        assert provisioner.nodes == []

    def test_deregister(self, provisioner: EdgeProvisioner) -> None:
        node = EdgeNode(node_id="x1", url="https://sync-node-x1.xup.workers.dev")
        provisioner.nodes.append(node)
        provisioner.deregister("x1")
        assert provisioner.nodes == []


# ---------------------------------------------------------------------------
# NoLimitRouter
# ---------------------------------------------------------------------------


class TestNoLimitRouter:
    def test_route_orders_by_latency_and_includes_primary(self) -> None:
        router = NoLimitRouter()
        nodes = [
            EdgeNode(node_id="a", url="https://sync-node-a.xup.workers.dev", status="active", last_latency_ms=500),
            EdgeNode(node_id="b", url="https://sync-node-b.xup.workers.dev", status="active", last_latency_ms=100),
            EdgeNode(node_id="c", url="https://sync-node-c.xup.workers.dev", status="provisioning"),
        ]
        endpoints = router.route(nodes)
        assert endpoints[0] == "https://sync-node-b.xup.workers.dev"
        assert "https://sync-node-c.xup.workers.dev" not in endpoints
        assert PRIMARY_EDGE in endpoints

    def test_route_degrades_to_primary_only(self) -> None:
        router = NoLimitRouter()
        endpoints = router.route([])
        assert endpoints == [PRIMARY_EDGE]

    def test_endpoint_for(self) -> None:
        assert NoLimitRouter.endpoint_for("POST", "https://sync-node-a.xup.workers.dev", "/sync") == (
            "https://sync-node-a.xup.workers.dev/sync"
        )
