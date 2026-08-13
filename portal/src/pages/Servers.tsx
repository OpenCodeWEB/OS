import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  memo,
  type ReactNode,
} from "react";
import { useAuth } from "../contexts/AuthContext";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PublicServer {
  id: string;
  name: string;
  type: "gun-relay" | "sandbox-preview" | "daemon-node" | "custom";
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

const POLL_INTERVAL = 30_000; // silent background refresh every 30 s

/* ------------------------------------------------------------------ */
/*  Reduced-motion hook                                                */
/* ------------------------------------------------------------------ */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ */
/*  Formatters                                                         */
/* ------------------------------------------------------------------ */

function formatUptime(pct: number): string {
  return pct >= 99.9 ? "99.9%+" : pct.toFixed(1) + "%";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Icons (memoized)                                                   */
/* ------------------------------------------------------------------ */

type IconProps = { className?: string };

const IconServer = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"
    />
  </svg>
));

const IconRadio = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
    />
  </svg>
));

const IconBeaker = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
    />
  </svg>
));

const IconBot = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
    />
  </svg>
));

const IconCog = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
));

const IconSignal = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"
    />
  </svg>
));

const IconClock = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
));

const IconTag = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
  </svg>
));

const IconRefresh = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
    />
  </svg>
));

const IconPlus = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
));

const IconLink = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
    />
  </svg>
));

/* ------------------------------------------------------------------ */
/*  Type metadata (stable module-level nodes — never re-created)       */
/* ------------------------------------------------------------------ */

const TYPE_META: Record<
  string,
  { label: string; icon: ReactNode; badge: string }
