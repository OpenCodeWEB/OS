/**
 * POST /api/auth/github/logout — destroy session
 *
 * Sessions are stateless (HMAC-signed); logout invalidates client-side by
 * discarding the token.  Best-effort KV delete for legacy cached sessions
 * — never fails the request even when KV is unavailable.
 */

import { Env, json } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");

  if (token && env.SESSIONS_KV) {
    try {
      await env.SESSIONS_KV.delete(`session:${token}`);
    } catch {
      // KV unavailable — stateless token is discarded client-side anyway.
    }
  }

  return json({ ok: true });
};
