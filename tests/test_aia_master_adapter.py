"""Tests for the OS-side AiA master engine adapter (GunX mirror mocked).

Skips when the AiA repo is not present locally — the engine itself is tested
in github.com/OpenCodeWEB/AiA's own pipeline.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from core.aia.aia_master_adapter import DEFAULT_AIA_LIB, MasterEngineAdapter  # noqa: E402

AIALIB = Path(DEFAULT_AIA_LIB)

if not AIALIB.joinpath("aia_core_engine.py").exists():
    pytest.skip("AiA lib not found (clone github.com/OpenCodeWEB/AiA)", allow_module_level=True)


def _mock_executors():
    sys.path.insert(0, str(AIALIB))
    from executors.mock import MockExecutor  # noqa: E402

    return [MockExecutor()]


class FakeBridge:
    def __init__(self):
        self.writes = []

    def put(self, soul, key, value):
        self.writes.append((soul, key, value))
        return {"ok": True, "soul": soul, "key": key}


def test_adapter_process_task_and_publish_brain(tmp_path, monkeypatch):
    monkeypatch.setenv("AIA_BRAIN_DIR", str(tmp_path / "brain"))
    bridge = FakeBridge()
    adapter = MasterEngineAdapter(lib_dir=AIALIB, bridge=bridge, executors=_mock_executors())
    result = adapter.process_task("hello from the OS adapter test")
    assert result["ok"] is True
    assert result["mode"] in ("native", "delegated")
    # brain mirror published through the fake bridge
    assert bridge.writes, "publish_brain should push a summary"
    soul, key, value = bridge.writes[-1]
    assert soul == "os/aia/brain"
    assert key.startswith("brain-")
    assert value["skills"] == 0 or "skills" in value
    assert "device" in value


def test_adapter_swarm_and_status(tmp_path, monkeypatch):
    monkeypatch.setenv("AIA_BRAIN_DIR", str(tmp_path / "brain"))
    adapter = MasterEngineAdapter(lib_dir=AIALIB, bridge=FakeBridge(), executors=_mock_executors())
    status = adapter.status()
    assert status["ok"] is True
    # swarm push offline → graceful error, no crash
    result = adapter.swarm_push()
    assert "pushed" in result
