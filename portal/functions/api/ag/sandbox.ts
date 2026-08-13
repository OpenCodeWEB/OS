/**
 * GET /api/ag/sandbox?org=<owner>&name=<repo> — real sandbox repo status.
 *
 * Proxies the AG worker's read-only `/api/sandbox` endpoint via the
 * AG_WORKER service binding (same-origin for the SPA, no CORS needed).
 * The worker returns live GitHub state: commits, backup branches,
 * latest commit, visibility, default branch.
 */

import { Env, json } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  if (!env.AG_WORKER) {
    return json({ error: "AG_WORKER binding not configured" }, 500);
  }

  const url = new URL(request.url);
  const org = (url.searchParams.get("org") ?? "").trim();
  const name = (url.searchParams.get("name") ?? "").trim();

  if (!org || !name) {
    return json({ error: "Both org and name query parameters are required." }, 400);
  }

  try {
    const workerUrl = `https://worker/api/sandbox?org=${encodeURIComponent(org)}&name=${encodeURIComponent(name)}`;
    const resp = await env.AG_WORKER.fetch(workerUrl);
    const body = await resp.json();
    return json(body, resp.status);
  } catch (err) {
    return json(
      {
        error: "Sandbox proxy failed",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      502,
    );
  }
};
