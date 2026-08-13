/**
 * Pages Function — WebSocket handler for MultiplayerGlobe.
 *
 * Phase 2: Forwards WebSocket upgrade to GlobeRelayDO (standalone Worker)
 * for real-time cross-user peer sync. Geo-position is extracted from the
 * Cloudflare cf-* headers and passed as X-Geo-* headers to the DO.
 * Authenticated session tokens are forwarded as X-User-* headers so the
 * DO can associate each WebSocket connection with a user identity.
 *
 * Architecture:
 *   Browser → wss://pocwu.pages.dev/api/globe-ws
 *          → Pages Function (this file)
 *          → service binding → pocwu-globe-relay Worker → GlobeRelayDO
 *
 * Reference:
 *   https://github.com/cloudflare/templates/tree/main/multiplayer-globe-template
 */

interface Env {
  GLOBE_DO: Fetcher; // service binding to pocwu-globe-relay
  SESSIONS_KV?: KVNamespace;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const upgrade = request.headers.get("Upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  // Extract geo-position from Cloudflare cf-* headers (set on the edge)
  const cf = (request as any).cf as Record<string, unknown> | undefined;
  const latitude = String(cf?.latitude ?? "");
  const longitude = String(cf?.longitude ?? "");

  // Check for session token in query params (sent by useGlobeWebSocket)
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  // Forward to DO via service binding, passing geo + optional user as headers
  const headers: Record<string, string> = {
    Upgrade: "websocket",
    "X-Geo-Latitude": latitude,
    "X-Geo-Longitude": longitude,
  };

  let userLogin = "";

  if (token && env.SESSIONS_KV) {
    try {
      const raw = await env.SESSIONS_KV.get(`session:${token}`);
      if (raw) {
        const session = JSON.parse(raw) as {
          user?: { login: string; name: string; avatar: string };
        };
        if (session.user) {
          headers["X-User-Login"] = session.user.login;
          headers["X-User-Name"] = session.user.name;
          headers["X-User-Avatar"] = session.user.avatar;
          userLogin = session.user.login;
        }
      }
    } catch {
      // Ignore — connect anonymously
    }
  }

  const doRequest = new Request(request.url, {
    method: "GET",
    headers,
  });

  const response = await env.GLOBE_DO.fetch(doRequest);

  // Mark the user as having an active WebSocket connection in KV.
  // The TTL is refreshed periodically via the client-side heartbeat ping.
  // When the WS disconnects the key expires naturally, showing the user offline.
  if (userLogin && env.SESSIONS_KV && response.status === 101) {
    // Fire-and-forget — don't block the upgrade response
    context.waitUntil(
      env.SESSIONS_KV.put(`ws_active:${userLogin}`, "1", {
        expirationTtl: 130, // 2 min 10 s — covers 2 missed heartbeats
      }),
    );
  }

  return response;
};
