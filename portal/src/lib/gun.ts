/**
 * GunDB client singleton — P2P graph database with IndexedDB persistence.
 *
 * Architecture:
 *   Browser Tab A  ←─wss─→  [Serverless Relay wss://gunx.pages.dev/gun]  ←─wss─→  Browser Tab B
 *        ↕                                  ↕ (Cloudflare Workers + Durable Objects)
 *   IndexedDB (offline-first)     [LAN fallback wss://absup:8765/gun]
 *
 * Primary relay: gunx.pages.dev — serverless GunDB peer (no relay server needed),
 * deployed from Gun-serverless/ (Workers Durable Object + Pages Functions).
 * LAN fallback: OpenCodeWEB OS local relay (OS/gun-relay/relay.js).
 * SEA (Security, Encryption, Authorization) is loaded for E2EE user data.
 */
import Gun from "gun";
import "gun/sea";

// Re-export Gun for convenience
export { Gun };

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GunPost {
  id: string;
  title: string;
  body: string;
  category: string;
  author: string;
  authorAvatar: string;
  authorId: number;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  _source: "gun";
}

export interface GunComment {
  id: string;
  postId: string;
  body: string;
  author: string;
  authorAvatar: string;
  authorId: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Singleton                                                          */
/* ------------------------------------------------------------------ */

let _gun: ReturnType<typeof Gun> | null = null;

/**
 * Relay endpoints for cross-user real-time sync.
 * - GUN_RELAY_URLS env override (comma-separated) for custom deployments
 * - Default: serverless gunx.pages.dev relay (no relay server needed).
 *   The local OS relay is NOT listed here on purpose: gun clients ask peers
 *   round-robin and stop at the first answer, so a stale LAN relay would
 *   shadow the authoritative serverless graph.
 */
const RELAY_URLS = (
  import.meta.env.VITE_GUN_RELAY_URLS ||
  "https://gunx.pages.dev/gun"
)
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

/**
 * Get or create the GunDB singleton.
 * Data is persisted to IndexedDB automatically and synced across
 * peers through the configured relay(s).
 */
export function getGun(): ReturnType<typeof Gun> {
  if (!_gun) {
    _gun = Gun({
      localStorage: true,
      peers: RELAY_URLS,
      radisk: true,
    });
    startSyncPolling();
  }
  return _gun;
}

/**
 * List configured relay URLs.
 */
export function getRelayUrls(): string[] {
  return [...RELAY_URLS];
}

/**
 * Derive a deterministic GunDB key from the session token.
 */
export function deriveGunKey(sessionToken: string): string {
  let hash = 0;
  for (let i = 0; i < sessionToken.length; i++) {
    const char = sessionToken.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return "user_" + Math.abs(hash).toString(36);
}

/* ------------------------------------------------------------------ */
/*  Graph helpers                                                      */
/* ------------------------------------------------------------------ */

const POSTS_KEY = "community_posts";
const COMMENTS_KEY = "community_comments";

/**
 * Subscribe to all GunDB-synced posts.
 * Calls `onData` with the full merged map whenever data changes.
 * Returns an unsubscribe function.
 */
export function subscribePosts(
  onData: (posts: Record<string, GunPost>) => void,
): () => void {
  const gun = getGun();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postsNode = gun.get(POSTS_KEY) as any;

  const off = postsNode.on((data: Record<string, GunPost> | null) => {
    onData(data ?? {});
  });

  return () => {
    if (typeof off === "function") off();
  };
}

/**
 * Publish a post to the local GunDB graph.
 * Other tabs (same origin) see it instantly via shared IndexedDB.
 */
export function publishPost(post: GunPost): void {
  const gun = getGun();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (gun.get(POSTS_KEY) as any).get(post.id).put(post as any);
}

/**
 * Remove a post from the GunDB graph.
 */
export function unpublishPost(postId: string): void {
  const gun = getGun();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (gun.get(POSTS_KEY) as any).get(postId).put(null);
}

/**
 * Publish a comment to the GunDB graph.
 */
export function publishComment(comment: GunComment): void {
  const gun = getGun();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (gun.get(COMMENTS_KEY) as any).get(comment.id).put(comment as any);
}

/**
 * Get the number of GunDB-connected peers (tabs / relays).
 */
export function getPeerCount(): number {
  const gun = getGun();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const peers = (gun as any)._?.peers;
  if (!peers) return 0;
  return Object.keys(peers).length;
}

/* ------------------------------------------------------------------ */
/*  Peer refresh polling                                               */
/* ------------------------------------------------------------------ */

/**
 * Force-refresh the given souls from connected peers.
 *
 * Why this exists: gun clients only ask peers about souls they already have
 * locally at peer-connect time ("hi" handler -> per-key hash-check GETs).
 * In an SPA the gun singleton connects at boot, but route-level subscriptions
 * (e.g. the community page) start later — at that point the peer is never
 * asked, so remote writes made while this tab was offline or unsubscribed
 * never arrive. A plain soul GET makes the peer reply with the full fresh
 * node (verified against the gunx serverless relay: `{get:{"#":soul}}` ->
 * complete node reply, which gun merges and re-emits to live `.on()`s).
 *
 * The message is injected through the root `out` pipeline (the canonical
 * wire path — identical to what mesh.say does internally), so the wire
 * layer handles framing, and every connected peer is asked.
 */
export function refreshSouls(souls: string[]): void {
  const gun = getGun();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const root = (gun as any)._;
  if (!root || !root.mesh || !root.opt || !root.opt.peers) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const peers = root.opt.peers as Record<string, any>;
  const ids = Object.keys(peers);
  if (!ids.length) return;
  for (const soul of souls) {
    const msg = { get: { "#": soul } };
    for (const id of ids) {
      const peer = peers[id];
      if (!peer || !peer.wire) continue;
      root.on("out", msg, peer);
    }
  }
}

const REFRESH_INTERVAL_MS = 20000;
const SYNC_SOULS = [POSTS_KEY, COMMENTS_KEY];

/**
 * Start periodic peer refresh polling (idempotent).
 * Runs while the tab is visible; also refreshes immediately when the tab
 * becomes visible again so returning users see fresh remote data.
 */
function startSyncPolling(): void {
  const gun = getGun();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = gun as any;
  if (g.__syncPoll) return;
  g.__syncPoll = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    refreshSouls(SYNC_SOULS);
  }, REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshSouls(SYNC_SOULS);
  });
}
