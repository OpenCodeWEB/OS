/* OpenCodeWEB OS — Desktop Hybrid UI controller
   Talks to the local daemon (127.0.0.1:8080) over REST + WebSocket.
   Framework-free: works identically in a browser (web port) and in the
   WebView2 shell. Maintainers: ABsUP & ABsUPs. */

"use strict";

const API = "";
const WS_URL = `ws://${location.host}/ws/aia`;  // real-time AiA streaming channel

/* ── Utilities ─────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function fmtBytes(b) {
  if (!b) return "—";
  const g = b / 1024 ** 3;
  return g >= 1 ? `${g.toFixed(2)} GiB` : `${(b / 1024 ** 2).toFixed(1)} MiB`;
}
function fmtUptime(s) {
  if (!s && s !== 0) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ── Tabs ──────────────────────────────────────────────── */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "roadmap") refreshRoadmap();
    if (btn.dataset.tab === "logs") refreshLogs();
  });
});

/* ── WebSocket client ──────────────────────────────────── */
let ws = null;
let wsRetry = 0;

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    wsRetry = 0;
    setConn("online");
    ws.send(JSON.stringify({ cmd: "subscribe", channels: ["status", "logs", "aia.events"] }));
  };
  ws.onclose = () => {
    setConn("offline");
    const wait = Math.min(1000 * 2 ** wsRetry, 10000);
    wsRetry += 1;
    setTimeout(connectWS, wait);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.channel === "status") renderStatus(msg.data);
    else if (msg.channel === "logs") renderLogs(msg.data);
    else if (msg.channel === "aia.events") renderAiaEvent(msg.data);
  };
}
function setConn(state) {
  const b = $("conn-badge");
  b.className = `conn-badge ${state}`;
  b.textContent = state === "online" ? "● live — ws connected" : state === "offline" ? "● reconnecting…" : "● connecting…";
}

/* ── REST helpers ──────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json();
}

/* ── Dashboard render ──────────────────────────────────── */
function renderStatus(s) {
  if (!s) return;
  const k = s.kernel || {}, hw = s.hardware || {}, aia = s.aia || {}, edge = s.edge || {}, rm = s.roadmap || {}, dm = s.daemon || {};

  // Kernel
  const kState = $("kernel-state");
  if (k.online) { kState.textContent = "🟢 Online"; kState.className = "big-state ok"; }
  else { kState.textContent = "🔴 Offline"; kState.className = "big-state bad"; }
  $("kernel-ipc").textContent = k.ipc || "—";
  const ks = k.status || {};
  $("kernel-uptime").textContent = fmtUptime(ks.uptime_s);
  $("kernel-aia").textContent = ks.aia_running ? "running" : "not running";
  $("kernel-aia-pid").textContent = ks.aia_pid || "—";

  // Hardware
  $("hw-cpu").textContent = hw.cpu_threads ?? "—";
  $("hw-ram").textContent = fmtBytes(hw.ram_bytes);
  $("hw-vulkan").textContent = hw.vulkan ? "yes" : "no";
  $("hw-cuda").textContent = hw.cuda ? "yes" : "no";
  $("hw-platform").textContent = hw.platform ? String(hw.platform).slice(0, 40) : "—";
  $("hw-python").textContent = hw.python || "—";

  // Edge
  const edgeOk = edge.primary_healthy;
  const eState = $("edge-primary-state");
  eState.textContent = edgeOk ? "🟢 Online" : "◔ checking…";
  eState.className = `big-state ${edgeOk ? "ok" : "warn"}`;
  $("edge-primary-url").textContent = edge.primary || "—";
  $("edge-primary-url").href = edge.primary || "#";
  $("edge-latency").textContent = edge.last_probe_at
    ? `EMA latency ${edge.ema_latency_ms ?? "—"} ms · probe ${new Date(edge.last_probe_at * 1000).toLocaleTimeString()}`
    : "no probe yet";
  const ul = $("edge-nodes");
  const nodes = edge.nodes || [];
  if (!nodes.length) ul.innerHTML = '<li class="muted">no dynamic nodes — spawn on demand</li>';
  else ul.innerHTML = nodes.map((n) =>
    `<li><span class="st ${esc(n.status)}">${esc(n.status)}</span><span>${esc(n.url)}</span><span>${n.last_latency_ms ? n.last_latency_ms.toFixed(0) + "ms" : "—"}</span></li>`
  ).join("");

  // AiA
  $("aia-engine").textContent = aia.engine || "—";
  const ctx = aia.context || {};
  $("aia-turns").textContent = (ctx.recent || []).length ?? "—";
  $("aia-summaries").textContent = (ctx.summaries || []).length ?? "—";
  $("aia-guard").textContent = aia.guard_rejections ?? "—";
  $("aia-uptime").textContent = fmtUptime(aia.uptime_s);

  // Roadmap
  $("rm-items").textContent = rm.items ?? "—";
  $("rm-polls").textContent = rm.polls ?? "—";
  const board = $("rm-board");
  const lb = rm.leaderboard || [];
  board.innerHTML = lb.length
    ? lb.map((e) => `<li><span>${esc(e.user)}</span><span>${e.points} pts</span></li>`).join("")
    : '<li class="muted">no activity yet</li>';

  // Daemon
  $("dm-uptime").textContent = fmtUptime(dm.uptime_s);
  if (dm.zero_constraint) $("dm-policy-text").textContent = dm.zero_constraint;
}

/* ── Chat ──────────────────────────────────────────────── */
const chatWin = $("chat-window");

