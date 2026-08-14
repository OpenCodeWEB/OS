# Track: Autonomous Roadmap System + Dynamic No-Limit Edge Connector

**Track ID:** `roadmap-system`
**Status:** In Progress
**Branding:** ABsUP & ABsUPs (primary), opencodeweb[bot] co-author trailer
**Policy:** Immutable Zero-Constraint — no token limits, no hard timeouts, no artificial quotas, no throttling.

## Goal

Power `https://pocwu.pages.dev/roadmap` with an AiA-driven autonomous roadmap:
live chat → polls → roadmap items → leaderboard, all synced in real time
through Cloudflare Workers (`*.xup.workers.dev`) and GitHub
(`github.com/OpenCodeWEB/OS` + `github.com/OpenCodeWEB/Roadmap`).

## Modules

| Module | Path | Responsibility |
| :--- | :--- | :--- |
| A | `core/roadmap/roadmap_engine.py` | AiA autonomous item generator, live poll generator, 24h leaderboard (ABsUP locked #1), state persistence, sync |
| B | `core/roadmap/dynamic_edge_provisioner.py` | Load/latency monitor, auto-spawn `sync-node-<uuid>.xup.workers.dev` via Cloudflare API + GitHub workflow dispatch, no-limit router |
| C | `worker/roadmap/roadmap_worker.js` | Cloudflare Edge Worker: WebSocket live chat (Durable Object), CRDT state sync, persistent voting (KV/DO), CORS |
| D | `worker/sync-node/` | Auto-spawned edge sub-worker (health + forward), deployed dynamically |
| E | `conductor/tracks/roadmap-system/` | Spec + plan + metadata |
| F | `.github/workflows/deploy-sync-node.yml` | GitHub Actions: dynamic sub-worker deploy/delete via `workflow_dispatch` |
| G | Portal | `pocwu.pages.dev/roadmap` page wired to the edge (WS + REST) |

## Functional Requirements

1. **Autonomous Item Generator (Module A)**
   - Ingests chat messages/feedback; extracts topic keywords (TF-based, stopword-filtered).
   - Dedupes against existing roadmap items via token/character similarity (Jaccard ≥ 0.55).
   - Auto-creates `draft` items when a topic reaches `MIN_MENTIONS` (default 3) with
     generated title/summary; pushes to web UI via `/api/roadmap/*`.
2. **Live Dynamic Polls (Module A)**
   - Clusters chat around topics; spawns a poll (3 options: Agree / Neutral / Disagree,
     or extracted options when available) when topic count ≥ threshold and no open poll exists.
   - Polls expire after `POLL_TTL_HOURS` (default 48).
3. **24-Hour Leaderboard (Module A)**
   - Points: chat=1, upvote=2, poll vote=3, item submit=5, PR/commit=10.
   - Rolling 24h window; **ABsUP permanently locked at Rank #1** (founder lock,
     configurable via `FOUNDER_LOCK`). ABsUPs follows founder lock at #2.
4. **Dynamic Edge Provisioner (Module B)**
   - Monitor: probes gateway latency + sync payload size (EMA smoothing).
   - Spawn triggers: latency > `LATENCY_MS_THRESHOLD` (default 1500ms) OR payload >
     `PAYLOAD_BYTES_THRESHOLD` (default 2 MB/sample) OR HTTP 429 observed.
   - Spawn path: `gh workflow run deploy-sync-node -R OpenCodeWEB/OS -f node_id=<uuid>`.
   - Fallback path: direct Cloudflare Workers API (`PUT /accounts/{id}/workers/scripts/...`).
   - Registry persisted to `state/edge_nodes.json`; health-checked; expired nodes deregistered.
5. **Roadmap Worker (Module C)**
   - `GET /health` public. `POST /sync` (state push). `GET /roadmap`, `GET /polls`, `GET /leaderboard`.
   - `POST /vote` (poll), `POST /item` (feedback), `POST /chat` (message), WS `/ws` (live chat).
   - Durable Object `RoadmapRoom` for WebSocket fan-out + CRDT merge (LWW registers).
   - Voting/poll state persisted in KV namespace `ROADMAP_STATE` (single-key store to respect
     free-tier KV write caps, mirroring the AiA connector lesson) with in-memory fallback.
6. **Zero-Downtime Deployment (Module E/script)**
   - `core/roadmap/deploy_roadmap_edge.py`: `wrangler versions upload` → health gate →
     `wrangler versions deploy` (gradual) → rollback on failure.

## Non-Functional Requirements

- Zero-Constraint policy honored; platform caps (KV 1k writes/day free tier) respected by
  single-key writes + memory buffering (proven pattern from AiA connector).
- Strict error handling: every external call wrapped; degraded modes instead of 500s.
- Windows/Linux portable paths via `OPENCODE_STATE_DIR` env override.
- All Python: type-annotated, ruff-clean, pytest-covered. Workers: TS-free JS ES module.

## Out of Scope (this track)

- GitHub Discussions migration, auth flows, full vectorize indexing (stub only).