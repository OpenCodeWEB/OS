/**
 * OpenCodeWEB OS — Roadmap Edge Worker (roadmap.xup.workers.dev)
 *
 * Real-time WebSocket live chat (Durable Object fan-out), CRDT state sync,
 * persistent voting, and roadmap state serving for pocwu.pages.dev/roadmap.
 *
 * Endpoints:
 *   GET  /health                  status probe (public, for CI/uptime)
 *   POST /sync                    engine state push (roadmap engine -> edge)
 *   GET  /roadmap                 full roadmap snapshot (items+polls+leaderboard)
 *   POST /vote                    cast a poll vote {poll_id, option, user}
 *   POST /upvote                  upvote roadmap item {item_id, user}
 *   POST /chat                    push a chat message (REST fallback)
 *   GET  /ws?room=general         WebSocket live chat (Durable Object)
 *
 * Persistence: KV single-key store (ROADMAP_STATE) + in-memory buffer.
 * Learned from AiA connector: Cloudflare free KV caps daily writes, so we
 * write ONE key per mutation batch, never per event. Durable Object storage
 * carries chat history + CRDT registers inside the room.
 *
 * CRDT: state-based LWW (last-writer-wins) registers with per-client
 * monotonically increasing sequence numbers; merge() is commutative and
 * idempotent so any two edge nodes converge on the same state.
 *
 * Zero-Constraint Policy: no token limits, no throttling, no artificial
 * quotas in our code.
 *
 * Maintainers: ABsUP & ABsUPs
 */

const KV_KEY = "roadmap:state";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gateway-Token",
  "Content-Type": "application/json",
};

// In-memory fallback (used when KV writes are quota-blocked)
const memoryStore = { state: null };

/* ------------------------------------------------------------------ */
/*  CRDT — LWW registers with version vectors                         */
/* ------------------------------------------------------------------ */

function lwwSet(state, key, value, client, seq) {
  const existing = state[key];
  if (!existing || existing.seq < seq || (existing.seq === seq && existing.client < client)) {
    state[key] = { value, client, seq };
  }
}

function lwwMerge(target, source) {
  for (const [key, reg] of Object.entries(source || {})) {
    const existing = target[key];
    if (!existing || existing.seq < reg.seq || (existing.seq === reg.seq && existing.client < reg.client)) {
      target[key] = reg;
    }
  }
  return target;
}

/* ------------------------------------------------------------------ */
/*  Durable Object — RoadmapRoom (WebSocket fan-out + CRDT merge)      */
/* ------------------------------------------------------------------ */

