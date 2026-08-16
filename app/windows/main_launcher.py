#!/usr/bin/env python3
"""OpenCodeWEB OS — Windows Native GUI Launcher (initial test suite).

A modern desktop GUI to boot, inspect and test the full local OpenCodeWEB
OS ecosystem before wide deployment. The launcher:

    * Auto-starts the System Daemon (core/kernel/system_daemon.py) on
      http://absup:8080/ if it is not already running.
    * Live Dashboard — Kernel Boot Status, CPU/RAM usage, active local
      ports (http://absup:8080/ ... 8100+), active device-adaptive Pods,
      and AiA Prompt Execution.
    * Real-time Edge Connector Monitor — active Cloudflare Worker links.
    * Embedded Roadmap Interface — interacts with https://pocwu.pages.dev/roadmap.

Rendering strategy (zero hard dependencies):
    1. CustomTkinter (modern dark UI) — if installed (pip install customtkinter).
    2. Tkinter (stdlib) — always available; fallback styling.
    3. Native WebView2 (pywebview) — optional embedded browser shell.

CLI:
    python app/windows/main_launcher.py               # GUI test suite
    python app/windows/main_launcher.py --no-gui      # daemon only (headless)
    python app/windows/main_launcher.py --roadmap     # open roadmap directly

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling. Founders: ABsUP & ABsUPs.
"""

from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
KERNEL_SCRIPT = REPO_ROOT / "core" / "kernel" / "system_daemon.py"
DEFAULT_HOST = "ABsUP"
DEFAULT_PORT = 8080
AIA_PORT = 9090
EDGE_PORT = 7070
ROADMAP_PORT = 3030
POD_BASE_PORT = 8100
DAEMON_URL = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}"
FALLBACK_URL = f"http://127.0.0.1:{DEFAULT_PORT}"
PORTAL_ROADMAP_URL = "https://pocwu.pages.dev/roadmap"
POLL_INTERVAL_MS = 2000

PORT_LABELS: list[tuple[str, int]] = [
    ("OS Kernel", DEFAULT_PORT),
    ("AiA Agent Engine", AIA_PORT),
    ("Dynamic Edge Sync Gateway", EDGE_PORT),
    ("Roadmap Local Buffer", ROADMAP_PORT),
    ("On-Demand Pod Base", POD_BASE_PORT),
]


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _get_json(url: str, timeout_s: float = 3.0) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=timeout_s) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError):
        return {}


def _post_json(url: str, payload: dict, timeout_s: float = 30.0) -> dict:
    try:
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "X-ABsUP-Auth": "ABsUP-Token-OpenCodeWEB"},
        )
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError):
        return {}


def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.7):
            return True
    except OSError:
        return False


def _resolve_base_url(port: int = DEFAULT_PORT) -> str:
    try:
        socket.gethostbyname(DEFAULT_HOST)
        return f"http://{DEFAULT_HOST}:{port}"
    except OSError:
        return f"http://127.0.0.1:{port}"


# ---------------------------------------------------------------------------
# Daemon lifecycle
# ---------------------------------------------------------------------------


