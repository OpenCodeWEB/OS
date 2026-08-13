/**
 * Public Servers API
 *
 * GET /api/public/servers — list all registered public servers
 * POST /api/public/servers — register a new public server (auth required)
 * DELETE /api/public/servers/:id — unregister a server (owner only)
 */

interface PublicServer {
  id: string;
  name: string;
  type: "gun-relay" | "sandbox-preview" | "daemon-node" | "custom";
  url: string;
  owner: string;
  status: "online" | "offline" | "maintenance";
  region: string;
  version: string;
  description: string;
  tags: string[];
  uptime: number;
  lastSeen: string;
  createdAt: string;
}

// Built-in seed servers — always shown alongside user-registered ones
const SEED_SERVERS: PublicServer[] = [
  {
    id: "gun-relay-1",
    name: "GunDB Main Relay",
    type: "gun-relay",
    url: "wss://pocwu.pages.dev/api/gun/relay",
    owner: "ABsUP",
    status: "online",
    region: "Global (Cloudflare Edge)",
    version: "0.9.x",
    description: "Primary GunDB WebSocket relay for P2P message forwarding across all connected peers. Routes between browsers, daemons, and edge workers.",
    tags: ["gun", "websocket", "relay", "p2p"],
    uptime: 99.9,
    lastSeen: new Date().toISOString(),
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "sandbox-preview-1",
    name: "Sandbox Preview Server",
    type: "sandbox-preview",
    url: "https://pocwu.pages.dev/s/{org}/{project}",
    owner: "ABsUP",
    status: "online",
    region: "Global (Cloudflare Edge)",
    version: "1.0.0-EA",
    description: "Multi-tenant sandbox preview environment. Each org/project gets an isolated runtime with auto-backup, PREVIEW mode, and one-click publish to production.",
    tags: ["sandbox", "preview", "isolated"],
    uptime: 99.9,
    lastSeen: new Date().toISOString(),
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "daemon-registry-1",
    name: "Daemon Registry",
    type: "daemon-node",
    url: "https://pocwu.pages.dev/u/{username}",
    owner: "ABsUP",
    status: "online",
    region: "Global (Cloudflare Edge)",
    version: "1.0.0-EA",
    description: "OS-level background daemon registry. Tracks all registered systemd/launchd/Task Scheduler daemon nodes with real-time heartbeat and telemetry.",
    tags: ["daemon", "background", "systemd", "launchd"],
    uptime: 99.8,
    lastSeen: new Date().toISOString(),
    createdAt: "2026-07-10T00:00:00.000Z",
  },
  {
    id: "community-api-1",
    name: "Community Hub API",
    type: "custom",
    url: "https://pocwu.pages.dev/C",
    owner: "ABsUP",
    status: "online",
    region: "Global (Cloudflare Edge)",
    version: "1.0.0-EA",
    description: "Community discussion API with GunDB real-time sync. Posts and comments are replicated across all connected peers via the GunDB graph network.",
    tags: ["community", "api", "gun", "real-time"],
    uptime: 99.9,
    lastSeen: new Date().toISOString(),
    createdAt: "2026-07-15T00:00:00.000Z",
  },
];

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

// Parse auth header
async function getUser(request: Request, kv: KVNamespace): Promise<string | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  if (!token) return null;
  const session = await kv.get(`session:${token}`);
  if (!session) return null;
  return (JSON.parse(session).user?.login as string) ?? null;
}

// ─── GET /api/public/servers — list all public servers ──────
export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const kv = env.DEVICES_KV;

  // Start with seed servers
  const allServers = [...SEED_SERVERS];

  // Merge user-registered servers from KV
  if (kv) {
    try {
      const list = await kv.list({ prefix: "public-server:" });
      for (const key of list.keys) {
        const val = await kv.get(key.name);
        if (val) {
          const server = JSON.parse(val) as PublicServer;
          // Don't duplicate seed servers
          if (!allServers.some((s) => s.id === server.id)) {
            allServers.push(server);
          }
        }
      }
    } catch {
      // KV not available — just return seeds
    }
  }

  // Sort: online first, then by name
  allServers.sort((a, b) => {
    if (a.status !== b.status) return a.status === "online" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return json({ servers: allServers });
};

// ─── POST /api/public/servers — register a new server ──────
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const kv = env.DEVICES_KV;

  if (!kv || !env.SESSIONS_KV) {
    return json({ error: "Storage not configured" }, 503);
  }

  const user = await getUser(request, env.SESSIONS_KV);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await request.json()) as Partial<PublicServer>;
  if (!body.name || !body.type || !body.url) {
    return json({ error: "name, type, and url are required" }, 400);
  }

  const server: PublicServer = {
    id: crypto.randomUUID(),
    name: body.name,
    type: body.type,
    url: body.url,
    owner: user,
    status: body.status ?? "online",
    region: body.region ?? "Unknown",
    version: body.version ?? "1.0.0",
    description: body.description ?? "",
    tags: body.tags ?? [],
    uptime: body.uptime ?? 100,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  await kv.put(`public-server:${server.id}`, JSON.stringify(server), {
    expirationTtl: 86400 * 90, // 90-day TTL
  });

  return json({ server }, 201);
};
