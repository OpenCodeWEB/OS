# OpenCodeWEB OS — Master Architecture

> Single source of truth for the OpenCodeWEB OS ecosystem. Maintained by ABsUP & ABsUPs.

## 1. Vision

OpenCodeWEB OS is a self-sovereign, unrestricted, perpetual, universal AI-native
operating system. Every component operates under the **Immutable Zero-Constraint
Policy**: no token limits, no hard timeouts, no artificial quotas, no throttling.

## 2. System Topology

| Repo | Role |
| :--- | :--- |
| `OpenCodeWEB/UI` | Main web portal (https://pocwu.pages.dev) — dashboards, `/u/`, `/o/`, `/s/`, `/T/`, `/C/`; owns this document |
| `OpenCodeWEB/Servers` | Core gateway backend (https://opencodeweb.xup.workers.dev) — webhook ingress, OAuth, metrics |
| `OpenCodeWEB/AiA` | Master Intelligence Engine — unlimited context memory, zero-constraint guard, learning loop, autonomous refactorer |
| `OpenCodeWEB/AG` | Autonomous Agent pipeline — AST audits, self-healing auto-repair, dual-authorship commits |
| `OpenCodeWEB/SandBox` | Owner-only private preview & staging ground |
| `OpenCodeWEB/GitHubApp` | GitHub App integration (OAuth, webhook-driven automation) |
| `OpenCodeWEB/Roadmap` | Public roadmap & planning |
| `OpenCodeWEB/TeamSwarm` | Multi-agent orchestration |
| `OpenCodeWEB/CommunityHub` | Community sync layer |
| `OpenCodeWEB/AddonHub` | Addon/plugin registry |
| `OpenCodeWEB/ABsNOTE` | Notes subsystem |
| `OpenCodeWEB/OpenNotebook` | Notebook subsystem |
| `OpenCodeWEB/Model` | Model registry / sub-models |
| `OpenCodeWEB/AnyThingLLM` | LLM runtime integration |
| `OpenCodeWEB/GIMP` | Graphics fork (FOSS ecosystem) |
| `OpenCodeWEB/Inkscape` | Vector graphics fork |
| `OpenCodeWEB/BlenDer` | 3D suite fork |
| `OpenCodeWEB/FFmPeg` | Media processing fork |
| `OpenCodeWEB/KdenLive` | Video editing fork |
| `OpenCodeWEB/VsCode` | Editor fork |
| `OpenCodeWEB/Flutter` | UI toolkit fork |
| `OpenCodeWEB/PodMan` | Container runtime fork |
| `OpenCodeWEB/DotNet` | .NET runtime fork |

## 3. Runtime Topology

```text
                        ┌──────────────────────────────┐
                        │   Edge Gateway (Workers)     │
                        │  opencodeweb.xup.workers.dev │
                        │  /health  /api/github/…      │
                        └──────────────┬───────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
      ┌──────────────┐        ┌──────────────┐        ┌──────────────────┐
      │  Web Portal  │        │  AG Worker   │        │  AiA Engine      │
      │  pocwu.pages │        │ (automation) │        │ (intelligence)   │
      │  .dev        │        └──────────────┘        └──────────────────┘
      └──────────────┘
```

## 4. Security & Backup Policy

- **Backups**: every push creates `backup/opencode-<repo>-<timestamp>` branches on GitHub (never separate repos).
- **Secret hygiene**: CI scans for leaked credentials (GitHub PATs, AWS keys, CF tokens, PEM keys) on every push.
- **Edge auth**: gateway requires `Authorization: Bearer <key>` or `X-Gateway-Token`, except public routes (`GET /health`, `GET /api/metrics/live`, OAuth callback).
- **Branding**: primary authors `ABsUP` & `ABsUPs`; commits use the dual-authorship trailer with `opencodeweb[bot] <311941023+opencodeweb[bot]@users.noreply.github.com>`.

## 5. Zero-Constraint Directive

> **Immutable Zero-Constraint Policy: no token limits, no hard timeouts, no artificial quotas, no throttling.**

Enforced by the AiA engine:
- `core/aia/aia_engine.py` — `ZeroConstraintGuard` rejects any proposal containing caps/limits/backoff patterns.
- `core/aia/unrestricted_refactor.py` — sanitizes third-party sources at import time (AST + regex).
- `core/aia/learning_loop.py` — persistent federated learning loop.
- `core/aia/memory_manager.py` — infinite sliding-window context (logarithmic memory growth, never forgets).

## 6. CI/CD Standard

Every repo runs a self-healing pipeline on push to `main`:
1. Pre-mutation backup branch
2. Secret leak scan
3. Lint + tests
4. Deploy (portal / worker / gateway, when present)
5. Gateway health check (`GET https://opencodeweb.xup.workers.dev/health` must return 200)
6. Self-healing: failures open alert issues; rollback re-deploys previous successful commit

## 7. Development Workflow

Follow the [Conductor workflow](./workflow.md): every feature is a **Track** with an approved
`spec.md` and `plan.md` under `conductor/tracks/<track_id>/` before implementation.