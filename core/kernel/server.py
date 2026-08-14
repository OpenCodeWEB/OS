#!/usr/bin/env python3
"""OpenCodeWEB OS — Local Kernel Daemon / IPC server (Module A).

The canonical local daemon: REST + WebSocket IPC server bound strictly to
``ABsUP:8080`` (hosts-file alias of 127.0.0.1; graceful 127.0.0.1 fallback
when the hosts entry is absent). Serves the hybrid desktop UI, exposes the
AiA Master Engine, the Autonomous Roadmap Engine, on-demand modules, and
the Dynamic Edge Connector.

Binding (per OS spec):
    Local IPC Daemon Host: ABsUP:8080  (C:\\Windows\\System32\\drivers\\etc\\hosts
    -> ``127.0.0.1 ABsUP``, or /etc/hosts on POSIX)

Architecture (cross-platform hybrid):
    UI shell (WebView2/Edge)  --HTTP/WS-->  this daemon  --IPC/in-process-->
    bin/opencode-kernel.py + core/aia + core/roadmap + core/network

Endpoints:
    GET  /health                 CPU/RAM/Vulkan/CUDA + active edge worker links
    GET  /api/status             kernel / aia / edge / daemon snapshot
    GET  /api/hardware           hardware profile (kernel IPC, graceful offline)
    POST /api/aia/chat           AiA prompt {text, author} -> engine reply
    GET  /api/aia/status         AiA engine runtime status
    GET  /api/roadmap/snapshot   items + polls + leaderboard (founder lock)
    POST /api/roadmap/chat       ingest chat {author, text} -> topics/items/polls
    POST /api/roadmap/vote       {poll_id, option, user}
    POST /api/roadmap/upvote     {item_id, user}
    GET  /api/roadmap/sync       push state to edge gateway (?dry_run=1 default)
    GET  /api/modules/list       on-demand module registry
    POST /api/modules/run        {module, args?} -> execution result
    POST /api/modules/clean      {force?} -> evicted modules
    GET  /api/edge/status        primary health + dynamic sync-node registry
    POST /api/edge/spawn         manual node spawn {reason?}

WebSocket (``/ws`` and ``/ws/aia`` — real-time AiA streaming channel), JSON:
    -> {"cmd":"ping"}                         {"cmd":"pong","ok":true}
    -> {"cmd":"subscribe","channels":["status","logs","aia.events"]}
    <- {"channel":"status","data":{...}}      every 2s
    <- {"channel":"logs","data":"..."}        kernel/daemon log tail

Run:
    python core/kernel/server.py
    python app/desktop/main_launcher.py        (GUI shell)

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling in our code.

Maintainers: ABsUP & ABsUPs
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import logging
import os
import platform
import socket
import struct
import sys
import threading
import time
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

# ---------------------------------------------------------------------------
# Repo-root aware imports (runs from anywhere: core/kernel, repo root, tests)
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.aia.aia_engine import AiAEngine  # noqa: E402
from core.network.dynamic_edge import EdgeMonitor  # noqa: E402
from core.roadmap.roadmap_engine import ChatMessage, RoadmapEngine  # noqa: E402
from core.runtime.on_demand_loader import OnDemandLoader  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_HOST: str = os.environ.get("OPENCODE_DESKTOP_HOST", "ABsUP")
DEFAULT_PORT: int = int(os.environ.get("OPENCODE_DESKTOP_PORT", "8080"))
KERNEL_IPC_HOST: str = "127.0.0.1"
KERNEL_IPC_PORT: int = int(os.environ.get("OPENCODE_IPC_PORT", "8790"))
KERNEL_IPC_TIMEOUT_S: float = 3.0
UI_DIR: Path = REPO_ROOT / "app" / "desktop" / "ui"
STATUS_TICK_SECONDS: float = 2.0
LOG_TAIL_MAX: int = 200
LOG_TAIL_LINES: int = 40
WS_MAGIC: str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

ZERO_CONSTRAINT_NOTE: str = (
    "OpenCodeWEB OS — Immutable Zero-Constraint Policy: no token limits, "
    "no hard timeouts, no artificial quotas, no throttling. Founders: ABsUP & ABsUPs."
)

_logger = logging.getLogger("opencodeweb.desktop")


# ---------------------------------------------------------------------------
# Kernel IPC bridge (thin JSON-line client, mirrors bin/opencode-kernel.py)
# ---------------------------------------------------------------------------


class KernelBridge:
    """Talk to the local kernel over loopback TCP (IPC port 8790)."""

    def __init__(self, host: str = KERNEL_IPC_HOST, port: int = KERNEL_IPC_PORT) -> None:
        self.host = host
        self.port = port
        self.last_error: str | None = None

    def call(self, cmd: str, payload: dict[str, Any] | None = None, timeout_s: float = KERNEL_IPC_TIMEOUT_S) -> dict[str, Any]:
        """Send one JSON-line command; returns the kernel reply dict.

        Raises ConnectionError when the kernel is unreachable.
        """
        request = {"cmd": cmd, "payload": payload or {}, "id": f"desktop-{time.time_ns()}"}
        try:
            with socket.create_connection((self.host, self.port), timeout=timeout_s) as sock:
                sock.settimeout(timeout_s)
                sock.sendall((json.dumps(request) + "\n").encode("utf-8"))
                line = sock.recv(65536).decode("utf-8", errors="replace")
        except (TimeoutError, OSError) as exc:
            self.last_error = str(exc)
            raise ConnectionError(f"kernel IPC unreachable: {exc}") from exc
        if not line.strip():
            raise ConnectionError("empty reply from kernel")
        return json.loads(line)

    def ping(self) -> dict[str, Any]:
        return self.call("ping")

    def status(self) -> dict[str, Any]:
        return self.call("status")

    def hardware(self) -> dict[str, Any]:
        return self.call("hardware")

    def is_up(self) -> bool:
        try:
            self.ping()
            return True
        except (ConnectionError, json.JSONDecodeError):
            return False


# ---------------------------------------------------------------------------
# Log tail ring buffer (broadcast to WS subscribers)
# ---------------------------------------------------------------------------


class LogTail:
    """In-memory ring of the last ``max_lines`` log strings."""

    def __init__(self, max_lines: int = LOG_TAIL_MAX) -> None:
        self.max_lines = max_lines
        self._lines: list[str] = []
        self._lock = threading.Lock()

    def append(self, line: str) -> None:
        with self._lock:
            self._lines.append(line)
            if len(self._lines) > self.max_lines:
                del self._lines[: len(self._lines) - self.max_lines]

    def tail(self, n: int = LOG_TAIL_LINES) -> list[str]:
        with self._lock:
            return list(self._lines[-n:])


# ---------------------------------------------------------------------------
# Minimal RFC 6455 WebSocket implementation (stdlib only)
# ---------------------------------------------------------------------------


def _ws_accept(key: str) -> str:
    return b64encode(hashlib.sha1((key + WS_MAGIC).encode("utf-8")).digest()).decode("ascii")


def _ws_encode_frame(payload: bytes, opcode: int = 0x1) -> bytes:
    """Encode a server->client frame (no masking required)."""
    header = bytearray([0x80 | opcode])
    length = len(payload)
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header += struct.pack(">H", length)
    else:
        header.append(127)
        header += struct.pack(">Q", length)
    return bytes(header) + payload


def _ws_decode_frame(buffer: bytes) -> tuple[int | None, bytes, bytes]:
    """Decode one client->server frame from ``buffer``.

    Returns (opcode, payload, remaining). opcode None when incomplete.
    Handles masked frames (clients always mask) and 64-bit lengths.
    """
    if len(buffer) < 2:
        return None, b"", buffer
    b0, b1 = buffer[0], buffer[1]
    opcode = b0 & 0x0F
    masked = bool(b1 & 0x80)
    length = b1 & 0x7F
    offset = 2
    if length == 126:
        if len(buffer) < 4:
            return None, b"", buffer
        length = struct.unpack(">H", buffer[2:4])[0]
        offset = 4
    elif length == 127:
        if len(buffer) < 10:
            return None, b"", buffer
        length = struct.unpack(">Q", buffer[2:10])[0]
        offset = 10
    mask_key = b""
    if masked:
        if len(buffer) < offset + 4:
            return None, b"", buffer
        mask_key = buffer[offset : offset + 4]
        offset += 4
    if len(buffer) < offset + length:
        return None, b"", buffer
    payload = buffer[offset : offset + length]
    remaining = buffer[offset + length :]
    if masked:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return (opcode, payload, remaining)


class WebSocketConnection:
    """Server-side WebSocket connection over a socket (blocking recv)."""

    def __init__(self, sock: socket.socket, handler: DesktopDaemon) -> None:
        self.sock = sock
        self.handler = handler
        self.channels: set[str] = set()
        self.buffer = b""
        self.closed = False
        self._lock = threading.Lock()

    def send_json(self, obj: dict[str, Any]) -> None:
        if self.closed:
            return
        try:
            with self._lock:
                self.sock.sendall(_ws_encode_frame(json.dumps(obj).encode("utf-8")))
        except OSError:
            self.closed = True

    def _handle_text(self, text: str) -> None:
        try:
            request = json.loads(text)
        except json.JSONDecodeError:
            self.send_json({"cmd": "error", "message": "malformed JSON"})
            return
        cmd = str(request.get("cmd", ""))
        if cmd == "ping":
            pong: dict[str, Any] = {"cmd": "pong", "ok": True, "ts": time.time()}
            if "nonce" in request:
                pong["nonce"] = request["nonce"]  # echo for correlation
            self.send_json(pong)
        elif cmd == "subscribe":
            channels = request.get("channels", [])
            if isinstance(channels, list):
                self.channels.update(str(c) for c in channels)
            self.send_json({"cmd": "subscribed", "channels": sorted(self.channels)})
        elif cmd == "status":
            self.send_json({"channel": "status", "data": self.handler.status_snapshot()})
        elif cmd == "logs":
            self.send_json({"channel": "logs", "data": self.handler.logs.tail()})
        else:
            self.send_json({"cmd": "unknown", "cmd_received": cmd})

    def run(self) -> None:
        """Read frames until close/error."""
        try:
            while not self.closed:
                try:
                    chunk = self.sock.recv(65536)
                except OSError:
                    break
                if not chunk:
                    break
                self.buffer += chunk
                while True:
                    opcode, payload, self.buffer = _ws_decode_frame(self.buffer)
                    if opcode is None:
                        break
                    if opcode == 0x8:  # close
                        self.closed = True
                        break
                    if opcode == 0x9:  # ping
                        self.sock.sendall(_ws_encode_frame(payload, opcode=0xA))
                    elif opcode == 0x1:  # text
                        self._handle_text(payload.decode("utf-8", errors="replace"))
        finally:
            self.closed = True
            try:
                self.sock.close()
            except OSError:
                pass
            self.handler.ws_drop(self)


# ---------------------------------------------------------------------------
# Desktop daemon
# ---------------------------------------------------------------------------


class DesktopDaemon:
    """Owns the engine components and the HTTP/WS server.

    Binds to ``ABsUP`` (hosts-file alias of 127.0.0.1) per the OS spec,
    with a graceful 127.0.0.1 fallback when the hosts entry is missing.
    """

    def __init__(
        self,
        port: int = DEFAULT_PORT,
        ui_dir: Path = UI_DIR,
        host: str = DEFAULT_HOST,
    ) -> None:
        self.port = port
        self.host = host
        self.ui_dir = Path(ui_dir)
        self.aia = AiAEngine()
        self.kernel = KernelBridge()
        self.roadmap = RoadmapEngine()
        self.loader = OnDemandLoader()
        self.edge = EdgeMonitor()
        self.logs = LogTail()
        self.server: ThreadingHTTPServer | None = None
        self.started_at: float = time.time()
        self._ws_clients: list[WebSocketConnection] = []
        self._ws_lock = threading.Lock()
        self._status_seq = 0
        self._shutdown = threading.Event()

        self._log("daemon initialized (port %d, python %s)", port, platform.python_version())
        try:
            self.roadmap.load()
        except Exception:  # noqa: BLE001 - state may be absent on first run
            self._log("roadmap state not loaded (first run?)")

    # -- logging helpers --------------------------------------------------------

    def _log(self, fmt: str, *args: Any) -> None:
        line = f"[{time.strftime('%H:%M:%S')}] {fmt % args if args else fmt}"
        _logger.info("%s", line)
        self.logs.append(line)
        self._broadcast("logs", self.logs.tail(5))

    # -- WebSocket broadcast ------------------------------------------------------

    def ws_register(self, conn: WebSocketConnection) -> None:
        with self._ws_lock:
            self._ws_clients.append(conn)

    def ws_drop(self, conn: WebSocketConnection) -> None:
        with self._ws_lock:
            if conn in self._ws_clients:
                self._ws_clients.remove(conn)

    def _broadcast(self, channel: str, data: Any) -> None:
        with self._ws_lock:
            clients = list(self._ws_clients)
        for conn in clients:
            if channel in conn.channels or channel == "logs":
                conn.send_json({"channel": channel, "data": data})

    # -- snapshots -----------------------------------------------------------------

    def status_snapshot(self) -> dict[str, Any]:
        """Combined kernel/AiA/edge/daemon status for the dashboard."""
        kernel_ok = False
        kernel_status: dict[str, Any] = {}
        try:
            kernel_status = self.kernel.status()
            kernel_ok = True
        except (ConnectionError, json.JSONDecodeError):
            kernel_status = {"error": self.kernel.last_error or "kernel offline"}

        hardware: dict[str, Any] = {}
        try:
            hardware = self.kernel.hardware()
        except (ConnectionError, json.JSONDecodeError):
            hardware = {"platform": platform.platform(), "python": platform.python_version(), "offline": True}

        self._status_seq += 1
        return {
            "ok": True,
            "seq": self._status_seq,
            "ts": time.time(),
            "daemon": {
                "uptime_s": round(time.time() - self.started_at, 1),
                "port": self.port,
                "zero_constraint": ZERO_CONSTRAINT_NOTE,
            },
            "kernel": {
                "online": kernel_ok,
                "status": kernel_status,
                "ipc": f"{KERNEL_IPC_HOST}:{KERNEL_IPC_PORT}",
            },
            "hardware": hardware,
            "aia": self.aia.status(),
            "edge": self.edge.snapshot(),
            "roadmap": {
                "items": len([i for i in self.roadmap.items if i.status != "archived"]),
                "polls": len([p for p in self.roadmap.polls if p.active]),
                "leaderboard": self.roadmap.leaderboard_view()[:10],
            },
        }

    # -- handlers ---------------------------------------------------------------------

    def handle_chat(self, payload: dict[str, Any]) -> dict[str, Any]:
        text = str(payload.get("text", "")).strip()
        if not text:
            return {"ok": False, "error": "text required"}
        author = str(payload.get("author", "ABsUP"))
        self._log("aia chat from %s: %s", author, text[:80])
        result = self.aia.prompt(text, author)
        event = {"event": "prompt", "author": author, "text": text[:200], "accepted": result.get("accepted")}
        self._broadcast("aia.events", event)
        return {"ok": True, "result": result}

    def handle_roadmap_chat(self, payload: dict[str, Any]) -> dict[str, Any]:
        author = str(payload.get("author", "guest"))
        text = str(payload.get("text", "")).strip()
        if not text:
            return {"ok": False, "error": "text required"}
        outcome = self.roadmap.ingest_chat([ChatMessage(author=author, text=text)])
        self._log("roadmap chat from %s: %s", author, text[:60])
        topics = [t["topic"] for t in outcome.get("topics", [])]
        self._broadcast("aia.events", {"event": "roadmap.ingest", "author": author, "topics": topics})
        return {"ok": True, **outcome}

    def handle_roadmap_vote(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.roadmap.vote(
            str(payload.get("poll_id", "")),
            str(payload.get("option", "")),
            str(payload.get("user", "guest")),
        )

    def handle_roadmap_upvote(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.roadmap.upvote_item(str(payload.get("item_id", "")), str(payload.get("user", "guest")))

    def handle_module_run(self, payload: dict[str, Any]) -> dict[str, Any]:
        module = str(payload.get("module", "")).strip()
        if not module:
            return {"ok": False, "error": "module required"}
        args = payload.get("args") or []
        self._log("module run: %s (args=%s)", module, args)
        try:
            return {"ok": True, "result": self.loader.execute(module, list(args))}
        except Exception as exc:  # noqa: BLE001 - surface to UI
            return {"ok": False, "error": str(exc)}

    def handle_module_clean(self, payload: dict[str, Any]) -> dict[str, Any]:
        force = bool(payload.get("force", False))
        evicted = self.loader.clean(force=force)
        return {"ok": True, "evicted": evicted}

    def handle_edge_spawn(self, payload: dict[str, Any]) -> dict[str, Any]:
        reason = str(payload.get("reason", "manual"))
        node = self.edge.spawn_now(reason=reason)
        if node is None:
            return {"ok": False, "error": "spawn skipped (cooldown/max nodes)"}
        return {"ok": True, "node": node.to_dict()}

    # -- HTTP request routing -----------------------------------------------------------

    def route(self, method: str, path: str, query: dict[str, list[str]], body: bytes) -> tuple[int, dict[str, Any], bytes, str]:
        """Return (status, headers_extra, body_bytes, content_type)."""
        if path == "/" or path == "/index.html":
            return self._serve_file("index.html")
        if path.startswith("/ui/"):
            rel = path[len("/ui/") :]
            return self._serve_file(rel)
        if path == "/favicon.ico":
            return self._serve_file("favicon.svg", fallback_ok=True)

        # ---- REST JSON API ----
        if path == "/health" and method == "GET":
            return self._json(200, self.health())
        if path == "/api/status" and method == "GET":
            return self._json(200, self.status_snapshot())
        if path == "/api/hardware" and method == "GET":
            try:
                return self._json(200, self.kernel.hardware())
            except ConnectionError:
                return self._json(200, {"offline": True, "error": self.kernel.last_error})
        if path == "/api/aia/status" and method == "GET":
            return self._json(200, self.aia.status())
        if path == "/api/aia/chat" and method == "POST":
            return self._json(200, self.handle_chat(self._body_json(body)))
        if path == "/api/roadmap/snapshot" and method == "GET":
            return self._json(200, {"ok": True, **self.roadmap.snapshot()})
        if path == "/api/roadmap/chat" and method == "POST":
            return self._json(200, self.handle_roadmap_chat(self._body_json(body)))
        if path == "/api/roadmap/vote" and method == "POST":
            return self._json(200, self.handle_roadmap_vote(self._body_json(body)))
        if path == "/api/roadmap/upvote" and method == "POST":
            return self._json(200, self.handle_roadmap_upvote(self._body_json(body)))
        if path == "/api/roadmap/sync" and method == "GET":
            dry = query.get("dry_run", ["1"])[0] not in ("0", "false", "False")
            return self._json(200, self.roadmap.sync(dry_run=dry))
        if path == "/api/modules/list" and method == "GET":
            return self._json(200, {"ok": True, "modules": self.loader.list_modules()})
        if path == "/api/modules/run" and method == "POST":
            return self._json(200, self.handle_module_run(self._body_json(body)))
        if path == "/api/modules/clean" and method == "POST":
            return self._json(200, self.handle_module_clean(self._body_json(body)))
        if path == "/api/edge/status" and method == "GET":
            return self._json(200, {"ok": True, **self.edge.snapshot()})
        if path == "/api/edge/spawn" and method == "POST":
            return self._json(200, self.handle_edge_spawn(self._body_json(body)))
        if path == "/api/directive" and method == "GET":
            return self._json(200, {"directive": ZERO_CONSTRAINT_NOTE})

        return self._json(404, {"error": "not found", "path": path})

    def _serve_file(self, rel: str, fallback_ok: bool = False) -> tuple[int, dict[str, Any], bytes, str]:
        """Serve a static UI file; block path traversal."""
        target = (self.ui_dir / rel).resolve()
        if not str(target).startswith(str(self.ui_dir.resolve())):
            return self._json(403, {"error": "forbidden"})
        if not target.is_file():
            if fallback_ok:
                return self._json(404, {"error": "not found"})
            return self._json(404, {"error": f"missing file: {rel}"})
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".json": "application/json",
            ".woff2": "font/woff2",
        }.get(target.suffix.lower(), "application/octet-stream")
        data = target.read_bytes()
        return (200, {"Content-Type": content_type, "Cache-Control": "no-store"}, data, content_type)

    @staticmethod
    def _json(status: int, obj: dict[str, Any]) -> tuple[int, dict[str, Any], bytes, str]:
        return (status, {"Content-Type": "application/json; charset=utf-8"}, json.dumps(obj).encode("utf-8"), "application/json")

    @staticmethod
    def _body_json(body: bytes) -> dict[str, Any]:
        try:
            parsed = json.loads(body.decode("utf-8")) if body else {}
            return parsed if isinstance(parsed, dict) else {"_raw": parsed}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    # -- lifecycle ---------------------------------------------------------------------

    def start(self) -> None:
        self.edge.start()
        handler = self._make_handler()
        bind_host = self._resolve_bind_host()
        self.server = ThreadingHTTPServer((bind_host, self.port), handler)
        self.server.daemon_threads = True
        self._log("desktop daemon listening on http://%s:%d", bind_host, self.port)
        threading.Thread(target=self._status_ticker, name="status-ticker", daemon=True).start()

    @staticmethod
    def _resolve_bind_host() -> str:
        """Resolve the ABsUP hosts alias; fall back to 127.0.0.1."""
        try:
            socket.gethostbyname(DEFAULT_HOST)
            return DEFAULT_HOST
        except OSError:
            _logger.warning(
                "hosts alias %r not resolvable — falling back to 127.0.0.1 "
                "(add '127.0.0.1 ABsUP' to the hosts file for the canonical bind)",
                DEFAULT_HOST,
            )
            return "127.0.0.1"

    # -- health (Module A spec: CPU/RAM/GPU + active sub-worker links) ------------------

    @staticmethod
    def _ram_bytes() -> int | None:
        """Total physical RAM via ctypes (stdlib). None when unsupported."""
        if platform.system() == "Windows":
            class MEMORYSTATUSEX(ctypes.Structure):  # noqa: N801
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX(dwLength=ctypes.sizeof(MEMORYSTATUSEX))
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                return int(stat.ullTotalPhys)
        try:
            with open("/proc/meminfo", encoding="utf-8") as fh:  # POSIX
                for line in fh:
                    if line.startswith("MemTotal:"):
                        return int(line.split()[1]) * 1024
        except OSError:
            pass
        return None

    def health(self) -> dict[str, Any]:
        """GET /health — CPU, RAM, Vulkan/CUDA GPU status, active worker links."""
        edge = self.edge.snapshot()
        gpu: dict[str, Any] = {"vulkan": False, "cuda": False}
        try:
            hw = self.kernel.hardware()
            if isinstance(hw, dict):
                gpu["vulkan"] = bool(hw.get("vulkan"))
                gpu["cuda"] = bool(hw.get("cuda"))
                gpu["detail"] = hw.get("gpu")
        except (ConnectionError, json.JSONDecodeError):
            gpu["detail"] = "kernel offline — GPU status unavailable"
        return {
            "status": "ok",
            "host": DEFAULT_HOST,
            "port": self.port,
            "cpu_threads": os.cpu_count() or 0,
            "ram_bytes": self._ram_bytes(),
            "gpu": gpu,
            "kernel_ipc": f"{KERNEL_IPC_HOST}:{KERNEL_IPC_PORT}",
            "edge": {
                "primary": edge["primary"],
                "primary_healthy": edge["primary_healthy"],
                "active_workers": [n["url"] for n in edge["nodes"] if n.get("status") == "active"],
                "provisioning": [n["url"] for n in edge["nodes"] if n.get("status") == "provisioning"],
            },
            "policy": ZERO_CONSTRAINT_NOTE,
        }

    def _status_ticker(self) -> None:
        while not self._shutdown.is_set():
            self._broadcast("status", self.status_snapshot())
            self._shutdown.wait(STATUS_TICK_SECONDS)

    def serve_forever(self) -> None:
        assert self.server is not None
        try:
            self.server.serve_forever()
        finally:
            self.stop()

    def stop(self) -> None:
        self._shutdown.set()
        self.edge.stop()
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()

    def _make_handler(self):
        daemon = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "OpenCodeWEB-Desktop/1.0"

            def log_message(self, fmt: str, *args: Any) -> None:  # quiet default
                pass

            def _handle_ws(self) -> None:
                headers = dict(self.headers.items())
                key = headers.get("Sec-WebSocket-Key", "")
                if not key:
                    self.send_response(400)
                    self.end_headers()
                    return
                self.send_response(101)
                self.send_header("Upgrade", "websocket")
                self.send_header("Connection", "Upgrade")
                self.send_header("Sec-WebSocket-Accept", _ws_accept(key))
                self.end_headers()
                conn = WebSocketConnection(self.connection, daemon)
                daemon.ws_register(conn)
                conn.run()

            def do_GET(self) -> None:
                parsed = urlparse(self.path)
                if parsed.path in ("/ws", "/ws/aia") and self.headers.get("Upgrade", "").lower() == "websocket":
                    self._handle_ws()
                    return
                query = parse_qs(parsed.query)
                status, extra, body, ctype = daemon.route("GET", parsed.path, query, b"")
                self.send_response(status)
                for k, v in extra.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                parsed = urlparse(self.path)
                status, extra, body_out, ctype = daemon.route("POST", parsed.path, {}, body)
                self.send_response(status)
                for k, v in extra.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body_out)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body_out)

        return Handler


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    desc = "OpenCodeWEB OS local kernel daemon / IPC server (ABsUP:8080)"
    parser = argparse.ArgumentParser(prog="server", description=desc)
    parser.add_argument("--port", "-p", type=int, default=DEFAULT_PORT, help="listen port (default 8080)")
    parser.add_argument("--host", type=str, default=DEFAULT_HOST,
                        help="bind host (default ABsUP hosts alias, 127.0.0.1 fallback)")
    parser.add_argument("--ui-dir", type=str, default=str(UI_DIR), help="UI static files directory")
    parser.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    daemon = DesktopDaemon(port=args.port, ui_dir=Path(args.ui_dir), host=args.host)
    daemon.start()
    _logger.info("%s", ZERO_CONSTRAINT_NOTE)
    print(f"OpenCodeWEB OS desktop daemon: http://ABsUP:{args.port} (bind host {daemon.host})")
    try:
        daemon.serve_forever()
    except KeyboardInterrupt:
        daemon.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
