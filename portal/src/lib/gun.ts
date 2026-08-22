/**
 * @deprecated GunDB/GunX relay removed — all community sync now rides the
 * sovereign .GDBx mesh (gdbx.pages.dev / gdbx-do.xup.workers.dev).
 *
 * This file is a compatibility shim: every existing import
 * (`subscribePosts`, `publishPost`, `getPeerCount`, types, …) keeps working,
 * but the transport underneath is GDBX1-signed, PoW-gated and pool-replicated.
 * See ./gdbx.ts for the implementation.
 */
export * from "./gdbx";
