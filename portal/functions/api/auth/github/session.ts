/**
 * GET /api/auth/github/session — verify current session token
 */

import { Env, json } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");

  if (!token || !env.SESSIONS_KV) {
    return json({ authenticated: false }, 401);
  }

  const session = await env.SESSIONS_KV.get(`session:${token}`);
  if (!session) {
    return json({ authenticated: false }, 401);
  }

  return json({ authenticated: true, session: JSON.parse(session) });
};
