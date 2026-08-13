/**
 * GET /api/ag/auth/callback — handle GitHub App installation callback
 *
 * After a user installs the GitHub App, GitHub redirects here with:
 *   - code: temporary OAuth code (for OAuth flow, if enabled)
 *   - installation_id: the installation ID
 *   - setup_action: "install"
 *
 * We store the installation metadata in AG_TOKENS_KV for the worker.
 */

import { Env, json, generateToken } from "../_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);
  const kv = env.AG_TOKENS_KV;

  const installationId = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action");
  const code = url.searchParams.get("code");

  if (!installationId) {
    return json({ error: "Missing installation_id" }, 400);
  }

  // Store installation record in KV
  if (kv) {
    const record = {
      installationId,
      setupAction: setupAction ?? "install",
      installedAt: new Date().toISOString(),
      // If we received an OAuth code, store it for token exchange later
      ...(code ? { pendingCode: code } : {}),
    };

    await kv.put(
      `ag_install:${installationId}`,
      JSON.stringify(record),
      { expirationTtl: 86400 * 30 } // 30 days
    );

    // Also store a reference under the login key if we have a session
    const sessionToken = url.searchParams.get("session");
    if (sessionToken && env.SESSIONS_KV) {
      const sessionRaw = await env.SESSIONS_KV.get(`session:${sessionToken}`);
      if (sessionRaw) {
        try {
          const session = JSON.parse(sessionRaw) as { user?: { login?: string } };
          if (session.user?.login) {
            await kv.put(
              `ag_user:${session.user.login}:installations`,
              JSON.stringify({ installations: [installationId] }),
              { expirationTtl: 86400 * 30 }
            );
          }
        } catch {
          // Ignore malformed session
        }
      }
    }
  }

  // Redirect to the AG dashboard
  const appUrl = new URL(url.origin);
  appUrl.pathname = "/ag";
  appUrl.searchParams.set("installed", installationId);
  return Response.redirect(appUrl.toString(), 302);
};
