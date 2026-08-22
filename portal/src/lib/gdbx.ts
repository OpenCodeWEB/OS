/**
 * GDBx portal sync adapter — sovereign community fabric (replaces GunDB/GunX).
 *
 * Architecture (Gemini-consulted migration, Top 1: same-interface adapter):
 *   Browser Tab A  ←─wss─→  [GDBx hub wss://gdbx-do.xup.workers.dev/ws?addr=…]  ←─wss─→  Browser Tab B
 *        ↕                                   ↕ (GDBX1 signed + PoW + FirewallGuard + LWW CRDT)
 *   localStorage cache                [GDBxMirrorDO pool — pool-replicated]
 *
 * Wire protocol (identical to gdbx.pages.dev playground, proven live):
 *   - PUT  : WS {type:"put", addr, pubkey, pubkeyHex, deltas[], ts, nonce, diff, hash, sig}
 *            fallback POST https://gdbx-do.xup.workers.dev/sync (same body)
 *   - READ : GET  https://gdbx-do.xup.workers.dev/sync/:addr?prefix=…
 *   - SIG  : GDBX1 envelope "GDBX1"+JSON{m,s} — canonical key-sorted JSON,
 *            ECDSA P-256/SHA-256 over SHA256(m) (double-hash, matches worker verify)
 *   - PoW  : SHA256(`${addr}:${pub}:${action}:${ts}:${nonce}`) startsWith "00"
 *
 * Community data lives under ONE shared sovereign address so every visitor
 * converges on the same graph (open forum semantics — same as the old open
 * GunX relay, but now zero-trust signed and pool-replicated):
 *   posts    → pocwu/community/posts/<id>
 *   comments → pocwu/community/comments/<postId>/<commentId>
 */

/* ------------------------------------------------------------------ */
/*  Shared community identity (dedicated .GDBx for this portal)        */
/* ------------------------------------------------------------------ */

const COMMUNITY = {
  pub: "EJwLw1uSVbcCDYvUZJ7u-Fi6ZOLXBiu3unKAlGperTo.1Cy4hEmJ1VhpiVbG2CZxh4NNNXhWZSIGfNwaCqZJQog",
  priv: "V4SKgabvy_GqG69U69GieTe6CCkVXZgdfE24f_x-rr8",
  pubkeyHex:
    "04109c0bc35b9255b7020d8bd4649eeef858ba64e2d7062bb7ba7280946a5ead3ad42cb8844989d558698956c6d8267187834d3578566522067cdc1a0aa6494288",
  addr: "aeac2ygbljleaiocudsbqijkjrljk2z5nhtq3xtwovu46cfmzqarwju6gq",
};

const WORKER_BASE = "https://gdbx-do.xup.workers.dev";
const WS_URL = "wss://gdbx-do.xup.workers.dev/ws";

const POSTS_PREFIX = "pocwu/community/posts/";
const COMMENTS_PREFIX = "pocwu/community/comments/";

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

type PostsCallback = (posts: Record<string, GunPost>) => void;

interface DeltaEntry {
  key: string;
  value: string;
  clock?: number;
}

/* ------------------------------------------------------------------ */
/*  GDBX1 crypto helpers (pure WebCrypto — matches sdk/gdbx-crypto.js) */
/* ------------------------------------------------------------------ */

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj) as string;
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(rec[k])).join(",") +
    "}"
  );
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let _signKey: CryptoKey | null = null;
async function getSignKey(): Promise<CryptoKey> {
  if (_signKey) return _signKey;
  const [x, y] = COMMUNITY.pub.split(".");
  _signKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d: COMMUNITY.priv },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return _signKey;
}

/** GDBX1 sign over a canonical body (double-hash, matches worker/src/verify.js). */
async function gdbx1Sign(body: Record<string, unknown>): Promise<string> {
  const m = canonicalJson(body);
  const key = await getSignKey();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(m));
  const rawSig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, hash);
  return "GDBX1" + JSON.stringify({ m, s: bytesToB64url(new Uint8Array(rawSig)) });
}

async function minePoW(action: string, ts: number): Promise<{ nonce: number; hash: string; diff: number }> {
  const input = `${COMMUNITY.addr}:${COMMUNITY.pub}:${action}:${ts}:`;
  for (let nonce = 1; nonce < 500_000; nonce++) {
    const hex = await sha256Hex(input + nonce);
    if (hex.startsWith("00")) return { nonce, hash: hex, diff: 2 };
  }
  throw new Error("PoW timeout");
}

/* ------------------------------------------------------------------ */
/*  Connection state                                                   */
/* ------------------------------------------------------------------ */

let ws: WebSocket | null = null;
let wsOpen = false;
let retryMs = 5000;
let registered = false;

// delta fan-out: subscribers registered per key-prefix
const postsSubs = new Set<PostsCallback>();
const postsMap = new Map<string, GunPost>();
const seenKeys = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Instant-live cache — hydrate from localStorage BEFORE any network  */
/* ------------------------------------------------------------------ */

