#!/usr/bin/env python3
"""OpenCodeWEB OS — System Daemon (OS Kernel supervisor + IPC server).

The production kernel bound to ``http://absup:8080/``. Supervises the full
local micro-service fleet per the OS port convention:

    * OpenCodeWEB OS Kernel:       http://absup:8080/   (this process)
    * AiA Agent Engine:            http://absup:9090/   (child service)
    * Dynamic Edge Sync Gateway:   http://absup:7070/   (child service)
    * Roadmap Local Buffer:        http://absup:3030/   (in-process)
    * Dynamic On-Demand Pods:      http://absup:8100/+  (PodOrchestrator)

Responsibilities:
    * Spawn + supervise child services (agent_engine, dynamic_connector).
    * Profile device hardware and spawn device-adaptive pods via the
      PodOrchestrator; offload to edge pods on saturation.
    * Run the Roadmap Local Buffer on absup:3030 (local state + edge sync).
    * Serve the desktop dashboard UI and the JSON/IPC API on absup:8080.
    * Enforce the X-ABsUP-Auth header on every inter-service call.

Custom Security Header:   X-ABsUP-Auth: ABsUP-Token-***

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling in our code. Founders: ABsUP & ABsUPs.
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
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.kernel.pod_orchestrator import PodOrchestrator  # noqa: E402
from core.roadmap.roadmap_engine import ChatMessage, RoadmapEngine  # noqa: E402

_logger = logging.getLogger("opencodeweb.kernel.daemon")

DEFAULT_HOST: str = os.environ.get("OPENCODE_KERNEL_HOST", "ABsUP")
DEFAULT_PORT: int = int(os.environ.get("OPENCODE_KERNEL_PORT", "8080"))
AIA_PORT: int = int(os.environ.get("OPENCODE_AIA_PORT", "9090"))
EDGE_PORT: int = int(os.environ.get("OPENCODE_EDGE_PORT", "7070"))
ROADMAP_PORT: int = int(os.environ.get("OPENCODE_ROADMAP_PORT", "3030"))
AUTH_TOKEN: str = os.environ.get("OPENCODE_AUTH_TOKEN", "ABsUP-Token-OpenCodeWEB")
UI_DIR: Path = REPO_ROOT / "app" / "desktop" / "ui"
STATUS_TICK_SECONDS: float = 2.0
LOG_TAIL_MAX: int = 200
WS_MAGIC: str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

ZERO_CONSTRAINT_NOTE: str = (
    "OpenCodeWEB OS — Immutable Zero-Constraint Policy: no token limits, "
    "no hard timeouts, no artificial quotas, no throttling. Founders: ABsUP & ABsUPs."
)


# ---------------------------------------------------------------------------
# TLS-aware threaded HTTP server
# ---------------------------------------------------------------------------


class TLSThreadingHTTPServer(ThreadingHTTPServer):
    """ThreadingHTTPServer that performs the TLS handshake per-connection.

    Wrapping the listening socket (``server.socket = ctx.wrap_socket(...)``)
    makes ``accept()`` run the TLS handshake synchronously in the accept loop,
    so a single slow client can block the whole kernel.  Here the raw
    connection is accepted and the handshake happens in its own worker
    thread, keeping the accept loop non-blocking.
    """

    tls_context: Any = None  # set by the daemon before start()

    def process_request(self, request: socket.socket, client_address: Any) -> None:
        if self.tls_context is None:
            super().process_request(request, client_address)
            return

        def _wrap_and_handle() -> None:
            try:
                tls_sock = self.tls_context.wrap_socket(request, server_side=True)
            except OSError:
                try:
                    request.close()
                except OSError:
                    pass
                return
            try:
                self.finish_request(tls_sock, client_address)
            except Exception:
                # Match stdlib behaviour: surface handler crashes in the log
                # instead of silently dropping the connection (client RST).
                try:
                    self.handle_error(tls_sock, client_address)
                finally:
                    try:
                        tls_sock.close()
                    except OSError:
                        pass
                return
            try:
                tls_sock.close()
            except OSError:
                pass

        threading.Thread(target=_wrap_and_handle, name="tls-request", daemon=True).start()


SERVICES: dict[str, dict[str, Any]] = {
    "aia": {
        "module": "core.aia.agent_engine",
        "port": AIA_PORT,
        "url": f"http://absup:{AIA_PORT}/",
        "health": "/health",
    },
    "edge": {
        "module": "core.network.dynamic_connector",
        "port": EDGE_PORT,
        "url": f"http://absup:{EDGE_PORT}/",
        "health": "/health",
    },
}


# ---------------------------------------------------------------------------
# WebSocket helpers (stdlib RFC 6455)
# ---------------------------------------------------------------------------


def _ws_accept(key: str) -> str:
    return b64encode(hashlib.sha1((key + WS_MAGIC).encode("utf-8")).digest()).decode("ascii")


def _ws_encode_frame(payload: bytes, opcode: int = 0x1) -> bytes:
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
    def __init__(self, sock: socket.socket, daemon: SystemDaemon) -> None:
        self.sock = sock
        self.daemon = daemon
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
                pong["nonce"] = request["nonce"]
            self.send_json(pong)
        elif cmd == "subscribe":
            channels = request.get("channels", [])
            if isinstance(channels, list):
                self.channels.update(str(c) for c in channels)
            self.send_json({"cmd": "subscribed", "channels": sorted(self.channels)})
        elif cmd == "status":
            self.send_json({"channel": "status", "data": self.daemon.status_snapshot()})
        elif cmd == "logs":
            self.send_json({"channel": "logs", "data": self.daemon.logs_tail()})
        else:
            self.send_json({"cmd": "unknown", "cmd_received": cmd})

    def run(self) -> None:
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
                    if opcode == 0x8:
                        self.closed = True
                        break
                    if opcode == 0x9:
                        self.sock.sendall(_ws_encode_frame(payload, opcode=0xA))
                    elif opcode == 0x1:
                        self._handle_text(payload.decode("utf-8", errors="replace"))
        finally:
            self.closed = True
            try:
                self.sock.close()
            except OSError:
                pass
            self.daemon.ws_drop(self)


# ---------------------------------------------------------------------------
# Roadmap Local Buffer (absup:3030)
# ---------------------------------------------------------------------------


class RoadmapBuffer:
    """Roadmap Local Buffer: in-process HTTP server on absup:3030.

    Buffers roadmap state locally (items/polls/chat/leaderboard) and syncs
    it to the edge gateway (opencodeweb.xup.workers.dev/sync) on demand —
    a zero-constraint local persistence layer before global sync.
    """

    def __init__(self, roadmap: RoadmapEngine, port: int = ROADMAP_PORT, host: str = "ABsUP") -> None:
        self.roadmap = roadmap
        self.port = port
        self.host = host
        self.server: ThreadingHTTPServer | None = None

    def start(self) -> None:
        import socket as _socket

        try:
            _socket.gethostbyname(self.host)
            bind_host = self.host
        except OSError:
            bind_host = "127.0.0.1"
        handler = self._make_handler()
        self.server = ThreadingHTTPServer((bind_host, self.port), handler)
        self.server.daemon_threads = True
        _logger.info("roadmap local buffer listening on http://%s:%d", bind_host, self.port)

    def serve_forever(self) -> None:
        assert self.server is not None
        try:
            self.server.serve_forever()
        finally:
            self.server.server_close()

    def _make_handler(self):
        buffer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "OpenCodeWEB-RoadmapBuffer/1.0"

            def log_message(self, fmt: str, *args: Any) -> None:
                pass

            def _handle(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                path = self.path.split("?", 1)[0]
                status, extra, payload = buffer.route_request(self.command, path, body)
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

    def route_request(self, method: str, path: str, body: bytes) -> tuple[int, dict[str, Any], bytes]:
        def _json(code: int, obj: dict[str, Any]) -> tuple[int, dict[str, Any], bytes]:
            payload = json.dumps(obj).encode("utf-8")
            return (code, {"Content-Type": "application/json; charset=utf-8"}, payload)

        if path == "/health" and method == "GET":
            return _json(200, {"status": "ok", "service": "roadmap-local-buffer", "url": f"http://absup:{self.port}/"})
        if path == "/snapshot" and method == "GET":
            return _json(200, {"ok": True, **self.roadmap.snapshot()})
        if path == "/chat" and method == "POST":
            p = SystemDaemon._body_json(body)
            author = str(p.get("author", "guest"))
            text = str(p.get("text", "")).strip()
            if not text:
                return _json(400, {"ok": False, "error": "text required"})
            outcome = self.roadmap.ingest_chat([ChatMessage(author=author, text=text)])
            return _json(200, {"ok": True, **outcome})
        if path == "/vote" and method == "POST":
            p = SystemDaemon._body_json(body)
            return _json(200, self.roadmap.vote(str(p.get("poll_id", "")), str(p.get("option", "")), str(p.get("user", "guest"))))
        if path == "/upvote" and method == "POST":
            p = SystemDaemon._body_json(body)
            return _json(200, self.roadmap.upvote_item(str(p.get("item_id", "")), str(p.get("user", "guest"))))
        if path == "/sync" and method == "GET":
            return _json(200, self.roadmap.sync(dry_run=True))
        return _json(404, {"error": "not found", "path": path})


# ---------------------------------------------------------------------------
# System Daemon
# ---------------------------------------------------------------------------


class SystemDaemon:
    """OS Kernel: supervises services, runs roadmap buffer + pods, IPC server."""

    def __init__(
        self,
        port: int = DEFAULT_PORT,
        host: str = DEFAULT_HOST,
        spawn_children: bool = True,
        tls_cert: str | None = None,
        tls_key: str | None = None,
    ) -> None:
        self.port = port
        self.host = host
        self.spawn_children = spawn_children
        self.tls_cert = tls_cert
        self.tls_key = tls_key
        self.ui_dir = UI_DIR
        self.roadmap = RoadmapEngine()
        self.pods = PodOrchestrator()
        self.buffer = RoadmapBuffer(self.roadmap, port=ROADMAP_PORT)
        self.started_at = time.time()
        self.server: ThreadingHTTPServer | None = None
        self._ws_clients: list[WebSocketConnection] = []
        self._ws_lock = threading.Lock()
        self._status_seq = 0
        self._shutdown = threading.Event()
        self._log_tail: list[str] = []
        self._children: list[subprocess.Popen] = []
        self._bind_host = "127.0.0.1"
        try:
            self.roadmap.load()
        except Exception:  # noqa: BLE001 - state may be absent on first run
            pass

    # -- logging / WS -----------------------------------------------------------

    def _log(self, fmt: str, *args: Any) -> None:
        line = f"[{time.strftime('%H:%M:%S')}] {fmt % args if args else fmt}"
        _logger.info("%s", line)
        self._log_tail.append(line)
        if len(self._log_tail) > LOG_TAIL_MAX:
            del self._log_tail[: len(self._log_tail) - LOG_TAIL_MAX]
        self._broadcast("logs", self.logs_tail(5))

    def logs_tail(self, n: int = 40) -> list[str]:
        return list(self._log_tail[-n:])

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

    # -- child service supervision ------------------------------------------------

    def _start_children(self) -> None:
        if not self.spawn_children:
            return
        for name, spec in SERVICES.items():
            url = spec["url"]
            if self._http_ok(f"http://127.0.0.1:{spec['port']}{spec['health']}"):
                self._log("child service %s already up at %s", name, url)
                continue
            try:
                proc = subprocess.Popen(
                    [sys.executable, "-m", spec["module"], "--port", str(spec["port"]), "--host", DEFAULT_HOST],
                    cwd=str(REPO_ROOT),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    stdin=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
                self._children.append(proc)
                self._log("spawned child service %s (pid %d) at %s", name, proc.pid, url)
            except OSError as exc:
                self._log("failed to spawn child service %s: %s", name, exc)

    def _supervise_children(self) -> None:
        """Watchdog: restart any crashed child service (no artificial limit)."""
        while not self._shutdown.is_set():
            for name, spec in SERVICES.items():
                url = spec["url"]
                if not self._http_ok(f"http://127.0.0.1:{spec['port']}{spec['health']}"):
                    self._log("child service %s down at %s — restarting", name, url)
                    try:
                        proc = subprocess.Popen(
                            [sys.executable, "-m", spec["module"], "--port", str(spec["port"]), "--host", DEFAULT_HOST],
                            cwd=str(REPO_ROOT),
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            stdin=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                        )
                        self._children.append(proc)
                    except OSError as exc:
                        self._log("restart failed for %s: %s", name, exc)
            self._shutdown.wait(5.0)

    # -- pod management ------------------------------------------------------------

    def _start_pods(self) -> None:
        """Profile hardware + spawn device-adaptive pods; offload to edge if saturated."""
        # Reconcile any stale registry from a previous daemon instance first.
        self.pods.reconcile()
        profile = self.pods.profile()
        self._log(
            "device profile: %d cores, %.1f GiB RAM, GPU=%s, Vulkan=%s, CUDA=%s",
            profile.cpu_cores, profile.ram_bytes / (1024 ** 3), profile.gpu_name or "none",
            profile.vulkan, profile.cuda,
        )
        capacity = self.pods.capacity()
        self._log("device-adaptive pod capacity: %d (unlimited policy, hardware-bound)", capacity)
        if capacity > 0:
            spawned = self.pods.spawn_until_saturated(max_new=capacity)
            self._log("spawned %d local pods (http://absup:8100+...)", len(spawned))
        elif self.pods.saturated():
            self._log("local hardware saturated — offloading to edge pods")
            offload = self.pods.offload_to_edge(reason="device saturation at boot")
            self._log("edge offload request: %s", offload.get("ok", False))

    # -- HTTP helpers --------------------------------------------------------------

    @staticmethod
    def _http_ok(url: str, timeout_s: float = 2.0) -> bool:
        try:
            with urllib.request.urlopen(url, timeout=timeout_s) as response:
                return response.status == 200
        except (urllib.error.URLError, OSError, TimeoutError):
            return False

    def _proxy_get(self, url: str) -> dict[str, Any]:
        try:
            request = urllib.request.Request(url, headers={"X-ABsUP-Auth": AUTH_TOKEN})
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.loads(response.read().decode("utf-8", errors="replace"))
        except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError) as exc:
            return {"ok": False, "error": str(exc)}

    # -- status / health --------------------------------------------------------------

    def _scheme(self) -> str:
        return "https" if self.tls_cert else "http"

    def status_snapshot(self) -> dict[str, Any]:
        """Combined kernel/AiA/edge/daemon status for the dashboard.

        Emits the UI-compatible shape (kernel/hardware/aia/edge/roadmap/daemon)
        plus richer extras (services, pods, buffer) for programmatic clients.
        """
        aia = self._proxy_get(f"http://127.0.0.1:{AIA_PORT}/status")
        edge = self._proxy_get(f"http://127.0.0.1:{EDGE_PORT}/status")
        aia_up = bool(aia.get("engine"))
        aia_core = aia.get("aia") or {}
        self._status_seq += 1

        profile = self.pods.profile()
        scheme = self._scheme()
        ws_scheme = "wss" if self.tls_cert else "ws"
        hw = {
            "cpu_threads": profile.cpu_cores if profile.cpu_cores else (os.cpu_count() or 0),
            "ram_bytes": self._ram_bytes() or 0,
            "vulkan": bool(profile.gpu_name),
            "cuda": bool(profile.gpu_name),
            "platform": platform.platform(),
            "python": platform.python_version(),
        }

        child_pid = next(
            (p.pid for p in self._children if p.poll() is None),
            None,
        )

        return {
            "ok": True,
            "seq": self._status_seq,
            "ts": time.time(),
            "daemon": {
                "uptime_s": round(time.time() - self.started_at, 1),
                "port": self.port,
                "local_endpoint": f"{scheme}://absup:{self.port}",
                "zero_constraint": ZERO_CONSTRAINT_NOTE,
            },
            "kernel": {
                "online": True,
                "ipc": f"{ws_scheme}://absup:{self.port}/ws",
                "status": {
                    "uptime_s": round(time.time() - self.started_at, 1),
                    "aia_running": aia_up,
                    "aia_pid": child_pid or None,
                },
            },
            "hardware": hw,
            "aia": {
                "engine": aia.get("engine"),
                "uptime_s": aia.get("uptime_s"),
                "context": aia_core.get("context") or {"recent": [], "summaries": []},
                "guard_rejections": aia_core.get("guard_rejections", 0),
                "local_model": aia.get("local_model"),
                "lessons": aia.get("lessons"),
            },
            "edge": edge,
            "roadmap": {
                "items": len([i for i in self.roadmap.items if i.status != "archived"]),
                "polls": len([p for p in self.roadmap.polls if p.active]),
                "leaderboard": self.roadmap.leaderboard_view()[:10],
            },
            # rich extras (ignored by the dashboard UI)
            "services": {
                "aia": {"online": aia_up, "url": f"http://absup:{AIA_PORT}/", "detail": aia},
                "edge": {"online": bool(edge.get("ok", False)), "url": f"http://absup:{EDGE_PORT}/", "detail": edge},
            },
            "pods": self.pods.snapshot(),
            "buffer": {"online": True, "url": f"http://absup:{ROADMAP_PORT}/"},
        }

    def health(self) -> dict[str, Any]:
        aia_up = self._http_ok(f"http://127.0.0.1:{AIA_PORT}/health")
        edge_up = self._http_ok(f"http://127.0.0.1:{EDGE_PORT}/health")
        pod_active = len([p for p in self.pods.pods if p.status == "active"])
        return {
            "status": "ok",
            "host": DEFAULT_HOST,
            "port": self.port,
            "cpu_threads": os.cpu_count() or 0,
            "ram_bytes": self._ram_bytes(),
            "services": {
                "kernel": f"http://absup:{self.port}/",
                "aia": {"online": aia_up, "url": f"http://absup:{AIA_PORT}/"},
                "edge": {"online": edge_up, "url": f"http://absup:{EDGE_PORT}/"},
                "roadmap": {"online": True, "url": f"http://absup:{ROADMAP_PORT}/"},
            },
            "pods_active": pod_active,
            "policy": ZERO_CONSTRAINT_NOTE,
        }

    @staticmethod
    def _ram_bytes() -> int | None:
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
        return None

    # -- handlers -----------------------------------------------------------------------

    def handle_roadmap_chat(self, payload: dict[str, Any]) -> dict[str, Any]:
        author = str(payload.get("author", "guest"))
        text = str(payload.get("text", "")).strip()
        if not text:
            return {"ok": False, "error": "text required"}
        outcome = self.roadmap.ingest_chat([ChatMessage(author=author, text=text)])
        self._log("roadmap chat from %s: %s", author, text[:60])
        return {"ok": True, **outcome}

    def handle_roadmap_sync(self) -> dict[str, Any]:
        return self.roadmap.sync(dry_run=True)

    # -- routing ---------------------------------------------------------------------------

    def route(self, method: str, path: str, query: dict[str, list[str]], body: bytes) -> tuple[int, dict[str, Any], bytes, str]:
        if path in ("/", "/index.html"):
            return self._serve_file("index.html")
        if path.startswith("/ui/"):
            return self._serve_file(path[len("/ui/") :])
        if path == "/favicon.ico":
            return self._serve_file("favicon.svg", fallback_ok=True)

        if path == "/health" and method == "GET":
            return self._json(200, self.health())
        if path == "/api/status" and method == "GET":
            return self._json(200, self.status_snapshot())
        if path == "/api/directive" and method == "GET":
            return self._json(200, {"directive": ZERO_CONSTRAINT_NOTE})
        if path == "/api/aia/status" and method == "GET":
            return self._json(200, self._proxy_get(f"http://127.0.0.1:{AIA_PORT}/status"))
        if path == "/api/aia/prompt" and method == "POST":
            return self._json(200, self._proxy_post(f"http://127.0.0.1:{AIA_PORT}/prompt", self._body_json(body)))
        if path == "/api/aia/chat" and method == "POST":
            payload = self._body_json(body)
            # UI contract sends {text, author}; engine expects {task, author}.
            if "text" in payload and "task" not in payload:
                payload["task"] = payload["text"]
            outcome = self._proxy_post(f"http://127.0.0.1:{AIA_PORT}/chat", payload)
            # Translate engine output into the dashboard UI contract:
            # {ok, result: {accepted, response, verdict, recalled_summaries}}.
            if outcome.get("ok"):
                agent = outcome.get("agent") or {}
                if agent.get("accepted") is False:
                    verdict = agent.get("verdict") or {}
                    outcome = {
                        "ok": True,
                        "result": {
                            "accepted": False,
                            "verdict": {
                                "reason": verdict.get("reasons", ["rejected by policy"])[0],
                                **verdict,
                            },
                            "response": None,
                        },
                    }
                else:
                    result = agent.get("result") or {}
                    stdout = str(result.get("stdout") or "").strip()
                    outcome = {
                        "ok": True,
                        "result": {
                            "accepted": True,
                            "response": stdout or "(task completed)",
                            "verdict": agent.get("reflection") or {},
                            "recalled_summaries": agent.get("recalled_summaries") or [],
                            "steps": agent.get("steps", 0),
                            "complete": agent.get("complete", False),
                        },
                        "lesson": outcome.get("lesson"),
                    }
            return self._json(200, outcome)
        if path == "/api/edge/status" and method == "GET":
            return self._json(200, self._proxy_get(f"http://127.0.0.1:{EDGE_PORT}/status"))
        if path == "/api/edge/spawn" and method == "POST":
            return self._json(200, self._proxy_post(f"http://127.0.0.1:{EDGE_PORT}/spawn", self._body_json(body)))
        if path == "/api/edge/provision" and method == "POST":
            return self._json(200, self._proxy_post(f"http://127.0.0.1:{EDGE_PORT}/provision", {}))
        if path == "/api/roadmap/snapshot" and method == "GET":
            return self._json(200, {"ok": True, **self.roadmap.snapshot()})
        if path == "/api/roadmap/chat" and method == "POST":
            return self._json(200, self.handle_roadmap_chat(self._body_json(body)))
        if path == "/api/roadmap/vote" and method == "POST":
            p = self._body_json(body)
            result = self.roadmap.vote(
                str(p.get("poll_id", "")),
                str(p.get("option", "")),
                str(p.get("user", "guest")),
            )
            return self._json(200, result)
        if path == "/api/roadmap/upvote" and method == "POST":
            p = self._body_json(body)
            return self._json(200, self.roadmap.upvote_item(str(p.get("item_id", "")), str(p.get("user", "guest"))))
        if path == "/api/roadmap/sync" and method == "GET":
            return self._json(200, self.handle_roadmap_sync())
        if path == "/api/pods/status" and method == "GET":
            return self._json(200, {"ok": True, **self.pods.snapshot()})
        if path == "/api/pods/spawn" and method == "POST":
            pod = self.pods.spawn()
            return self._json(200, {"ok": pod is not None, "pod": pod.to_dict() if pod else None})
        if path == "/api/pods/offload" and method == "POST":
            return self._json(200, self.pods.offload_to_edge())

        return self._json(404, {"error": "not found", "path": path})

    def _proxy_post(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            request = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "X-ABsUP-Auth": AUTH_TOKEN},
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8", errors="replace"))
        except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError) as exc:
            return {"ok": False, "error": str(exc)}

    def _serve_file(self, rel: str, fallback_ok: bool = False) -> tuple[int, dict[str, Any], bytes, str]:
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
        }.get(target.suffix.lower(), "application/octet-stream")
        return (200, {"Content-Type": content_type, "Cache-Control": "no-store"}, target.read_bytes(), content_type)

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

    # -- lifecycle ---------------------------------------------------------------------------

    def start(self) -> None:
        try:
            socket.gethostbyname(self.host)
            self._bind_host = self.host
        except OSError:
            _logger.warning("hosts alias %r missing — falling back to 127.0.0.1", self.host)
            self._bind_host = "127.0.0.1"

        self._start_children()
        self._start_pods()
        threading.Thread(target=self._supervise_children, name="child-supervisor", daemon=True).start()

        self.buffer.start()
        threading.Thread(target=self.buffer.serve_forever, name="roadmap-buffer", daemon=True).start()

        handler = self._make_handler()
        self.server = TLSThreadingHTTPServer((self._bind_host, self.port), handler)
        self.server.daemon_threads = True
        if self.tls_cert and self.tls_key:
            import ssl

            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(self.tls_cert, self.tls_key)
            self.server.tls_context = context
            scheme = "https"
        else:
            self.server.tls_context = None
            scheme = "http"
        self._log(
            "system daemon listening on %s://%s:%d",
            scheme,
            self._bind_host,
            self.port,
        )
        threading.Thread(target=self._status_ticker, name="status-ticker", daemon=True).start()

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
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
        for proc in self._children:
            try:
                if proc.poll() is None:
                    proc.terminate()
            except OSError:
                pass

    def _make_handler(self):
        daemon = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "OpenCodeWEB-Kernel/1.0"

            def log_message(self, fmt: str, *args: Any) -> None:
                pass

            def _handle_ws(self) -> None:
                key = self.headers.get("Sec-WebSocket-Key", "")
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
                self.send_header("X-ABsUP-Auth", AUTH_TOKEN)
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
                self.send_header("X-ABsUP-Auth", AUTH_TOKEN)
                self.end_headers()
                self.wfile.write(body_out)

        return Handler


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="system_daemon", description="OpenCodeWEB OS system daemon (absup:8080)")
    parser.add_argument("--port", "-p", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", type=str, default=DEFAULT_HOST)
    parser.add_argument("--no-children", action="store_true", help="do not spawn child services")
    parser.add_argument("--tls-cert", type=str, default=str(REPO_ROOT / "certs" / "absup-server.crt"),
                        help="TLS certificate (default: certs/absup-server.crt)")
    parser.add_argument("--tls-key", type=str, default=str(REPO_ROOT / "certs" / "absup-server.key"),
                        help="TLS private key (default: certs/absup-server.key)")
    parser.add_argument("--no-tls", action="store_true", help="serve plain HTTP even if certs exist")
    parser.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    tls_cert = tls_key = None
    if not args.no_tls:
        cert = Path(args.tls_cert)
        key = Path(args.tls_key)
        if cert.is_file() and key.is_file():
            tls_cert, tls_key = str(cert), str(key)
        else:
            _logger.warning("TLS certs not found (%s / %s) — serving plain HTTP", args.tls_cert, args.tls_key)
    daemon = SystemDaemon(
        port=args.port,
        host=args.host,
        spawn_children=not args.no_children,
        tls_cert=tls_cert,
        tls_key=tls_key,
    )
    daemon.start()
    _logger.info("%s", ZERO_CONSTRAINT_NOTE)
    scheme = "https" if daemon.tls_cert else "http"
    print(f"OpenCodeWEB OS system daemon: {scheme}://absup:{daemon.port} (bind host {daemon._bind_host})")
    try:
        daemon.serve_forever()
    except KeyboardInterrupt:
        daemon.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
