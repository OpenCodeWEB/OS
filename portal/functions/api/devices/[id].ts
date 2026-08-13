/**
 * Device management API
 *
 * GET    /api/devices/:id       — get device status by ID
 * POST   /api/devices/register  — register a new device
 * GET    /api/devices           — list all devices for authenticated user
 * PUT    /api/devices/:id/state — update device state (heartbeat)
 */

interface Device {
  id: string;
  name: string;
  os: string;
  owner: string;
  status: "online" | "offline" | "idle";
  ip?: string;
  lastSeen: string;
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

// Parse auth header to get user
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
  const { env, request, params } = context;
  const url = new URL(request.url);
  const method = request.method;
  const kv = env.DEVICES_KV;

  if (!kv || !env.SESSIONS_KV) {
    return json({ error: "Storage not configured" }, 503);
  }

  const user = await getUser(request, env.SESSIONS_KV);

  // ─── GET /api/devices — list all devices for user ──────────
  if (method === "GET" && url.pathname === "/api/devices") {
    if (!user) return json({ error: "Unauthorized" }, 401);

    const devices: Device[] = [];
    const list = await kv.list({ prefix: `device:${user}:` });
    for (const key of list.keys) {
      const val = await kv.get(key.name);
      if (val) devices.push(JSON.parse(val));
    }

    return json({ devices });
  }

  // ─── GET /api/devices/:id — single device ─────────────────
  if (method === "GET" && params.id) {
    if (!user) return json({ error: "Unauthorized" }, 401);

    const device = await kv.get(`device:${user}:${params.id}`);
    if (!device) return json({ error: "Device not found" }, 404);

    return json({ device: JSON.parse(device) });
  }

  return json({ error: "Not found" }, 404);
};

// ─── POST /api/devices/register ───────────────────────────────
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const kv = env.DEVICES_KV;
  const sessionsKv = env.SESSIONS_KV;

  if (!kv || !sessionsKv) {
    return json({ error: "Storage not configured" }, 503);
  }

  const user = await getUser(request, sessionsKv);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await request.json()) as {
    name?: string;
    os?: string;
    ip?: string;
  };

  const deviceId = crypto.randomUUID();
  const device: Device = {
    id: deviceId,
    name: body.name ?? "Unknown Device",
    os: body.os ?? "unknown",
    owner: user,
    status: "online",
    ip: body.ip,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  await kv.put(`device:${user}:${deviceId}`, JSON.stringify(device), {
    expirationTtl: 86400 * 30, // 30-day TTL, refreshed on heartbeat
  });

  return json({ device }, 201);
};

// ─── PUT /api/devices/:id/state — heartbeat update ────────────
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const kv = env.DEVICES_KV;
  const sessionsKv = env.SESSIONS_KV;

  if (!kv || !sessionsKv) {
    return json({ error: "Storage not configured" }, 503);
  }

  const user = await getUser(request, sessionsKv);
  if (!user) return json({ error: "Unauthorized" }, 401);

  if (!params.id) return json({ error: "Device ID required" }, 400);

  const key = `device:${user}:${params.id}`;
  const existing = await kv.get(key);
  if (!existing) return json({ error: "Device not found" }, 404);

  const device: Device = JSON.parse(existing);
  device.status = "online";
  device.lastSeen = new Date().toISOString();

  // Refresh TTL on heartbeat
  await kv.put(key, JSON.stringify(device), {
    expirationTtl: 86400 * 30,
  });

  return json({ device });
};
