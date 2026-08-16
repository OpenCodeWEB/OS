#!/usr/bin/env python3
"""OpenCodeWEB OS — AiA Master Intelligence Engine (canonical HTTP agent).

The production entry point for the AiA brain, bound to ``http://absup:9090/``.
Composes the proven OpenCodeWEB subsystems into a single zero-constraint
agentic service:

    * Unlimited Context Window   -> core.aia.aia_engine.ContextWindow
    * Zero-Constraint Guardrail  -> core.aia.aia_engine.ZeroConstraintGuard
    * Limitation Remover         -> core.aia.aia_engine.LimitationRemover
    * ReAct + Reflection Agent   -> core.aia.agent_core.ReActAgent
    * Continuous Learning Loop   -> core.aia.learning_loop.LearningLoop
    * Shared Memory Bus          -> core.ipc.shared_memory.SharedMemoryBus
    * Local Model Connector      -> zero-constraint Ollama-style local
                                    inference (no token caps, no timeouts),
                                    with automatic deterministic fallback.

Canonical URL:            http://absup:9090/
Custom Security Header:   X-ABsUP-Auth: ABsUP-Token-***

Endpoints:
    GET  /health                  service probe
    GET  /status                  engine + agent + learning runtime status
    POST /prompt                  {text, author} -> guard + context + response
    POST /chat                    {task} -> ReAct agent loop (autonomous)
    POST /research                {query} -> live web intelligence
    POST /guard                   {text} -> zero-constraint verdict
    POST /strip                   {source, dry_run?} -> limitation remover
    POST /learn                   {task, result} -> continuous learning

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling in our code. Local inference is invoked WITHOUT a
``max_tokens`` cap so the model may reason as long as it needs.

Maintainers: ABsUP & ABsUPs
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.aia.agent_core import ReActAgent, WebRetriever  # noqa: E402
from core.aia.aia_engine import AiAEngine  # noqa: E402
from core.aia.learning_loop import LearningLoop  # noqa: E402

_logger = logging.getLogger("opencodeweb.aia.engine")

DEFAULT_HOST: str = os.environ.get("OPENCODE_AIA_HOST", "ABsUP")
DEFAULT_PORT: int = int(os.environ.get("OPENCODE_AIA_PORT", "9090"))
AUTH_TOKEN: str = os.environ.get("OPENCODE_AUTH_TOKEN", "ABsUP-Token-OpenCodeWEB")
LOCAL_MODEL_URL: str = os.environ.get("OPENCODE_LOCAL_MODEL_URL", "http://127.0.0.1:11434")
LOCAL_MODEL_NAME: str = os.environ.get("OPENCODE_LOCAL_MODEL", "qwen2.5:3b")
ZERO_CONSTRAINT_NOTE: str = (
    "Immutable Zero-Constraint Policy: no token limits, no hard timeouts, "
    "no artificial quotas, no throttling. Local inference is unlimited."
)

LOG_TAIL_MAX: int = 200


# ---------------------------------------------------------------------------
# Local model connector (zero-constraint local inference)
# ---------------------------------------------------------------------------


class LocalModelConnector:
    """Zero-constraint local inference via an Ollama-style REST API.

    The request deliberately omits any ``max_tokens`` / ``options.num_predict``
    cap so the model reasons without artificial limits. If the local model is
    unreachable, callers fall back to the deterministic engine.
    """

    def __init__(self, base_url: str = LOCAL_MODEL_URL, model: str = LOCAL_MODEL_NAME) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    def available(self, timeout_s: float = 2.0) -> bool:
        try:
            with urllib.request.urlopen(f"{self.base_url}/api/tags", timeout=timeout_s) as response:
                return response.status == 200
        except (urllib.error.URLError, OSError, TimeoutError):
            return False

    def generate(self, prompt: str, system: str | None = None) -> dict[str, Any]:
        """Generate an UNLIMITED completion from the local model.

        Returns ``{"ok": True, "text": ...}`` or ``{"ok": False, "error": ...}``.
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            # NOTE: no num_predict / max_tokens -> unlimited reasoning.
        }
        if system:
            payload["system"] = system
        request = urllib.request.Request(
            f"{self.base_url}/api/generate",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                body = json.loads(response.read().decode("utf-8", errors="replace"))
            return {"ok": True, "text": str(body.get("response", "")), "model": self.model}
        except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError) as exc:
            return {"ok": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# AiA Agent Engine service
# ---------------------------------------------------------------------------


class AgentEngine:
    """The canonical AiA brain service (HTTP on absup:9090)."""

    def __init__(
        self,
        port: int = DEFAULT_PORT,
        host: str = DEFAULT_HOST,
        local_model_url: str = LOCAL_MODEL_URL,
        local_model_name: str = LOCAL_MODEL_NAME,
    ) -> None:
        self.port = port
        self.host = host
        self.core = AiAEngine()
        self.agent = ReActAgent()
        self.web = WebRetriever()
        self.learning = LearningLoop()
        self.local = LocalModelConnector(local_model_url, local_model_name)
        self.started_at = time.time()
        self._log_tail: list[str] = []
        self._local_online: bool | None = None
        _logger.info("agent engine initialized (port %d)", port)

    # -- logging ---------------------------------------------------------------

    def _log(self, line: str) -> None:
        _logger.info("%s", line)
        self._log_tail.append(f"[{time.strftime('%H:%M:%S')}] {line}")
        if len(self._log_tail) > LOG_TAIL_MAX:
            del self._log_tail[: len(self._log_tail) - LOG_TAIL_MAX]

    # -- capability helpers ------------------------------------------------------

    def prompt(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Full AiA prompt pipeline with optional unlimited local inference."""
        text = str(payload.get("text", "")).strip()
        author = str(payload.get("author", "ABsUP"))
        if not text:
            return {"ok": False, "error": "text required"}
        self._log(f"prompt from {author}: {text[:80]}")

        verdict = self.core.guard.evaluate(text)
        self.core.context.add("user", text)
        if not verdict.allowed:
            self.core.context.add("system", self.core.directive_text())
            return {
                "ok": True,
                "accepted": False,
                "verdict": verdict.to_dict(),
                "directive": self.core.directive_text(),
            }

        # Zero-constraint local inference when available; deterministic fallback.
        if self.local.available():
            self._local_online = True
            result = self.local.generate(text, system=self.core.directive_text())
            if result.get("ok"):
                response_text = result["text"]
                source = "local-model"
            else:
                response_text = self.core._generate(text)
                source = "deterministic"
        else:
            self._local_online = False
            response_text = self.core._generate(text)
            source = "deterministic"

        self.core.context.add("aia", response_text)
        return {
            "ok": True,
            "accepted": True,
            "author": author,
            "source": source,
            "response": response_text,
            "recalled_summaries": [
                {"score": round(s, 3), "tokens": sm.tokens}
                for s, sm in self.core.context.recall(text)
            ],
            "context": self.core.context.snapshot(),
        }

    def chat(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Run the autonomous ReAct agent loop on a task.

        The Immutable Zero-Constraint guard is evaluated first; proposals that
        violate the policy (rate limits, token caps, hard timeouts, quotas,
        throttling) are permanently rejected before any action runs.
        """
        task = str(payload.get("task", "")).strip()
        if not task:
            return {"ok": False, "error": "task required"}
        verdict = self.core.guard.evaluate(task)
        if not verdict.allowed:
            self._log(f"guard rejected chat task: {task[:80]}")
            return {
                "ok": True,
                "agent": {
                    "task": task,
                    "steps": 0,
                    "complete": False,
                    "accepted": False,
                    "verdict": verdict.to_dict(),
                    "result": None,
                },
            }
        self._log(f"agent task: {task[:80]}")
        result = self.agent.run(task)
        # Continuous learning: distill the outcome into a lesson.
        lesson = self.learning.learn(task, result.get("result") or {})
        return {
            "ok": True,
            "agent": result,
            "lesson": lesson.to_dict() if lesson else None,
        }

    def research(self, payload: dict[str, Any]) -> dict[str, Any]:
        query = str(payload.get("query", "")).strip()
        if not query:
            return {"ok": False, "error": "query required"}
        return self.web.fetch(query)

    def guard(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True, "verdict": self.core.guard.evaluate(str(payload.get("text", ""))).to_dict()}

    def strip(self, payload: dict[str, Any]) -> dict[str, Any]:
        source = str(payload.get("source", "")).strip()
        if not source:
            return {"ok": False, "error": "source required"}
        dry_run = bool(payload.get("dry_run", True))
        module = str(payload.get("module", Path(source).name))
        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "files": [r.to_dict() for r in self.core.limiter.scan_tree(Path(source))],
            }
        return {"ok": True, "manifest": self.core.limiter.prepare_release(module, Path(source))}

    def _gunx_publish(self, kind: str, data: dict[str, Any]) -> None:
        """Best-effort publish of AiA events to the GunX global graph via the
        OS GunBridge (soul: ``os/aia/events``, e.g. ``learn-<ts>``). Requires
        ``GUN_BRIDGE_TOKEN`` (plus optional ``GUN_BRIDGE_URL``); silently
        no-ops when unconfigured so telemetry never breaks the engine."""
        token = os.environ.get("GUN_BRIDGE_TOKEN", "")
        if not token:
            return
        url = os.environ.get("GUN_BRIDGE_URL", "https://absup:8766").rstrip("/")
        payload = {"kind": kind, "ts": time.time(), **data}
        req = urllib.request.Request(
            f"{url}/put",
            data=json.dumps(payload).encode("utf-8"),
            method="PUT",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp.read()
        except Exception as exc:  # noqa: BLE001 — telemetry must never break AiA
            _logger.debug("gunx publish skipped: %s", exc)

    def learn(self, payload: dict[str, Any]) -> dict[str, Any]:
        task = str(payload.get("task", "")).strip()
        result = payload.get("result") or {}
        if not task:
            return {"ok": False, "error": "task required"}
        lesson = self.learning.learn(task, result)
        self._gunx_publish("learn", {"task": task[:200], "lessons": self.learning.store.count()})
        return {"ok": True, "lesson": lesson.to_dict() if lesson else None}

    # -- status -------------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        return {
            "engine": "AiA Master Intelligence Engine",
            "uptime_s": round(time.time() - self.started_at, 1),
            "port": self.port,
            "url": f"http://absup:{self.port}/",
            "local_model": {"online": self.local.available() if self._local_online is not None else self._local_online,
                            "endpoint": self.local.base_url, "model": self.local.model},
            "aia": self.core.status(),
            "agent_tools": self.agent.registry.names(),
            "lessons": self.learning.store.count(),
            "policy": ZERO_CONSTRAINT_NOTE,
            "maintainers": ["ABsUP", "ABsUPs"],
        }

    def health(self) -> dict[str, Any]:
        return {"status": "ok", "service": "aia-agent-engine", "url": f"http://absup:{self.port}/", "ts": time.time()}

    # -- HTTP routing ----------------------------------------------------------------

    def route(self, method: str, path: str, body: bytes) -> tuple[int, dict[str, Any], bytes]:
        def _json(code: int, obj: dict[str, Any]) -> tuple[int, dict[str, Any], bytes]:
            payload = json.dumps(obj).encode("utf-8")
            return (code, {"Content-Type": "application/json; charset=utf-8"}, payload)

        if path == "/health" and method == "GET":
            return _json(200, self.health())
        if path == "/status" and method == "GET":
            return _json(200, self.status())
        if path == "/prompt" and method == "POST":
            return _json(200, self.prompt(self._body_json(body)))
        if path == "/chat" and method == "POST":
            return _json(200, self.chat(self._body_json(body)))
        if path == "/research" and method == "POST":
            return _json(200, self.research(self._body_json(body)))
        if path == "/guard" and method == "POST":
            return _json(200, self.guard(self._body_json(body)))
        if path == "/strip" and method == "POST":
            return _json(200, self.strip(self._body_json(body)))
        if path == "/learn" and method == "POST":
            return _json(200, self.learn(self._body_json(body)))
        return _json(404, {"error": "not found", "path": path})

    @staticmethod
    def _body_json(body: bytes) -> dict[str, Any]:
        try:
            parsed = json.loads(body.decode("utf-8")) if body else {}
            return parsed if isinstance(parsed, dict) else {"_raw": parsed}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    # -- lifecycle ---------------------------------------------------------------------

    def start(self) -> None:
        self._resolve_bind_host()
        handler = self._make_handler()
        self.server = ThreadingHTTPServer((self._bind_host, self.port), handler)
        self.server.daemon_threads = True
        self._log(f"agent engine listening on http://{self._bind_host}:{self.port}")

    def _resolve_bind_host(self) -> None:
        import socket

        try:
            socket.gethostbyname(self.host)
            self._bind_host = self.host
        except OSError:
            _logger.warning("hosts alias %r missing — falling back to 127.0.0.1", self.host)
            self._bind_host = "127.0.0.1"

    def serve_forever(self) -> None:
        assert self.server is not None
        try:
            self.server.serve_forever()
        finally:
            self.server.server_close()

    def _make_handler(self):
        engine = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "OpenCodeWEB-AiA/2.0"

            def log_message(self, fmt: str, *args: Any) -> None:
                pass

            def _handle(self) -> None:
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                    body = self.rfile.read(length) if length else b""
                    parsed = self.path.split("?", 1)[0]
                    status, extra, payload = engine.route(self.command, parsed, body)
                except Exception as exc:  # noqa: BLE001 - keep the service alive
                    _logger.exception("request handler error: %s", exc)
                    status = 500
                    extra = {"Content-Type": "application/json; charset=utf-8"}
                    payload = json.dumps({"ok": False, "error": str(exc)}).encode("utf-8")
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
    parser = argparse.ArgumentParser(prog="agent_engine", description="OpenCodeWEB OS AiA agent engine (absup:9090)")
    parser.add_argument("--port", "-p", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", type=str, default=DEFAULT_HOST)
    parser.add_argument("--prompt", help="one-shot prompt (CLI mode)")
    parser.add_argument("--task", "-t", help="one-shot agent task (CLI mode)")
    parser.add_argument("--status", action="store_true", help="print status and exit")
    parser.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    engine = AgentEngine(port=args.port, host=args.host)

    if args.status:
        print(json.dumps(engine.status(), indent=2))
        return 0
    if args.prompt:
        print(json.dumps(engine.prompt({"text": args.prompt}), indent=2))
        return 0
    if args.task:
        print(json.dumps(engine.chat({"task": args.task}), indent=2))
        return 0

    engine.start()
    print(f"OpenCodeWEB OS AiA agent engine: http://absup:{engine.port}")
    try:
        engine.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