> = {
  "gun-relay": {
    label: "GunDB Relay",
    icon: <IconRadio className="h-5 w-5" />,
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  },
  "sandbox-preview": {
    label: "Sandbox Preview",
    icon: <IconBeaker className="h-5 w-5" />,
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
  "daemon-node": {
    label: "Daemon Node",
    icon: <IconBot className="h-5 w-5" />,
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  custom: {
    label: "Custom Service",
    icon: <IconCog className="h-5 w-5" />,
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  },
};

const STATUS_META: Record<
  string,
  { dot: string; label: string; text: string; topBorder: string }
> = {
  online: {
    dot: "bg-green-400",
    label: "Online",
    text: "text-green-400",
    topBorder: "border-t-emerald-500/60",
  },
  offline: {
    dot: "bg-red-400",
    label: "Offline",
    text: "text-red-400",
    topBorder: "border-t-red-500/60",
  },
  maintenance: {
    dot: "bg-amber-400",
    label: "Maintenance",
    text: "text-amber-400",
    topBorder: "border-t-amber-500/60",
  },
};

const FILTER_TYPES = [
  "All",
  "gun-relay",
  "sandbox-preview",
  "daemon-node",
  "custom",
] as const;

/* ------------------------------------------------------------------ */
/*  Stat card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({
  icon,
  label,
  value,
  valueClass = "text-slate-100",
  title,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  valueClass?: string;
  title?: string;
}) {
  return (
    <div
      className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5"
      title={title}
    >
      <div className="mb-3 flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p className={`truncate text-xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Server card (memoized)                                             */
/* ------------------------------------------------------------------ */

const ServerCard = memo(function ServerCard({
  server,
  reducedMotion,
}: {
  server: PublicServer;
  reducedMotion: boolean;
}) {
  const typeMeta = TYPE_META[server.type] ?? TYPE_META.custom;
  const statusMeta = STATUS_META[server.status] ?? STATUS_META.offline;
  const isLinkable =
    server.url.startsWith("http") || server.url.startsWith("wss");

  return (
    <div
      className={`group flex flex-col rounded-xl border border-slate-700/60 border-t-2 bg-slate-800/30 p-4 transition-colors hover:border-violet-500/50 hover:bg-slate-800/60 ${statusMeta.topBorder}`}
    >
      {/* Top row */}
      <div className="flex items-start gap-4">
        {/* Type icon */}
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${typeMeta.badge}`}
        >
          {typeMeta.icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-slate-100 transition-colors group-hover:text-violet-300">
              {server.name}
            </h3>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${typeMeta.badge}`}
            >
              {typeMeta.label}
            </span>
            <span className="shrink-0 rounded-full border border-slate-600/60 bg-slate-700/30 px-2 py-0.5 font-mono text-[10px] text-slate-400">
              v{server.version}
            </span>
          </div>

          {/* Description */}
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-500">
            {server.description}
          </p>

          {/* Meta row */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span
              className={`inline-flex items-center gap-1.5 font-medium ${statusMeta.text}`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  server.status === "online" && !reducedMotion
                    ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)] animate-pulse"
                    : statusMeta.dot
                }`}
              />
              {statusMeta.label}
            </span>
            <span className="text-slate-700">·</span>
            <span>{server.region}</span>
            <span className="text-slate-700">·</span>
            <span>{formatUptime(server.uptime)} uptime</span>
            <span className="text-slate-700">·</span>
            <span>by {server.owner}</span>
          </div>
        </div>
      </div>

      {/* Tags */}
      {server.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {server.tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-violet-500/20 bg-violet-500/5 px-2 py-0.5 text-[10px] font-medium text-violet-300/80"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-700/40 pt-3">
        <span className="truncate text-xs text-slate-600">
          {server.url}
        </span>
        {isLinkable ? (
          <a
            href={server.url}
            target={server.url.startsWith("http") ? "_blank" : undefined}
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/40 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-violet-500/60 hover:text-violet-300"
          >
            <IconLink className="h-3 w-3" />
            {server.type === "gun-relay" ? "Connect Relay" : "Open Server"}
          </a>
        ) : (
          <code className="shrink-0 rounded-lg bg-slate-800/60 px-2 py-1 text-[10px] text-slate-500">
            {server.url}
          </code>
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Empty / error states                                               */
/* ------------------------------------------------------------------ */

function EmptyState({ filterType }: { filterType: string }) {
  const label = filterType === "All" ? null : TYPE_META[filterType]?.label;
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-600/60 bg-slate-800/50">
        <IconServer className="h-7 w-7 text-slate-500" />
      </div>
      <h3 className="text-base font-semibold text-slate-200">
        No servers found
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        {label
          ? `No ${label.toLowerCase()} servers registered yet.`
          : "No public servers registered yet."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function Servers() {
  const { user } = useAuth();
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<string>("All");
  const [showRegister, setShowRegister] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    name: "",
    type: "custom" as PublicServer["type"],
    url: "",
    region: "",
    description: "",
    tags: "",
  });
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  /** Fetch servers — silent polls skip the skeleton. Aborts superseded requests. */
  const fetchServers = useCallback(async (silent = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const r = await fetch("/api/public/servers", { signal: controller.signal });
      if (!r.ok) throw new Error("Failed to fetch servers");
      const data = (await r.json()) as { servers: PublicServer[] };
      setServers(data.servers);
      setLastSync(new Date());
    } catch (err) {
      if ((err as Error).name !== "AbortError" && !silent) {
        setError(err instanceof Error ? err.message : "Failed to load servers");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // ── Initial fetch ──────────────────────────────────────────────
  useEffect(() => {
    fetchServers();
    return () => abortRef.current?.abort();
  }, [fetchServers]);

  // ── Silent 30 s polling — paused while the tab is hidden ───────
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) fetchServers(true);
    };
    const timer = setInterval(tick, POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) fetchServers(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchServers]);

  /* ── Derived data (memoized) ─────────────────────────────────── */
  const filtered = useMemo(() => {
    if (filterType === "All") return servers;
    return servers.filter((s) => s.type === filterType);
  }, [servers, filterType]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of servers) counts[s.type] = (counts[s.type] ?? 0) + 1;
    return counts;
  }, [servers]);

  const stats = useMemo(() => {
    let online = 0;
    let uptimeSum = 0;
    let tags = 0;
    for (const s of servers) {
      if (s.status === "online") online++;
      uptimeSum += s.uptime;
      tags += s.tags.length;
    }
    return {
      total: servers.length,
      online,
      avgUptime: servers.length ? uptimeSum / servers.length : 0,
      tags,
    };
  }, [servers]);

  // ── Register handler ───────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerForm.name.trim() || !registerForm.url.trim()) return;
    setRegistering(true);
    setRegisterError("");
    try {
      const token = localStorage.getItem("pocwu_session_token");
      const r = await fetch("/api/public/servers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: registerForm.name.trim(),
          type: registerForm.type,
          url: registerForm.url.trim(),
          region: registerForm.region.trim() || undefined,
          description: registerForm.description.trim() || undefined,
          tags: registerForm.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to register",
        );
      }
      setShowRegister(false);
      setRegisterForm({
        name: "",
        type: "custom",
        url: "",
        region: "",
        description: "",
        tags: "",
      });
      await fetchServers(true);
    } catch (err) {
      setRegisterError(
        err instanceof Error ? err.message : "Registration failed",
      );
    } finally {
      setRegistering(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-slate-600 bg-slate-800/40 px-3 py-2 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-violet-500/60 focus:bg-slate-800/70 [&>option]:bg-slate-900";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <div className="relative mb-10 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/60 p-8 text-center backdrop-blur">
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-violet-500/20 blur-3xl" />

          <div className="relative">
            {/* Infrastructure badge */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/10 shadow-[0_0_30px_rgba(139,92,246,0.25)]">
              <IconServer className="h-9 w-9 text-violet-400" />
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-violet-400 to-fuchsia-300 bg-clip-text text-transparent">
                Public Servers
              </span>
            </h1>
            <p className="mt-3 text-slate-400">
              Infrastructure directory — live edge network
            </p>

            {/* Live status chip */}
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-600/60 bg-slate-800/60 px-4 py-1.5 text-sm">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  stats.online > 0
                    ? reducedMotion
                      ? "bg-green-400"
                      : "bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.7)] animate-pulse"
                    : "bg-slate-600"
                }`}
              />
              <span className="font-medium text-green-400">
                {stats.online} online
              </span>
              <span className="mx-1 text-slate-600">•</span>
              <span className="text-slate-400">
                {stats.total} server{stats.total === 1 ? "" : "s"}
              </span>
              {lastSync && (
                <>
                  <span className="mx-1 text-slate-600">•</span>
                  <span className="text-slate-500">
                    synced {timeAgo(lastSync.toISOString())}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Filter pills ─────────────────────────────────────── */}
        {!loading && !error && servers.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
            {FILTER_TYPES.map((t) => {
              const count = t === "All" ? servers.length : (typeCounts[t] ?? 0);
              const active = filterType === t;
              return (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    active
                      ? "border-violet-500/60 bg-violet-500/15 text-violet-300"
                      : "border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                  }`}
                >
                  {t === "All" ? "All" : (TYPE_META[t]?.label ?? t)}
                  <span className={`ml-1.5 ${active ? "opacity-70" : "opacity-50"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Action bar ───────────────────────────────────────── */}
        <div className="mb-10 flex flex-wrap items-center justify-center gap-3">
          {user && (
            <button
              onClick={() => setShowRegister(!showRegister)}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white shadow-lg shadow-violet-900/40 transition hover:bg-violet-500 hover:shadow-violet-800/40"
            >
              <IconPlus className="h-4 w-4" />
              {showRegister ? "Close Form" : "Register Server"}
            </button>
          )}

          <button
            onClick={() => fetchServers(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/40 px-5 py-3 font-medium text-slate-300 transition hover:border-violet-600/50 hover:text-violet-300 disabled:cursor-wait disabled:opacity-50"
          >
            <IconRefresh
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {/* ── Register form ────────────────────────────────────── */}
        {showRegister && (
          <div className="mb-8 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
              <IconPlus className="h-4 w-4 text-violet-400" />
              Register a Public Server
            </h2>
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">
                    Name *
                  </label>
                  <input
                    value={registerForm.name}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, name: e.target.value })
                    }
                    required
                    className={inputClass}
                    placeholder="My Server"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">
                    Type
                  </label>
                  <select
                    value={registerForm.type}
                    onChange={(e) =>
                      setRegisterForm({
                        ...registerForm,
                        type: e.target.value as PublicServer["type"],
                      })
                    }
                    className={inputClass}
                  >
                    <option value="gun-relay">GunDB Relay</option>
                    <option value="sandbox-preview">Sandbox Preview</option>
                    <option value="daemon-node">Daemon Node</option>
                    <option value="custom">Custom Service</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  URL *
                </label>
                <input
                  value={registerForm.url}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, url: e.target.value })
                  }
                  required
                  className={inputClass}
                  placeholder="https://myserver.com or wss://relay.example.com"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">
                    Region
                  </label>
                  <input
                    value={registerForm.region}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, region: e.target.value })
                    }
                    className={inputClass}
                    placeholder="US East, Europe, Global…"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">
                    Tags (comma-separated)
                  </label>
                  <input
                    value={registerForm.tags}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, tags: e.target.value })
                    }
                    className={inputClass}
                    placeholder="gun, relay, europe"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">
                  Description
                </label>
                <textarea
                  value={registerForm.description}
                  onChange={(e) =>
                    setRegisterForm({
                      ...registerForm,
                      description: e.target.value,
                    })
                  }
                  rows={2}
                  className={`${inputClass} resize-y`}
                  placeholder="What does your server do?"
                />
              </div>
              {registerError && (
                <p className="text-sm text-red-400">{registerError}</p>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowRegister(false)}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-400 transition hover:bg-slate-800/60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    registering ||
                    !registerForm.name.trim() ||
                    !registerForm.url.trim()
                  }
                  className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
                >
                  {registering ? "Registering…" : "Register"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Loading ──────────────────────────────────────────── */}
        {loading && (
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-12 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" />
            <div className="animate-pulse text-slate-400">
              Loading servers…
            </div>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────── */}
        {!loading && error && (
          <div className="rounded-2xl border border-red-700/60 bg-red-950/30 p-6 text-center">
            <p className="text-red-400">
              <span className="font-semibold">Error:</span> {error}
            </p>
            <button
              onClick={() => fetchServers()}
              className="mt-4 rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 transition hover:bg-red-500/10"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Content ──────────────────────────────────────────── */}
        {!loading && !error && (
          <div className="space-y-6">
            {/* Stat cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<IconServer className="h-4 w-4" />}
                label="Total Servers"
                value={stats.total}
              />
              <StatCard
                icon={<IconSignal className="h-4 w-4" />}
                label="Online"
                value={stats.online}
                valueClass={stats.online > 0 ? "text-green-400" : "text-slate-100"}
              />
              <StatCard
                icon={<IconClock className="h-4 w-4" />}
                label="Avg Uptime"
                value={formatUptime(stats.avgUptime)}
                valueClass="text-violet-300"
                title={`Across ${stats.total} registered server${stats.total === 1 ? "" : "s"}`}
              />
              <StatCard
                icon={<IconTag className="h-4 w-4" />}
                label="Tags Indexed"
                value={stats.tags}
              />
            </div>

            {/* Server cards */}
            {filtered.length === 0 ? (
              <EmptyState filterType={filterType} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filtered.map((server) => (
                  <ServerCard
                    key={server.id}
                    server={server}
                    reducedMotion={reducedMotion}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
