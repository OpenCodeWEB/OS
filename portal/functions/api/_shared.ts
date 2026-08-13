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
 */
export async function getSession(
  request: Request,
  env: Env,
): Promise<SessionData | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");

  if (!token || !env.SESSIONS_KV) return null;

  const raw = await env.SESSIONS_KV.get(`session:${token}`);
  if (!raw) return null;

  return JSON.parse(raw) as SessionData;
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
