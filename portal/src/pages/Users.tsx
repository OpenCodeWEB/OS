import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  memo,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { timeAgo } from "../utils/users-time-ago.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UserEntry {
  login: string;
  id: number;
  avatar: string;
  name: string;
  status: "online" | "offline";
  lastSeen: string;
  joinedAt: string;
}

const POLL_INTERVAL = 10_000; // refresh online status every 10 s

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
/*  Icons (memoized, no re-creation per render)                        */
/* ------------------------------------------------------------------ */

type IconProps = { className?: string };

const IconUsers = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
    />
  </svg>
));

const IconSearch = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
    />
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

const IconSignal = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"
    />
  </svg>
));

const IconMoon = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
    />
  </svg>
));

const IconSparkles = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
    />
  </svg>
));

const IconChevron = memo(({ className = "h-4 w-4" }: IconProps) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
    />
  </svg>
));

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
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
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
/*  User card (memoized — only re-renders when its own data changes)   */
/* ------------------------------------------------------------------ */

const UserCard = memo(function UserCard({
  user,
  isYou,
  reducedMotion,
}: {
  user: UserEntry;
  isYou: boolean;
  reducedMotion: boolean;
}) {
  const online = user.status === "online";
  return (
    <Link
      to={`/u/${user.login}`}
      className={`group flex items-center gap-4 rounded-xl border border-slate-700/60 bg-slate-800/30 p-4 transition-colors hover:border-sky-500/50 hover:bg-slate-800/60 ${
        isYou ? "ring-1 ring-sky-500/30" : ""
      }`}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <img
          src={user.avatar}
          alt={user.login}
          className="h-12 w-12 rounded-full border border-slate-600/60 bg-slate-700/50"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <span
          className={`absolute -bottom-0.5 -right-0.5 block h-3.5 w-3.5 rounded-full border-2 border-slate-900 transition-colors duration-500 ${
            online ? "bg-green-400" : "bg-slate-600"
          }`}
        />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-slate-100 transition-colors group-hover:text-sky-300">
            {user.name}
          </span>
          <span className="shrink-0 text-xs text-slate-500">@{user.login}</span>
          {isYou && (
            <span className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300">
              You
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          <span
            className={`inline-flex items-center gap-1.5 font-medium ${
              online ? "text-green-400" : "text-slate-500"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                online
                  ? reducedMotion
                    ? "bg-green-400"
                    : "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)] animate-pulse"
                  : "bg-slate-600"
              }`}
            />
            {online ? "Online" : "Offline"}
          </span>
          {!online && user.lastSeen && <span>last seen {timeAgo(user.lastSeen)}</span>}
          <span>joined {timeAgo(user.joinedAt)}</span>
        </div>
      </div>

      {/* Chevron */}
      <IconChevron className="h-4 w-4 shrink-0 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-sky-400" />
    </Link>
  );
});

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({
  hasQuery,
  query,
}: {
  hasQuery: boolean;
  query?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-600/60 bg-slate-800/50">
        <IconUsers className="h-7 w-7 text-slate-500" />
      </div>
      {hasQuery ? (
        <>
          <h3 className="text-base font-semibold text-slate-200">
            No users matching
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            &ldquo;{query}&rdquo; — try a different name or handle.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-base font-semibold text-slate-200">
            No users yet
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Users will appear here once they authenticate via GitHub OAuth.
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function Users() {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const { user: currentUser } = useAuth();
  const abortRef = useRef<AbortController | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  /**
   * Fetch user list — optionally silent (no skeleton on re-fetch).
   * Aborts any in-flight request so polls can never resolve out of order.
   */
  const fetchUsers = useCallback(async (silent = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const r = await fetch("/api/users", { signal: controller.signal });
      if (!r.ok) throw new Error("Failed to fetch users");
      const data = (await r.json()) as { users: UserEntry[] };
      setUsers(data.users);
      setLastSync(new Date());
    } catch (err) {
      if ((err as Error).name !== "AbortError" && !silent) {
        setError(err instanceof Error ? err.message : "Failed to load users");
      }
    } finally {
      // Never flip states for a request that was superseded by a newer one
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // ── Initial fetch ──────────────────────────────────────────────
  useEffect(() => {
    fetchUsers();
    return () => abortRef.current?.abort();
  }, [fetchUsers]);

  // ── Live polling (10 s) — paused while the tab is hidden ───────
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) fetchUsers(true);
    };
    const timer = setInterval(tick, POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) fetchUsers(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchUsers]);

  /* ── Derived data (memoized) ─────────────────────────────────── */
  const query = search.toLowerCase().trim();

  const filtered = useMemo(() => {
    if (!query) return users;
    return users.filter(
      (u) =>
        u.login.toLowerCase().includes(query) ||
        u.name.toLowerCase().includes(query),
    );
  }, [users, query]);

  const stats = useMemo(() => {
    let online = 0;
    let newest: UserEntry | null = null;
    let newestTime = 0;
    for (const u of users) {
      if (u.status === "online") online++;
      const t = new Date(u.joinedAt).getTime();
      if (t > newestTime) {
        newestTime = t;
        newest = u;
      }
    }
    return { total: users.length, online, offline: users.length - online, newest };
  }, [users]);

  const currentLogin = currentUser?.login ?? "";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <div className="relative mb-10 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/60 p-8 text-center backdrop-blur">
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-sky-500/20 blur-3xl" />

          <div className="relative">
            {/* Community badge */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-sky-500/30 bg-sky-500/10 shadow-[0_0_30px_rgba(14,165,233,0.25)]">
              <IconUsers className="h-9 w-9 text-sky-400" />
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-sky-400 to-indigo-300 bg-clip-text text-transparent">
                Users Directory
              </span>
            </h1>
            <p className="mt-3 text-slate-400">
              Community directory — live GitHub presence
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
                {stats.total} user{stats.total === 1 ? "" : "s"}
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

        {/* ── Action bar ───────────────────────────────────────── */}
        <div className="mb-10 flex flex-wrap items-center justify-center gap-3">
          <div className="relative w-full max-w-md">
            <IconSearch className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users by name or handle…"
              aria-label="Search users"
              className="w-full rounded-xl border border-slate-600 bg-slate-800/40 py-3 pl-10 pr-4 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-sky-500/60 focus:bg-slate-800/70"
            />
          </div>

          <button
            onClick={() => fetchUsers(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/40 px-5 py-3 font-medium text-slate-300 transition hover:border-sky-600/50 hover:text-sky-300 disabled:cursor-wait disabled:opacity-50"
          >
            <IconRefresh
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {/* ── Loading ──────────────────────────────────────────── */}
        {loading && (
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-12 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-sky-400/30 border-t-sky-400" />
            <div className="animate-pulse text-slate-400">
              Loading users…
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
              onClick={() => fetchUsers()}
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
                icon={<IconUsers className="h-4 w-4" />}
                label="Total Users"
                value={stats.total}
              />
              <StatCard
                icon={<IconSignal className="h-4 w-4" />}
                label="Online Now"
                value={stats.online}
                valueClass={
                  stats.online > 0 ? "text-green-400" : "text-slate-100"
                }
              />
              <StatCard
                icon={<IconMoon className="h-4 w-4" />}
                label="Offline"
                value={stats.offline}
              />
              <StatCard
                icon={<IconSparkles className="h-4 w-4" />}
                label="Newest Member"
                value={
                  stats.newest ? `@${stats.newest.login}` : "—"
                }
                valueClass="text-sky-300 font-mono text-lg"
                title={stats.newest ? `Joined ${timeAgo(stats.newest.joinedAt)}` : undefined}
              />
            </div>

            {/* User cards */}
            {filtered.length === 0 ? (
              <EmptyState hasQuery={query.length > 0} query={search} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filtered.map((user) => (
                  <UserCard
                    key={user.login}
                    user={user}
                    isYou={user.login === currentLogin}
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
