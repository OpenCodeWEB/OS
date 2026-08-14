"""OpenCodeWEB OS — Zero-Downtime Edge Deployment (roadmap worker).

Uses wrangler versioned deploys:
  1. `wrangler versions upload`  -> creates a new immutable version
  2. health gate on the CURRENT worker (pre-roll sanity)
  3. `wrangler versions deploy <id>@<percentage>` (gradual rollout, default 100%)
  4. post-deploy health check; on failure, roll back to the previous version

Windows/POSIX portable. Requires wrangler auth (local OAuth or CF_API_TOKEN).

Usage:
    python core/roadmap/deploy_roadmap_edge.py [--workdir worker/roadmap] [--percentage 100]

Zero-Constraint Policy: no artificial limits; the only gates are the health
probes required for safe, zero-downtime rollouts.

Maintainers: ABsUP & ABsUPs
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HEALTH_URL = "https://roadmap.xup.workers.dev/health"
ROLLOUT_STEPS: list[tuple[int, float]] = [(10, 10.0), (50, 10.0), (100, 0.0)]


def run(cmd: list[str], workdir: Path) -> str:
    result = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{result.stderr[-2000:]}")
    return result.stdout


def parse_version_id(upload_output: str) -> str:
    match = re.search(r"Version ID:\s*([0-9a-f-]{36})", upload_output)
    if not match:
        match = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", upload_output)
    if not match:
        raise RuntimeError(f"could not parse version id from output:\n{upload_output[-1000:]}")
    return match.group(1)


def health_ok(url: str = HEALTH_URL, timeout: float = 20.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status == 200
    except (urllib.error.URLError, OSError, TimeoutError):
        return False


def deploy(workdir: Path, percentage: int = 100, health_url: str = HEALTH_URL) -> dict[str, str]:
    print(f"[1/4] sanity: current {health_url}")
    if not health_ok(health_url):
        raise RuntimeError("pre-deploy health check failed — aborting rollout")

    print("[2/4] uploading new version (wrangler versions upload)")
    out = run(["npx", "wrangler", "versions", "upload", "--minify"], workdir)
    version_id = parse_version_id(out)
    print(f"      uploaded version {version_id}")

    # Gradual rollout
    steps = [s for s in ROLLOUT_STEPS if s[0] <= percentage]
    deployed_pct = 0
    for pct, wait in steps:
        print(f"[3/4] deploying {pct}% (version {version_id})")
        run(["npx", "wrangler", "versions", "deploy", f"{version_id}@{pct}", "--yes"], workdir)
        deployed_pct = pct
        if wait > 0:
            time.sleep(wait)
        if not health_ok(health_url):
            print("[!] health degraded during rollout — rolling back")
            rollback(workdir, version_id)
            raise RuntimeError(f"rollout failed at {pct}%; rolled back to previous version")

    print("[4/4] post-deploy health verify")
    for attempt in range(3):
        if health_ok(health_url):
            print(f"      healthy after 100% rollout (attempt {attempt + 1})")
            return {"version": version_id, "percentage": str(deployed_pct), "status": "live"}
        time.sleep(5)
    rollback(workdir, version_id)
    raise RuntimeError("post-deploy health check failed; rolled back to previous version")


def rollback(workdir: Path, bad_version: str) -> None:
    """Roll back to the previous deployment (wrangler rollback)."""
    print(f"[rollback] reverting from {bad_version}")
    out = run(["npx", "wrangler", "rollback", "--yes"], workdir)
    print(f"[rollback] {out.strip()[-300:]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Zero-downtime roadmap edge deploy")
    parser.add_argument("--workdir", default="worker/roadmap", type=Path)
    parser.add_argument("--percentage", type=int, default=100, help="target rollout % (10/50/100)")
    parser.add_argument("--health-url", default=HEALTH_URL)
    args = parser.parse_args()

    try:
        result = deploy(args.workdir, args.percentage, args.health_url)
        print(json.dumps(result, indent=2))
        return 0
    except (RuntimeError, subprocess.SubprocessError) as exc:
        print(f"deploy failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
