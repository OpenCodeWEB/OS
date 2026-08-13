import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CommunityHub {
  id: string;
  owner: string;
  name: string;
  project?: string;
  description: string;
  starCount: number;
  forkCount: number;
  discussionCount: number;
  memberCount: number;
  lastActive: string;
  createdAt: string;
  rank: number;
  isRoot: boolean;
  tags: string[];
}

type ViewMode = "global" | "project";
type SortKey = "rank" | "members" | "stars" | "created";
type TagFilter = "All" | "Templates" | "Features" | "Showcase" | "Bug Reports";
type StatusFilter = "active";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SORT_OPTIONS: { value: SortKey; label: string; icon: string }[] = [
  { value: "rank", label: "System Smart Rank", icon: "🔽" },
  { value: "members", label: "Most Active Members", icon: "👥" },
  { value: "stars", label: "Top GitHub Stars & Forks", icon: "⭐" },
  { value: "created", label: "Recently Created", icon: "🆕" },
];

const TAG_OPTIONS: { value: TagFilter; label: string; icon: string }[] = [
  { value: "All", label: "All", icon: "🏷️" },
  { value: "Templates", label: "Templates", icon: "📋" },
  { value: "Features", label: "Features", icon: "✨" },
  { value: "Showcase", label: "Showcase", icon: "🏆" },
  { value: "Bug Reports", label: "Bug Reports", icon: "🐛" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string; icon: string }[] = [
  { value: "active", label: "All Active", icon: "⚡" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function hubUrl(hub: CommunityHub): string {
  if (hub.project) return `/C/${hub.owner}/${hub.project}`;
  if (hub.isRoot) return `/C/${hub.owner}/${hub.name}`;
  return `/C/${hub.owner}/${hub.name}`;
}

/* ------------------------------------------------------------------ */
/*  Custom Dropdown                                                    */
/* ------------------------------------------------------------------ */

function Dropdown<T extends string>({
  icon,
  options,
  value,
  onChange,
}: {
  icon: string;
  label?: string;
  options: { value: T; label: string; icon: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/50 transition-all hover:border-white/20 hover:text-white/70"
      >
        <span>{icon}</span>
        <span className="max-w-[140px] truncate">{current.label}</span>
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[210px] rounded-xl border border-white/10 bg-surface-raised p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                opt.value === value
                  ? "bg-brand-600/15 text-brand-300"
                  : "text-white/50 hover:bg-white/5 hover:text-white/70"
              }`}
            >
              <span className="w-5 text-center">{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="card-surface animate-pulse">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-white/5" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-48 rounded bg-white/5" />
              <div className="h-4 w-3/4 rounded bg-white/5" />
              <div className="flex gap-3">
                <div className="h-4 w-20 rounded bg-white/5" />
                <div className="h-4 w-16 rounded bg-white/5" />
              </div>
            </div>
            <div className="h-6 w-16 rounded-full bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hub Card                                                           */
/* ------------------------------------------------------------------ */

function HubCard({ hub }: { hub: CommunityHub }) {
  const isProject = !!hub.project;
  const url = hubUrl(hub);

  return (
    <Link
      to={url}
      className={`card-surface group flex items-start gap-4 transition-all ${
        hub.isRoot
          ? "border-brand-500/30 bg-brand-500/[0.03] hover:border-brand-500/50"
          : "hover:border-white/10"
      }`}
    >
      {/* Rank badge */}
      <div className="flex shrink-0 flex-col items-center pt-1">
        {hub.isRoot ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-sm font-bold text-white shadow-lg shadow-amber-500/20">
            #1
          </div>
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-sm font-medium text-white/30">
            #{hub.rank}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-medium text-white/90 group-hover:text-brand-400 transition-colors">
            {hub.project
              ? `${hub.owner}/${hub.project}`
              : `${hub.owner}/${hub.name}`}
          </h3>
          {hub.isRoot && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              ★ Root Hub
            </span>
          )}
          {isProject ? (
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[10px] font-medium text-brand-400">
              📁 Project
            </span>
          ) : (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              🌐 Global
            </span>
          )}
        </div>

        {/* Description */}
        <p className="mt-1 text-sm text-white/50 line-clamp-1">
          {hub.description}
        </p>

        {/* Tags */}
        {hub.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {hub.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/35"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/30">
          <span>💬 {hub.discussionCount} discussions</span>
          <span>👥 {hub.memberCount} members</span>
          <span>⭐ {hub.starCount} stars</span>
          <span>⑂ {hub.forkCount} forks</span>
          <span>· active {timeAgo(hub.lastActive)}</span>
        </div>
      </div>

      {/* Chevron */}
      <svg
        className="mt-3 h-4 w-4 shrink-0 text-white/20 transition-all group-hover:translate-x-0.5 group-hover:text-brand-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
        />
      </svg>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CommunityHubIndex() {
  const [hubs, setHubs] = useState<CommunityHub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [viewMode, setViewMode] = useState<ViewMode>("global");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("rank");
  const [tag, setTag] = useState<TagFilter>("All");

  // Fetch hubs with sort and tag params
  const fetchHubs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sort, tag });
      const r = await fetch(`/api/community/hubs?${params}`);
      if (!r.ok) throw new Error("Failed to fetch hubs");
      const data = (await r.json()) as { hubs: CommunityHub[] };
      setHubs(data.hubs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hubs");
    } finally {
      setLoading(false);
    }
  }, [sort, tag]);

  useEffect(() => {
    fetchHubs();
  }, [fetchHubs]);

  // Filter by view mode
  const byMode =
    viewMode === "global"
      ? hubs.filter((h) => !h.project)
      : hubs.filter((h) => h.project);

  // Real-time search — matches username, org, project, and description
  const query = search.toLowerCase().trim();
  const filtered = query
    ? byMode.filter(
        (h) =>
          h.owner.toLowerCase().includes(query) ||
          h.name.toLowerCase().includes(query) ||
          h.project?.toLowerCase().includes(query) ||
          h.description.toLowerCase().includes(query),
      )
    : byMode;

  return (
    <div className="mx-auto max-w-4xl px-6 py-16 pb-24">
      {/* ── Header (Primary Action Button ➔ /C/💬) ─────────── */}
      <div className="mb-6">
        <Link
          to="/C/💬"
          className="group inline-flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] px-5 py-3 transition-all hover:border-brand-500/30 hover:bg-brand-500/[0.03] hover:shadow-lg hover:shadow-brand-500/5"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-xl shadow-lg shadow-brand-500/20 transition-all group-hover:scale-110 group-hover:shadow-brand-500/30">
            💬
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white/90 group-hover:text-white transition-colors">
              Community <span className="text-brand-400">Hub</span>
            </h1>
            <p className="text-xs text-white/30 transition-colors group-hover:text-brand-400/60">
              Primary Button &bull; /C/💬 &bull; GitHub Discussions
            </p>
          </div>
          <svg
            className="ml-auto h-5 w-5 shrink-0 text-white/20 transition-all group-hover:translate-x-0.5 group-hover:text-brand-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
            />
          </svg>
        </Link>
        <p className="mt-2 text-sm text-white/40">
          {loading
            ? "Loading…"
            : `${filtered.length} hub${filtered.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {/* ── Navigation Header ─────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* View mode toggles */}
        <div className="flex rounded-xl border border-white/10 bg-white/[0.02] p-1">
          <button
            onClick={() => setViewMode("global")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
              viewMode === "global"
                ? "bg-brand-600/20 text-brand-300 shadow-sm"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            <span>🌐</span> Global
          </button>
          <button
            onClick={() => setViewMode("project")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
              viewMode === "project"
                ? "bg-brand-600/20 text-brand-300 shadow-sm"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            <span>📁</span> Projects
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Search by username, org, or project…"
            className="w-full rounded-xl border border-white/10 bg-white/[0.02] py-2 pl-10 pr-4 text-sm text-white/70 outline-none transition-colors placeholder:text-white/20 focus:border-brand-500/50 focus:bg-white/[0.04]"
          />
        </div>
      </div>

      {/* ── Sort & Filter Toolbar ─────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Dropdown
          icon={SORT_OPTIONS.find((o) => o.value === sort)?.icon ?? "🔽"}
          label="Sort"
          options={SORT_OPTIONS}
          value={sort}
          onChange={setSort}
        />
        <Dropdown
          icon={TAG_OPTIONS.find((o) => o.value === tag)?.icon ?? "🏷️"}
          label="Tag"
          options={TAG_OPTIONS}
          value={tag}
          onChange={setTag}
        />
        <Dropdown
          icon="⚡"
          label="Status"
          options={STATUS_OPTIONS}
          value="active"
          onChange={() => {}}
        />
      </div>

      {/* ── Content ────────────────────────────────────────── */}
      {loading && <SkeletonList />}
      {!loading && error && (
        <div className="card-surface border-red-500/20 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={fetchHubs}
            className="mt-3 rounded-lg bg-brand-600/20 px-4 py-2 text-sm font-medium text-brand-300 hover:bg-brand-600/30"
          >
            Try again
          </button>
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div className="card-surface text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
            <svg
              className="h-6 w-6 text-white/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
              />
            </svg>
          </div>
          <h3 className="text-base font-medium text-white/70">No hubs found</h3>
          <p className="mt-1 text-sm text-white/40">
            {query
              ? `No ${viewMode} hubs matching "${search}"`
              : tag !== "All"
                ? `No ${viewMode} hubs with the "${tag}" tag`
                : `No ${viewMode} hubs registered yet.`}
          </p>
        </div>
      )}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((hub) => (
            <HubCard key={hub.id} hub={hub} />
          ))}
        </div>
      )}

      {/* ── Legend ─────────────────────────────────────────── */}
      <div className="mt-8 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-xs text-white/30">
        <p className="mb-1 font-medium text-white/40">Ranking System</p>
        <p>
          <span className="text-amber-400">★ #1 Root Hub</span> —
          ABsUPs/CommunityHub is permanently anchored at position #1. All other
          hubs are ranked algorithmically by member engagement, discussion
          volume, and repository stars/forks. Rankings are computed server-side
          and manual override is strictly disallowed.
        </p>
      </div>
    </div>
  );
}