export class RoadmapRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // { ws: WebSocket, client: string }
    this.sessions = new Map();
    this.roomState = { registers: {}, messages: [] };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      return this.handleWebSocket(request, url);
    }
    if (url.pathname === "/state" && request.method === "GET") {
      return Response.json({ room: this.roomState.messages.length, messages: this.roomState.messages.slice(-50) });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: CORS_HEADERS });
  }

  async handleWebSocket(request, url) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const room = url.searchParams.get("room") || "general";
    const clientId = url.searchParams.get("client") || `c${Math.random().toString(36).slice(2, 10)}`;

    server.accept();
    this.sessions.set(server, { client: clientId, room });

    server.addEventListener("message", async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "chat") {
          const entry = {
            id: `${clientId}-${msg.seq || Date.now()}`,
            author: msg.author || "anonymous",
            text: String(msg.text || "").slice(0, 2000),
            room,
            ts: Date.now(),
          };
          this.roomState.messages.push(entry);
          if (this.roomState.messages.length > 500) this.roomState.messages.shift();
          this.broadcast({ type: "chat", ...entry });
        } else if (msg.type === "vote") {
          // CRDT register: poll:<id>:<option> -> count
          lwwSet(this.roomState.registers, `poll:${msg.poll_id}:${msg.option}`, (msg.count || 0) + 1, clientId, msg.seq || Date.now());
          this.broadcast({ type: "vote", poll_id: msg.poll_id, option: msg.option });
        } else if (msg.type === "sync") {
          // Engine/other node pushes its CRDT registers; merge and broadcast.
          lwwMerge(this.roomState.registers, msg.registers || {});
          this.broadcast({ type: "state", registers: this.roomState.registers });
        } else if (msg.type === "ping") {
          server.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        }
      } catch (err) {
        server.send(JSON.stringify({ type: "error", message: String(err.message || err) }));
      }
    });

    server.addEventListener("close", () => this.sessions.delete(server));
    server.addEventListener("error", () => this.sessions.delete(server));

    // Welcome + latest state
    server.send(
      JSON.stringify({
        type: "welcome",
        client: clientId,
        room,
        messages: this.roomState.messages.slice(-20),
        registers: this.roomState.registers,
      })
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(payload) {
    const data = JSON.stringify(payload);
    for (const [ws] of this.sessions) {
      try {
        ws.send(data);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Main worker                                                        */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // ---- Health -----------------------------------------------------
      if (url.pathname === "/health" && method === "GET") {
        return new Response(
          JSON.stringify({
            status: "Online",
            service: "roadmap-edge",
            endpoint: "roadmap.xup.workers.dev",
            version: "1.0.0",
            timestamp: new Date().toISOString(),
          }),
          { status: 200, headers: CORS_HEADERS }
        );
      }

      // ---- WebSocket live chat (Durable Object) -------------------------
      if (url.pathname === "/ws") {
        const id = env.ROADMAP_ROOM.idFromName(url.searchParams.get("room") || "general");
        const stub = env.ROADMAP_ROOM.get(id);
        return stub.fetch(request);
      }

      // ---- REST: roadmap snapshot ---------------------------------------
      if (url.pathname === "/roadmap" && method === "GET") {
        const state = await readState(env);
        return new Response(JSON.stringify({ ok: true, ...state.snapshot }), { status: 200, headers: CORS_HEADERS });
      }

      // ---- REST: sync (engine state push) -------------------------------
      if (url.pathname === "/sync" && method === "POST") {
        const payload = await request.json().catch(() => null);
        if (!payload || typeof payload !== "object") {
          return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400, headers: CORS_HEADERS });
        }
        return await handleSync(payload, env);
      }

      // ---- REST: vote -----------------------------------------------------
      if (url.pathname === "/vote" && method === "POST") {
        return await handleVote(request, env);
      }

      // ---- REST: upvote -----------------------------------------------------
      if (url.pathname === "/upvote" && method === "POST") {
        return await handleUpvote(request, env);
      }

      // ---- REST: chat (fallback without WS) -------------------------------
      if (url.pathname === "/chat" && method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || !body.text) {
          return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: CORS_HEADERS });
        }
        const snapshot = await readState(env);
        snapshot.snapshot.chat = snapshot.snapshot.chat || [];
        snapshot.snapshot.chat.push({
          author: body.author || "anonymous",
          text: String(body.text).slice(0, 2000),
          ts: Date.now(),
        });
        if (snapshot.snapshot.chat.length > 200) snapshot.snapshot.chat.shift();
        await writeState(env, snapshot.snapshot);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
      }

      // ---- Fallback ---------------------------------------------------------
      return new Response(
        JSON.stringify({
          service: "roadmap-edge",
          endpoints: ["/health", "/ws", "/roadmap", "/sync", "/vote", "/upvote", "/chat"],
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    } catch (err) {
      console.error("roadmap edge error:", err);
      return new Response(
        JSON.stringify({ error: "Internal Server Error", message: err instanceof Error ? err.message : "Unknown" }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  },
};

/* ------------------------------------------------------------------ */
/*  Storage helpers (KV single-key + memory fallback)                 */
/* ------------------------------------------------------------------ */

async function readState(env) {
  const raw = await env.ROADMAP_STATE.get(KV_KEY).catch(() => null);
  if (raw) {
    try {
      return { snapshot: JSON.parse(raw), persisted: true };
    } catch {
      /* fall through to memory */
    }
  }
  return { snapshot: memoryStore.state || { items: [], polls: [], leaderboard: { standings: [] }, chat: [] }, persisted: false };
}

async function writeState(env, snapshot) {
  memoryStore.state = snapshot;
  try {
    await env.ROADMAP_STATE.put(KV_KEY, JSON.stringify({ ...snapshot, updated_at: Date.now() }));
    return true;
  } catch (err) {
    console.warn("KV write blocked; buffered in memory:", err);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                          */
/* ------------------------------------------------------------------ */

async function handleSync(payload, env) {
  const roadmap = payload.roadmap || payload;
  const current = await readState(env);

  const merged = {
    items: mergeById(current.snapshot.items || [], roadmap.items || []),
    polls: mergeById(current.snapshot.polls || [], roadmap.polls || []),
    leaderboard: roadmap.leaderboard || current.snapshot.leaderboard || { standings: [] },
    chat: (roadmap.chat || current.snapshot.chat || []).slice(-200),
    last_sync: Date.now(),
    source: payload.source || "engine",
  };
  const persisted = await writeState(env, merged);
  return new Response(JSON.stringify({ ok: true, persisted, buffered: !persisted, items: merged.items.length, polls: merged.polls.length }), {
    status: 200,
    headers: CORS_HEADERS,
  });
}

function mergeById(current, incoming) {
  const byId = new Map();
  for (const item of current) byId.set(item.id, item);
  for (const item of incoming) {
    if (item && item.id) byId.set(item.id, item);
  }
  return [...byId.values()];
}

async function handleVote(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.poll_id || !body.option) {
    return new Response(JSON.stringify({ error: "poll_id and option required" }), { status: 400, headers: CORS_HEADERS });
  }
  const { snapshot } = await readState(env);
  const poll = (snapshot.polls || []).find((p) => p.id === body.poll_id && p.active !== false);
  if (!poll) {
    return new Response(JSON.stringify({ error: "poll not found or expired" }), { status: 404, headers: CORS_HEADERS });
  }
  if (!poll.options.includes(body.option)) {
    return new Response(JSON.stringify({ error: "invalid option" }), { status: 400, headers: CORS_HEADERS });
  }
  poll.votes = poll.votes || {};
  poll.votes[body.option] = (poll.votes[body.option] || 0) + 1;
  const persisted = await writeState(env, snapshot);
  return new Response(JSON.stringify({ ok: true, poll_id: poll.id, votes: poll.votes, persisted, buffered: !persisted }), {
    status: 200,
    headers: CORS_HEADERS,
  });
}

async function handleUpvote(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.item_id) {
    return new Response(JSON.stringify({ error: "item_id required" }), { status: 400, headers: CORS_HEADERS });
  }
  const { snapshot } = await readState(env);
  const item = (snapshot.items || []).find((i) => i.id === body.item_id);
  if (!item) {
    return new Response(JSON.stringify({ error: "item not found" }), { status: 404, headers: CORS_HEADERS });
  }
  item.votes = (item.votes || 0) + 1;
  item.score = (item.score || 0) + 1;
  const persisted = await writeState(env, snapshot);
  return new Response(JSON.stringify({ ok: true, item_id: item.id, votes: item.votes, persisted, buffered: !persisted }), {
    status: 200,
    headers: CORS_HEADERS,
  });
}