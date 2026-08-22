/**
 * @deprecated GunDB/GunX relay transport removed — community sync, presence
 * and all portal realtime now ride the sovereign .GDBx mesh
 * (gdbx.pages.dev / gdbx-do.xup.workers.dev).
 *
 * This file is a compatibility shim: every existing import
 * (`subscribePosts`, `publishPost`, `publishComment`, `getGun`,
 * `getPeerCount`, `getRelayUrls`, `deriveGunKey`, `refreshSouls`,
 * `startPresenceHeartbeat`, `fetchPresence`, types …) keeps working with the
 * same signatures, but the transport underneath is GDBx-signed, PoW-gated,
 * FirewallGuard-enforced and pool-replicated.
 *
 * GunX feature parity preserved ON GDBx (nothing lost):
 *   - serverless relay        → gdbx-do Worker + Durable Objects (no server)
 *   - appKey namespacing      → key prefixes (pocwu/community/…, pocwu/presence/…)
 *   - LWW merge               → native LWW CRDT in GDBxStorageDO
 *   - offline-first cache     → localStorage snapshot + refresh polling
 *   - presence joinPresence   → startPresenceHeartbeat (signed deltas)
 *   - onPeers                 → getPeerCount via live hub state
 *   - auto-refresh            → 20s prefix poll + WS broadcast
 * See ./gdbx.ts for the implementation.
 */
export * from "./gdbx";
