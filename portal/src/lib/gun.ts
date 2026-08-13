/**
 * GunDB client singleton — P2P graph database with IndexedDB persistence.
 *
 * Architecture:
 *   Browser Tab A  ←→  [IndexedDB / SharedWorker]  ←→  Browser Tab B
 *        ↕                                          ↕
 *   Cloudflare REST API                    Cloudflare REST API
 *
 * Future: WebSocket relay for cross-user real-time sync.
 */
import Gun from "gun";

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
 * Get or create the GunDB singleton.
 * Data is persisted to IndexedDB automatically.
 */
export function getGun(): ReturnType<typeof Gun> {
  if (!_gun) {
    _gun = Gun({
      localStorage: true,
      peers: [],
      radisk: true,
    });
  }
  return _gun;
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
