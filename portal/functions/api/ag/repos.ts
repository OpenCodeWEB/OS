/**
 * POST /api/ag/repos — Create a GitHub repository via the AG worker.
 *
 * Proxies to the AG worker's POST /repos endpoint through the service
 * binding (same pattern as dashboard.ts). Requires a valid session token
 * (Authorization: Bearer <session>) so only logged-in users can create
 * repositories on behalf of installed orgs.
 *
 * Body: { owner: string, name: string, description?: string, private?: boolean, autoInit?: boolean }
 */

import { Env, json } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // ── Session auth ───────────────────────────────────────────────── //
  const auth = request.headers.get("Authorization") ?? "";
  const sessionToken = auth.replace("Bearer ", "");
  if (!sessionToken || !env.SESSIONS_KV) {
    return json({ error: "Authentication required" }, 401);
  }

  const sessionRaw = await env.SESSIONS_KV.get(`session:${sessionToken}`);
  if (!sessionRaw) {
    return json({ error: "Invalid or expired session" }, 401);
  }

  // ── Parse + validate body ──────────────────────────────────────── //
  let body: {
    owner?: string;
    name?: string;
    description?: string;
    private?: boolean;
    autoInit?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const owner = body.owner?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  if (!owner || !name) {
    return json({ error: "Missing required fields: owner, name" }, 400);
  }

  // ── Proxy to AG worker ─────────────────────────────────────────── //
  if (!env.AG_WORKER) {
    return json({ error: "AG worker not bound" }, 503);
  }

  try {
    const workerHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Forward gateway token so the worker's protected /repos route accepts us
    if (env.INTERNAL_GATEWAY_TOKEN) {
      workerHeaders["X-Gateway-Token"] = env.INTERNAL_GATEWAY_TOKEN;
    }

    const workerResp = await env.AG_WORKER.fetch("https://worker/repos", {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify(body),
    });

    const workerBody = await workerResp.text();
    return new Response(workerBody, {
      status: workerResp.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "AG worker unreachable", message }, 502);
  }
};
