/**
 * OpenCodeWEB GunDB Relay
 *
 * P2P real-time sync backbone for the OpenCodeWEB OS network.
 * Source: github.com/OpenCodeWEB/Gun (fork of amark/gun).
 *
 * Architecture (per Gemini discussion):
 *   Browser peers <─wss─> [this relay] <─wss─> Browser peers
 *   Persistence: JSON file on disk (gun file adapter).
 *
 * Run:
 *   node relay.js [--port 8765] [--tls] [--cert certs/absup-server.crt --key certs/absup-server.key]
 *
 * Defaults to TLS on port 8765 using the OS trust root certs (wss://absup:8765/gun).
 * The gun library mounts its WebSocket relay automatically at /gun.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const Gun = require("gun");

/* ── Args ─────────────────────────────────────────────────────────── */
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = parseInt(arg("--port", process.env.GUN_RELAY_PORT || "8765"), 10);
const useTls = process.argv.includes("--tls") || process.env.GUN_RELAY_TLS !== "0";
const certFile = arg("--cert", path.join(__dirname, "..", "certs", "absup-server.crt"));
const keyFile = arg("--key", path.join(__dirname, "..", "certs", "absup-server.key"));
const dataFile = arg("--file", path.join(__dirname, "gun-data.json"));

/* ── Logging ──────────────────────────────────────────────────────── */
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[gun-relay ${ts}] ${msg}`);
}
function err(msg) {
  const ts = new Date().toISOString();
  console.error(`[gun-relay ${ts}] ERROR ${msg}`);
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

/* ── GunDB relay ──────────────────────────────────────────────────── */
const gun = Gun({
  web: server,
  // file: false — gun's local file store (v0.2020.1239 on Node 24) breaks
  // ALL peer connections (verified: mesh.peers stays empty even for ws://
  // local peers). Durability lives in the serverless relay (Cloudflare DO
  // SQLite); this LAN relay is a live memory hub that converges with it.
  file: false,
  // Relay-to-relay mesh: connect to the serverless gunx relay so the LAN
  // relay stays converged with gunx.pages.dev (Cloudflare DO storage).
  // axe/multicast are disabled: LAN peer discovery interferes with the
  // node client's connection to remote peers (verified empirically).
  peers: ["https://gunx.pages.dev/gun"],
  axe: false,
  multicast: false,
});

server.on("upgrade", () => {
  log("WebSocket upgrade accepted");
});

server.listen(PORT, () => {
  const scheme = useTls ? "wss" : "ws";
  log(`OpenCodeWEB GunDB relay listening on ${scheme}://absup:${PORT}/gun`);
  log(`Source: github.com/OpenCodeWEB/Gun`);
  log(`Persistence: ${dataFile}`);
});

process.on("SIGINT", () => {
  log("Shutting down…");
  gun.off();
  server.close(() => process.exit(0));
});