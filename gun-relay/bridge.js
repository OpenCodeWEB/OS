/**
 * OpenCodeWEB GunDB Bridge — Node.js/Python RPC gateway
 *
 * Bridges the Python fleet (kernel :8080, AiA :9090, pods, ...) to the
 * GunDB graph. Python services use core/gun_bridge.py (stdlib-only) against
 * this gateway; the gateway peers to the relay and both stay in sync.
 *
 * Architecture (per Gemini discussion):
 *   Python fleet ──HTTPS──> [this bridge :8766] ──Gun peer──> [relay :8765 wss]
 *   Browser peers <────────────────────────────── wss ────────> [relay]
 *
 * API (all JSON, Bearer-token auth except /health):
 *   GET  /health                     -> { ok, gun, relay, uptime }
 *   GET  /node?soul=<soul>           -> { soul, fields: {...} } (latest known)
 *   GET  /value?soul=<soul>&key=<k>  -> { soul, key, value, state } | null
 *   PUT  /put   {soul,key,value}     -> { ok, state }   (write to the graph; value may be any JSON, null deletes)
 *   GET  /watch?soul=<soul>&since=<state> -> { changes: [...], now }  (cursor-based change feed)
 *
 * Run:
 *   node bridge.js [--port 8766] [--relay wss://gunx.pages.dev/gun]
 *                  [--token SECRET] [--tls] [--cert ... --key ...]
 *
 * Defaults: TLS on port 8766 (OS trust root certs), peers to the GunX
 * serverless relay (global graph — same one the portal syncs through).
 * Token: env GUN_BRIDGE_TOKEN or --token; if unset a random token is
 * generated once at startup and printed to the log.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const Gun = require("gun");

// Never let an async callback slip kill a request silently.
process.on("unhandledRejection", (e) => err("unhandledRejection: " + (e && e.stack ? e.stack : e)));

/* ── Args ─────────────────────────────────────────────────────────── */
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = parseInt(arg("--port", process.env.GUN_BRIDGE_PORT || "8766"), 10);
// Default peer = the GunX serverless relay (wss://gunx.pages.dev/gun, backed
// by Cloudflare Workers + Durable Objects) so the Python fleet (kernel, AiA,
// pods) reads/writes the SAME global graph as the portal. The local LAN
// relay (wss://absup:8765/gun) remains available via --relay for offline labs.
const RELAY = arg("--relay", process.env.GUN_RELAY_URL || "wss://gunx.pages.dev/gun");
const useTls = process.argv.includes("--tls") || process.env.GUN_BRIDGE_TLS !== "0";
const certFile = arg("--cert", path.join(__dirname, "..", "certs", "absup-server.crt"));
const keyFile = arg("--key", path.join(__dirname, "..", "certs", "absup-server.key"));
const dataFile = arg("--file", path.join(__dirname, "gun-bridge-data.json"));
const TOKEN = arg("--token", process.env.GUN_BRIDGE_TOKEN || crypto.randomBytes(24).toString("hex"));

