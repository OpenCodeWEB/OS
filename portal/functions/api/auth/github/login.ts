/**
 * GET /api/auth/github/login — redirect to GitHub OAuth
 */

import { Env, json, generateToken } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const clientId = env.GITHUB_CLIENT_ID;
  const url = new URL(request.url);

  if (!clientId) {
    return json({ error: "GitHub OAuth not configured" }, 503);
  }

  const redirectUri = `${url.origin}/api/auth/github/callback`;
  const state = generateToken(); // CSRF protection

  // Store state in KV with 10min expiry
  if (env.SESSIONS_KV) {
    await env.SESSIONS_KV.put(`oauth_state:${state}`, "1", {
      expirationTtl: 600,
    });
  }

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", clientId);
  githubUrl.searchParams.set("redirect_uri", redirectUri);
  // Minimal scope: only read public profile info (login, avatar, name).
  // No repo, org, workflow, or write permissions are ever requested.
  githubUrl.searchParams.set("scope", "read:user");
  githubUrl.searchParams.set("state", state);

  return Response.redirect(githubUrl.toString(), 302);
};
