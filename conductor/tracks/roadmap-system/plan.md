# Implementation Plan — Track `roadmap-system`

## Phase 1 — Foundations (Done in this session)
- [x] Track scaffold: spec.md, plan.md, metadata.json, tracks.md registration
- [ ] `core/roadmap/__init__.py` package exports

## Phase 2 — Module A: roadmap_engine.py
1. Data models (dataclasses): `RoadmapItem`, `Poll`, `PollVote`, `LeaderboardEntry`, `ChatMessage`.
2. `TopicExtractor`: TF scoring + stopwords + n-gram similarity dedupe.
3. `PollGenerator`: topic clustering → poll spawn (3 options), TTL expiry.
4. `Leaderboard`: rolling 24h window, point weights, founder lock (ABsUP #1, ABsUPs #2).
5. `RoadmapEngine`: orchestrates ingest → items/polls → persistence (JSON state dir) →
   sync push (POST /api/roadmap/sync via gateway, token optional).
6. **Tests**: `tests/test_roadmap_engine.py` — item generation, poll spawn, leaderboard lock,
   dedupe, expiry, persistence round-trip, sync failure tolerance.

## Phase 3 — Module B: dynamic_edge_provisioner.py
1. `LoadMonitor`: EMA latency + payload tracking; threshold + 429 triggers.
2. `EdgeProvisioner`: spawn via GitHub workflow dispatch (primary) + Cloudflare API (fallback);
   delete/deregister; health verification before activation.
3. `NoLimitRouter`: endpoint registry, active-node rotation, degrade to primary.
4. **Tests**: `tests/test_dynamic_edge_provisioner.py` — thresholds, spawn payload, registry
   persistence, health gating (mocked HTTP).

## Phase 4 — Module C: roadmap_worker.js
1. `RoadmapRoom` Durable Object: WebSocket upgrade, broadcast, CRDT LWW merge, chat history.
2. REST handlers: health, sync, roadmap/polls/leaderboard, vote, item, chat.
3. KV single-key persistence `ROADMAP_STATE` + memory fallback; CORS; optional Vectorize stub.
4. `worker/roadmap/wrangler.toml` (name `roadmap` → roadmap.xup.workers.dev, DO + KV bindings).

## Phase 5 — Module D: sync-node sub-worker
1. `worker/sync-node/index.js`: /health + forward proxy (no storage) — auto-deployed per node.
2. `worker/sync-node/wrangler.toml` (name overridden at deploy time).

## Phase 6 — CI/CD + Gateway + Portal
1. `.github/workflows/deploy-sync-node.yml` (workflow_dispatch, node_id input, deploy/delete,
   secret-gated).
2. OS pipeline: add roadmap tests (pytest picks up), roadmap worker deploy step.
3. Gateway: `ROADMAP_WORKER` binding + `/api/roadmap/*` REST proxy + `/api/roadmap/ws`
   WebSocket passthrough (OS + AG copies).
4. Portal: `src/pages/Roadmap.tsx` + route `/roadmap` (chat, polls, leaderboard, items).

## Phase 7 — Zero-Downtime Deployment
1. `core/roadmap/deploy_roadmap_edge.py`: versions upload → health gate → gradual deploy →
   rollback.

## Phase 8 — Live Verification & Ship
1. Deploy roadmap worker (`roadmap.xup.workers.dev`) + gateway redeploy.
2. Verify: /health 200, REST CRUD 200, WS handshake 101, sync round-trip, leaderboard lock.
3. Push OS (`f8149a0` → next) + AG mirror; CI green; PR/README updates as needed.