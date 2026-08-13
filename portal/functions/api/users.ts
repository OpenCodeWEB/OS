/**
 * Users API
 *
 * GET /api/users — list all registered users from active sessions.
 * Online status is determined by presence KV keys (ws_active:<login>)
 * that are set / refreshed by globe-ws.ts (WebSocket upgrade) and
 * globe-ping.ts (heartbeat), NOT by session freshness.
 *
 * This approach works independently of the DO Worker lifecycle —
 * no DO query needed.
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

interface SessionUser {
  login: string;
  id: number;
  avatar: string;
  name: string;
}

interface UserEntry {
  login: string;
  id: number;
  avatar: string;
  name: string;
  status: "online" | "offline";
  lastSeen: string;
  joinedAt: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const kv = env.SESSIONS_KV;

  if (!kv) {
    return json({ error: "Storage not configured" }, 503);
  }

  // ── Iterate over all session keys ──────────────────────────────────//
  const userMap = new Map<string, UserEntry>();

  try {
    let cursor: string | undefined;
    do {
      const list = await kv.list({ prefix: "session:", cursor });
      for (const key of list.keys) {
        const val = await kv.get(key.name);
        if (!val) continue;

        try {
          const session = JSON.parse(val) as {
            user: SessionUser;
            createdAt: string;
          };
          if (!session.user?.login) continue;

          const login = session.user.login;
          const existing = userMap.get(login);

          // Keep the most recent session timestamp
          const sessionTime = new Date(session.createdAt).getTime();
          if (!existing || sessionTime > new Date(existing.joinedAt).getTime()) {
            // Online if they have an active ws_active KV key (set by
            // globe-ws.ts on WS upgrade, refreshed by globe-ping.ts heartbeat)
            const wsKey = `ws_active:${login}`;
            const wsActive = await kv.get(wsKey);

            userMap.set(login, {
              login: session.user.login,
              id: session.user.id,
              avatar: session.user.avatar,
              name: session.user.name,
              status: wsActive ? "online" : "offline",
              lastSeen: existing?.lastSeen ?? session.createdAt,
              joinedAt: existing?.joinedAt ?? session.createdAt,
            });
          }
        } catch {
          // Skip malformed entries
        }
      }
      cursor = (list as unknown as { cursor: string }).cursor;
    } while (cursor);

    // Sort: online first, then by name
    const users = Array.from(userMap.values()).sort((a, b) => {
      if (a.status !== b.status) return a.status === "online" ? -1 : 1;
      return a.login.localeCompare(b.login);
    });

    return json({ users });
  } catch (err) {
    return json({ error: "Failed to list users", users: [] }, 500);
  }
};
