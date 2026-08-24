"""Smoke test for the GunDB bridge + Python client (Track 4).

Run from D:\\OpenCodeWEB\\OS with the bridge running:
    $env:GUNX_BRIDGE_TOKEN="..." ; python -m core.test_gun_bridge
"""
from __future__ import annotations

import sys
import threading
import time

from core.gun_bridge import GunBridge


def main() -> None:
    bridge = GunBridge()  # token from env GUNX_BRIDGE_TOKEN
    health = bridge.health()
    assert health.get("ok"), health
    print(f"health: {health['service']} | relay: {health['relay']} | uptime: {health['uptime_s']}s")

    soul = "bridge/smoke/test"

    # put + get_value roundtrip (object value)
    bridge.put(soul, "greeting", {"hello": "world", "n": 1})
    value = bridge.get_value(soul, "greeting")
    assert value and value["value"] == {"hello": "world", "n": 1}, value
    print("put + get_value roundtrip: OK")

    # get_node
    node = bridge.get_node(soul)
    assert node["fields"].get("greeting") == {"hello": "world", "n": 1}, node
    print("get_node: OK")

    # watch change feed with cursor
    bridge.put(soul, "greeting2", "second")
    changes = bridge.watch(soul, since=0)
    assert len(changes) >= 2, changes
    print(f"watch since=0 -> {len(changes)} changes: OK")

    cursor = max(c["state"] for c in changes)
    assert bridge.watch(soul, since=cursor) == [], "cursor did not advance"
    print("watch cursor advancement: OK")

    # live watch_loop push
    received: list = []
    event = threading.Event()

    def on_change(change: dict) -> None:
        received.append(change)
        event.set()

    loop = bridge.watch_loop(soul, on_change, poll_seconds=0.5)
    time.sleep(0.3)
    bridge.put(soul, "live", 42)
    # The first poll may deliver earlier journal entries; wait for the
    # live push specifically (it arrives on a subsequent poll).
    deadline = time.time() + 5
    while time.time() < deadline:
        if any(c.get("key") == "live" and c.get("value") == 42 for c in received):
            break
        time.sleep(0.1)
    assert any(c.get("key") == "live" and c.get("value") == 42 for c in received), received
    loop.stop_event.set()
    print("watch_loop live push: OK")

    # delete (null put) roundtrip
    bridge.put(soul, "greeting", None)
    assert bridge.get_value(soul, "greeting") is None, "delete failed"
    print("delete via null put: OK")

    print("ALL BRIDGE TESTS PASSED")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — test harness
        print(f"FAIL: {exc}")
        sys.exit(1)