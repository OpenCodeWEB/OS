/**
 * @deprecated GunDB/GunX relay transport removed - community sync, presence
 * and all portal realtime now ride the sovereign .GDBx mesh
 * (gdbx.pages.dev / gdbx.xup.workers.dev).
 *
 * Compatibility shim: every existing import keeps working with the same
 * signatures, but the transport underneath is GDBx-signed, PoW-gated,
 * FirewallGuard-enforced and pool-replicated (GunX feature parity ON GDBx:
 * serverless relay, namespacing, LWW, offline-first, presence, auto-refresh).
 * See ./gdbx.ts for the implementation.
 */
export * from "./gdbx";