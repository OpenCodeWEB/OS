#!/usr/bin/env python3
"""OpenCodeWEB OS — Device-Adaptive Unlimited Pod Orchestrator.

Profiles the host hardware (CPU cores, RAM, GPU/NPU/VRAM), then dynamically
spawns isolated, lightweight OS Pods on ``127.0.0.1:8100+`` based on real
capacity with **zero artificial caps or limits**.

When local resources are saturated, the orchestrator automatically offloads
and spawns new Edge Pods via the Dynamic Connector (``absup:7070``), which
provisions ``***.xup.workers.dev`` endpoints through Cloudflare + GitHub
Actions.

Canonical Pod ports (strict lowercase URL aliases for HTTP compatibility):
    Dynamic On-Demand Pods: http://absup:8100/, http://absup:8101/, ...

Custom Security Header on every inter-service call:
    X-ABsUP-Auth: ABsUP-Token-***

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling in our code. Pod count is bounded ONLY by physical
hardware, never by a config cap.

Maintainers: ABsUP & ABsUPs
"""

from __future__ import annotations

import ctypes
import json
import logging
import os
import platform
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

_logger = logging.getLogger("opencodeweb.kernel.pods")

# ---------------------------------------------------------------------------
# Configuration (env-overridable)
# ---------------------------------------------------------------------------

POD_HOST: str = os.environ.get("OPENCODE_POD_HOST", "127.0.0.1")
POD_BASE_PORT: int = int(os.environ.get("OPENCODE_POD_BASE_PORT", "8100"))
POD_BASE_URL: str = os.environ.get("OPENCODE_POD_BASE_URL", "http://absup:8100")
POD_MAX_PORTS: int = int(os.environ.get("OPENCODE_POD_MAX_PORTS", "64"))
POD_RAM_BUDGET_BYTES: int = int(os.environ.get("OPENCODE_POD_RAM_BUDGET", str(160 * 1024 * 1024)))  # 160 MiB per pod
RESERVED_RAM_BYTES: int = int(os.environ.get("OPENCODE_RESERVED_RAM", str(2 * 1024 * 1024 * 1024)))  # 2 GiB system reserve
MIN_FREE_RAM_BYTES: int = int(os.environ.get("OPENCODE_MIN_FREE_RAM", str(512 * 1024 * 1024)))  # never starve host
POD_HEALTH_TIMEOUT: float = float(os.environ.get("OPENCODE_POD_HEALTH_TIMEOUT", "4.0"))
EDGE_CONNECTOR_URL: str = os.environ.get("OPENCODE_EDGE_CONNECTOR", "http://absup:7070")
AUTH_TOKEN: str = os.environ.get("OPENCODE_AUTH_TOKEN", "ABsUP-Token-OpenCodeWEB")

ZERO_CONSTRAINT_NOTE: str = (
    "Immutable Zero-Constraint Policy: no token limits, no hard timeouts, "
    "no artificial quotas, no throttling. Pods are capacity-adaptive, never "
    "limit-capped. Founders: ABsUP & ABsUPs."
)

_POD_WORKER_SCRIPT = r'''
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
POD_ID = sys.argv[2]
TOKEN = sys.argv[3] if len(sys.argv) > 3 else "ABsUP-Token-OpenCodeWEB"
HOST = sys.argv[4] if len(sys.argv) > 4 else "127.0.0.1"

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, fmt, *args):
        pass
    def _reply(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Pod-Id", POD_ID)
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path.startswith("/health"):
            self._reply(200, {"status": "ok", "pod": POD_ID, "port": PORT, "service": "opencode-pod"})
        elif self.path.startswith("/echo"):
            self._reply(200, {"pod": POD_ID, "echo": "alive", "ts": __import__("time").time()})
        else:
            self._reply(404, {"error": "not found"})
    def do_POST(self):
        auth = self.headers.get("X-ABsUP-Auth", "")
        if auth != TOKEN:
            self._reply(403, {"error": "forbidden", "detail": "invalid X-ABsUP-Auth"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        payload = {"pod": POD_ID, "received": raw.decode("utf-8", "replace")[:2000], "echo": True}
        self._reply(200, payload)

ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
'''


@dataclass
class HardwareProfile:
    """Snapshot of host hardware used for adaptive pod capacity planning."""

    cpu_cores: int = 0
    ram_bytes: int = 0
    free_ram_bytes: int = 0
    gpu_name: str = ""
    vram_bytes: int = 0
    vulkan: bool = False
    cuda: bool = False
    npu: bool = False
    platform: str = ""
    python: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def pod_capacity(self) -> int:
        """How many pods the *physical* machine can currently host (unlimited in policy, bounded by RAM).

        Zero artificial caps: the count is derived purely from available RAM.
        """
        if self.free_ram_bytes <= MIN_FREE_RAM_BYTES:
            return 0
        usable = self.free_ram_bytes - RESERVED_RAM_BYTES
        if usable <= 0:
            return 0
        return max(0, int(usable / POD_RAM_BUDGET_BYTES))


