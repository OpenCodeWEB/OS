#!/usr/bin/env python3
"""OpenCodeWEB OS — Dynamic Edge Connector (canonical HTTP gateway).

The No-Limit Connector bound to ``http://absup:7070/``. Wraps the proven
Cloudflare + GitHub auto-provisioning subsystem into a production HTTP
service that:

    * Monitors the primary edge (opencodeweb.xup.workers.dev) for latency,
      payload and HTTP 429 signals (EMA smoothed).
    * Auto-provisions sub-workers ``sync-node-<uuid>.xup.workers.dev`` via
      GitHub Actions ``workflow_dispatch`` (primary) and the Cloudflare
      Workers API (fallback) the moment thresholds are crossed — zero
      bandwidth / rate-limit caps guaranteed.
    * Routes streams across active edge nodes with the primary edge as the
      guaranteed final fallback (No-Limit Router).

Canonical URL:            http://absup:7070/
Custom Security Header:   X-ABsUP-Auth: ABsUP-Token-***

Endpoints:
    GET  /health                  service probe
    GET  /status                  monitor + provisioner + router snapshot
    GET  /nodes                   registry of spawned edge nodes
    POST /spawn                   {reason?} -> provision a new edge node
    GET  /route                   active routed endpoints
    POST /provision               force threshold evaluation + spawn
    POST /sync                    push roadmap state to the primary edge

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling in our code.

Maintainers: ABsUP & ABsUPs
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.network.dynamic_edge import EdgeMonitor  # noqa: E402
from core.roadmap.dynamic_edge_provisioner import (  # noqa: E402
    PRIMARY_EDGE,
    NoLimitRouter,
)

_logger = logging.getLogger("opencodeweb.network.connector")

DEFAULT_HOST: str = os.environ.get("OPENCODE_EDGE_HOST", "ABsUP")
DEFAULT_PORT: int = int(os.environ.get("OPENCODE_EDGE_PORT", "7070"))
AUTH_TOKEN: str = os.environ.get("OPENCODE_AUTH_TOKEN", "ABsUP-Token-OpenCodeWEB")
ZERO_CONSTRAINT_NOTE: str = (
    "Immutable Zero-Constraint Policy: no token limits, no hard timeouts, "
    "no artificial quotas, no throttling. Edge pods scale without caps."
)


class DynamicConnector:
    """HTTP service exposing the No-Limit Edge Connector (absup:7070)."""

    def __init__(self, port: int = DEFAULT_PORT, host: str = DEFAULT_HOST) -> None:
        self.port = port
        self.host = host
        self.monitor = EdgeMonitor(auto_spawn=True)
        self.started_at = time.time()
        _logger.info("dynamic connector initialized (port %d)", port)

    # -- lifecycle -------------------------------------------------------------

    def start(self) -> None:
        import socket

        try:
            socket.gethostbyname(self.host)
            self._bind_host = self.host
        except OSError:
            _logger.warning("hosts alias %r missing — falling back to 127.0.0.1", self.host)
            self._bind_host = "127.0.0.1"
        self.monitor.start()
        handler = self._make_handler()
        self.server = ThreadingHTTPServer((self._bind_host, self.port), handler)
        self.server.daemon_threads = True
        _logger.info("dynamic connector listening on http://%s:%d", self._bind_host, self.port)

    def serve_forever(self) -> None:
        assert self.server is not None
        try:
            self.server.serve_forever()
        finally:
            self.monitor.stop()
            self.server.server_close()

    # -- handlers -----------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        snapshot = self.monitor.snapshot()
        snapshot["uptime_s"] = round(time.time() - self.started_at, 1)
        snapshot["primary"] = PRIMARY_EDGE
        snapshot["zero_constraint"] = ZERO_CONSTRAINT_NOTE
        return {"ok": True, **snapshot}

    def spawn(self, payload: dict[str, Any]) -> dict[str, Any]:
        reason = str(payload.get("reason", "manual"))
        node = self.monitor.spawn_now(reason=reason)
        if node is None:
            return {"ok": False, "error": "spawn skipped (cooldown/max nodes)"}
        return {"ok": True, "node": node.to_dict()}

    def route(self) -> dict[str, Any]:
        nodes = self.monitor.provisioner.nodes
        router = NoLimitRouter(primary=PRIMARY_EDGE)
        return {"ok": True, "endpoints": router.route(nodes), "primary": PRIMARY_EDGE}

    def provision(self) -> dict[str, Any]:
        """Run one full probe + spawn cycle on demand."""
        report = self.monitor.probe_once()
        return {"ok": True, **report}

    def sync(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Push roadmap state to the primary edge gateway."""
        import urllib.request

        state = payload.get("roadmap") or payload
        request = urllib.request.Request(
            f"{PRIMARY_EDGE}/sync",
            data=json.dumps({"roadmap": state, "source": "dynamic-connector"}).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "X-ABsUP-Auth": AUTH_TOKEN},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8", errors="replace")
            return {"ok": True, "response": body[:500]}
        except Exception as exc:  # noqa: BLE001 - surfaced to UI
            return {"ok": False, "error": str(exc)}

    # -- HTTP routing ---------------------------------------------------------------

    def route_request(self, method: str, path: str, body: bytes) -> tuple[int, dict[str, Any], bytes]:
        def _json(code: int, obj: dict[str, Any]) -> tuple[int, dict[str, Any], bytes]:
            payload = json.dumps(obj).encode("utf-8")
            return (code, {"Content-Type": "application/json; charset=utf-8"}, payload)

        if path == "/health" and method == "GET":
            return _json(200, {"status": "ok", "service": "dynamic-edge-connector", "url": f"http://absup:{self.port}/"})
        if path == "/status" and method == "GET":
            return _json(200, self.status())
        if path == "/nodes" and method == "GET":
            return _json(200, {"ok": True, "nodes": [n.to_dict() for n in self.monitor.provisioner.nodes]})
        if path == "/spawn" and method == "POST":
            return _json(200, self.spawn(self._body_json(body)))
        if path == "/route" and method == "GET":
            return _json(200, self.route())
        if path == "/provision" and method == "POST":
            return _json(200, self.provision())
        if path == "/sync" and method == "POST":
            return _json(200, self.sync(self._body_json(body)))
        return _json(404, {"error": "not found", "path": path})

    @staticmethod
    def _body_json(body: bytes) -> dict[str, Any]:
        try:
            parsed = json.loads(body.decode("utf-8")) if body else {}
            return parsed if isinstance(parsed, dict) else {"_raw": parsed}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def _make_handler(self):
        connector = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "OpenCodeWEB-Connector/1.0"

            def log_message(self, fmt: str, *args: Any) -> None:
                pass

            def _handle(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                path = self.path.split("?", 1)[0]
                status, extra, payload = connector.route_request(self.command, path, body)
                self.send_response(status)
                for k, v in extra.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("X-ABsUP-Auth", AUTH_TOKEN)
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self) -> None:
                self._handle()

            def do_POST(self) -> None:
                self._handle()

        return Handler


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dynamic_connector", description="OpenCodeWEB OS dynamic edge connector (absup:7070)")
    parser.add_argument("--port", "-p", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", type=str, default=DEFAULT_HOST)
    parser.add_argument("--status", action="store_true", help="print status and exit")
    parser.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    connector = DynamicConnector(port=args.port, host=args.host)

    if args.status:
        print(json.dumps(connector.status(), indent=2))
        return 0

    connector.start()
    print(f"OpenCodeWEB OS dynamic edge connector: http://absup:{connector.port}")
    try:
        connector.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
