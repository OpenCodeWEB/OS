/**
 * Project management API (sandbox projects / templates)
 *
 * GET  /api/projects/:id  — get project details
 * POST /api/projects      — create project (from template)
 */

interface Project {
  id: string;
  name: string;
  description: string;
  template: string;
  owner: string;
  org?: string;
  tags: string[];
  status: "draft" | "preview" | "live";
  previewUrl?: string;
  createdAt: string;
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

  // ─── GET /api/projects/:id ───────────────────────────────
  if (method === "GET" && params.id) {
    const project = await kv.get(`project:${params.id}`);
    if (!project) return json({ error: "Project not found" }, 404);

    return json({ project: JSON.parse(project) });
  }

  return json({ error: "Not found" }, 404);
};

// ─── POST /api/projects — create from template ───────────────
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const kv = env.DEVICES_KV;

  if (!kv || !env.SESSIONS_KV) {
    return json({ error: "Storage not configured" }, 503);
  }

  const user = await getUser(request, env.SESSIONS_KV);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await request.json()) as {
    name?: string;
    description?: string;
    template?: string;
    tags?: string[];
  };

  const project: Project = {
    id: crypto.randomUUID(),
    name: body.name ?? "Untitled Project",
    description: body.description ?? "",
    template: body.template ?? "custom",
    owner: user,
    tags: body.tags ?? [],
    status: "draft",
    createdAt: new Date().toISOString(),
  };

  await kv.put(`project:${project.id}`, JSON.stringify(project), {
    expirationTtl: 86400 * 30,
  });

  return json({ project }, 201);
};
