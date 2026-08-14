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
  draft: "bg-slate-500/20 border-slate-400/30 text-slate-300",
  proposed: "bg-amber-500/15 border-amber-400/40 text-amber-300",
  in_progress: "bg-sky-500/15 border-sky-400/40 text-sky-300",
  done: "bg-emerald-500/15 border-emerald-400/40 text-emerald-300",
  shipped: "bg-emerald-500/20 border-emerald-400/50 text-emerald-200",
  archived: "bg-slate-700/20 border-slate-600/30 text-slate-400",
};

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
  const lastTextRef = useRef(text);
  lastTextRef.current = text;

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

  /* ---- live chat WebSocket ---- */
  useEffect(() => {
    loadSnapshot();
    const interval = window.setInterval(loadSnapshot, 30000);
    return () => window.clearInterval(interval);
  }, [loadSnapshot]);

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
      const entry: ChatMessage = { id: `local-${Date.now()}`, author, text: trimmed, ts: Date.now() };
      setMessages((prev) => [...prev, entry]);
      setText("");
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat", author, text: trimmed, seq: Date.now() }));
        return;
      }
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
    [author, text]
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
    [author, loadSnapshot]
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
    [author, loadSnapshot]
  );

  const standings = snapshot?.leaderboard?.standings ?? [];
  const items = snapshot?.items ?? [];
  const polls = snapshot?.polls ?? [];

  const badge = (label: string, live: boolean) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
        live
          ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
          : "border-slate-500/40 bg-slate-500/10 text-slate-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400 animate-pulse" : "bg-slate-400"}`} />
      {label}
    </span>
  );

  return (
    <div className="min-h-screen bg-[#06090f] text-slate-200">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-[#0b1019]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold tracking-wide text-white">
              OpenCodeWEB <span className="text-teal-300">Roadmap</span>
            </h1>
            <p className="text-[11px] text-slate-400">
              Live community roadmap · founders{" "}
              <span className="text-teal-300 font-medium">ABsUP</span> &{" "}
              <span className="text-sky-300 font-medium">ABsUPs</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {wsState === "live"
              ? badge("live chat", true)
              : wsState === "connecting"
              ? badge("connecting…", false)
              : badge("REST fallback", false)}
            {error && <span className="text-[11px] text-rose-400">{error}</span>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {/* ── Chat + Leaderboard ───────────────────────────── */}
        <section className="grid gap-6 lg:grid-cols-5">
          <div className="rounded-xl border border-slate-800 bg-[#0b1019] p-4 lg:col-span-3">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-sky-300">
              Community Chat
            </h2>
            <div className="mb-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <p className="text-sm text-slate-500">
                  No messages yet — say hello, propose a feature, or discuss the roadmap.
                </p>
              )}
              {messages.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-800/70 bg-slate-900/40 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        FOUNDERS.includes(m.author) ? "text-teal-300" : "text-slate-300"
                      }`}
                    >
                      {m.author}
                      {FOUNDERS.includes(m.author) && <span className="ml-1 text-[10px] text-teal-500">★ founder</span>}
                    </span>
                    <span className="text-[10px] text-slate-500">{timeAgo(m.ts)}</span>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-200">{m.text}</p>
                </div>
              ))}
            </div>
            <form onSubmit={sendChat} className="flex gap-2">
              <input
                value={author}
                onChange={(e) => {
                  setAuthor(e.target.value);
                  localStorage.setItem("roadmap-author", e.target.value);
                }}
                placeholder="name"
                className="w-28 rounded-lg border border-slate-700 bg-[#06090f] px-2.5 py-2 text-sm outline-none focus:border-teal-400"
              />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Suggest a roadmap direction…"
                className="flex-1 rounded-lg border border-slate-700 bg-[#06090f] px-3 py-2 text-sm outline-none focus:border-teal-400"
              />
              <button
                type="submit"
                className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-[#04221c] transition hover:brightness-110"
              >
                Send
              </button>
            </form>
            <p className="mt-2 text-[10px] italic text-slate-500">{ZERO_CONSTRAINT}</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0b1019] p-4 lg:col-span-2">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-sky-300">
              24h Leaderboard <span className="text-slate-500 normal-case">(founder lock)</span>
            </h2>
            <ol className="space-y-1.5">
              {standings.length === 0 && <p className="text-sm text-slate-500">No activity yet.</p>}
              {standings.map((entry, idx) => (
                <li
                  key={entry.user}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                    idx === 0
                      ? "border-teal-400/40 bg-teal-500/10 text-teal-200"
                      : idx === 1
                      ? "border-sky-400/40 bg-sky-500/10 text-sky-200"
                      : "border-slate-800 bg-slate-900/40 text-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">#{idx + 1}</span>
                    <span className="font-semibold">{entry.user}</span>
                    {FOUNDERS.includes(entry.user) && (
                      <span className="text-[10px] text-teal-500">★ locked</span>
                    )}
                  </span>
                  <span className="font-mono text-xs">{entry.points} pts</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Active Polls ─────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-sky-300">
            Active Polls
          </h2>
          {polls.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#0b1019] p-6 text-center text-sm text-slate-500">
              No active polls — chat about a topic and AiA spawns a community vote.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {polls.map((poll) => {
              const total = Object.values(poll.votes ?? {}).reduce((a, b) => a + b, 0);
              return (
                <div key={poll.id} className="rounded-xl border border-slate-800 bg-[#0b1019] p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">{poll.topic}</h3>
                    <span className="text-[10px] text-slate-500">expires {timeAgo(poll.expires_at)}</span>
                  </div>
                  <div className="space-y-1.5">
                    {poll.options.map((option) => {
                      const count = poll.votes?.[option] ?? 0;
                      const pct = total ? Math.round((count / total) * 100) : 0;
                      return (
                        <button
                          key={option}
                          onClick={() => vote(poll.id, option)}
                          className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-left text-sm text-slate-200 transition hover:border-teal-400/60"
                        >
                          <span
                            className="absolute inset-y-0 left-0 bg-teal-500/15 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="relative flex justify-between">
                            <span>{option}</span>
                            <span className="font-mono text-xs text-slate-400">{count}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Roadmap Items ────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-sky-300">
            Roadmap Items
          </h2>
          {items.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#0b1019] p-6 text-center text-sm text-slate-500">
              No roadmap items yet — they spawn autonomously from community discussion.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-800 bg-[#0b1019] p-4">
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
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
        </section>

        {/* ── Footer ───────────────────────────────────────── */}
        <footer className="border-t border-slate-800/70 pb-6 pt-4 text-center text-[11px] text-slate-500">
          <p>
            Powered by <span className="text-teal-300">roadmap.xup.workers.dev</span> ·{" "}
            <span className="text-sky-300">opencodeweb.xup.workers.dev</span> ·{" "}
            <span className="text-slate-400">pocwu.pages.dev</span>
          </p>
          <p className="mt-1 italic">{ZERO_CONSTRAINT}</p>
        </footer>
      </main>
    </div>
  );
}
