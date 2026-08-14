#!/usr/bin/env python3
"""OpenCodeWEB OS — Hybrid Desktop Launcher (Module B, WebView2 shell).

Opens the OpenCodeWEB OS desktop UI in a native window:

1. **pywebview** (preferred) — a true WebView2 window (Edge runtime,
   preinstalled on Windows 10/11): ``python -m pip install pywebview``.
2. **Edge --app fallback** (zero dependencies) — launches a chromeless
   native Edge/WebView2 app window pointing at the local daemon.

The daemon (core/kernel/server.py) is started automatically if not already
listening on ABsUP:8080.

Usage:
    python app/desktop/main_launcher.py          # launch GUI (auto-start daemon)
    python app/desktop/main_launcher.py --no-gui # start daemon only (headless)
    python core/kernel/server.py                 # daemon only, no window

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling. Founders: ABsUP & ABsUPs.
"""

from __future__ import annotations

import argparse
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DESKTOP_DIR = Path(__file__).resolve().parent
DAEMON_SCRIPT = REPO_ROOT / "core" / "kernel" / "server.py"
DEFAULT_HOST = "ABsUP"
DEFAULT_PORT = 8080
DAEMON_URL = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}"
FALLBACK_URL = f"http://127.0.0.1:{DEFAULT_PORT}"
WINDOW_SIZE = "1280,820"


def _port_open(port: int) -> bool:
    """True when something already listens on 127.0.0.1:port."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1.0):
            return True
    except OSError:
        return False


def _daemon_responding(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2.0) as response:
            return response.status == 200
    except OSError:
        return False


def start_daemon(port: int, verbose: bool = False) -> subprocess.Popen:
    """Start the desktop daemon detached; returns the process handle."""
    if _port_open(port):
        return None  # already running
    log_path = DESKTOP_DIR / "daemon.log"
    log_handle = log_path.open("a", encoding="utf-8")
    args = [sys.executable, str(DAEMON_SCRIPT), "--port", str(port)]
    if verbose:
        args.append("--verbose")
    proc = subprocess.Popen(
        args,
        cwd=str(DESKTOP_DIR),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    # Wait (bounded) for the daemon to answer — a readiness probe, not a quota.
    probe_urls = [f"{DAEMON_URL}/api/status", f"{FALLBACK_URL}/api/status"]
    for _ in range(100):
        if any(_daemon_responding(u) for u in probe_urls):
            break
        time.sleep(0.1)
    return proc


def launch_pywebview(url: str) -> bool:
    """Open the UI in a pywebview (WebView2) window. Returns True on success."""
    try:
        import webview  # type: ignore
    except ImportError:
        return False
    webview.create_window(  # noqa: F841 - window handle kept by webview runtime
        "OpenCodeWEB OS — Zero-Constraint Desktop",
        url,
        width=int(WINDOW_SIZE.split(",")[0]),
        height=int(WINDOW_SIZE.split(",")[1]),
        min_size=(980, 640),
        background_color="#06090f",
    )
    webview.start()
    return True


def launch_edge_app(url: str) -> bool:
    """Fallback: chromeless Edge (WebView2 runtime) app window."""
    edge_candidates = (
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    )
    edge = next((p for p in edge_candidates if Path(p).exists()), shutil.which("msedge"))
    if not edge:
        return False
    subprocess.Popen(
        [edge, f"--app={url}", f"--window-size={WINDOW_SIZE}", "--user-data-dir=" + str(DESKTOP_DIR / ".edge-profile")],
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    return True


def launch_browser(url: str) -> bool:
    """Final fallback: default browser."""
    import webbrowser

    webbrowser.open(url)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="main_launcher", description="OpenCodeWEB OS hybrid desktop launcher (ABsUP & ABsUPs)")
    parser.add_argument("--port", "-p", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", type=str, default=DEFAULT_HOST)
    parser.add_argument("--no-gui", action="store_true", help="start the daemon only (headless)")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    port = args.port
    # Canonical UI URL is ABsUP:8080; fall back to 127.0.0.1 if unresolvable.
    url = f"http://{args.host}:{port}"
    try:
        socket.gethostbyname(args.host)
    except OSError:
        url = f"http://127.0.0.1:{port}"

    daemon = start_daemon(port, verbose=args.verbose)
    if daemon is not None:
        print(f"desktop daemon started (pid {daemon.pid}) — {url}")
    else:
        print(f"desktop daemon already running — {url}")

    if args.no_gui:
        print("headless mode: daemon running, no window opened.")
        return 0

    # Prefer a native WebView2 window; fall back gracefully.
    if launch_pywebview(url):
        return 0
    if launch_edge_app(url):
        print("launched Edge app window (WebView2 runtime)")
        return 0
    launch_browser(url)
    print("launched default browser window")
    return 0


if __name__ == "__main__":
    sys.exit(main())
