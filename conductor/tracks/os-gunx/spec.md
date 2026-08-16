# Track: OS + AiA on GunX — serverless GunDB graph integration

**Track ID:** `os-gunx`
**Status:** In Progress
**Repo:** `github.com/OpenCodeWEB/OS`, local at `D:\OpenCodeWEB\OS`
**Policy:** Immutable Zero-Constraint — no limits, no quotas, no throttling.

## Goal

Make **GunX** (`github.com/OpenCodeWEB/GunX` — serverless GunDB relay on
Cloudflare Workers + Durable Objects, live at `gunx.pages.dev`) the shared
realtime graph of the OpenCodeWEB OS: the portal (browser) AND the Python
fleet (kernel :8080, AiA :9090) read/write the SAME global graph, so a
knowledge event learned by AiA is visible on the portal in realtime and
vice-versa — no relay server to run, no quotas.

## Architecture

```
Browser portal (pocwu.pages.dev)
      │  wss://gunx.pages.dev/gun   (gunx.js SDK / gun peer)
      ▼
[GunX serverless relay — Cloudflare DO SQLite]   ← 1ms global sync
      ▲
      │  wss://gunx.pages.dev/gun (peer, axe/multicast OFF)
[Node bridge :8766  ── GunBridge RPC]
      ▲  HTTPS (Bearer token, OS trust root)
      │
Python fleet: kernel :8080 · AiA :9090 · pods
```

- Portal (browser): gun singleton peers to `gunx.pages.dev/gun`; 20s
  plain-soul GET polling (`refreshSouls` via the root `out` pipeline) closes
  gun's "late-subscription" gap; writes route through the durable offline
  queue.
- Python fleet: `gun-relay/bridge.js` is the RPC gateway; its gun client
  peers DIRECTLY to the serverless relay (default), with `axe: false,
  multicast: false` (LAN discovery empirically breaks remote-peer writes).
- Local LAN relay (`relay.js :8765`) remains available for offline labs and
  itself peers to the serverless relay.

## Functional Requirements

1. Portal community discussions sync live across ALL users through the GunX
   relay (verified: cross-tab + cross-client writes converge).
2. `GunBridge` (Python, stdlib-only) put/get/watch roundtrips replicate to
   the GLOBAL graph — verified by an independent gun client reading the
   same soul from `gunx.pages.dev`.
3. AiA publishes `os/aia/events` (kind `learn`, …) to the graph via the
   bridge when `GUN_BRIDGE_TOKEN` is configured (opt-in, never blocks).
4. No artificial limits: the relay enforces only its standard frame caps /
   token buckets; SDK file/P2P/image paths carry no size quotas.

## Verification

1. `python core/test_gun_bridge.py` — bridge RPC suite green.
2. Cross-client write test: bridge PUT → independent node gun client reads
   the value from `wss://gunx.pages.dev/gun`.
3. Portal build (`npm run build` in `portal/`) + live deploy check on
   pocwu.pages.dev (community page shows gun-synced posts).
4. `os/aia/events` contains a `learn-*` node after a `/learn` call.

## Out of Scope

- Yjs CRDT adapter (separate `gun-core` milestone).
- SEA user accounts for the OS (separate `gun-core` milestones).
- Vector indexing of learned lessons (later milestone).