# Plan — OS + AiA on GunX (serverless GunDB graph integration)

**Track:** `os-gunx` | **Repo:** `D:\OpenCodeWEB\OS`

## Steps

| # | Step | Detail | Verify |
| :--- | :--- | :--- | :--- |
| 1 | Track registration | `conductor/tracks/os-gunx/` (spec, plan, metadata) + registry row | Files exist, `tracks.md` updated |
| 2 | Portal relay wiring | `portal/src/lib/gun.ts`: peers = `gunx.pages.dev/gun`, `refreshSouls` via `root.on("out", {get:{"#":soul}}, peer)`, 20s polling, offline queue for writes | `npm run build` green; cross-tab post appears |
| 3 | Portal hygiene | Remove debug hooks; ignore `.dev.vars`; clean leftover test post in `community_posts` | Empty nodes filtered by `useGunSync`; no secrets tracked |
| 4 | Bridge → GunX | `gun-relay/bridge.js`: default relay = `wss://gunx.pages.dev/gun`, `axe:false`, `multicast:false` | `/health` shows gunx relay; Python put → global readback |
| 5 | AiA events | `core/aia/agent_engine.py`: `_gunx_publish` on `/learn` (opt-in via `GUN_BRIDGE_TOKEN`) | `os/aia/events/learn-*` visible on the graph |
| 6 | Deploy + verify | Push to `main` → pipeline deploys portal; browser + node cross-client checks | Live verification record |

## Key Design Decisions

- **`axe:false` + `multicast:false` on every Node gun peer** — LAN peer
  discovery interferes with the node client's connection to the remote relay
  (verified empirically in `relay.js`; the bridge inherited the fix).
- **Portal excludes the local LAN relay** from its peer list on purpose: a
  stale LAN relay would shadow the authoritative serverless graph
  (round-robin ask, first answer wins).
- **Bridge keeps its local file cache** (offline-first) but replicates every
  write to the serverless relay over the peer connection.
- **`mime` field for P2P metadata** (never duplicate `type`) so receivers
  complete transfers (gunx SDK lesson applied in GunX repo).

## Risks / Mitigations

- **Relay reachability** → bridge remains fully functional from its local
  cache when the relay is down; writes replay on reconnect.
- **Pollution of the public graph** → test souls cleaned; portal filters
  empty/partial nodes; all OS namespaces prefixed (`os/*`).
- **Secrets** → `portal/.dev.vars` and `certs/*.key` gitignored; bridge token
  via env only; secret leak scan in CI.