/* ── Logging ──────────────────────────────────────────────────────── */
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[gun-bridge ${ts}] ${msg}`);
}
function err(msg) {
  const ts = new Date().toISOString();
  console.error(`[gun-bridge ${ts}] ERROR ${msg}`);
}

/* ── TLS setup ────────────────────────────────────────────────────── */
let server;
if (useTls) {
  try {
    server = https.createServer({
      cert: fs.readFileSync(certFile),
      key: fs.readFileSync(keyFile),
    });
    log(`TLS enabled — cert: ${certFile}`);
  } catch (e) {
    err(`cannot load certs (${e.message}) — falling back to plain HTTP`);
    server = http.createServer();
  }
} else {
  server = http.createServer();
}

/* ── GunDB peer ───────────────────────────────────────────────────── */
// The bridge keeps its own file store (a local gateway cache) and peers
// to the relay, which is the network's durable store. Writes made through
// this bridge replicate to the relay over the peer connection; even if the
// relay is temporarily unreachable the bridge remains fully functional.
// axe/multicast are disabled: LAN peer discovery interferes with the node
// client's connection to remote peers (verified empirically in relay.js).
const gun = Gun({
  peers: [RELAY],
  // file: false — gun's local file store (v0.2020.1239 on Node 24) breaks
  // ALL peer connections (verified: mesh.peers stays empty even for ws://
  // local peers). Durability comes from the serverless relay by design; the
  // in-memory change journal covers /watch cursors.
  file: false,
  axe: false,
  multicast: false,
});

/* ── Peer keepalive ─────────────────────────────────────────────────── */
// The serverless relay (CF Durable Object) drops idle WebSocket links; a
// dead link silently buffers writes in the local store and they never reach
// the global graph. Exercise the peer connection every 45s with a tiny write
// so gun's retry logic detects a dropped link and reconnects promptly.
setInterval(() => {
  gun.get("os/_keepalive").put({ node: "opencodeweb-bridge", t: Date.now() });
}, 45_000);
// NOTE: do NOT reassign Gun.log — gun stores internal dedup loggers on it
// (Gun.log.once / Gun.log.off) and chain reads (val/map without callbacks)
// crash with TypeError when they are missing.

/* ── OS presence in the GunX user registry ──────────────────────────── */
// The bridge is the always-on presence of the machine running OpenCodeWEB
// OS. It publishes (and refreshes) an entry under os/users/<login> so the
// public Users directory (/U) shows this machine's owner as ONLINE in the
// global GunX network even when no browser is open. Contract is flat —
// GitHub profile data only, no secrets, no session material.
const OS_USER = {
  login: "ABsUP",
  name: "ABsUP",
  avatar: "https://github.com/ABsUP.png",
  id: 0, // GitHub numeric id is not exposed to the bridge; profile still resolves
};
const OS_JOINED_AT = "2026-08-17T00:00:00.000Z"; // first OS presence in GunX
let osPresenceBooted = false;
function publishOsPresence() {
  const node = gun.get("os/users").get(OS_USER.login);
  if (!osPresenceBooted) {
    osPresenceBooted = true;
    node.put({
      login: OS_USER.login,
      name: OS_USER.name,
      avatar: OS_USER.avatar,
      id: OS_USER.id,
      joinedAt: OS_JOINED_AT,
      lastSeen: Date.now(),
    });
  } else {
    node.get("lastSeen").put(Date.now());
  }
}
setInterval(publishOsPresence, 45_000);
publishOsPresence(); // publish immediately on boot

/* ── Change journal (cursor-based watch feed) ─────────────────────── */
// Watched souls accumulate { soul, key, value, state } entries here so
// /watch?soul=..&since=.. can return exactly what changed since a cursor.
const journal = {}; // soul -> array of { key, value, state }
const JOURNAL_CAP = 5000; // max entries kept per soul (FIFO)

function journalPush(soul, key, value, state) {
  let list = (journal[soul] = journal[soul] || []);
  // Gun's map().on() re-emits fields on node updates; skip (key, state) dupes.
  const last = list[list.length - 1];
  if (last && last.key === key && last.state === state) return;
  list.push({ key: key, value: value, state: state });
  if (list.length > JOURNAL_CAP) list.shift();
}

// Lazily watch souls on first /watch request.
const watchers = {}; // soul -> true (subscribed)
function ensureWatcher(soul) {
  if (watchers[soul]) return;
  watchers[soul] = true;
  gun
    .get(soul)
    .map()
    .on(async (value, key) => {
      if (key === "_") return; // skip metadata
      const clean = value === undefined || value === null ? null : await graphDeref(value);
      journalPush(soul, key, clean, await nodeState(soul, key, 0));
    });
  log(`watching soul ${soul}`);
}

/* ── HTTP helpers ─────────────────────────────────────────────────── */
// Gun returns embedded nodes with `_` metadata and compact links
// {"#": "soul"}; recursively resolve links and strip metadata so Python
// clients see plain JSON values.
//
// IMPORTANT: reading a child field via `gun.get(soul).get(key)` pollutes
// the cached parent chain (a known Gun duq quirk in this fork) — a later
// `gun.get(soul).once()` returns the CHILD node. So parent-node reads go
// straight to the in-memory root graph, which is immune to chain caching.
function graphSoul(soul) {
  const rootGraph = gun._.root.graph;
  return rootGraph[soul];
}
async function graphDeref(v, depth) {
  depth = depth || 0;
  if (depth > 8 || v === null || v === undefined || typeof v !== "object") return v;
  if (typeof v["#"] === "string" && Object.keys(v).length === 1) {
    let target = graphSoul(v["#"]);
    if (target === undefined) {
      // Not in the local graph yet — ask the mesh and read it via a chain.
      target = await gun.get(v["#"]).once().then();
    }
    return graphDeref(target, depth + 1);
  }
  if (Array.isArray(v)) {
    const out = [];
    for (let i = 0; i < v.length; i++) out[i] = await graphDeref(v[i], depth + 1);
    return out;
  }
  const o = {};
  for (const k of Object.keys(v)) {
    if (k === "_") continue; // drop Gun metadata
    o[k] = await graphDeref(v[k], depth + 1);
  }
  return o;
}
// Field states live in the parent node's `_` metadata — Gun.state.is()
// cannot derive them from scalar values. Read the parent node instead
// (graph-first, chain fallback).
function nodeState(soul, key, fallback) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(fallback || 0), 2000);
    const node = graphSoul(soul);
    if (node && node._ && node._[">"]) {
      clearTimeout(timeout);
      const t = node._[">"][key];
      return resolve(t || fallback || 0);
    }
    gun.get(soul).once((node2) => {
      clearTimeout(timeout);
      const t = node2 && node2._ && node2._[">"] ? node2._[">"][key] : 0;
      resolve(t || fallback || 0);
    });
  });
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
function auth(req) {
  const h = req.headers["authorization"] || "";
  return h === "Bearer " + TOKEN;
}

/* ── Routes ───────────────────────────────────────────────────────── */
const START = Date.now();
server.on("request", async (req, res) => {
  const url = new URL(req.url, "http://x");
  const route = url.pathname;

  if (route === "/health") {
    return send(res, 200, {
      ok: true,
      service: "opencodeweb-gun-bridge",
      gun: Gun.version,
      relay: RELAY,
      uptime_s: Math.round((Date.now() - START) / 1000),
    });
  }

  if (route === "/peers") {
    // gun stores live peer objects under opt.peers (mesh.peers stays empty
    // on this build) — each entry carries its open WebSocket (`wire`).
    const root = gun._.root || {};
    const opt = root.opt || {};
    const optPeers = opt.peers || {};
    const meshPeers = (root.mesh && root.mesh.peers) || {};
    const all = Object.assign({}, meshPeers, optPeers);
    const mesh = opt.mesh || root.mesh || {};
    return send(res, 200, {
      ok: true,
      mesh: {
        wire: typeof mesh.wire,
        say: typeof mesh.say,
      },
      peers: Object.keys(all).map((k) => ({
        url: k,
        wire: !!(all[k].wire && all[k].wire.readyState === 1),
        readyState: all[k].wire ? all[k].wire.readyState : null,
        tries: all[k].tries || 0,
        retry: all[k].retry || 0,
      })),
    });
  }

  if (!auth(req)) {
    return send(res, 401, { ok: false, err: "unauthorized" });
  }

  try {
    if (route === "/node" && req.method === "GET") {
      const soul = url.searchParams.get("soul");
      if (!soul) return send(res, 400, { ok: false, err: "missing soul" });
      const node = graphSoul(soul);
      const fields = {};
      if (node && node._) {
        for (const k of Object.keys(node)) {
          if (k === "_") continue;
          fields[k] = await graphDeref(node[k]);
        }
      } else {
        // Soul not in the local graph yet — materialize it via a chain
        // read (falls back to the relay), then retry from the graph.
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 2000);
          gun.get(soul).once(() => {
            clearTimeout(timeout);
            resolve();
          });
        });
        const node2 = graphSoul(soul);
        if (node2 && node2._) {
          for (const k of Object.keys(node2)) {
            if (k === "_") continue;
            fields[k] = await graphDeref(node2[k]);
          }
        }
      }
      return send(res, 200, { ok: true, soul: soul, fields: fields });
    }

    if (route === "/value" && req.method === "GET") {
      const soul = url.searchParams.get("soul");
      const key = url.searchParams.get("key");
      if (!soul || !key) return send(res, 400, { ok: false, err: "missing soul/key" });
      // once() never fires for a missing/deleted field — bound it with a
      // timeout so absent values return null instead of hanging.
      const value = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(undefined), 2000);
        gun.get(soul).get(key).once((v) => {
          clearTimeout(timeout);
          resolve(v);
        });
      });
      return send(res, 200, {
        ok: true,
        soul: soul,
        key: key,
        value: value === undefined || value === null ? null : await graphDeref(value),
        state: await nodeState(soul, key, 0),
      });
    }

    if (route === "/put" && req.method === "PUT") {
      const body = await readBody(req);
      if (!body.soul || !body.key) return send(res, 400, { ok: false, err: "missing soul/key" });
      if (!("value" in body)) return send(res, 400, { ok: false, err: "missing value" });
      const soul = String(body.soul);
      const key = String(body.key);
      const value = body.value;
      // Deletes: nothing to read back — fire the null put, journal, respond.
      if (value === null) {
        gun.get(soul).get(key).put(null);
        const st = await nodeState(soul, key, Gun.state());
        journalPush(soul, key, null, st);
        return send(res, 200, { ok: true, soul: soul, key: key, state: st, deleted: true });
      }
      // Gun does not fire server-side put acks, so write and confirm via a
      // local read (fire-and-forget put, then verify it landed in the graph).
      gun.get(soul).get(key).put(value);
      const val = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        gun.get(soul).get(key).once((v) => {
          clearTimeout(timeout);
          resolve(v);
        });
      });
      const clean = val === undefined || val === null ? null : await graphDeref(val);
      const st = await nodeState(soul, key, Gun.state());
      journalPush(soul, key, clean, st);
      return send(res, 200, { ok: true, soul: soul, key: key, state: st });
    }

    if (route === "/watch" && req.method === "GET") {
      const soul = url.searchParams.get("soul");
      const since = parseFloat(url.searchParams.get("since")) || 0;
      if (!soul) return send(res, 400, { ok: false, err: "missing soul" });
      ensureWatcher(soul);
      const list = journal[soul] || [];
      const changes = [];
      let now = since;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.state > since) {
          changes.push(c);
          if (c.state > now) now = c.state;
        }
      }
      return send(res, 200, { ok: true, soul: soul, changes: changes, now: now });
    }

    return send(res, 404, { ok: false, err: "not found" });
  } catch (e) {
    err(`${route} failed: ${e && e.stack ? e.stack : e}`);
    return send(res, 500, { ok: false, err: "internal error" });
  }
});

/* ── Start ────────────────────────────────────────────────────────── */
server.listen(PORT, () => {
  const scheme = useTls ? "https" : "http";
  log(`OpenCodeWEB GunDB bridge listening on ${scheme}://absup:${PORT}`);
  log(`Gun peer relay: ${RELAY}`);
  log(`Auth token: ${TOKEN}`);
  log(`Change journal cap per soul: ${JOURNAL_CAP} entries`);
});

process.on("SIGINT", () => {
  log("Shutting down…");
  gun.off();
  server.close(() => process.exit(0));
});