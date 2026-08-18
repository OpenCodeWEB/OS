# OpenCodeWEB OS â€” Master Monorepo

> Self-sovereign, unrestricted, perpetual, universal AI-native operating system.
> All OpenCodeWEB OS code lives here. Maintained by **ABsUP & ABsUPs**.
![CI](https://github.com/OpenCodeWEB/OS/actions/workflows/opencodeweb-pipeline.yml/badge.svg)


## Immutable Zero-Constraint Policy

> **No token limits, no hard timeouts, no artificial quotas, no throttling.**

Enforced by the AiA engine (`core/aia/`): every proposal is checked by the
`ZeroConstraintGuard`, and third-party tool sources are sanitized at import
time by the `UnrestrictedRefactorer`.

## Repository Layout

| Path | Component |
| :--- | :--- |
| `bin/` | OS kernel bootstrapper (`opencode-kernel.py`) â€” hardware probe, IPC server, AiA daemon, CLI |
| `core/aia/` | **AiA Master Intelligence Engine** â€” context window, agent core, learning loop, memory manager, unrestricted refactorer |
| `core/ipc/` | Zero-copy shared-memory bus (`SharedMemoryBus`, <3ms) |
| `core/runtime/` | On-demand module loader (`OnDemandLoader`, StorageGuard janitor) |
| `gateway/` | Edge gateway worker â€” `opencodeweb.xup.workers.dev` (auth, webhook HMAC, OAuth, proxies) |
| `worker/` | AG webhook worker â€” GitHub App automation, KV-backed bot tokens |
| `servers/` | Servers gateway worker |
| `portal/` | Web portal (Vite + React) â€” deployed to `pocwu.pages.dev` |
| `lib/modules/` | On-demand module store |
| `tests/` | Python test suite (ruff-clean, pytest) |
| `conductor/` | Project context: [master architecture](./conductor/master-architecture.md), product, workflow, tracks |

## Runtime Topology

```text
                        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                        â”‚   Edge Gateway (Workers)     â”‚
                        â”‚  opencodeweb.xup.workers.dev â”‚
                        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                       â”‚
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â–¼                        â–¼                        â–¼
      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
      â”‚  Web Portal  â”‚        â”‚  AG Worker   â”‚        â”‚  AiA Engine      â”‚
      â”‚  pocwu.pages â”‚        â”‚ (automation) â”‚        â”‚ (intelligence)   â”‚
      â”‚  .dev        â”‚        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

## Quick Start

```bash
# AiA engine (Python 3.12+)
pip install ruff pytest
python -m pytest -q
python -m core.aia.agent_core --task "research the shared memory bus"
python -m core.aia.memory_manager --bootstrap --add user "hello"
python -m core.aia.learning_loop --learn "fix gateway timeout" '{"ok": true}'
python -m core.aia.unrestricted_refactor --refactor <dir> --out <dir>

# Kernel (Linux target, OPENCODE_ROOT overridable)
OPENCODE_ROOT=/opt/opencode python bin/opencode-kernel.py --daemon

# Gateway / workers (Cloudflare, via CI or wrangler)
cd gateway && npx wrangler deploy --minify
cd worker && npm ci && npx wrangler deploy --minify
cd servers && npx wrangler deploy --minify

# Portal
cd portal && npm ci && npm run build
```

## CI/CD

Every push to `main` runs the self-healing pipeline (`.github/workflows/opencodeweb-pipeline.yml`):
1. Pre-mutation backup branch (`backup/opencode-OS-<timestamp>`)
2. Secret leak scan
3. Lint + tests (ruff + pytest)
4. Portal build + Pages deploy (when `portal/` present)
5. Gateway / worker / servers deploy (when `CF_API_TOKEN` configured)
6. Gateway health check (must return HTTP 200)
7. Self-healing: failures open alert issues; rollback re-deploys previous success

## Ecosystem

The OS is the canonical home for all code. Companion repos hold forks of
upstream tools (GIMP, Inkscape, BlenDer, FFmPeg, KdenLive, VsCode, Flutter,
PodMan, DotNet, AnyThingLLM) and deployment mirrors (AG, Servers, UI, AiA,
SandBox, CommunityHub, AddonHub, ABsNOTE, OpenNotebook, Model, GitHubApp,
Roadmap, TeamSwarm).