const CACHE_KEY = "gdbx-community-cache-v1";

function hydrateCache(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, GunPost>;
    for (const [id, p] of Object.entries(obj)) {
      if (p && p.id && p.title) postsMap.set(id, p);
    }
  } catch {}
}

function persistCache(): void {
  try {
    const obj: Record<string, GunPost> = {};
    for (const [id, p] of postsMap) obj[id] = p;
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {}
}

/* ------------------------------------------------------------------ */
/*  Low-level write (WS preferred, HTTP fallback)                      */
/* ------------------------------------------------------------------ */

async function ensureRegistered(): Promise<void> {
  if (registered) return;
  // Idempotent probe: server returns 200 for existing DID (per-addr limit path)
  try {
    const chk = await fetch(`${WORKER_BASE}/did/${COMMUNITY.addr}`);
    if (chk.ok) {
      registered = true;
      return;
    }
  } catch {
    /* fallthrough to register */
  }
  const ts = Date.now();
  const pow = await minePoW("did.register", ts);
  const sig = await gdbx1Sign({ addr: COMMUNITY.addr, action: "did.register", ts, payload: null });
  const res = await fetch(`${WORKER_BASE}/did`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      addr: COMMUNITY.addr,
      pubkey: COMMUNITY.pub,
      pubkeyHex: COMMUNITY.pubkeyHex,
      ts,
      nonce: pow.nonce,
      diff: pow.diff,
      hash: pow.hash,
      sig,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok && !/already|exists|registered/i.test(data.error || "")) {
    throw new Error(data.error || `register failed (${res.status})`);
  }
  registered = true;
}

async function putDeltas(deltas: Array<{ key: string; value: string }>, retries = 0): Promise<void> {
  await ensureRegistered();
  const ts = Date.now();
  const pow = await minePoW("sync.put", ts);
  const sig = await gdbx1Sign({
    addr: COMMUNITY.addr,
    action: "sync.put",
    ts,
    payload: JSON.stringify(deltas),
  });
  const body = {
    type: "put",
    addr: COMMUNITY.addr,
    pubkey: COMMUNITY.pub,
    pubkeyHex: COMMUNITY.pubkeyHex,
    deltas,
    ts,
    nonce: pow.nonce,
    diff: pow.diff,
    hash: pow.hash,
    sig,
  };

  // Preferred path: WS hub (instant broadcast to all subscribed visitors)
  if (ws && wsOpen) {
    try {
      ws.send(JSON.stringify(body));
      return;
    } catch {
      /* fallthrough to HTTP */
    }
  }

  // HTTP fallback — with auto-retry on transient rate limiting
  const res = await fetch(`${WORKER_BASE}/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!res || !res.ok) {
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (retryable && retries < 3) {
      await new Promise((r) => setTimeout(r, (retries + 1) * 3000));
      return putDeltas(deltas, retries + 1);
    }
    throw new Error(`GDBx put failed${res ? ` (${res.status})` : " (network)"}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Read path                                                          */
/* ------------------------------------------------------------------ */

function parseEntry(entry: DeltaEntry): void {
  if (!entry || !entry.key) return;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(String(entry.value));
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;

  // tombstone (unpublish) — remove from map
  if ((parsed as { _deleted?: boolean })._deleted) {
    const id =
      (parsed as { id?: string }).id ||
      entry.key.slice(POSTS_PREFIX.length);
    postsMap.delete(id);
    postsMap.delete(entry.key.slice(POSTS_PREFIX.length));
    seenKeys.add(entry.key);
    return;
  }

  // post entries only here (comments live under their own prefix and are not
  // part of the posts map — same as the old gun soul separation)
  if (!entry.key.startsWith(POSTS_PREFIX)) return;

  const post = parsed as unknown as GunPost;
  if (!post.id || !post.title) return;
  postsMap.set(post.id, { ...post, _source: "gun" });
  seenKeys.add(entry.key);
}

function emitPosts(): void {
  const snapshot: Record<string, GunPost> = {};
  for (const [id, p] of postsMap) snapshot[id] = p;
  persistCache();
  for (const cb of postsSubs) cb(snapshot);
}

async function refreshPrefix(prefix: string): Promise<void> {
  try {
    const res = await fetch(`${WORKER_BASE}/sync/${COMMUNITY.addr}?prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { entries?: DeltaEntry[] };
    let changed = false;
    for (const e of data.entries || []) {
      if (seenKeys.has(e.key)) continue;
      parseEntry(e);
      changed = true;
    }
    if (changed && postsSubs.size > 0) emitPosts();
  } catch {
    /* offline — cached map stays */
  }
}

/* ------------------------------------------------------------------ */
/*  WebSocket hub                                                      */
/* ------------------------------------------------------------------ */

function connect(): void {
  try {
    ws = new WebSocket(`${WS_URL}?addr=${COMMUNITY.addr}`);
  } catch {
    return;
  }
  ws.onopen = () => {
    wsOpen = true;
    retryMs = 5000;
    try {
      ws?.send(JSON.stringify({ type: "hello", addr: COMMUNITY.addr }));
    } catch {}
    // fresh subscription → pull anything missed while disconnected
    void refreshPrefix(POSTS_PREFIX);
  };
  ws.onmessage = (ev) => {
    let msg: { type?: string; key?: string; value?: string };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === "delta" && msg.key && msg.key.startsWith("pocwu/community/")) {
      if (seenKeys.has(msg.key)) return;
      parseEntry(msg as DeltaEntry);
      emitPosts();
    }
  };
  ws.onclose = () => {
    wsOpen = false;
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 20000);
  };
  ws.onerror = () => {
    try {
      ws?.close();
    } catch {}
  };
}

/* ------------------------------------------------------------------ */
/*  Boot (lazy singleton)                                              */
/* ------------------------------------------------------------------ */

let booted = false;
let stopPolling: (() => void) | null = null;
function boot(): void {
  if (booted) return;
  booted = true;
  hydrateCache();
  connect();
  // periodic refresh replaces gun's refreshSouls polling (20s → same cadence)
  if (!stopPolling) {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshPrefix(POSTS_PREFIX);
    }, 20000);
    stopPolling = () => clearInterval(timer);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => stopPolling?.());
    }
  }
  void refreshPrefix(POSTS_PREFIX);
}

/**
 * Login-instant guarantee: warm the hub + cache at app root (main.tsx imports
 * this module for side effects), so by the time a user reaches the community
 * page the WS is open and posts are already in localStorage/memory.
 */
if (typeof window !== "undefined") {
  try {
    boot();
  } catch {}
}

/* ------------------------------------------------------------------ */
/*  Public API — drop-in compatible surface used by the app            */
/* ------------------------------------------------------------------ */

export function subscribePosts(onData: PostsCallback): () => void {
  boot();
  postsSubs.add(onData);
  // deliver current cache immediately, then live updates
  if (postsMap.size > 0) {
    const snapshot: Record<string, GunPost> = {};
    for (const [id, p] of postsMap) snapshot[id] = p;
    onData(snapshot);
  }
  void refreshPrefix(POSTS_PREFIX);
  return () => {
    postsSubs.delete(onData);
  };
}

export function publishPost(post: GunPost): void {
  boot();
  void putDeltas([
    { key: `${POSTS_PREFIX}${post.id}`, value: JSON.stringify(post) },
  ]).catch((e) => console.error("[gdbx] publishPost:", e));
}

export function unpublishPost(postId: string): void {
  boot();
  void putDeltas([
    {
      key: `${POSTS_PREFIX}${postId}`,
      value: JSON.stringify({ id: postId, _deleted: true }),
    },
  ]).catch((e) => console.error("[gdbx] unpublishPost:", e));
}

export function publishComment(comment: GunComment): void {
  boot();
  void putDeltas([
    {
      key: `${COMMENTS_PREFIX}${comment.postId}/${comment.id}`,
      value: JSON.stringify(comment),
    },
  ]).catch((e) => console.error("[gdbx] publishComment:", e));
}

/**
 * Peer-count compat: useGunSync reads `(getGun() as any)._?.peers` and counts
 * keys every 5s — expose exactly that shape backed by live WS state.
 */
export function getGun(): { _: { peers: Record<string, unknown> } } {
  boot();
  return { _: { peers: wsOpen ? { hub: {} } : {} } };
}

/** Number of connected relay peers (compat — 1 while the GDBx hub is open). */
export function getPeerCount(): number {
  return wsOpen ? 1 : 0;
}

/** Relay URLs compat — now points at the sovereign GDBx edge. */
export function getRelayUrls(): string[] {
  return [WORKER_BASE];
}

/** Deterministic key derivation (unchanged behavior). */
export function deriveGunKey(sessionToken: string): string {
  let hash = 0;
  for (let i = 0; i < sessionToken.length; i++) {
    const char = sessionToken.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return "user_" + Math.abs(hash).toString(36);
}

/**
 * Force-refresh compat — pulls the given logical collections ("souls").
 * Maps legacy soul names onto GDBx prefixes.
 */
export function refreshSouls(souls: string[]): void {
  boot();
  for (const s of souls) {
    if (s === "community_posts") void refreshPrefix(POSTS_PREFIX);
    else if (s === "community_comments") void refreshPrefix(COMMENTS_PREFIX);
    else void refreshPrefix(`${s}/`);
  }
}

/** Test/debug hook. */
export function __gdbxState() {
  return {
    addr: COMMUNITY.addr,
    wsOpen,
    cachedPosts: postsMap.size,
    seenKeys: seenKeys.size,
    subscribers: postsSubs.size,
  };
}
