/**
 * supervisor.js — keeps relay.js and bridge.js alive, forever.
 *
 * Spawns each server detached (survives console close), with logs appended
 * to <name>-stdout.log / <name>-stderr.log. On unexpected exit, restarts
 * with exponential backoff (1s → 2s → … → 30s cap).
 *
 * Start once, hidden:
 *   Start-Process node -ArgumentList "supervisor.js" -WorkingDirectory <dir> -WindowStyle Hidden
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const SERVERS = [
  { name: "relay", script: "relay.js", port: 8765 },
  { name: "bridge", script: "bridge.js", port: 8766 },
];

const DIR = __dirname;
const MAX_BACKOFF_MS = 30000;
const BASE_BACKOFF_MS = 1000;

// Stable bridge token (same default as the smoke test). Override via
// GUN_BRIDGE_TOKEN if a different secret is desired.
const BRIDGE_TOKEN = process.env.GUN_BRIDGE_TOKEN || "absup-bridge-smoke-token";

function log(name, msg) {
  const line = `[supervisor ${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(path.join(DIR, `${name}-stdout.log`), line);
  } catch (e) {
    // Logging must never crash the supervisor.
    try { fs.appendFileSync(path.join(DIR, "supervisor.log"), line); } catch {}
  }
}

function start(server, attempt) {
  const out = fs.openSync(path.join(DIR, `${server.name}-stdout.log`), "a");
  const err = fs.openSync(path.join(DIR, `${server.name}-stderr.log`), "a");

  let child;
  try {
    child = spawn(process.execPath, [server.script], {
      cwd: DIR,
      detached: true,
      stdio: ["ignore", out, err],
      env: {
        ...process.env,
        // The bridge requires a stable auth token across restarts.
        GUN_BRIDGE_TOKEN: BRIDGE_TOKEN,
      },
    });
  } catch (e) {
    log(server.name, `spawn failed: ${e.message}`);
    setTimeout(() => start(server, attempt + 1), MAX_BACKOFF_MS);
    return;
  }

  log(server.name, `started pid=${child.pid} attempt=${attempt}`);
  child.on("exit", (code, signal) => {
    log(
      server.name,
      `exited code=${code} signal=${signal} — restarting in ${Math.min(
        MAX_BACKOFF_MS,
        BASE_BACKOFF_MS * 2 ** Math.min(attempt, 6),
      )}ms`,
    );
    setTimeout(
      () => start(server, attempt + 1),
      Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempt, 6)),
    );
  });
  child.on("error", (e) => {
    log(server.name, `process error: ${e.message}`);
  });
  child.unref();
}

for (const server of SERVERS) {
  start(server, 0);
}

// Keep the supervisor itself alive; children are detached so their lifetimes
// are independent of this process.
setInterval(() => {}, 60 * 1000);
log("supervisor", "watching: " + SERVERS.map((s) => `${s.name}@${s.port}`).join(", "));