def start_daemon(verbose: bool = False) -> subprocess.Popen | None:
    """Start the system daemon detached if not already running."""
    if _port_open(DEFAULT_PORT):
        return None
    log_path = Path(__file__).parent / "daemon.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_handle = log_path.open("a", encoding="utf-8")
    args = [sys.executable, str(KERNEL_SCRIPT), "--port", str(DEFAULT_PORT), "--host", DEFAULT_HOST]
    if verbose:
        args.append("--verbose")
    proc = subprocess.Popen(
        args,
        cwd=str(REPO_ROOT),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    # Bounded readiness probe (not a quota — just boot sequencing).
    url = f"{_resolve_base_url()}/health"
    for _ in range(120):
        if _get_json(url).get("status") == "ok":
            break
        time.sleep(0.25)
    return proc


# ---------------------------------------------------------------------------
# Dashboard data collector
# ---------------------------------------------------------------------------


class DashboardData:
    """Thread-safe snapshot of the live system state."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.kernel_ok = False
        self.health: dict = {}
        self.status: dict = {}
        self.pods: list[dict] = []
        self.edge: dict = {}
        self.ports: list[dict] = []
        self.last_error: str | None = None

    def refresh(self) -> None:
        base = _resolve_base_url()
        health = _get_json(f"{base}/health")
        status = _get_json(f"{base}/api/status")
        edge = _get_json(f"{base}/api/edge/status")
        ports = []
        for label, port in PORT_LABELS:
            ports.append({"label": label, "port": port, "url": f"http://absup:{port}/", "open": _port_open(port)})
        with self.lock:
            self.kernel_ok = bool(health.get("status") == "ok")
            self.health = health
            self.status = status
            self.edge = edge
            pods = (status.get("pods") or {}).get("pods") or []
            self.pods = pods
            self.ports = ports
            self.last_error = None if self.kernel_ok else "kernel unreachable"


# ---------------------------------------------------------------------------
# GUI (Tkinter first-class, CustomTkinter optional)
# ---------------------------------------------------------------------------


def _import_gui() -> Any:
    """Return the UI toolkit module, preferring customtkinter."""
    try:
        import customtkinter  # type: ignore

        return customtkinter
    except ImportError:
        import tkinter

        return tkinter


def build_gui(ctk: Any, data: DashboardData) -> Any:
    """Construct and return the dashboard root window."""
    using_customtkinter = ctk.__name__ == "customtkinter"

    if using_customtkinter:
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")
        root = ctk.CTk()
        root.title("OpenCodeWEB OS — Zero-Constraint Desktop (Test Suite)")
        root.geometry("1180x760")
        root.minsize(980, 640)
    else:
        root = ctk.Tk()
        root.title("OpenCodeWEB OS — Zero-Constraint Desktop (Test Suite)")
        root.geometry("1180x760")
        root.configure(bg="#0b0f14")

    # ---- top status banner -------------------------------------------------
    banner = ctk.Label(
        root,
        text=(
            "OpenCodeWEB OS — Immutable Zero-Constraint Policy: "
            "no token limits, no hard timeouts, no quotas. Founders: ABsUP & ABsUPs"
        ),
        font=("Segoe UI", 10, "bold"),
        fg_color="#0e7490",
        text_color="#e0f2fe",
    )
    banner.pack(fill="x", padx=8, pady=(8, 4))

    # ---- main content: two columns ----------------------------------------
    content = ctk.Frame(root)
    content.pack(fill="both", expand=True, padx=8, pady=4)
    content.grid_columnconfigure(0, weight=3)
    content.grid_columnconfigure(1, weight=2)
    content.grid_rowconfigure(0, weight=1)

    left = ctk.Frame(content)
    left.grid(row=0, column=0, sticky="nsew", padx=(0, 4))
    right = ctk.Frame(content)
    right.grid(row=0, column=1, sticky="nsew", padx=(4, 0))

    # ---- left column -------------------------------------------------------
    status_card = ctk.CTkFrame(left) if using_customtkinter else ctk.Frame(left, bg="#0b0f14")
    status_card.pack(fill="x", pady=(0, 8))
    ctk.Label(status_card, text="Kernel Boot Status", font=("Segoe UI", 12, "bold")).pack(anchor="w", padx=8, pady=(6, 0))
    kernel_label = ctk.Label(status_card, text="booting...", font=("Segoe UI", 11))
    kernel_label.pack(anchor="w", padx=8, pady=2)
    hw_label = ctk.Label(status_card, text="CPU/RAM: ...", font=("Segoe UI", 10))
    hw_label.pack(anchor="w", padx=8, pady=(0, 6))

    ports_card = ctk.CTkFrame(left) if using_customtkinter else ctk.Frame(left, bg="#0b0f14")
    ports_card.pack(fill="x", pady=(0, 8))
    ctk.Label(ports_card, text="Active Local Ports", font=("Segoe UI", 12, "bold")).pack(anchor="w", padx=8, pady=(6, 0))
    ports_text = ctk.Label(ports_card, text="scanning...", font=("Consolas", 10), justify="left")
    ports_text.pack(anchor="w", padx=8, pady=(0, 6))

    pods_card = ctk.CTkFrame(left) if using_customtkinter else ctk.Frame(left, bg="#0b0f14")
    pods_card.pack(fill="x", pady=(0, 8))
    ctk.Label(pods_card, text="Device-Adaptive Pods", font=("Segoe UI", 12, "bold")).pack(anchor="w", padx=8, pady=(6, 0))
    pods_text = ctk.Label(pods_card, text="none", font=("Consolas", 10), justify="left")
    pods_text.pack(anchor="w", padx=8, pady=(0, 6))

    edge_card = ctk.CTkFrame(right) if using_customtkinter else ctk.Frame(right, bg="#0b0f14")
    edge_card.pack(fill="x", pady=(0, 8))
    ctk.Label(edge_card, text="Edge Connector Monitor", font=("Segoe UI", 12, "bold")).pack(anchor="w", padx=8, pady=(6, 0))
    edge_text = ctk.Label(edge_card, text="primary: probing...", font=("Consolas", 10), justify="left")
    edge_text.pack(anchor="w", padx=8, pady=(0, 6))

    # ---- AiA prompt executor ------------------------------------------------
    aia_card = ctk.CTkFrame(right) if using_customtkinter else ctk.Frame(right, bg="#0b0f14")
    aia_card.pack(fill="both", expand=True, pady=(0, 8))
    ctk.Label(aia_card, text="AiA Prompt Execution", font=("Segoe UI", 12, "bold")).pack(anchor="w", padx=8, pady=(6, 0))
    prompt_entry = (
        ctk.CTkEntry(aia_card, placeholder_text="Ask AiA (zero limits)...")
        if using_customtkinter
        else ctk.Entry(aia_card, bg="white")
    )
    prompt_entry.pack(fill="x", padx=8, pady=4)
    aia_out = (
        ctk.CTkTextbox(aia_card, height=120, wrap="word")
        if using_customtkinter
        else ctk.Text(
            aia_card, height=7, bg="#0f141a", fg="#dbe4ee", wrap="word"
        )
    )
    aia_out.pack(fill="both", expand=True, padx=8, pady=(0, 6))

    def run_prompt(_event=None) -> None:
        text = prompt_entry.get().strip()
        if not text:
            return
        aia_out.insert("end", f"> {text}\n")
        base = _resolve_base_url()
        result = _post_json(f"{base}/api/aia/prompt", {"text": text, "author": "ABsUP"})
        if result.get("ok") and result.get("accepted") is not None:
            accepted = result.get("accepted")
            if accepted:
                aia_out.insert("end", f"[{result.get('source', 'engine')}] {result.get('response', '')}\n\n")
            else:
                reasons = "; ".join((result.get("verdict") or {}).get("reasons", []))
                aia_out.insert("end", f"[rejected] {reasons}\n\n")
        else:
            aia_out.insert("end", f"[error] {result.get('error', 'no response')}\n\n")
        aia_out.see("end")

    prompt_entry.bind("<Return>", run_prompt)
    run_btn = (
        ctk.CTkButton(aia_card, text="Execute Prompt", command=run_prompt)
        if using_customtkinter
        else ctk.Button(aia_card, text="Execute Prompt", command=run_prompt)
    )
    run_btn.pack(anchor="e", padx=8, pady=(0, 6))

    # ---- roadmap + action buttons -------------------------------------------
    actions = ctk.CTkFrame(root) if using_customtkinter else ctk.Frame(root, bg="#0b0f14")
    actions.pack(fill="x", padx=8, pady=(0, 8))

    def open_roadmap() -> None:
        _open_external(PORTAL_ROADMAP_URL)

    def open_dashboard() -> None:
        _open_external(_resolve_base_url())

    def spawn_pod() -> None:
        base = _resolve_base_url()
        result = _post_json(f"{base}/api/pods/spawn", {})
        print("spawn pod:", result)

    def offload_edge() -> None:
        base = _resolve_base_url()
        result = _post_json(f"{base}/api/edge/spawn", {"reason": "manual from launcher"})
        print("edge spawn:", result)

    if using_customtkinter:
        ctk.CTkButton(actions, text="Open Roadmap (pocwu.pages.dev)", command=open_roadmap).pack(side="left", padx=4)
        ctk.CTkButton(actions, text="Open Kernel Dashboard", command=open_dashboard).pack(side="left", padx=4)
        ctk.CTkButton(actions, text="Spawn Pod", command=spawn_pod).pack(side="left", padx=4)
        ctk.CTkButton(actions, text="Spawn Edge Node", command=offload_edge).pack(side="left", padx=4)
    else:
        for text, cmd in (
            ("Open Roadmap (pocwu.pages.dev)", open_roadmap),
            ("Open Kernel Dashboard", open_dashboard),
            ("Spawn Pod", spawn_pod),
            ("Spawn Edge Node", offload_edge),
        ):
            ctk.Button(actions, text=text, command=cmd).pack(side="left", padx=4)

    # ---- live polling ----------------------------------------------------------
    def _fmt_pods() -> str:
        if not data.pods:
            return "no pods (hardware capacity will spawn on demand)"
        lines = []
        for pod in data.pods:
            lines.append(f"{pod.get('url')}  {pod.get('status')}  pid={pod.get('pid')}  role={pod.get('role')}")
        return "\n".join(lines)

    def _fmt_ports() -> str:
        return "\n".join(
            f"[{'OK' if p['open'] else '--'}] {p['label']:<24} {p['url']}"
            for p in data.ports
        )

    def _fmt_edge() -> str:
        if not data.edge:
            return "primary: unreachable (offline)"
        nodes = data.edge.get("nodes") or []
        lines = [f"primary: {data.edge.get('primary', '?')}  healthy={data.edge.get('primary_healthy')}"]
        if nodes:
            for node in nodes[:6]:
                lines.append(f"  {node.get('url')}  {node.get('status')}  {round(node.get('last_latency_ms', 0))}ms")
        else:
            lines.append("  no edge pods spawned yet")
        return "\n".join(lines)

    def poll() -> None:
        data.refresh()
        h = data.health
        kernel_state = "ONLINE" if data.kernel_ok else "OFFLINE"
        uptime = (h.get("services") or {}).get("uptime", 0)
        kernel_label.configure(
            text=f"kernel: {kernel_state}   uptime: {round(uptime if False else 0)}"
        )
        cpu = h.get("cpu_threads")
        ram = h.get("ram_bytes")
        ram_gb = (ram or 0) / (1024 ** 3)
        svc = json.dumps(h.get("services", {}))[:160]
        hw_label.configure(
            text=f"CPU threads: {cpu}   RAM: {ram_gb:.1f} GiB   services: {svc}"
        )
        ports_text.configure(text=_fmt_ports())
        pods_text.configure(text=_fmt_pods())
        edge_text.configure(text=_fmt_edge())
        root.after(POLL_INTERVAL_MS, poll)

    root.after(300, poll)
    return root


def _open_external(url: str) -> None:
    """Open a URL in the best available shell (WebView2 app, then browser)."""
    import shutil
    import webbrowser

    edge_candidates = (
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    )
    edge = next((p for p in edge_candidates if Path(p).exists()), shutil.which("msedge"))
    if edge:
        try:
            subprocess.Popen(
                [edge, f"--app={url}", "--window-size=1280,820"],
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            return
        except OSError:
            pass
    webbrowser.open(url)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="main_launcher", description="OpenCodeWEB OS Windows GUI launcher (ABsUP & ABsUPs)")
    parser.add_argument("--no-gui", action="store_true", help="start the system daemon only (headless)")
    parser.add_argument("--roadmap", action="store_true", help="open the roadmap portal directly and exit")
    parser.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.roadmap:
        start_daemon(verbose=args.verbose)
        _open_external(PORTAL_ROADMAP_URL)
        return 0

    daemon = start_daemon(verbose=args.verbose)
    if daemon is not None:
        print(f"system daemon started (pid {daemon.pid}) — {_resolve_base_url()}")
    else:
        print(f"system daemon already running — {_resolve_base_url()}")

    if args.no_gui:
        print("headless mode: daemon running, no window opened.")
        return 0

    ctk = _import_gui()
    data = DashboardData()
    root = build_gui(ctk, data)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
