/**
 * Sandbox collection endpoint — POST /api/sandbox (create).
 *
 * Note: in Cloudflare Pages Functions, `[id].ts` matches only
 * `/api/sandbox/:id`; the base path `/api/sandbox` must be handled by
 * `index.ts` in the folder.
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

// ─── POST /api/sandbox — create new sandbox ──────────────────
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const kv = env.DEVICES_KV;

  if (!kv || !env.SESSIONS_KV) {
    return json({ error: "Storage not configured" }, 503);
  }

  const user = await getUser(request, env.SESSIONS_KV);
  // Org sandboxes (owner "OpenCodeWEB") may be created without a user
  // session — the AG dashboard has no OAuth login; the records are
  // inert KV state with a 7-day TTL and capped payload size.
  const owner = user ?? "OpenCodeWEB";

  const body = (await request.json()) as {
    name?: string;
    org?: string;
  };
  if ((body.name ?? "").length > 80 || (body.org ?? "").length > 60) {
    return json({ error: "name/org too long" }, 400);
  }

  const sandbox: Sandbox = {
    id: crypto.randomUUID(),
    name: (body.name ?? "Untitled Sandbox").slice(0, 80),
    org: (body.org ?? "OpenCodeWEB").slice(0, 60),
    owner: owner,
    status: "creating",
    isolation: "strict",
    autoBackup: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await kv.put(`sandbox:${sandbox.id}`, JSON.stringify(sandbox), {
    expirationTtl: 86400 * 7, // 7 day TTL
  });

  // Transition to running after creation
  sandbox.status = "running";
  sandbox.updatedAt = new Date().toISOString();
  await kv.put(`sandbox:${sandbox.id}`, JSON.stringify(sandbox), {
    expirationTtl: 86400 * 7,
  });

  return json({ sandbox }, 201);
};
