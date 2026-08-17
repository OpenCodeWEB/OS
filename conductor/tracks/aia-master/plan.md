# AiA Master Engine — Implementation Plan

> Track: `aia-master` · Spec: [spec.md](spec.md) · Status: approved (decisions §9 all ✅)

## m1 — AiAMasterEngine core (process_task pipeline)
1. `aia_core_engine.py`: `AiAMasterEngine` — brain dir resolution (env `AIA_BRAIN_DIR`), knowledge/user-profile load/save, `process_task` (recall → evaluate → native | delegate+observe → learn), capability evaluator (skill matcher + rule registry), native executor (builtin skills).
2. `executors/`: `base.py` (Executor ABC), `registry.py` (priority: gemini → opencode → mock), `mock.py`, `opencode_executor.py` (`opencode run` subprocess, env `AIA_OPENCODE_CMD`), `gemini_executor.py` (uses gemini_bridge).
3. Tests: routing (native vs delegate), persistence, dedupe, PRD demo task.

## m2 — Vector memory (unlimited context)
4. `vector_memory.py`: rolling window (verbatim recent), hashing TF-IDF embeddings (pure Python, dim 512), chunk summaries, cosine recall, LRU caps, `infinite_memory.json` persistence.
5. Tests: ingest/recall, compression trigger, similarity ranking, persistence round-trip.

## m3 — Continuous learning loop + GitHub sync
6. `learning_loop.py`: observation records (JSONL rotating log), `learn_from_execution` (dedupe by hash, 3×-success → skill promotion), `learn_from_user_pattern` (preference profile), anti-patterns on failure.
7. `github_sync.py`: GitHub search API (`created:>7d`, sort stars) → top repos → README fetch → abstracted pattern extraction → `github_trends` + skill candidates. Resilient (timeouts, rate limits).
8. Tests: promotion logic, anti-pattern, profile update; github sync with mocked HTTP.

## m4 — Gemini connector (zero API key)
9. `gemini_bridge.py`: gemini-cli detection (`shutil.which` + `--version`), non-interactive ask via env-configurable command (`AIA_GEMINI_CMD`, default `gemini --prompt`), session status, cookie-bridge experimental stub (env `AIA_GEMINI_COOKIE_BRIDGE=1` → NotImplemented).
10. Tests: unavailable CLI → available()=False; mock subprocess ask; cookie stub raise.

## m5 — OS integration + GunX brain mirror
11. OS adapter `core/aia/aia_master_adapter.py`: locate AiA repo (`AIA_LIB_DIR` or `D:\OpenCodeWEB\AiA`), expose engine to OS services.
12. GunX mirror: publish knowledge/memory/observations summaries to `os/aia/*` via bridge `/put` (flat payloads); subscribe `os/swarm/patches`.
13. Verify: brain souls readable from `wss://gunx.pages.dev/gun`.

## m6 — Marketplace readiness
14. `health.py` + `api.py`: minimal HTTP health/status API (threading.HTTPServer): `GET /health`, `GET /status` (version, brain size, skills count, sync state). Documented for marketplace apps.

## m7 — Federated swarm client
15. `federated_learning_sync.py`: per-install secret, `_abstract_solution` (identifiers/strings/URLs stripped), `anonymize_pattern` (category + numeric vector + outcome_stats + HMAC signature), watermark upload (`/v1/sync`), patch download+validate+apply (`/v1/patch?since=`), optional GunX transport (`os/swarm/*`).
16. Tests: anonymization NEVER contains raw prompt/solution tokens; signature changes with salt; watermark advance; patch apply dedupe.

## m8 — Central brain worker
17. `worker/` (Cloudflare Worker, JS): POST `/v1/sync` (schema/size/dedupe validation, per-category aggregation), GET `/v1/patch?since=` (bounded merged feed). Durable Object or KV storage.
18. Wrangler config; deploy blocked on CF auth → code ships, deploy deferred (tracked).

## Order & verification
- Implement m1→m8 in order; `pytest` after each milestone; demo: `python -m aia --task "Write a Flutter UI component with custom glassmorphism"` at m1/m7.
- Push to `github.com/OpenCodeWEB/AiA` after m1+m2 (initial), then after m7+m8.
