#!/usr/bin/env python3
"""OpenCodeWEB OS — Desktop Launcher (compatibility shim).

The canonical hybrid launcher is ``app/desktop/main_launcher.py`` (Module B
of the OS spec). This alias keeps older references working.

Run:
    python app/desktop/launcher.py            # == main_launcher.py
    python app/desktop/main_launcher.py       # canonical entry point

Maintainers: ABsUP & ABsUPs.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from main_launcher import main  # noqa: E402,F401

if __name__ == "__main__":
    sys.exit(main())
