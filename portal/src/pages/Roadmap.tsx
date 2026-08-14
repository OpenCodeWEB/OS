import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  OpenCodeWEB Roadmap Portal — live community roadmap                 */
/*                                                                      */
/*  Backed by the Roadmap Edge Worker (roadmap.xup.workers.dev) via     */
/*  the OpenCodeWEB gateway (opencodeweb.xup.workers.dev/api/roadmap/*) */
/*  with WebSocket live chat through the Durable Object room.           */
/*                                                                      */
/*  Zero-Constraint Policy: no token limits, no hard timeouts, no       */
/*  artificial quotas, no throttling. Founders: ABsUP & ABsUPs.         */
/*                                                                      */
/*  Visual language mirrors the AG dashboard (/ag): slate gradient      */
/*  shell, glow hero, stat cards, medal leaderboard, card sections.     */
/* ------------------------------------------------------------------ */

interface RoadmapItem {
  id: string;
  title: string;
  summary?: string;
  status: string;
  score: number;
  mentions: number;
  votes: number;
  tags?: string[];
  created_at: number;
}

interface RoadmapPoll {
  id: string;
  topic: string;
  options: string[];
  votes: Record<string, number>;
  active: boolean;
  expires_at: number;
  created_at: number;
}

interface LeaderboardEntry {
  user: string;
  points: number;
  actions?: Record<string, number>;
  updated_at: number;
}

interface RoadmapSnapshot {
  ok?: boolean;
  items: RoadmapItem[];
  polls: RoadmapPoll[];
  leaderboard: { standings: LeaderboardEntry[] };
  chat?: Array<{ author: string; text: string; ts: number }>;
}

interface ChatMessage {
  id: string;
  author: string;
  text: string;
  ts: number;
}

const GATEWAY = "https://opencodeweb.xup.workers.dev";
const SNAPSHOT_URL = `${GATEWAY}/api/roadmap/roadmap`;
const CHAT_REST_URL = `${GATEWAY}/api/roadmap/chat`;
const VOTE_URL = `${GATEWAY}/api/roadmap/vote`;
const UPVOTE_URL = `${GATEWAY}/api/roadmap/upvote`;
const WS_URL = `wss://roadmap.xup.workers.dev/ws?room=general`;
const FOUNDERS = ["ABsUP", "ABsUPs"];
const ZERO_CONSTRAINT = "Immutable Zero-Constraint Policy: no token limits · no hard timeouts · no artificial quotas · no throttling";

