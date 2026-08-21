/**
 * OS GDBx Relay — bridges the Python fleet (kernel :8080, AiA :9090) to the GDBx pool.
 * Gun-free: uses GDBx SDK (sdk/gdbx-sdk.js) directly, no `gun` import.
 * Exposes minimal HTTP RPC that mirrors the old gun-relay/bridge.js API:
 *   POST /gdbx/put  { key, value, clock? }  -> GDBx put_deltas
 *   GET  /gdbx/get?prefix=  -> GDBx get_deltas
 *   GET  /gdbx/health -> pool + identity
 *
 * Env:
 *   GDBX_API=https://gdbx-do.xup.workers.dev
 *   GDBX_PUB / GDBX_PRIV / GDBX_PUBKEY_HEX / GDBX_ADDR
 *   PORT=8767 (default, next to gun-relay :8766)
 *   USE_GDBX=1 (feature flag)
 */

import { createServer } from "node:http";
import { URL } from "node:url";

// Import GDBx SDK from the GDBX repo (single source of truth)
// When OS is deployed standalone, vendor copy is at ./vendor/gdbx-sdk.js
let sdk;
try {
  sdk = await import("../../../GDBX/sdk/gdbx-sdk.js");
} catch {
  try {
    sdk = await import("./vendor/gdbx-sdk.js");
  } catch (e) {
    console.error("GDBx SDK not found — run `node sync-vendor.mjs` or set GDBX_SDK_PATH");
    throw e;
  }
}

const PORT = Number(process.env.PORT || 8767);
const API = process.env.GDBX_API || "https://gdbx-do.xup.workers.dev";
const USE_GDBX = process.env.USE_GDBX !== "0";

// identity — load or generate ephemeral (and register)
let pair = null;
let pubkeyHex = null;
let addr = null;

async function ensureIdentity() {
  if (pair && pubkeyHex && addr) return { pair, pubkeyHex, addr };
  const envPub = process.env.GDBX_PUB;
  const envPriv = process.env.GDBX_PRIV;
  const envHex = process.env.GDBX_PUBKEY_HEX;
  if (envPub && envPriv && envHex) {
    pair = { pub: envPub, priv: envPriv };
    pubkeyHex = envHex;
    addr = sdk.addressFromPubkey(pubkeyHex);
    return { pair, pubkeyHex, addr };
  }
  // ephemeral for dev
  pair = await sdk.makePair();
  // derive pubkeyHex — sdk's makePair gives only pub/priv, need hex via subtle export
  // Use GDBx SDK's internal? For now, generate via crypto export
  const jwk = await (async () => {
    const [x, y] = pair.pub.split(".");
    // re-import to get JWK
    const key = await globalThis.crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x, y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );
    return await globalThis.crypto.subtle.exportKey("jwk", key);
  })().catch(() => null);
  if (jwk) {
    const b64uToHex = (s) => {
      const pad = s.replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(pad + (pad.length % 4 ? "=".repeat(4 - (pad.length % 4)) : ""));
      return [...bin].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
    };
    // we need full hex: need private import to get x/y? fallback: use pair's pub and brute force via makeAddress with dummy?
    // Simpler: ask SDK to makeAddress from pubkeyHex — but we don't have hex. Derive via x/y:
    const xHex = (() => {
      const pad = jwk.x.replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(pad + (pad.length % 4 ? "=".repeat(4 - (pad.length % 4)) : ""));
      return [...bin].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
    })();
    const yHex = (() => {
      const pad = jwk.y.replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(pad + (pad.length % 4 ? "=".repeat(4 - (pad.length % 4)) : ""));
      return [...bin].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
    })();
    pubkeyHex = "04" + xHex + yHex;
    addr = sdk.addressFromPubkey(pubkeyHex);
  } else {
    // last resort: use sdk's makeAddress with pub directly? SDK expects hex, so we keep addr null and let register fail gracefully
    pubkeyHex = "";
    addr = "";
  }
  // register DID (best-effort)
  try {
    if (addr && pubkeyHex) {
      await sdk.registerDID({ pubkeyHex, pair });
      console.log(`[gdbx-relay] registered DID ${addr.slice(0,12)}...`);
    }
  } catch (e) {
    console.warn("[gdbx-relay] register DID (maybe already):", e.message?.slice(0,120));
  }
  return { pair, pubkeyHex, addr };
}

function json(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    return res.end();
  }

  if (url.pathname === "/gdbx/health" && req.method === "GET") {
    const id = await ensureIdentity().catch(() => ({ addr: null }));
    json(res, 200, { ok: true, use_gdbx: USE_GDBX, addr: id.addr || null, api: API });
    return;
  }

  if (url.pathname === "/gdbx/put" && req.method === "POST") {
    if (!USE_GDBX) return json(res, 503, { ok: false, error: "USE_GDBX=0 — GDBx disabled, use gun-relay" });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const { pair: p, pubkeyHex: hex } = await ensureIdentity();
        if (!hex) return json(res, 500, { ok: false, error: "no GDBx identity" });
        const deltas = Array.isArray(data.deltas) ? data.deltas : [{ key: data.key, value: data.value, clock: data.clock }];
        const r = await sdk.putDeltas({ pubkeyHex: hex, pair: p, deltas });
        json(res, 200, { ok: true, ...r });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e).slice(0,500) });
      }
    });
    return;
  }

  if (url.pathname === "/gdbx/get" && req.method === "GET") {
    const prefix = url.searchParams.get("prefix") || url.searchParams.get("key") || "";
    try {
      const { addr: a } = await ensureIdentity();
      if (!a) return json(res, 500, { ok: false, error: "no GDBx identity" });
      const r = await sdk.getDeltas(a, prefix);
      json(res, 200, { ok: true, ...r });
    } catch (e) {
      json(res, 400, { ok: false, error: String(e.message || e).slice(0,500) });
    }
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
});

if (process.argv.includes("--demo")) {
  const id = await ensureIdentity();
  console.log("[demo] identity", id.addr);
  const r = await sdk.putDeltas({ pubkeyHex: id.pubkeyHex, pair: id.pair, deltas: [{ key: "os/demo", value: "hello from OS gdbx-relay" }] });
  console.log("[demo] put", r);
  const g = await sdk.getDeltas(id.addr, "os/demo");
  console.log("[demo] get", g);
  process.exit(0);
}

if (!process.argv.includes("--test")) {
  server.listen(PORT, () => console.log(`[gdbx-relay] listening on :${PORT} → GDBX_API=${API} USE_GDBX=${USE_GDBX}`));
}

export default server;
export { ensureIdentity };
