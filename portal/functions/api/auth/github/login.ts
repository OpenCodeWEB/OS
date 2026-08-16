/**
 * GET /api/auth/github/login — redirect to GitHub OAuth
 *
 * Stateless CSRF: the `state` is an HMAC-signed token (verified in the
 * callback without any KV write), so login keeps working even when the
 * free-tier KV write budget is exhausted.
 */

import { Env, json, signToken } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const clientId = env.GITHUB_CLIENT_ID;
  const url = new URL(request.url);

  if (!clientId) {
    return json({ error: "GitHub OAuth not configured" }, 503);
  }

  const redirectUri = `${url.origin}/api/auth/github/callback`;

  // Stateless signed state token (CSRF protection, no KV write required).
  // Best-effort KV store as well so old-style callbacks still validate.
  const state = (await signToken({ purpose: "oauth_state" }, env)) ?? generateTokenFallback();
  if (env.SESSIONS_KV) {
    try {
      await env.SESSIONS_KV.put(`oauth_state:${state}`, "1", {
        expirationTtl: 600,
      });
    } catch {
      // KV write budget exhausted — signed state alone is sufficient.
    }
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

function generateTokenFallback(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
