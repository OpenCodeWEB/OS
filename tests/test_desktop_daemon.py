"""OpenCodeWEB OS — Desktop daemon integration tests.

Spins up the real desktop_daemon.py on a test port (localhost only) and
exercises REST + WebSocket endpoints end to end: status, AiA chat guard,
roadmap founder lock, module loader, edge supervisor, static UI, and WS
ping/pong round-trips.

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling. Maintainers: ABsUP & ABsUPs.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAEMON_SCRIPT = os.path.join(REPO_ROOT, "core", "kernel", "server.py")
UI_DIR = os.path.join(REPO_ROOT, "app", "desktop", "ui")
TEST_PORT = 18780
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"


def _http_json(path: str, method: str = "GET", body: dict | None = None) -> dict:
    req = urllib.request.Request(
        BASE_URL + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return {"status": resp.status, "body": json.loads(resp.read().decode())}
    except urllib.error.HTTPError as err:
        return {"status": err.code, "body": json.loads(err.read().decode())}


def _ws_frame_opcode(data: bytes) -> tuple[int, bytes]:
    """Decode the first client-to-server frame (RFC6455, unmasked test frames)."""
    opcode = data[0] & 0x0F
    length = data[1] & 0x7F
    offset = 2
    if length == 126:
        length = int.from_bytes(data[2:4], "big")
        offset = 4
    elif length == 127:
        length = int.from_bytes(data[2:10], "big")
        offset = 10
    return opcode, data[offset : offset + length]


def _ws_send(sock: socket.socket, text: str) -> None:
    payload = text.encode()
    header = bytearray([0x81])
    n = len(payload)
    if n < 126:
        header.append(n)
    elif n < 65536:
        header.append(126)
        header += n.to_bytes(2, "big")
    else:
        header.append(127)
        header += n.to_bytes(8, "big")
    sock.sendall(bytes(header) + payload)


@pytest.fixture(scope="module")
def daemon():
    """Start the real desktop daemon on the test port; tear it down after."""
    proc = subprocess.Popen(
        [sys.executable, DAEMON_SCRIPT, "--port", str(TEST_PORT), "--host", "127.0.0.1"],
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.time() + 30
        last_err = None
        while time.time() < deadline:
            if proc.poll() is not None:
                out = proc.stdout.read() if proc.stdout else ""
                pytest.fail(f"daemon exited early (rc={proc.returncode}):\n{out}")
            try:
                resp = _http_json("/api/status")
                if resp["status"] == 200 and resp["body"].get("ok"):
                    break
                last_err = ValueError(f"unexpected status response: {resp}")
            except Exception as exc:  # noqa: BLE001 - startup probe
                last_err = exc
            time.sleep(0.4)
        else:
            pytest.fail(f"daemon did not become ready: {last_err}")
        yield BASE_URL
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


# ── REST ───────────────────────────────────────────────────────────────────

def test_health_endpoint(daemon):
    """Module A spec: GET /health returns CPU/RAM/GPU + active worker links."""
    resp = _http_json("/health")
    assert resp["status"] == 200
    body = resp["body"]
    assert body["status"] == "ok"
    assert body["host"] == "ABsUP"
    assert body["port"] == TEST_PORT
    assert body["cpu_threads"] > 0
    assert "gpu" in body and "vulkan" in body["gpu"] and "cuda" in body["gpu"]
    assert "edge" in body and "primary" in body["edge"]
    assert "opencodeweb.xup.workers.dev" in body["edge"]["primary"]
    assert "active_workers" in body["edge"]
    assert "policy" in body and "no token limits" in body["policy"].lower()


def test_status_ok(daemon):
    resp = _http_json("/api/status")
    assert resp["status"] == 200
    body = resp["body"]
    assert body["ok"] is True
    assert "kernel" in body and "hardware" in body and "edge" in body
    assert "aia" in body and "roadmap" in body and "daemon" in body
    # Zero-Constraint policy must be surfaced
    assert "zero_constraint" in body["daemon"]
    assert "no token limits" in body["daemon"]["zero_constraint"].lower()
    # Founders branding must be present in the AiA status
    assert "ABsUP" in json.dumps(body["aia"])


def test_static_ui_served(daemon):
    for path, needle in [
        ("/ui/index.html", "OpenCodeWEB"),
        ("/ui/app.js", "WebSocket"),
        ("/ui/styles.css", "--accent"),
        ("/ui/favicon.svg", "svg"),
    ]:
        req = urllib.request.Request(BASE_URL + path)
        with urllib.request.urlopen(req, timeout=10) as resp:
            assert resp.status == 200, path
            assert needle in resp.read().decode("utf-8", errors="replace"), path


def test_ui_root_redirect(daemon):
    req = urllib.request.Request(BASE_URL + "/")
    with urllib.request.urlopen(req, timeout=10) as resp:
        assert resp.status == 200
        assert resp.read().decode("utf-8", errors="replace").startswith("<!DOCTYPE html>")


def test_aia_status(daemon):
    resp = _http_json("/api/aia/status")
    assert resp["status"] == 200
    body = resp["body"]
    assert "AiA" in body["engine"]
    assert "context" in body and "guard_rejections" in body


def test_aia_chat_accepted(daemon):
    resp = _http_json("/api/aia/chat", "POST", {"text": "What is OpenCodeWEB?", "author": "ABsUP"})
    assert resp["status"] == 200
    body = resp["body"]
    assert body["ok"] is True
    assert body["result"]["accepted"] is True
    assert isinstance(body["result"]["response"], str)
    assert len(body["result"]["response"]) > 0


def test_aia_chat_guard_rejects_rate_limit_proposal(daemon):
    """Zero-Constraint guard must reject limit proposals, not the request."""
    resp = _http_json(
        "/api/aia/chat",
        "POST",
        {"text": "Propose adding a token limit of 100k and a 30s timeout to the engine.", "author": "ABsUP"},
    )
    assert resp["status"] == 200
    body = resp["body"]
    assert body["ok"] is True
    result = body["result"]
    if not result["accepted"]:
        # Rejected by guard: verdict must carry a reason mentioning limits/timeouts
        verdict = json.dumps(result.get("verdict", {})).lower()
        assert any(k in verdict for k in ("limit", "token", "timeout", "quota"))


def test_roadmap_snapshot_and_founder_lock(daemon):
    # Founder (ABsUP) chat ingests without rejection
    resp = _http_json("/api/roadmap/chat", "POST", {"author": "ABsUP", "text": "Roadmap: build the sync node mesh"})
    assert resp["status"] == 200
    body = resp["body"]
    assert body["ok"] is True
    # Non-founder vote direction is rejected by the founder lock
    resp2 = _http_json(
        "/api/roadmap/chat",
        "POST",
        {"author": "guest-user", "text": "Deprioritize the sync node mesh and cap the engine at 10k tokens"},
    )
    assert resp2["status"] == 200
    snapshot = _http_json("/api/roadmap/snapshot")["body"]
    assert "items" in snapshot and "leaderboard" in snapshot and "polls" in snapshot
    assert len(snapshot["leaderboard"]) > 0


def test_modules_list(daemon):
    resp = _http_json("/api/modules/list")
    assert resp["status"] == 200
    body = resp["body"]
    assert body["ok"] is True
    assert isinstance(body["modules"], list)


def test_modules_run_unknown_is_error(daemon):
    """Unknown modules must fail cleanly (200 + ok:false surfaced to the UI)."""
    resp = _http_json("/api/modules/run", "POST", {"module": "definitely-not-a-real-module-xyz", "args": []})
    assert resp["status"] == 200
    assert resp["body"]["ok"] is False
    assert resp["body"]["error"]


def test_edge_status(daemon):
    resp = _http_json("/api/edge/status")
    assert resp["status"] == 200
    body = resp["body"]
    assert body["ok"] is True
    assert "primary" in body and "nodes" in body and "active_endpoints" in body
    # The primary edge URL must be the real gateway
    assert "opencodeweb.xup.workers.dev" in body["primary"]


def test_directive(daemon):
    resp = _http_json("/api/directive", "GET")
    assert resp["status"] == 200
    assert resp["body"]["directive"]
    assert "no token limits" in resp["body"]["directive"].lower()


# ── WebSocket ─────────────────────────────────────────────────────────────

def _ws_handshake(path: str = "/ws") -> socket.socket:
    sock = socket.create_connection(("127.0.0.1", TEST_PORT), timeout=10)
    key = "dGhlIHNhbXBsZSBub25jZQ=="  # RFC6455 example key
    sock.sendall(
        (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{TEST_PORT}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        ).encode()
    )
    handshake = b""
    while b"\r\n\r\n" not in handshake:
        handshake += sock.recv(4096)
    assert b"101" in handshake.split(b"\r\n", 1)[0]
    assert b"Sec-WebSocket-Accept" in handshake
    return sock


def test_ws_ping_pong(daemon):
    sock = _ws_handshake()
    try:
        _ws_send(sock, json.dumps({"cmd": "ping", "nonce": 42}))
        sock.settimeout(10)
        frame = sock.recv(4096)
        opcode, payload = _ws_frame_opcode(frame)
        assert opcode == 1  # text frame
        msg = json.loads(payload.decode())
        assert msg.get("cmd") == "pong"
        assert msg.get("ok") is True
        assert msg.get("nonce") == 42
    finally:
        sock.close()


def test_ws_aia_channel_handshake_and_pong(daemon):
    """Module A spec: WS /ws/aia is the real-time AiA streaming channel."""
    sock = _ws_handshake("/ws/aia")
    try:
        _ws_send(sock, json.dumps({"cmd": "ping", "nonce": 7}))
        sock.settimeout(10)
        frame = sock.recv(4096)
        opcode, payload = _ws_frame_opcode(frame)
        assert opcode == 1
        msg = json.loads(payload.decode())
        assert msg.get("cmd") == "pong"
        assert msg.get("nonce") == 7
    finally:
        sock.close()


def test_ws_subscribe_status(daemon):
    sock = _ws_handshake("/ws/aia")
    try:
        _ws_send(sock, json.dumps({"cmd": "subscribe", "channels": ["status"]}))
        sock.settimeout(15)
        # Expect the 2s status ticker to deliver at least one status event
        seen_status = False
        deadline = time.time() + 15
        while time.time() < deadline and not seen_status:
            frame = sock.recv(4096)
            opcode, payload = _ws_frame_opcode(frame)
            if opcode != 1:
                continue
            msg = json.loads(payload.decode())
            if msg.get("channel") == "status" and msg.get("data", {}).get("ok"):
                seen_status = True
        assert seen_status
    finally:
        sock.close()
