/**
 * Organization showcase API
 *
 * GET  /api/orgs/:name          — get org profile
 * POST /api/orgs                — create/register org
 */

interface OrgProfile {
  name: string;
  displayName: string;
  logo?: string;
  website?: string;
  mission: string;
  owner: string;
  verified: boolean;
  agentCount: number;
  storageUsed: number;
  storageLimit: number;
  createdAt: string;
}

interface Env {
  DB?: D1Database;
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
): Promise<{ login: string; orgs: string[] } | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  if (!token) return null;

  const session = await kv.get(`session:${token}`);
  if (!session) return null;

  const data = JSON.parse(session);
  return { login: data.user.login, orgs: data.orgs ?? [] };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  // ─── GET /api/orgs/:name — get org profile ───────────────
  const orgName = Array.isArray(params.name) ? params.name[0] : params.name;
  if (method === "GET" && orgName) {
    if (env.DB) {
      const result = await env.DB.prepare(
        "SELECT * FROM orgs WHERE name = ?",
      ).bind(orgName).first();

      if (result) return json({ org: result });
    }

    // Fallback: mock data for demo
    return json({
      org: {
        name: orgName,
        displayName: orgName.charAt(0).toUpperCase() + orgName.slice(1),
        mission: "Organization managed via OpenCodeABsUI/UX",
        verified: false,
        agentCount: 0,
        storageUsed: 0,
        storageLimit: 100,
      },
    });
  }

  return json({ error: "Not found" }, 404);
};

// ─── POST /api/orgs — create new org ─────────────────────────
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.SESSIONS_KV) return json({ error: "Auth not configured" }, 503);

  const user = await getUser(request, env.SESSIONS_KV);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await request.json()) as {
    name: string;
    displayName?: string;
    logo?: string;
    website?: string;
    mission?: string;
  };

  // Validate org name ownership via GitHub orgs list
  if (!user.orgs.includes(body.name)) {
    return json(
      {
        error:
          "You must be an admin/owner of this GitHub organization to claim this namespace",
      },
      403,
    );
  }

  if (env.DB) {
    // Check if org already exists
    const existing = await env.DB.prepare(
      "SELECT name FROM orgs WHERE name = ?",
    ).bind(body.name).first();

    if (existing) {
      return json({ error: "Organization already registered" }, 409);
    }

    await env.DB.prepare(
      `INSERT INTO orgs (name, display_name, logo, website, mission, owner, verified, agent_count, storage_used, storage_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      body.name,
      body.displayName ?? body.name,
      body.logo ?? null,
      body.website ?? null,
      body.mission ?? "No mission set",
      user.login,
      1, // verified
      0, // agentCount
      0, // storageUsed
      100, // storageLimit
    ).run();
  }

  return json({
    org: {
      name: body.name,
      displayName: body.displayName ?? body.name,
      mission: body.mission ?? "No mission set",
      owner: user.login,
      verified: true,
    },
  }, 201);
};
