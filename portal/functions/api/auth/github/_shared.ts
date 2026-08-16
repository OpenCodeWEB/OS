/**
 * Shared utilities for GitHub OAuth handlers
 *
 * Session + OAuth-state handling is STATELESS by default: tokens are
 * HMAC-SHA256 signed (JWT_SECRET, falling back to GITHUB_CLIENT_SECRET), so
 * login works even when the free-tier KV write budget (1,000 writes/day) is
 * exhausted.  KV is used as a best-effort cache only — failures never break
 * the auth flow.
 */

export interface Env {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  JWT_SECRET?: string;
  SESSIONS_KV?: KVNamespace;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Stateless signed tokens (HMAC-SHA256)
// ---------------------------------------------------------------------------

function b64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): string {
  const pad = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
}

async function sign(secret: string, payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function signingSecret(env: Env): string | null {
  return env.JWT_SECRET || env.GITHUB_CLIENT_SECRET || null;
}

/**
 * Create a signed stateless token: `v1.<base64url(payload)>.<hmac>`
 */
export async function signToken(payload: Record<string, unknown>, env: Env): Promise<string | null> {
  const secret = signingSecret(env);
  if (!secret) return null;
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = await sign(secret, body);
  return `v1.${body}.${sig}`;
}

/**
 * Verify a signed token; returns the payload or null.
 * `maxAgeMs` caps the token lifetime (default 24h).
 */
export async function verifyToken(
  token: string | null | undefined,
  env: Env,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const secret = signingSecret(env);
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, body, sig] = parts;
  const expected = await sign(secret, body);
  if (sig.length !== expected.length || sig !== expected) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body)) as { iat?: number };
    if (payload.iat && Date.now() - payload.iat > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session helpers (KV as best-effort cache, stateless fallback)
// ---------------------------------------------------------------------------

export interface SessionUser {
  login: string;
  id: number;
  avatar: string;
  name: string;
}

export interface SessionData {
  user: SessionUser;
  createdAt: string;
}

/**
 * Look up a session by token: signed token first (stateless), then KV cache.
 */
export async function getSessionData(
  token: string | null | undefined,
  env: Env,
): Promise<SessionData | null> {
  if (!token) return null;

  // Stateless path — works with zero KV writes.
  const payload = await verifyToken(token, env);
  if (payload && payload.user && payload.createdAt) {
    return {
      user: payload.user as SessionUser,
      createdAt: String(payload.createdAt),
    };
  }

  // KV cache path (legacy sessions created before stateless rollout).
  if (env.SESSIONS_KV) {
    try {
      const raw = await env.SESSIONS_KV.get(`session:${token}`);
      if (raw) return JSON.parse(raw) as SessionData;
    } catch {
      // KV failure must never break auth — stateless path above is primary.
    }
  }
  return null;
}
