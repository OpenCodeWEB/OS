import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";

interface DashboardData {
  loggedIn: boolean;
  installationCount: number;
  user: string | null;
  workerStatus: string;
  installations: Array<{
    id: string;
    installationId: string;
    installedAt: string;
    account: string;
    accountType: string;
    [key: string]: unknown;
  }>;
  version: string;
}

interface MetricsData {
  system_stats: {
    total_backups: number;
    bugs_fixed: number;
    total_commits: number;
    last_updated: string;
  };
  contributors: Array<{
    username: string;
    role: string;
    avatar: string;
    commits_count: number;
    last_active: string;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then) return "—";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function workerInfo(status: string) {
  switch (status) {
    case "ok":
      return {
        dot: "bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.7)] animate-pulse",
        label: "Online",
        text: "text-green-400",
        badge: "bg-green-500/10 border-green-500/30 text-green-300",
      };
    case "unknown":
      return {
        dot: "bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]",
        label: "Unknown",
        text: "text-yellow-400",
        badge: "bg-yellow-500/10 border-yellow-500/30 text-yellow-300",
      };
    default:
      return {
        dot: "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.6)]",
        label: "Unreachable",
        text: "text-red-400",
        badge: "bg-red-500/10 border-red-500/30 text-red-300",
      };
  }
}

function formatNumber(n: number): string {
  return (n ?? 0).toLocaleString();
}

/** Avatar with graceful letter fallback when GitHub avatars fail to load. */
function ContributorAvatar({ name, url }: { name: string; url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-600/60 bg-gradient-to-br from-emerald-500/30 to-teal-500/30 font-bold text-emerald-200">
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-full border border-slate-600/60 bg-slate-700/50"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Main dashboard                                                     */
/* ------------------------------------------------------------------ */

export default function AGDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [metricsFailed, setMetricsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const loadDashboard = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const session = new URLSearchParams(window.location.search).get(
        "session",
      );
      const headers: Record<string, string> = {};
      if (session) {
        headers["Authorization"] = `Bearer ${session}`;
      }

      const [dashResp, metricsResp] = await Promise.all([
        fetch("/api/ag/dashboard", { headers }),
        fetch("/api/ag/metrics", { headers }),
      ]);

      if (!dashResp.ok) {
        throw new Error(`HTTP ${dashResp.status}`);
      }
      const json = (await dashResp.json()) as DashboardData;
      setData(json);

      // Metrics are best-effort — hide the section on failure, never block the dashboard
      if (metricsResp.ok) {
        const metricsJson = (await metricsResp.json()) as MetricsData;
        setMetrics(metricsJson);
        setMetricsFailed(false);
      } else {
        setMetricsFailed(true);
      }

      setError(null);
      setLastSync(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Auto-refresh every 30s
  useEffect(() => {
    const timer = setInterval(() => loadDashboard(true), 30000);
    return () => clearInterval(timer);
  }, [loadDashboard]);

  const worker = workerInfo(data?.workerStatus ?? "");

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <div className="relative mb-10 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/60 p-8 text-center backdrop-blur">
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl" />

          <div className="relative">
            {/* Bot badge */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_30px_rgba(16,185,129,0.25)]">
              <svg className="h-9 w-9 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
              </svg>
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                OpenCodeWEB
              </span>
            </h1>
            <p className="mt-3 text-slate-400">
              Autonomous GitHub Bot — real-time control center
            </p>

            {/* Live status chip */}
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-600/60 bg-slate-800/60 px-4 py-1.5 text-sm">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${worker.dot}`} />
              <span className={`font-medium ${worker.text}`}>{worker.label}</span>
              <span className="mx-1 text-slate-600">•</span>
              <span className="text-slate-400">
                v{data?.version ?? "1.0.0"}
              </span>
              {lastSync && (
                <>
                  <span className="mx-1 text-slate-600">•</span>
                  <span className="text-slate-500">synced {timeAgo(lastSync.toISOString())}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Action bar ───────────────────────────────────────── */}
        <div className="mb-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/api/ag/auth/login"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white shadow-lg shadow-emerald-900/40 transition hover:bg-emerald-500 hover:shadow-emerald-800/40"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            Install / Authorize GitHub App
          </a>

          <button
            onClick={() => loadDashboard(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/40 px-5 py-3 font-medium text-slate-300 transition hover:border-emerald-600/50 hover:text-emerald-300 disabled:cursor-wait disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>

          <Link
            to="/ag/features"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/40 px-5 py-3 font-medium text-slate-300 transition hover:border-indigo-600/50 hover:text-indigo-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            Features
          </Link>
        </div>

        {/* ── Loading ──────────────────────────────────────────── */}
        {loading && (
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-12 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
            <div className="animate-pulse text-slate-400">
              Connecting to gateway…
            </div>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────── */}
        {error && (
          <div className="rounded-2xl border border-red-700/60 bg-red-950/30 p-6 text-center">
            <p className="text-red-400">
              <span className="font-semibold">Error:</span> {error}
            </p>
            <button
              onClick={() => loadDashboard()}
              className="mt-4 rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 transition hover:bg-red-500/10"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Dashboard content ────────────────────────────────── */}
        {data && (
          <div className="space-y-6">
            {/* Connection Status grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5">
                <div className="mb-3 flex items-center gap-2 text-slate-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                  <span className="text-sm">App Status</span>
                </div>
                <p
                  className={`text-xl font-bold ${
                    data.installationCount > 0
                      ? "text-green-400"
                      : "text-yellow-400"
                  }`}
                >
                  {data.installationCount > 0
                    ? "Installed & Active"
                    : "Not installed"}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5">
                <div className="mb-3 flex items-center gap-2 text-slate-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  <span className="text-sm">Installations</span>
                </div>
                <p className="text-xl font-bold text-slate-100">
                  {data.installationCount}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5">
                <div className="mb-3 flex items-center gap-2 text-slate-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
                  </svg>
                  <span className="text-sm">Worker Status</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-3.5 w-3.5 rounded-full ${worker.dot}`} />
                  <span className={`text-xl font-bold ${worker.text}`}>
                    {worker.label}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5">
                <div className="mb-3 flex items-center gap-2 text-slate-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                  </svg>
                  <span className="text-sm">Version</span>
                </div>
                <p className="text-xl font-bold font-mono text-slate-100">
                  {data.version}
                </p>
              </div>
            </div>

            {/* ── Live Analytics & Leaderboard ─────────────────── */}
            {metrics && !metricsFailed && (
              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="flex items-center gap-3 text-lg font-semibold text-slate-200">
                    <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                    Live Analytics
                    <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-sm font-medium text-emerald-300">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      live
                    </span>
                  </h2>
                  {metrics.system_stats.last_updated &&
                    metrics.system_stats.last_updated.startsWith("1970") === false && (
                      <span className="text-xs text-slate-500">
                        updated {timeAgo(metrics.system_stats.last_updated)}
                      </span>
                    )}
                </div>

                {/* Metric cards */}
                <div className="mb-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-5">
                    <div className="mb-3 flex items-center gap-2 text-emerald-400/80">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                      </svg>
                      <span className="text-sm">Pre-Mutation Backups</span>
                    </div>
                    <p className="font-mono text-3xl font-bold text-emerald-300">
                      {formatNumber(metrics.system_stats.total_backups)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-5">
                    <div className="mb-3 flex items-center gap-2 text-amber-400/80">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
                      </svg>
                      <span className="text-sm">Bug Fixes</span>
                    </div>
                    <p className="font-mono text-3xl font-bold text-amber-300">
                      {formatNumber(metrics.system_stats.bugs_fixed)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-sky-700/40 bg-sky-950/20 p-5">
                    <div className="mb-3 flex items-center gap-2 text-sky-400/80">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                      </svg>
                      <span className="text-sm">Total Commits</span>
                    </div>
                    <p className="font-mono text-3xl font-bold text-sky-300">
                      {formatNumber(metrics.system_stats.total_commits)}
                    </p>
                  </div>
                </div>

                {/* Leaderboard */}
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                    <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" />
                    </svg>
                    Contributor Leaderboard
                  </h3>

                  {metrics.contributors.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/20 py-8 text-center">
                      <p className="text-3xl">🏆</p>
                      <p className="mt-2 text-sm text-slate-500">
                        No activity yet — push events, backups, and auto-repairs
                        will populate the leaderboard.
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {metrics.contributors.map((c, i) => {
                        const medal =
                          i === 0
                            ? "text-amber-300"
                            : i === 1
                              ? "text-slate-300"
                              : i === 2
                                ? "text-orange-400"
                                : "text-slate-600";
                        return (
                          <li
                            key={c.username}
                            className="flex items-center gap-4 rounded-xl border border-slate-700/60 bg-slate-800/30 p-3 transition hover:border-emerald-600/40 hover:bg-slate-800/60"
                          >
                            <span className={`w-8 shrink-0 text-center font-mono text-lg font-bold ${medal}`}>
                              {i + 1}
                            </span>
                            <ContributorAvatar name={c.username} url={c.avatar} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <a
                                  href={
                                    c.username === "OpenCodeWEB"
                                      ? "https://github.com/apps/opencodeweb"
                                      : `https://github.com/${c.username}`
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="truncate font-semibold text-slate-100 hover:text-emerald-300"
                                >
                                  {c.username}
                                </a>
                                <span className="hidden rounded-full border border-slate-600/60 bg-slate-700/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:inline">
                                  {c.role}
                                </span>
                              </div>
                              <div className="mt-0.5 text-xs text-slate-500">
                                last active {timeAgo(c.last_active)}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="font-mono text-lg font-bold text-emerald-300">
                                {formatNumber(c.commits_count)}
                              </div>
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                                commits
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Logged-in user banner */}
            {data.loggedIn && data.user && (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-700/50 bg-emerald-950/30 p-4">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="text-sm text-slate-300">
                  Logged in as{" "}
                  <span className="font-semibold text-emerald-300">
                    @{data.user}
                  </span>
                </span>
              </div>
            )}

            {/* Installations */}
            <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-3 text-lg font-semibold text-slate-200">
                  <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                  </svg>
                  Installations
                  {data.installationCount > 0 && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-sm font-medium text-emerald-300">
                      {data.installationCount}
                    </span>
                  )}
                </h2>
              </div>

              {data.installations.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-4xl">🤖</p>
                  <p className="mt-3 text-slate-500">
                    No installations found. Click the button above to install
                    the GitHub App.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.installations.map((inst) => {
                    const account = (inst.account as string) ?? "Unknown";
                    const accountType = (inst.accountType as string) ?? "—";
                    const isOrg = accountType === "Organization";
                    return (
                      <a
                        key={(inst.id as string) ?? (inst.installationId as string)}
                        href={`https://github.com/${account}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center gap-4 rounded-xl border border-slate-700/60 bg-slate-800/30 p-4 transition hover:border-emerald-600/50 hover:bg-slate-800/60"
                      >
                        <img
                          src={`https://avatars.githubusercontent.com/${account}?s=80`}
                          alt={account}
                          className="h-12 w-12 rounded-full border border-slate-600/60 bg-slate-700/50"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-semibold text-slate-100 group-hover:text-emerald-300">
                              {account}
                            </span>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                                isOrg
                                  ? "border-purple-500/30 bg-purple-500/10 text-purple-300"
                                  : "border-sky-500/30 bg-sky-500/10 text-sky-300"
                              }`}
                            >
                              {accountType === "User" ? "User" : "Org"}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                            <span className="font-mono text-emerald-400/80">
                              #{inst.installationId as string}
                            </span>
                            <span>·</span>
                            <span>
                              {inst.installedAt
                                ? `Installed ${timeAgo(inst.installedAt as string)}`
                                : "—"}
                            </span>
                          </div>
                        </div>
                        <svg
                          className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Legal links */}
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <Link
                to="/ag/privacy"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-2 text-xs font-medium text-slate-400 transition hover:border-emerald-600/50 hover:text-emerald-300"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                Privacy Policy
              </Link>
              <Link
                to="/ag/terms"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-2 text-xs font-medium text-slate-400 transition hover:border-emerald-600/50 hover:text-emerald-300"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                Terms of Service
              </Link>
              <Link
                to="/ag/license"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-2 text-xs font-medium text-slate-400 transition hover:border-emerald-600/50 hover:text-emerald-300"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                MIT License
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
