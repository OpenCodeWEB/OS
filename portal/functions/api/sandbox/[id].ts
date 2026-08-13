/**
 * Sandbox item API
 *
 * GET  /api/sandbox/:id     — get sandbox status
 * PUT  /api/sandbox/:id     — update sandbox state
 * (POST /api/sandbox        — create, handled by ./index.ts)
 */

interface Sandbox {
  id: string;
  name: string;
  org: string;
  owner: string;
  status: "creating" | "running" | "preview" | "stopped";
  isolation: "strict" | "shared";
  autoBackup: boolean;
  previewUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface Env {
  DEVICES_KV?: KVNamespace;
  SESSIONS_KV?: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getUser(
  request: Request,
  kv: KVNamespace,
): Promise<string | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  if (!token) return null;

  const session = await kv.get(`session:${token}`);
  if (!session) return null;

  const data = JSON.parse(session);
  return data.user?.login ?? null;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params, env } = context;
  const method = request.method;
  const kv = env.DEVICES_KV;

  if (!kv || !env.SESSIONS_KV) {
    return json({ error: "Storage not configured" }, 503);
  }

  const user = await getUser(request, env.SESSIONS_KV);

  // ─── GET /api/sandbox/:id ─────────────────────────────────
  if (method === "GET" && params.id) {
    const sandbox = await kv.get(`sandbox:${params.id}`);
    if (!sandbox) return json({ error: "Sandbox not found" }, 404);

    const data: Sandbox = JSON.parse(sandbox);
    const actor = user ?? "OpenCodeWEB";
    if (data.owner !== actor) {
      // Org sandboxes are readable without a session; private
      // sandboxes require the owning user.
      if (!user) return json({ error: "Unauthorized" }, 401);
      return json({ error: "Forbidden" }, 403);
    }

    return json({ sandbox: data });
  }

  return json({ error: "Not found" }, 404);
};

// ─── PUT /api/sandbox/:id — update state ─────────────────────
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { request, params, env } = context;
  const kv = env.DEVICES_KV;

  if (!kv || !env.SESSIONS_KV) {
    return json({ error: "Storage not configured" }, 503);
  }

  const user = await getUser(request, env.SESSIONS_KV);
  if (!params.id) return json({ error: "Sandbox ID required" }, 400);

  const existing = await kv.get(`sandbox:${params.id}`);
  if (!existing) return json({ error: "Sandbox not found" }, 404);

  const sandbox: Sandbox = JSON.parse(existing);
  // Org sandboxes may be published without a session (inert KV state).
  const actor = user ?? "OpenCodeWEB";
  if (sandbox.owner !== actor) {
    if (!user) return json({ error: "Unauthorized" }, 401);
    return json({ error: "Forbidden" }, 403);
  }
  const body = (await request.json()) as {
    status?: Sandbox["status"];
  };

  if (body.status) sandbox.status = body.status;
  sandbox.updatedAt = new Date().toISOString();

  await kv.put(`sandbox:${params.id}`, JSON.stringify(sandbox), {
    expirationTtl: 86400 * 7,
  });

  return json({ sandbox });
};
