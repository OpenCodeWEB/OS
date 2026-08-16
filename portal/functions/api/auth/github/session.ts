/**
 * GET /api/auth/github/session — verify current session token
 *
 * Accepts stateless HMAC-signed tokens (primary) and KV-backed sessions
 * (legacy).  KV failures never break verification.
 */

import { Env, json, getSessionData } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");

  const session = await getSessionData(token, env);
  if (!session) {
    return json({ authenticated: false }, 401);
  }

  return json({ authenticated: true, session });
};
