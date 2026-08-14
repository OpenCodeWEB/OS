# Implementation Plan — Track `desktop-gui`

## Phase 1 — Track scaffold (Done)
- [x] metadata.json, spec.md; register in tracks.md

## Phase 2 — core/network/ facade (Done)
- [x] `core/network/__init__.py` — package exports.
- [x] `core/network/dynamic_edge.py` — re-export `EdgeProvisioner`, `LoadMonitor`,
  `NoLimitRouter`, `EdgeNode` from `core/roadmap/dynamic_edge_provisioner.py`
  (single source of truth, no logic duplication) + convenience
  `EdgeMonitor` combining LoadMonitor + Provisioner with a background thread.
- [x] **Tests**: `tests/test_network_facade.py` — imports resolve, EdgeMonitor
  spawn/registry/health mocked (6 passed).

## Phase 3 — Local kernel daemon (core/kernel/server.py, canonical; app/desktop/desktop_daemon.py shim) (Done)
- [x] Stdlib-only: `http.server.ThreadingHTTPServer` + hand-rolled RFC6455
  WebSocket (minimal frame encode/decode) — no pip deps.
- [x] Binds **ABsUP:8080** (hosts alias) with 127.0.0.1 fallback.
- [x] REST routes:
  - `GET /health` — CPU/RAM/Vulkan-CUDA + active worker links (Module A spec)
  - `GET /` + static UI files (`/ui/*`), favicon
  - `GET /api/status` — kernel/aia/edge/daemon snapshot
  - `GET /api/hardware` — via kernel IPC (graceful offline fallback)
  - `POST /api/aia/chat` — in-process AiAEngine.prompt
  - `GET /api/aia/status` — engine status
  - `GET /api/roadmap/snapshot`; `POST /api/roadmap/chat`; `POST /api/roadmap/vote`; `POST /api/roadmap/upvote`
  - `GET /api/modules/list`; `POST /api/modules/run`; `POST /api/modules/clean`
  - `GET /api/edge/status`; `POST /api/edge/spawn`
  - `GET /api/roadmap/sync` — push to gateway (dry-run flag)
- [x] WS `/ws` + `/ws/aia`: JSON protocol; `ping`→pong (nonce echo); subscribe
  `status`, `logs`, `aia.events`; periodic status tick (2s), log tail broadcast.
- [x] Kernel bridge: attempt IPC connect (TCP 8790); if down, report offline
  (daemon still serves AiA in-process + edge REST).
- [x] `main()`: argparse `--port 8080 --host ABsUP --ui-dir`; zero-dependency run.

## Phase 4 — WebView2 hybrid UI (app/desktop/ui/) (Done)
- [x] `index.html` — single-page app, 4 tabs (Dashboard, AiA Studio, Roadmap, Logs).
- [x] `app.js` — fetch REST + WebSocket client (`/ws/aia`); status tick render; chat send;
  roadmap snapshot render (items/polls/leaderboard); logs stream.
- [x] `styles.css` — dark "OpenCodeWEB OS" theme (founder branding, zero-constraint
  footer). Framework-free so the same files run in any browser (web port).
- [x] Roadmap tab iframe — embeds `https://pocwu.pages.dev/roadmap`.

## Phase 5 — Launcher (app/desktop/main_launcher.py, canonical; launcher.py shim) (Done)
- [x] `python -m pip install pywebview` optional; `webview.create_window` on
  `http://ABsUP:8080` (127.0.0.1 fallback when alias unresolved).
- [x] Fallback: spawn `msedge --app` (Edge = WebView2 runtime, preinstalled
  on Windows 10/11).
- [x] Auto-starts the daemon (`core/kernel/server.py`) if not already listening.

## Phase 6 — Roadmap edge wiring (finish roadmap-system track) (Done)
1. [x] Gateway: `ROADMAP_WORKER` binding (service `roadmap`) + `/api/roadmap/*`
   REST proxy + public auth exemption (OS + AG copies).
2. [x] Deploy roadmap worker (`roadmap.xup.workers.dev`, version
   b5b1864f-2064-45cf-a28e-4b0fc304ed3d) + redeploy gateway (c933cef7-...).
3. [x] Portal: `src/pages/Roadmap.tsx` + route `/roadmap` (chat via WS,
   polls, leaderboard, items) → deployed to pocwu.pages.dev (chunk live).
4. [x] Live verify: gateway `/api/roadmap/{health,roadmap,chat,sync}` 200;
   WS `/ws?room=general` handshake 101, welcome + chat echo + pong; roadmap
   direct `/health` 200. Initial 401/404/500 were post-deploy propagation
   artifacts. roadmap-system metadata → Deployed.

## Phase 7 — Tests & quality (Done)
- [x] `tests/test_desktop_daemon.py` — REST endpoints (incl. `/health`), WS
  `/ws` + `/ws/aia` ping round-trip, static file serving, aia chat
  accept/reject, roadmap founder lock, modules list, edge status; all offline.
- [x] `tests/test_network_facade.py` — facade imports + monitor.
- [x] Roadmap engine fixes: leaderboard list round-trip, topic chain-drop
  (no duplicate polls from one phrase), TestModels fixture.
- [x] ruff + full pytest green (104 passed, 1 skipped).

## Phase 8 — Live E2E + Ship (In progress)
1. [x] Launch daemon; verify REST + WS via scripted client (ABsUP→127.0.0.1
   fallback confirmed; /health, REST, WS ping round-trip all pass).
2. [ ] Launch GUI (pywebview or Edge --app); screenshot verification
   (requires interactive desktop session).
3. [x] Push OS monorepo (f09ab5d, CI green) + AG mirror (ad34717, CI green).
4. [x] Update tracks.md statuses (roadmap-system → Deployed).
