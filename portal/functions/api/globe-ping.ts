/**
 * Globe Ping — Heartbeat endpoint for WebSocket presence tracking
 *
 * GET /api/globe-ping
 *
 * Called periodically by the client (useGlobeWebSocket) to refresh the
 * ws_active:<login> KV key, keeping the user marked as "online" while
 * they have an active page with a WebSocket connection to the globe.
 *
 * The initial ws_active key is set by globe-ws.ts on WebSocket upgrade.
 * If this endpoint isn't called within ~2 minutes the key expires and
 * the user appears offline on the /U page.
 */

interface Env {
  SESSIONS_KV?: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Session token from Authorization header
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");

  if (!token || !env.SESSIONS_KV) {
    return json({ ok: false }, 200);
  }

  try {
    const raw = await env.SESSIONS_KV.get(`session:${token}`);
    if (!raw) return json({ ok: false }, 200);

    const session = JSON.parse(raw) as { user?: { login: string } };
    const login = session.user?.login;
    if (!login) return json({ ok: false }, 200);

    // Refresh the presence key — extends TTL from now
    await env.SESSIONS_KV.put(`ws_active:${login}`, "1", {
      expirationTtl: 130,
    });

    return json({ ok: true });
  } catch {
    return json({ ok: false }, 200);
  }
};