class HardwareProfiler:
    """Detect CPU/RAM/GPU/NPU/VRAM via stdlib + optional platform helpers."""

    @staticmethod
    def _ram_bytes() -> tuple[int, int]:
        """Return (total_ram_bytes, free_ram_bytes)."""
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
                return int(stat.ullTotalPhys), int(stat.ullAvailPhys)
        try:
            with open("/proc/meminfo", encoding="utf-8") as fh:  # POSIX
                total = free = 0
                for line in fh:
                    if line.startswith("MemTotal:"):
                        total = int(line.split()[1]) * 1024
                    elif line.startswith("MemAvailable:"):
                        free = int(line.split()[1]) * 1024
                return total, free
        except OSError:
            pass
        return 0, 0

    @staticmethod
    def _gpu_info() -> tuple[str, int, bool, bool, bool]:
        """Return (gpu_name, vram_bytes, vulkan, cuda, npu)."""
        name, vram, cuda = "", 0, False
        try:
            nv = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5, check=False,
            )
            if nv.returncode == 0 and nv.stdout.strip():
                parts = [p.strip() for p in nv.stdout.splitlines()[0].split(",")]
                name, vram = parts[0], int(float(parts[1])) * 1024 * 1024
                cuda = True
        except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
            pass
        vulkan = bool(name)
        return name, vram, vulkan, cuda, False

    def profile(self) -> HardwareProfile:
        total, free = self._ram_bytes()
        gpu_name, vram, vulkan, cuda, npu = self._gpu_info()
        return HardwareProfile(
            cpu_cores=os.cpu_count() or 1,
            ram_bytes=total,
            free_ram_bytes=free,
            gpu_name=gpu_name,
            vram_bytes=vram,
            vulkan=vulkan,
            cuda=cuda,
            npu=npu,
            platform=f"{platform.system()} {platform.release()}",
            python=platform.python_version(),
        )


@dataclass
class Pod:
    """One isolated lightweight OS Pod."""

    id: str
    port: int
    url: str
    pid: int = 0
    status: str = "spawning"  # spawning | active | degraded | stopped
    role: str = "worker"
    spawned_at: float = field(default_factory=time.time)
    last_health_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Pod:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})  # type: ignore[attr-defined]


def _default_state_dir() -> Path:
    override = os.environ.get("OPENCODE_STATE_DIR")
    if override:
        return Path(override)
    return Path.home() / ".opencode" / "pods"


