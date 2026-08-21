# Track: OS on GDBx — Fabric Migration

> Part of **org-gdbx-unification** (GDBX Phase 6)

## Goal
Migrate OS from GunX (`gun-relay/bridge.js` → `gunx.pages.dev`) to GDBx pool.

## Spec
- `gdbx-relay/bridge.js` — Node HTTP RPC `POST /gdbx/put`, `GET /gdbx/get?prefix=`, `GET /gdbx/health` — uses `GDBX/sdk/gdbx-sdk.js` (gun-free), feature flag `USE_GDBX=1`
- `gdbx-relay/vendor/` — copy of `GDBX/sdk/*` for standalone deploy (via `sync-vendor.mjs`)
- Portal: `portal/src/lib/gdbx.ts` — `USE_GDBX` flag, community `/C/` reads via GDBx when enabled
- Python fleet (`core/`, `gateway/`) — use `gdbx_py` shared with AiA
- Preserve `gun-relay/` for fallback until `os-gdbx` verified

## Links
- GDBX spec: `GDBX/conductor/tracks/org-gdbx-unification/spec.md`
- Prev track: `os-gunx` (GunX)
