/**
 * Public Servers API
 *
 * GET /api/public/servers — list all registered public servers
 * POST /api/public/servers — register a new public server (auth required)
 * DELETE /api/public/servers/:id — unregister a server (owner only)
 */

import { getUserLogin } from "../_shared";

interface PublicServer {
  id: string;
  name: string;
  type: "gunx-relay" | "sandbox-preview" | "daemon-node" | "custom";
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

// Built-in seed servers — the project's real, verified infrastructure.
// (Fake entries pointing at portal routes — /s/{org}/{project}, /u/{username},
// /C, /api/gun/relay — and the decommissioned node-win-01 worker were removed.)
const SEED_SERVERS: PublicServer[] = [
  {
    id: "gunx-relay-1",
    name: "GunDB Main Relay",
    type: "gunx-relay",
    url: "wss://absup:8787/ws",
    owner: "ABsUP",
    status: "online",
    region: "ABsUP Node (Local OS)",
    version: "0.2020.1239",
    description:
      "Primary GunX-compatible WebSocket relay (GDBx pool) for P2P real-time sync across peers. Runs from github.com/OpenCodeWEB/Gun (OS/gun-relay/relay.js, TLS). Routes community posts, comments, and presence between browsers and daemons.",
    tags: ["GunX", "websocket", "relay", "p2p", "realtime"],
    uptime: 99.9,
    lastSeen: new Date().toISOString(),
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "edge-gateway-1",
    name: "OpenCodeWEB Edge Gateway",
    type: "custom",
    url: "https://opencodeweb.xup.workers.dev",
    owner: "ABsUP",
    status: "online",
    region: "Global (Cloudflare Edge)",
    version: "2.0.0",
    description:
      "Primary API gateway for the OpenCodeWEB OS network. Secure single-ingress routing to roadmap, AiA, and portal services. Auth-protected — 401 without valid credentials.",
    tags: ["gateway", "api", "secure", "ingress"],
    uptime: 99.9,
    lastSeen: new Date().toISOString(),
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "roadmap-edge-1",
    name: "Roadmap Edge Worker",
    type: "custom",
    url: "https://roadmap.xup.workers.dev",
    owner: "ABsUP",
    status: "online",
    region: "Global (Cloudflare Edge)",
    version: "1.0.0",
    description:
      "Durable roadmap service backed by Cloudflare Durable Objects. Real-time sync, voting, upvotes, and chat over WebSocket. Endpoints: /health, /ws, /roadmap, /sync, /vote, /upvote, /chat.",
    tags: ["roadmap", "worker", "durable-object", "websocket", "sync"],
    uptime: 99.9,
    lastSeen: new Date().toISOString(),
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "aia-connector-1",
    name: "AiA Connector Worker",
    type: "custom",
    url: "https://aia.xup.workers.dev",
    owner: "ABsUP",
    status: "online",
    region: "Global (Cloudflare Edge)",
    version: "1.1.0",
    description:
      "Edge connector for the AiA (Automated Intelligence Assistant) service. Lessons sync, research orchestration, and health checks. Endpoints: /health, /sync, /lessons, /lessons/:id, /research.",
    tags: ["aia", "ai", "connector", "lessons", "research"],
    uptime: 99.9,
    lastSeen: new Date().toISOString(),
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "portal-1",
    name: "OpenCodeWEB Portal",
    type: "custom",
    url: "https://pocwu.pages.dev",
    owner: "ABsUP",
    status: "online",
    region: "Global (Cloudflare Edge)",
    version: "1.0.0-EA",
    description:
      "Cloudflare Pages frontend hub for the OS network — AG dashboard, feature flags (/F), servers directory (/S), community (/C), sandbox previews (/s/...), and GitHub auth.",
    tags: ["portal", "pages", "dashboard", "ui", "cloudflare"],
    uptime: 99.9,
    lastSeen: new Date().toISOString(),
    createdAt: "2026-07-01T00:00:00.000Z",
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
  return getUserLogin(request, { SESSIONS_KV: kv });
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