function timeAgo(ts: number): string {
  if (!ts) return "—";
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_STYLE: Record<string, string> = {
  draft: "border-slate-600/60 bg-slate-700/40 text-slate-400",
  proposed: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  in_progress: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  shipped: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  archived: "border-slate-600/30 bg-slate-700/20 text-slate-500",
};

/** First-letter avatar with founder coloring — graceful, no network. */
function ChatAvatar({ name }: { name: string }) {
  const founder = FOUNDERS.includes(name);
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
        founder
          ? "border-emerald-500/40 bg-gradient-to-br from-emerald-500/40 to-teal-500/30 text-emerald-200"
          : "border-slate-600/60 bg-gradient-to-br from-slate-600/40 to-slate-700/30 text-slate-300"
      }`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function Roadmap() {
  const [snapshot, setSnapshot] = useState<RoadmapSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [author, setAuthor] = useState<string>(() => {
    const stored = localStorage.getItem("roadmap-author");
    return stored || "guest";
  });
  const [text, setText] = useState("");
  const [wsState, setWsState] = useState<"connecting" | "live" | "fallback" | "offline">("connecting");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  /* ---- load snapshot ---- */
  const loadSnapshot = useCallback(async () => {
    try {
      const res = await fetch(SNAPSHOT_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RoadmapSnapshot;
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load roadmap");
    }
  }, []);

  /* ---- snapshot polling ---- */
  useEffect(() => {
    loadSnapshot();
    const interval = window.setInterval(loadSnapshot, 30000);
    return () => window.clearInterval(interval);
  }, [loadSnapshot]);

  /* ---- live chat WebSocket ---- */
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        setWsState("offline");
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => setWsState("live");
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "chat") {
            setMessages((prev) => [...prev.slice(-199), msg as ChatMessage]);
          } else if (msg.type === "welcome" && Array.isArray(msg.messages)) {
            setMessages(msg.messages as ChatMessage[]);
          } else if (msg.type === "vote") {
            loadSnapshot();
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (!disposed) {
          setWsState("fallback");
          // Keep REST snapshot polling alive as the chat fallback.
          setTimeout(connect, 8000);
        }
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      disposed = true;
      ws?.close();
    };
  }, [loadSnapshot]);

  /* ---- actions ---- */
  const sendChat = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        // WS is live — the server broadcasts the echo back to us (dedupe via
        // server id). No optimistic insert, so no duplicates.
        ws.send(JSON.stringify({ type: "chat", author, text: trimmed, seq: Date.now() }));
        setText("");
        return;
      }
      // WS unavailable — optimistic insert, persist via REST.
      const entry: ChatMessage = { id: `local-${Date.now()}`, author, text: trimmed, ts: Date.now() };
      setMessages((prev) => [...prev, entry]);
      setText("");
      try {
        await fetch(CHAT_REST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author, text: trimmed }),
        });
      } catch {
        setError("chat offline — message queued locally");
      }
    },
    [author, text],
  );

  const vote = useCallback(
    async (pollId: string, option: string) => {
      try {
        await fetch(VOTE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poll_id: pollId, option, user: author }),
        });
        loadSnapshot();
      } catch {
        setError("vote failed");
      }
    },
    [author, loadSnapshot],
  );

  const upvote = useCallback(
    async (itemId: string) => {
      try {
        await fetch(UPVOTE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: itemId, user: author }),
        });
        loadSnapshot();
      } catch {
        setError("upvote failed");
      }
    },
    [author, loadSnapshot],
  );

  const standings = snapshot?.leaderboard?.standings ?? [];
  const items = snapshot?.items ?? [];
  const polls = snapshot?.polls ?? [];

  const top = standings[0];

  /* WS status chip styling — mirrors the AG worker status chip */
  const wsChip =
    wsState === "live"
      ? {
          dot: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)] animate-pulse",
          text: "text-emerald-300",
          label: "live chat",
        }
      : wsState === "connecting"
        ? {
            dot: "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.6)]",
            text: "text-amber-300",
            label: "connecting…",
          }
        : {
            dot: "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.6)]",
            text: "text-red-300",
            label: "REST fallback",
          };

  const medal = (i: number) =>
    i === 0 ? "text-amber-300" : i === 1 ? "text-slate-300" : i === 2 ? "text-orange-400" : "text-slate-600";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <div className="relative mb-10 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/60 p-8 text-center backdrop-blur">
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-teal-500/20 blur-3xl" />

          <div className="relative">
            {/* Icon badge */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-teal-500/30 bg-teal-500/10 shadow-[0_0_30px_rgba(20,184,166,0.25)]">
              <svg className="h-9 w-9 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0l3.869-1.934c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0z" />
              </svg>
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-teal-400 to-emerald-300 bg-clip-text text-transparent">
                OpenCodeWEB Roadmap
              </span>
            </h1>
            <p className="mt-3 text-slate-400">
              Live community roadmap · founders{" "}
              <span className="font-medium text-emerald-300">ABsUP</span> &{" "}
              <span className="font-medium text-teal-300">ABsUPs</span>
            </p>

            {/* Live status chip */}
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-600/60 bg-slate-800/60 px-4 py-1.5 text-sm">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${wsChip.dot}`} />
              <span className={`font-medium ${wsChip.text}`}>{wsChip.label}</span>
              <span className="mx-1 text-slate-600">•</span>
              <span className="text-slate-400">{messages.length} messages</span>
              <span className="mx-1 text-slate-600">•</span>
              <span className="text-slate-400">{items.length} items</span>
            </div>
          </div>
        </div>

        {/* ── Loading ──────────────────────────────────────────── */}
        {!snapshot && !error && (
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-12 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-teal-400/30 border-t-teal-400" />
            <div className="animate-pulse text-slate-400">Connecting to gateway…</div>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────── */}
        {error && !snapshot && (
          <div className="rounded-2xl border border-red-700/60 bg-red-950/30 p-6 text-center">
            <p className="text-red-400">
              <span className="font-semibold">Error:</span> {error}
            </p>
            <button
              onClick={() => loadSnapshot()}
              className="mt-4 rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 transition hover:bg-red-500/10"
            >
              Try again
            </button>
          </div>
        )}

        {snapshot && (
          <div className="space-y-6">
            {/* ── Stat cards ───────────────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5">
                <div className="mb-3 flex items-center gap-2 text-slate-500">
                  <svg className="h-4 w-4 text-teal-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                  <span className="text-sm">Chat Messages</span>
                </div>
                <p className="font-mono text-2xl font-bold text-teal-300">{messages.length}</p>
              </div>

              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5">
                <div className="mb-3 flex items-center gap-2 text-slate-500">
                  <svg className="h-4 w-4 text-emerald-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" />
                  </svg>
                  <span className="text-sm">Top Contributor (24h)</span>
                </div>
                <p className="truncate text-xl font-bold text-slate-100">
                  {top ? top.user : "—"}
                </p>
                <p className="mt-0.5 font-mono text-xs text-emerald-400/80">{top ? `${top.points} pts` : "no activity yet"}</p>
              </div>

              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5">
                <div className="mb-3 flex items-center gap-2 text-slate-500">
                  <svg className="h-4 w-4 text-sky-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                  <span className="text-sm">Active Polls</span>
                </div>
                <p className="font-mono text-2xl font-bold text-sky-300">{polls.length}</p>
              </div>

              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5">
                <div className="mb-3 flex items-center gap-2 text-slate-500">
                  <svg className="h-4 w-4 text-amber-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                  <span className="text-sm">Roadmap Items</span>
                </div>
                <p className="font-mono text-2xl font-bold text-amber-300">{items.length}</p>
              </div>
            </div>

            {/* ── Community Chat ───────────────────────────────── */}
            <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-3 text-lg font-semibold text-slate-200">
                  <svg className="h-5 w-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                  Community Chat
                  <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-sm font-medium text-emerald-300">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {wsState === "live" ? "live" : wsState === "connecting" ? "connecting" : "REST"}
                  </span>
                </h2>
                {error && <span className="text-xs text-rose-400">{error}</span>}
              </div>

              {/* Messages */}
              <div className="mb-4 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                {messages.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/20 py-8 text-center">
                    <p className="text-3xl">💬</p>
                    <p className="mt-2 text-sm text-slate-500">
                      No messages yet — say hello, propose a feature, or discuss the roadmap.
                    </p>
                  </div>
                )}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-800/30 p-3 transition hover:border-teal-600/40 hover:bg-slate-800/60"
                  >
                    <ChatAvatar name={m.author} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate text-sm font-semibold ${
                            FOUNDERS.includes(m.author) ? "text-emerald-300" : "text-slate-100"
                          }`}
                        >
                          {m.author}
                        </span>
                        {FOUNDERS.includes(m.author) && (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                            ★ founder
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-[10px] text-slate-500">{timeAgo(m.ts)}</span>
                      </div>
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-200">{m.text}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Composer */}
              <form onSubmit={sendChat} className="flex gap-2">
                <input
                  value={author}
                  onChange={(e) => {
                    setAuthor(e.target.value);
                    localStorage.setItem("roadmap-author", e.target.value);
                  }}
                  placeholder="name"
                  aria-label="name"
                  className="w-28 rounded-xl border border-slate-700 bg-slate-800/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-500"
                />
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Suggest a roadmap direction…"
                  aria-label="Suggest a roadmap direction…"
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-800/40 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-500"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-900/40 transition hover:bg-teal-500 hover:shadow-teal-800/40"
                >
                  Send
                </button>
              </form>
            </div>

            {/* ── Leaderboard + Polls ──────────────────────────── */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Leaderboard */}
              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6">
                <h2 className="mb-5 flex items-center gap-3 text-lg font-semibold text-slate-200">
                  <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" />
                  </svg>
                  24h Leaderboard
                  <span className="rounded-full border border-slate-600/60 bg-slate-700/40 px-2.5 py-0.5 text-sm font-medium text-slate-300">
                    founder lock
                  </span>
                </h2>

                {standings.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/20 py-8 text-center">
                    <p className="text-3xl">🏆</p>
                    <p className="mt-2 text-sm text-slate-500">
                      No activity yet — chat, vote, and upvote to earn points.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {standings.map((entry, idx) => (
                      <li
                        key={entry.user}
                        className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/30 p-3 transition hover:border-emerald-600/40 hover:bg-slate-800/60"
                      >
                        <span className={`w-8 shrink-0 text-center font-mono text-lg font-bold ${medal(idx)}`}>
                          {idx + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-semibold text-slate-100">
                          {entry.user}
                          {FOUNDERS.includes(entry.user) && (
                            <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                              ★ locked
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="font-mono text-lg font-bold text-emerald-300">{entry.points}</span>
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-500">pts</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Active Polls */}
              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6">
                <h2 className="mb-5 flex items-center gap-3 text-lg font-semibold text-slate-200">
                  <svg className="h-5 w-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                  Active Polls
                  {polls.length > 0 && (
                    <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-sm font-medium text-sky-300">
                      {polls.length}
                    </span>
                  )}
                </h2>

                {polls.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/20 py-8 text-center">
                    <p className="text-3xl">🗳️</p>
                    <p className="mt-2 text-sm text-slate-500">
                      No active polls — chat about a topic and AiA spawns a community vote.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {polls.map((poll) => {
                      const total = Object.values(poll.votes ?? {}).reduce((a, b) => a + b, 0);
                      return (
                        <div key={poll.id} className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-4">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-white">{poll.topic}</h3>
                            <span className="shrink-0 text-[10px] text-slate-500">expires {timeAgo(poll.expires_at)}</span>
                          </div>
                          <div className="space-y-1.5">
                            {poll.options.map((option) => {
                              const count = poll.votes?.[option] ?? 0;
                              const pct = total ? Math.round((count / total) * 100) : 0;
                              return (
                                <button
                                  key={option}
                                  onClick={() => vote(poll.id, option)}
                                  className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-left text-sm text-slate-200 transition hover:border-teal-500/60"
                                >
                                  <span
                                    className="absolute inset-y-0 left-0 bg-teal-500/15 transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                  <span className="relative flex items-center justify-between gap-2">
                                    <span className="truncate">{option}</span>
                                    <span className="shrink-0 font-mono text-xs text-slate-400">
                                      {count} · {pct}%
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Roadmap Items ────────────────────────────────── */}
            <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6">
              <h2 className="mb-5 flex items-center gap-3 text-lg font-semibold text-slate-200">
                <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                Roadmap Items
                {items.length > 0 && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-sm font-medium text-amber-300">
                    {items.length}
                  </span>
                )}
              </h2>

              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/20 py-8 text-center">
                  <p className="text-3xl">🗺️</p>
                  <p className="mt-2 text-sm text-slate-500">
                    No roadmap items yet — they spawn autonomously from community discussion.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-4 transition hover:border-amber-600/40 hover:bg-slate-800/60"
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                            STATUS_STYLE[item.status] ?? STATUS_STYLE.draft
                          }`}
                        >
                          {item.status.replace("_", " ")}
                        </span>
                      </div>
                      {item.summary && <p className="mb-3 text-xs leading-relaxed text-slate-400">{item.summary}</p>}
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>
                          {item.mentions} mentions · score {item.score}
                        </span>
                        <button
                          onClick={() => upvote(item.id)}
                          className="rounded-lg border border-slate-700 px-2.5 py-1 font-semibold text-slate-300 transition hover:border-sky-400/60 hover:text-sky-300"
                        >
                          ▲ {item.votes}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Page footer ──────────────────────────────────── */}
            <footer className="border-t border-slate-800/70 pb-6 pt-4 text-center text-[11px] text-slate-500">
              <p>
                Powered by <span className="text-teal-300">roadmap.xup.workers.dev</span> ·{" "}
                <span className="text-sky-300">opencodeweb.xup.workers.dev</span> ·{" "}
                <span className="text-slate-400">pocwu.pages.dev</span>
              </p>
              <p className="mt-1 italic">{ZERO_CONSTRAINT}</p>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}