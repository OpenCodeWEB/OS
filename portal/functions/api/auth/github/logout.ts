/**
 * POST /api/auth/github/logout — destroy session
 */

import { Env, json } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");

  if (token && env.SESSIONS_KV) {
    await env.SESSIONS_KV.delete(`session:${token}`);
  }

  return json({ ok: true });
};