function addMsg(kind, who, text, extra) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.innerHTML = `<span class="who">${esc(who)}</span><pre>${esc(text)}</pre>`;
  if (extra) {
    const ex = document.createElement("pre");
    ex.textContent = extra;
    div.appendChild(ex);
  }
  chatWin.appendChild(div);
  chatWin.scrollTop = chatWin.scrollHeight;
}

async function sendChat() {
  const input = $("chat-text");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addMsg("user", "You", text);
  const trace = $("trace-window");
  trace.innerHTML = '<div class="muted">Thinking…</div>';
  try {
    const data = await api("/api/aia/chat", { method: "POST", body: JSON.stringify({ text, author: "ABsUP" }) });
    if (data.ok && data.result) {
      const r = data.result;
      if (r.accepted) {
        addMsg("aia", "AiA", r.response || "(empty response)", JSON.stringify({ recalled: r.recalled_summaries }, null, 2));
      } else {
        addMsg("rejected", "AiA · Guard", r.verdict?.reason || "Rejected by Zero-Constraint guard", JSON.stringify(r.verdict, null, 2));
      }
      trace.textContent = JSON.stringify(r, null, 2).slice(0, 4000);
    } else {
      addMsg("rejected", "System", data.error || "daemon error");
      trace.textContent = JSON.stringify(data, null, 2);
    }
  } catch (err) {
    addMsg("rejected", "System", String(err));
  }
}
$("chat-send").addEventListener("click", sendChat);
$("chat-text").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

function renderAiaEvent(ev) {
  const trace = $("trace-window");
  const line = `[${new Date().toLocaleTimeString()}] ${ev.event}: ${ev.text || ev.author || ""}`;
  if (trace.firstChild?.textContent === "No actions yet.") trace.innerHTML = "";
  const div = document.createElement("div");
  div.textContent = line;
  trace.prepend(div);
  while (trace.children.length > 120) trace.lastChild.remove();
}

/* ── Edge actions ──────────────────────────────────────── */
$("edge-spawn-btn").addEventListener("click", async () => {
  $("edge-spawn-btn").disabled = true;
  try {
    const data = await api("/api/edge/spawn", { method: "POST", body: JSON.stringify({ reason: "manual-gui" }) });
    alert(data.ok ? `Spawned ${data.node.url}` : `Spawn skipped: ${data.error}`);
    const st = await api("/api/status");
    renderStatus(st);
  } finally { $("edge-spawn-btn").disabled = false; }
});
$("edge-refresh-btn").addEventListener("click", async () => {
  const st = await api("/api/status");
  renderStatus(st);
});

/* ── Roadmap ───────────────────────────────────────────── */
async function refreshRoadmap() {
  const el = $("roadmap-local");
  try {
    const data = await api("/api/roadmap/snapshot");
    el.innerHTML = "";
    const block = (title, arr, fmt) => {
      if (!arr || !arr.length) return;
      const h = document.createElement("div");
      h.style.cssText = "font-weight:700;color:var(--accent-2);margin:8px 0 4px;";
      h.textContent = title;
      el.appendChild(h);
      arr.forEach((x) => {
        const d = document.createElement("div");
        d.textContent = fmt(x);
        el.appendChild(d);
      });
    };
    block("Roadmap items", data.items, (i) => `• ${i.title} — ${i.status} (${i.votes} votes)`);
    block("Active polls", data.polls, (p) => `• ${p.topic} → ${Object.entries(p.votes || {}).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    block("Leaderboard (24h)", data.leaderboard?.standings, (e) => `${e.user}: ${e.points} pts`);
    if (!el.children.length) el.innerHTML = '<div class="muted">No roadmap state yet — ingest a sample chat.</div>';
  } catch (err) {
    el.innerHTML = `<div class="muted">Error: ${esc(String(err))}</div>`;
  }
}
$("rm-refresh-btn").addEventListener("click", refreshRoadmap);
$("rm-chat-btn").addEventListener("click", async () => {
  await api("/api/roadmap/chat", { method: "POST", body: JSON.stringify({ author: "ABsUP", text: "Please prioritize the sync node provisioning system and the unlimited context engine" }) });
  refreshRoadmap();
});
$("rm-sync-btn").addEventListener("click", async () => {
  const data = await api("/api/roadmap/sync?dry_run=1");
  alert(data.ok ? `Dry-run sync: ${data.bytes} bytes` : `Sync failed: ${data.error}`);
});

/* ── Logs ──────────────────────────────────────────────── */
const logWin = $("log-window");
function renderLogs(lines) {
  if (!lines || !lines.length) return;
  const wasBottom = logWin.scrollTop + logWin.clientHeight >= logWin.scrollHeight - 30;
  logWin.textContent = lines.join("\n");
  if (wasBottom) logWin.scrollTop = logWin.scrollHeight;
}
async function refreshLogs() {
  try {
    const data = await api("/api/status");
    // status endpoint does not include logs; use WS tail via REST-less approach:
    // daemon pushes logs over WS; nothing else needed here.
    void data;
  } catch { /* ignore */ }
}
$("log-clear").addEventListener("click", () => { logWin.textContent = "—"; });

/* ── Boot ──────────────────────────────────────────────── */
setConn("connecting");
connectWS();
(async () => {
  try {
    const st = await api("/api/status");
    renderStatus(st);
  } catch (err) {
    setConn("offline");
    $("kernel-state").textContent = "🔴 Daemon unreachable";
    $("kernel-state").className = "big-state bad";
  }
})();