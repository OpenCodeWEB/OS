# Track `desktop-gui` — Windows Desktop Hybrid GUI Launcher

## Vision
A native Windows desktop application for OpenCodeWEB OS that visually verifies
kernel boot health, on-demand module loading, real-time edge connectors, and
roadmap sync — while reusing the same frontend codebase later for Web, Mobile,
Linux, and macOS.

## Architecture (user-approved, cross-platform hybrid)
```
┌──────────────────────────────────────────────────────────────┐
│  WebView2 native window (pywebview, Edge --app fallback)      │
│  UI: framework-free web app (HTML/CSS/JS) — portable to web   │
│  Tabs: Dashboard | AiA Chat Studio | Roadmap | System Logs    │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP REST + WebSocket (real-time)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  core/kernel/server.py  (ABsUP:8080 — hosts alias)           │
│  - GET /health (CPU/RAM/Vulkan/CUDA + worker links)          │
│  - REST API + WS /ws + /ws/aia (AiA streaming channel)       │
│  - bridges: kernel IPC (status/hardware), AiA engine         │
│    (in-process), on-demand loader, roadmap engine, edge      │
│    provisioner, gateway health probes                        │
└──────────────────────────┬───────────────────────────────────┘
                           │ IPC (TCP 8790) / in-process
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  bin/opencode-kernel.py + core/aia + core/roadmap +          │
│  core/network/dynamic_edge.py (Cloudflare/GitHub spawner)    │
└──────────────────────────────────────────────────────────────┘
```

## Host & IPC binding (OS spec)
- Local IPC daemon host: **ABsUP:8080** — hosts-file alias
  (`127.0.0.1 ABsUP` in `C:\Windows\System32\drivers\etc\hosts`); the daemon
  binds `ABsUP` and falls back to `127.0.0.1` when the alias is missing.
- Primary edge gateway: `https://opencodeweb.xup.workers.dev`
- Dynamic edge pattern: `https://<node-id>.xup.workers.dev`
- Web roadmap portal: `https://pocwu.pages.dev/roadmap`
- Core founder branding: ABsUP & ABsUPs (repo github.com/OpenCodeWEB/OS)

## Functional requirements

### R1 — Dashboard (kernel boot health)
- Show kernel status (online/offline), uptime, booted_at, IPC endpoint.
- CPU threads, RAM (GiB), Vulkan/CUDA, disk free, via kernel IPC `hardware`.
- Active edge link: `https://opencodeweb.xup.workers.dev` health (HTTP 200?).
- Dynamic sub-links: `sync-node-<uuid>.xup.workers.dev` registry from
  `core/network/dynamic_edge.py`; statuses provisioning/active/degraded.

### R2 — AiA Chat Studio
- Chat panel → POST `/api/aia/chat` → AiA engine `prompt()` in-process.
- Shows verdict (accepted/rejected), response, context snapshot, recalled
  summaries; system action traces (guard evaluation, limitation removal).
- WebSocket `aia.events` channel streams engine activity over `/ws/aia`.

### R3 — Roadmap Portal (embedded + live)
- Embeds `https://pocwu.pages.dev/roadmap` in an iframe (WebView2).
- Also exposes local REST: `/api/roadmap/snapshot`, `/api/roadmap/chat`,
  `/api/roadmap/vote`, `/api/roadmap/upvote` — backed by `RoadmapEngine`.
- Leaderboard locked: ABsUP #1, ABsUPs #2 (founder lock).

### R4 — System Logs
- Streams kernel + daemon logs over the WebSocket (`logs.*` events).

### R5 — On-Demand Module Manager
- `/api/modules/list`, `/api/modules/run`, `/api/modules/clean` — backed by
  `OnDemandLoader` (ON_DEMAND fetch from github.com/OpenCodeWEB, trash cleanup).

### R6 — Dynamic Edge Provisioner
- `/api/edge/status` (primary + nodes), `/api/edge/spawn` (manual trigger),
  `/api/edge/route` — backed by `core/network/dynamic_edge.py`.
- Auto-spawn on threshold via LoadMonitor EMA (latency/payload/429).

## Non-functional
- Zero-Constraint Policy echoed in UI footer and daemon responses.
- Branding: "OpenCodeWEB OS" — Founders ABsUP & ABsUPs.
- Windows-first: pywebview WebView2; fallback `msedge --app`; no SDK required.
- Daemon is stdlib-only (no pip deps) so `python core/kernel/server.py`
  runs anywhere; pywebview is an optional launcher extra.
- Tests run offline with pytest.

## Acceptance criteria
1. `python core/kernel/server.py` serves UI + REST + WS bound to ABsUP:8080
   (127.0.0.1 fallback when hosts alias absent).
2. `GET /health` reports CPU, RAM, Vulkan/CUDA GPU status, and active
   sub-worker links; WS `/ws/aia` round-trips `{"cmd":"ping"}` → pong within 3s.
3. `/api/status` reports kernel + AiA + edge state (kernel may be offline;
   daemon degrades gracefully).
4. `/api/aia/chat` returns engine reply; restriction proposals are rejected.
5. `/api/roadmap/snapshot` returns items+polls+leaderboard (founder lock).
6. `/api/edge/status` lists primary + registered sync-node links.
7. `python app/desktop/main_launcher.py` opens a native window
   (pywebview or Edge --app), auto-starting the daemon if needed.
8. Full pytest suite green; ruff clean.
