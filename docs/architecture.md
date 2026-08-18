# OpenCodeWEB OS — Architecture Overview

## Branch Policy

- **Dev** (default): all release code. CI/CD pipeline runs on Dev pushes —
  quality gate, portal build, worker deploys, health checks, self-healing.
- **main**: passive production mirror. Updated by merging Dev into main.
- **backup/restore-point**: single rolling pre-mutation snapshot,
  force-updated on every deploy run.

## Core Components

| Component | Path | Role |
|---|---|---|
| AiA engine | `core/aia/` | Supervisor-Observer-Executor master intelligence; executor fallback chain (Gemini → opencode → mock) |
| Gun relay/bridge | `gun-relay/` | Local GunDB relay + bridge to the GunX global graph; publishes presence `os/users/<login>` (45s heartbeat) and AiA brain mirrors `os/aia/brain/<id>` |
| Portal | `portal/` | Vite app deployed to Cloudflare Pages (pocwu.pages.dev) |
| Workers | `worker/`, `functions/` | Edge gateway + API functions (KV sessions, health) |

## Presence Flow (/U Users Directory)

1. Bridge publishes flat profile `{login, name, avatar, id, joinedAt, lastSeen}`
   to `os/users/<login>` on the GunX global relay.
2. UI subscribes to `os/users`; online = lastSeen within 120s.
3. UI merges GunX registry with the KV session API; GunX wins on conflicts.

## Self-Healing

- Secret scan → ruff lint → pytest before any deploy.
- Health check after deploy; failure triggers auto-rollback to the previous
  successful run (located via the Actions API).
- Zero-constraint policy enforced by `ZeroConstraintGuard` and
  `UnrestrictedRefactorer`.
