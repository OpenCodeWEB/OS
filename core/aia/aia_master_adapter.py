"""AiA Master Engine adapter — OpenCodeWEB OS side of github.com/OpenCodeWEB/AiA.

Locates the AiA repo (env ``AIA_LIB_DIR`` or the canonical dev path) and exposes
the master engine to OS services with two extra capabilities:

- ``process_task``            — Supervisor-Observer-Executor pipeline
- ``publish_brain``           — GunX mirror of the brain (knowledge summary +
  memory stats) through the OS bridge, so the global graph can see AiA state

The brain data itself (learned_patterns.json etc.) stays machine-local in
``AIA_BRAIN_DIR`` — only small flat summaries are published to the graph.

Usage::

    from core.aia.aia_master_adapter import master_engine

    result = master_engine.process_task("...")
    master_engine.publish_brain()
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any

DEFAULT_AIA_LIB = Path(os.environ.get("AIA_LIB_DIR", r"D:\OpenCodeWEB\AiA"))


def _load_engine(lib_dir: str | Path | None = None, executors: list[Any] | None = None) -> Any:
    lib = Path(lib_dir or DEFAULT_AIA_LIB)
    if lib.joinpath("aia_core_engine.py").exists():
        sys.path.insert(0, str(lib))
    from aia_core_engine import AiAMasterEngine  # type: ignore

    return AiAMasterEngine(verbose=False, executors=executors)


class MasterEngineAdapter:
    """Thin OS-side wrapper around the AiA master engine."""

    def __init__(self, lib_dir: str | Path | None = None, bridge: Any = None, executors: list[Any] | None = None) -> None:
        self.lib_dir = Path(lib_dir or DEFAULT_AIA_LIB)
        self.engine = _load_engine(self.lib_dir, executors=executors)
        self.bridge = bridge  # optional GunBridge instance (lazy)

    # ── core pipeline ─────────────────────────────────────────────────────
    def process_task(self, prompt: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        result = self.engine.process_task(prompt, context)
        self.publish_brain()
        return result

    # ── GunX brain mirror (flat payloads only — GunX graph rule) ─────────
    def brain_summary(self) -> dict[str, Any]:
        status = self.engine.status()
        return {
            "ts": time.time(),
            "memory_entries": status["memory"]["entries"],
            "memory_summaries": status["memory"]["summaries"],
            "skills": status["knowledge"]["skills"],
            "learned": status["knowledge"]["learned_from_models"],
            "anti_patterns": status["knowledge"]["anti_patterns"],
            "interactions": status["profile_interactions"],
            "device": status["swarm"]["device_id"],
        }

    def publish_brain(self) -> dict[str, Any]:
        """Mirror a small flat brain summary to ``os/aia/brain`` on the graph."""
        if self.bridge is None:
            from core.gun_bridge import GunBridge

            self.bridge = GunBridge()
        summary = self.brain_summary()
        key = f"brain-{int(time.time() * 1000)}"
        self.bridge.put("os/aia/brain", key, summary)
        return {"ok": True, "soul": "os/aia/brain", "key": key}

    # ── passthroughs ──────────────────────────────────────────────────────
    def status(self) -> dict[str, Any]:
        return self.engine.status()

    def sync_github(self, days: int = 7) -> dict[str, Any]:
        return self.engine.sync_github_open_source_trends(days=days)

    def swarm_push(self) -> dict[str, Any]:
        from federated_learning_sync import AiAFederatedSync

        swarm = AiAFederatedSync(brain_dir=self.engine.brain_dir, knowledge=self.engine.knowledge)
        return swarm.sync_local_knowledge_to_global_swarm()

    def swarm_pull(self) -> dict[str, Any]:
        from federated_learning_sync import AiAFederatedSync

        swarm = AiAFederatedSync(brain_dir=self.engine.brain_dir, knowledge=self.engine.knowledge)
        result = swarm.download_global_skill_updates()
        self.engine.save_knowledge()
        return result


# Default instance for OS services (lazy bridge)
master_engine = MasterEngineAdapter()