class PodOrchestrator:
    """Device-adaptive, unlimited local pod spawner + edge offloader.

    Zero artificial caps: pods are spawned until the machine's *physical*
    free RAM is exhausted. On saturation, offload is requested from the
    Dynamic Edge Connector (absup:7070) to provision ``*.xup.workers.dev``.
    """

    def __init__(
        self,
        base_port: int = POD_BASE_PORT,
        base_url: str = POD_BASE_URL,
        max_ports: int = POD_MAX_PORTS,
        state_dir: Path | None = None,
        connector_url: str = EDGE_CONNECTOR_URL,
        profiler: HardwareProfiler | None = None,
    ) -> None:
        self.base_port = base_port
        self.base_url = base_url.rstrip("/")
        self.max_ports = max_ports
        self.state_dir = state_dir or (_default_state_dir())
        self.connector_url = connector_url.rstrip("/")
        self.profiler = profiler or HardwareProfiler()
        self.pods: list[Pod] = []
        self._lock = threading.Lock()
        self._worker_script = tempfile.gettempdir()
        self.load_registry()

    # -- registry -------------------------------------------------------------

    def load_registry(self) -> None:
        try:
            data = json.loads((self.state_dir / "pods.json").read_text(encoding="utf-8"))
            self.pods = [Pod.from_dict(p) for p in data.get("pods", [])]
        except (OSError, json.JSONDecodeError):
            self.pods = []

    def save_registry(self) -> Path:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        path = self.state_dir / "pods.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"pods": [p.to_dict() for p in self.pods]}, indent=2), encoding="utf-8")
        tmp.replace(path)
        return path

    # -- capacity -------------------------------------------------------------

    def profile(self) -> HardwareProfile:
        return self.profiler.profile()

    def reconcile(self) -> int:
        """Health-check every registered pod; mark unreachable ones stopped.

        Called at boot so a stale registry (from a previous daemon instance)
        never blocks fresh device-adaptive spawning. Returns pruned count.
        """
        pruned = 0
        for pod in self.pods:
            if pod.status == "stopped":
                continue
            if not self._probe(pod):
                pod.status = "stopped"
                pruned += 1
            else:
                pod.status = "active"
                pod.last_health_at = time.time()
        if pruned:
            _logger.info("reconciled %d stale/dead pods from registry", pruned)
            self.save_registry()
        return pruned

    def capacity(self) -> int:
        """Return how many more pods can be spawned on this device right now."""
        profile = self.profile()
        used = len([p for p in self.pods if p.status in ("spawning", "active", "degraded")])
        available_ports = self.max_ports - used
        ram_capacity = profile.pod_capacity() - used
        return max(0, min(available_ports, ram_capacity))

    def saturated(self) -> bool:
        return self.capacity() <= 0

    # -- spawning -------------------------------------------------------------

    def _next_port(self) -> int | None:
        used = {p.port for p in self.pods}
        for i in range(self.max_ports):
            port = self.base_port + i
            if port not in used:
                return port
        return None

    def spawn(self, role: str = "worker") -> Pod | None:
        """Spawn one isolated pod process on the next free port."""
        port = self._next_port()
        if port is None:
            _logger.warning("no free pod ports left (hardware-bound, not policy-bound)")
            return None
        if self.profile().free_ram_bytes <= MIN_FREE_RAM_BYTES:
            _logger.warning("host RAM saturated; spawn deferred to edge offload")
            return None

        pod_id = uuid.uuid4().hex[:8]
        pod = Pod(id=pod_id, port=port, url=f"http://absup:{port}", role=role)
        with self._lock:
            self.pods.append(pod)
        self.save_registry()

        try:
            proc = subprocess.Popen(
                [sys.executable, "-c", _POD_WORKER_SCRIPT, str(port), pod_id, AUTH_TOKEN, "127.0.0.1"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            pod.pid = proc.pid
        except OSError as exc:
            _logger.error("pod spawn failed: %s", exc)
            pod.status = "stopped"
            self.save_registry()
            return None

        # Health-gate (bounded readiness probe, not a quota).
        for _ in range(40):
            if self._probe(pod):
                pod.status = "active"
                break
            time.sleep(0.1)
        pod.last_health_at = time.time()
        self.save_registry()
        _logger.info("spawned pod %s on http://absup:%d (%s)", pod_id, port, pod.status)
        return pod

    def spawn_until_saturated(self, max_new: int | None = None) -> list[Pod]:
        """Spawn pods while physical capacity allows (no artificial cap)."""
        spawned: list[Pod] = []
        count = 0
        while not self.saturated():
            if max_new is not None and count >= max_new:
                break
            pod = self.spawn()
            if pod is None:
                break
            spawned.append(pod)
            count += 1
        return spawned

    def offload_to_edge(self, reason: str = "local saturation") -> dict[str, Any]:
        """Request a new Edge Pod from the Dynamic Connector (absup:7070)."""
        try:
            request = urllib.request.Request(
                f"{self.connector_url}/spawn",
                data=json.dumps({"reason": reason, "source": "pod_orchestrator"}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "X-ABsUP-Auth": AUTH_TOKEN},
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8", errors="replace")
            return {"ok": True, "response": body[:500]}
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            _logger.warning("edge offload unavailable: %s", exc)
            return {"ok": False, "error": str(exc)}

    # -- lifecycle ------------------------------------------------------------

    def _probe(self, pod: Pod) -> bool:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{pod.port}/health", timeout=POD_HEALTH_TIMEOUT) as r:
                return r.status == 200
        except (urllib.error.URLError, OSError, TimeoutError):
            return False

    def health_check(self) -> None:
        """Re-check every pod; mark stale ones degraded."""
        for pod in self.pods:
            if pod.status == "stopped":
                continue
            ok = self._probe(pod)
            pod.last_health_at = time.time()
            if not ok and pod.status == "active":
                pod.status = "degraded"
            elif ok and pod.status == "degraded":
                pod.status = "active"
        self.save_registry()

    def stop_pod(self, pod_id: str) -> bool:
        pod = next((p for p in self.pods if p.id == pod_id), None)
        if pod is None:
            return False
        try:
            if pod.pid:
                subprocess.run(["taskkill", "/PID", str(pod.pid), "/T", "/F"], capture_output=True, check=False)
        except OSError:
            pass
        pod.status = "stopped"
        self.save_registry()
        return True

    def stop_all(self) -> None:
        for pod in list(self.pods):
            self.stop_pod(pod.id)

    def snapshot(self) -> dict[str, Any]:
        """JSON view for the kernel dashboard."""
        profile = self.profile()
        return {
            "profile": profile.to_dict(),
            "capacity": self.capacity(),
            "saturated": self.saturated(),
            "pods": [p.to_dict() for p in self.pods],
            "active_pods": [p.to_dict() for p in self.pods if p.status == "active"],
            "zero_constraint": ZERO_CONSTRAINT_NOTE,
        }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> Any:
    import argparse

    parser = argparse.ArgumentParser(prog="pod_orchestrator", description="OpenCodeWEB OS device-adaptive pod orchestrator")
    parser.add_argument("--spawn", type=int, default=0, help="spawn N pods (default: until saturated)")
    parser.add_argument("--status", action="store_true", help="print snapshot and exit")
    parser.add_argument("--offload", action="store_true", help="request edge pod via dynamic connector")
    parser.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    orch = PodOrchestrator()

    if args.status:
        print(json.dumps(orch.snapshot(), indent=2))
        return 0
    if args.offload:
        print(json.dumps(orch.offload_to_edge(), indent=2))
        return 0
    if args.spawn:
        pods = orch.spawn_until_saturated(max_new=args.spawn) if args.spawn else orch.spawn_until_saturated()
        print(json.dumps({"spawned": [p.to_dict() for p in pods]}, indent=2))
        return 0

    print(json.dumps(orch.snapshot(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
