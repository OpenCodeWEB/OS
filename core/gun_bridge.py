"""GunBridge — stdlib-only Python client for the OpenCodeWEB GunDB Bridge.

Bridges Python fleet services (kernel :8080, AiA :9090, pods, ...) to the
GunDB graph through the Node RPC gateway (``gun-relay/bridge.js``), which
peers to the GunX serverless relay (``wss://gunx.pages.dev/gun``) — the SAME
global graph the portal syncs through.

    Python service ──HTTPS──> bridge :8766 ──Gun peer──> gunx.pages.dev (serverless)

Usage::

    from core.gun_bridge import GunBridge

    bridge = GunBridge()                      # https://absup:8766, token from env
    bridge.put("chat/main", "m1", {"from": "alice", "text": "hi"})
    node = bridge.get_node("chat/main")
    val = bridge.get_value("chat/main", "m1")
    for change in bridge.watch("chat/main", since=0):
        print(change)

Requires only the Python standard library. TLS uses the OS trust root
(CA installed in the Windows Trusted Root store); pass ``insecure=True``
only for local lab debugging.
"""
from __future__ import annotations

import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional

DEFAULT_BASE_URL = os.environ.get("GUN_BRIDGE_URL", "https://absup:8766")
DEFAULT_TOKEN = os.environ.get("GUN_BRIDGE_TOKEN", "")


class GunBridgeError(RuntimeError):
    """Raised when the bridge responds with an error or is unreachable."""


class GunBridge:
    """Thin RPC client for the GunDB bridge gateway."""

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        token: str = DEFAULT_TOKEN,
        timeout: float = 10.0,
        insecure: bool = False,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        # Secure by default: trusts the OS trust root (Windows cert store).
        self._ctx = ssl._create_unverified_context() if insecure else ssl.create_default_context()

    # ── low-level ──────────────────────────────────────────────────────
    def _request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "OpenCodeWEB-GunBridge",
        }
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            self.base_url + path, data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self._ctx) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode("utf-8"))
            except Exception:
                payload = {"err": str(e)}
            raise GunBridgeError(f"{method} {path} -> HTTP {e.code}: {payload.get('err', payload)}")
        except urllib.error.URLError as e:
            raise GunBridgeError(f"{method} {path} unreachable: {e.reason}")

    # ── API ────────────────────────────────────────────────────────────
    def health(self) -> Dict[str, Any]:
        """Probe the bridge. Raises GunBridgeError if unreachable."""
        return self._request("GET", "/health")

    def get_node(self, soul: str) -> Dict[str, Any]:
        """Return the latest known fields of a graph node."""
        return self._request("GET", f"/node?soul={urllib.parse.quote(soul)}")

    def get_value(self, soul: str, key: str) -> Optional[Dict[str, Any]]:
        """Return {soul, key, value, state} for one field, or None if absent."""
        result = self._request(
            "GET", f"/value?soul={urllib.parse.quote(soul)}&key={urllib.parse.quote(key)}"
        )
        return result if result.get("value") is not None else None

    def put(self, soul: str, key: str, value: Any) -> Dict[str, Any]:
        """Write a JSON value to soul/key. value=None deletes the field."""
        return self._request("PUT", "/put", {"soul": soul, "key": key, "value": value})

    def watch(self, soul: str, since: float = 0.0) -> List[Dict[str, Any]]:
        """One poll of the cursor-based change feed: changes with state > since."""
        result = self._request(
            "GET", f"/watch?soul={urllib.parse.quote(soul)}&since={since}"
        )
        return result.get("changes", [])

    def watch_loop(
        self,
        soul: str,
        callback: Callable[[Dict[str, Any]], None],
        poll_seconds: float = 2.0,
        since: float = 0.0,
        stop: Optional[threading.Event] = None,
    ) -> threading.Thread:
        """Poll /watch in a background thread, invoking callback(change) per change.

        Returns the worker thread. If ``stop`` is not given, a fresh Event is
        created and exposed as thread ``.stop_event`` — call it to terminate.
        """
        if stop is None:
            stop = threading.Event()
        cursor = {"since": since}

        def worker() -> None:
            while not stop.is_set():
                try:
                    changes = self.watch(soul, since=cursor["since"])
                    for change in changes:
                        if stop.is_set():
                            return
                        callback(change)
                        if change.get("state", 0) > cursor["since"]:
                            cursor["since"] = change["state"]
                except GunBridgeError:
                    pass  # transient; keep polling
                except Exception as e:  # noqa: BLE001 — watchdog loop must survive
                    print(f"[gun_bridge] watch {soul} error: {e}")
                time.sleep(poll_seconds)

        thread = threading.Thread(target=worker, name=f"gun-bridge-watch-{soul}", daemon=True)
        thread.stop_event = stop  # type: ignore[attr-defined]
        thread.start()
        return thread