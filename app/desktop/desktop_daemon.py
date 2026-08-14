#!/usr/bin/env python3
"""OpenCodeWEB OS — Desktop Daemon (compatibility shim).

The canonical local daemon lives at ``core/kernel/server.py`` (Module A of
the OS spec: REST + WebSocket IPC bound to ABsUP:8080). This module keeps
the historical ``app/desktop`` entry point working for launchers, scripts,
and tests that reference it directly.

Run:
    python app/desktop/desktop_daemon.py --port 8080
    (equivalent to python core/kernel/server.py --port 8080)

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling. Maintainers: ABsUP & ABsUPs.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.kernel.server import (  # noqa: E402,F401 - canonical implementation
    DEFAULT_HOST,
    DEFAULT_PORT,
    UI_DIR,
    ZERO_CONSTRAINT_NOTE,
    DesktopDaemon,
    KernelBridge,
    LogTail,
    WebSocketConnection,
    build_parser,
    main,
)

__all__ = [
    "DEFAULT_HOST",
    "DEFAULT_PORT",
    "UI_DIR",
    "ZERO_CONSTRAINT_NOTE",
    "DesktopDaemon",
    "KernelBridge",
    "LogTail",
    "WebSocketConnection",
    "build_parser",
    "main",
]

if __name__ == "__main__":
    sys.exit(main())
