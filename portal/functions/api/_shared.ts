/**
 * Shared utilities for community API endpoints
 */

export interface SessionUser {
  login: string;
  id: number;
  avatar: string;
  name: string;
}

export interface SessionData {
  user: SessionUser;
  orgs?: string[];
  createdAt: string;
}

export interface Env {
  DB?: D1Database;
  SESSIONS_KV?: KVNamespace;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Extract and verify the session token from the Authorization header.
 * Returns the session data or null (which the caller should 401).
 *
 * Stateless first: HMAC-signed session tokens (v1.<b64>.<sig>) verify
 * without any KV access, so community endpoints keep working when the
 * free-tier KV write budget is exhausted.  Falls back to the KV cache for
 * legacy sessions.
 */
export async function getSession(
  request: Request,
  env: Env,
): Promise<SessionData | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");

  if (!token) return null;

  // Stateless signed-token path.
  const v1 = await verifyV1(token, env);
  if (v1 && v1.user && v1.createdAt) {
    return {
      user: v1.user as SessionUser,
      createdAt: String(v1.createdAt),
    };
  }

  // KV cache path (legacy sessions).
  if (env.SESSIONS_KV) {
    try {
      const raw = await env.SESSIONS_KV.get(`session:${token}`);
      if (raw) return JSON.parse(raw) as SessionData;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Verify a stateless HMAC-signed token (v1.<base64url payload>.<hex sig>).
 * Shared logic mirrors functions/api/auth/github/_shared.ts; duplicated here
 * to avoid cross-directory imports inside the Pages functions bundle.
 */
async function verifyV1(
  token: string,
  env: Env,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<Record<string, unknown> | null> {
  const secret = (env as Record<string, unknown>).JWT_SECRET ??
    (env as Record<string, unknown>).GITHUB_CLIENT_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, body, sig] = parts;
  const expected = await hmacHex(String(secret), body);
  if (sig.length !== expected.length || sig !== expected) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body)) as { iat?: number };
    if (payload.iat && Date.now() - payload.iat > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlDecode(input: string): string {
  const pad = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
}

/**
 * Resolve the GitHub login from a request's Authorization header.
 * Handles stateless HMAC-signed tokens (primary) and KV-backed legacy
 * sessions.  Returns null when unauthenticated or KV is unavailable.
 */
export async function getUserLogin(
  request: Request,
  env: Env,
): Promise<string | null> {
  const session = await getSession(request, env);
  return session?.user?.login ?? null;
}

/**
 * Generate a UUID v4 string (crypto-safe).
 */
export function uuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set version 4 bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
