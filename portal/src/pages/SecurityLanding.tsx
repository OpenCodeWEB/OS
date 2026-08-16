import { useState } from "react";

/* ------------------------------------------------------------------ */
/*  OpenCodeWEB Feature Showcase (/F) — Security Landing                */
/*                                                                      */
/*  Visual language mirrors the AG dashboard (/ag): slate gradient      */
/*  shell, glow hero, live status chip, glassy stat/card sections,      */
/*  emerald accents, SVG iconography.                                   */
/* ------------------------------------------------------------------ */

interface Feature {
  icon: keyof typeof ICONS;
  title: string;
  desc: string;
  route?: string;
}

/* Heroicon-style outline paths (24x24, stroke 1.5) */
const ICONS = {
  globe: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
    />
  ),
  network: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m-6.75-9a6.75 6.75 0 1013.5 0 6.75 6.75 0 00-13.5 0zM12 15v-3m0 0l-2.25-2.25M12 12l2.25-2.25"
    />
  ),
  devices: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
    />
  ),
  building: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
    />
  ),
  cube: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
    />
  ),
  squares: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
    />
  ),
  users: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
    />
  ),
  server: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"
    />
  ),
  chat: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
    />
  ),
  lock: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
    />
  ),
  cloud: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
    />
  ),
  cpu: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z"
    />
  ),
  shield: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
    />
  ),
  sync: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
    />
  ),
} as const;

const FEATURES: Feature[] = [
  {
    icon: "globe",
    title: "3D Global Dashboard",
    desc: "Interactive Cobe WebGL globe with live node metrics, real-time telemetry, and top leaderboards — the command center of your infrastructure.",
    route: "/",
  },
  {
    icon: "network",
    title: "GunDB P2P Graph Network",
    desc: "Decentralized, offline-first peer-to-peer data synchronization. CRDT conflict resolution, SEA end-to-end encryption, and IndexedDB persistence for zero-cost real-time sync across all your devices.",
  },
  {
    icon: "devices",
    title: "Multi-Device Management",
    desc: "Register and monitor all your active nodes — PC, Mac, Linux, Docker, VPS, Termux. Live WebSocket telemetry, multi-stream logs, and offline snapshot fallback via GitHub Private Fork.",
    route: "/u/{username}",
  },
  {
    icon: "building",
    title: "Company Orchestration",
    desc: "AI workforce management with 33+ multi-agent roles. Organization showcase pages with live token throughput gauges, agent activity metrics, and public project cards.",
    route: "/o/{org}/{company}",
  },
  {
    icon: "cube",
    title: "Isolated Sandboxes",
    desc: "Multi-tenant sandbox environments with auto-backup, PREVIEW mode, and one-click publish. Strict filesystem isolation with human-in-the-loop escalation guardrails.",
    route: "/s/{org}/{project}",
  },
  {
    icon: "squares",
    title: "Template Marketplace",
    desc: "Discover and share multi-agent templates and OpenCode setups. Search by category, filter by stack, and clone with one click.",
    route: "/T",
  },
  {
    icon: "users",
    title: "Users Directory",
    desc: "Browse all registered users of the platform. See who's online, view their profiles and connected devices, and discover the community behind the infrastructure.",
    route: "/U",
  },
  {
    icon: "server",
    title: "Server Directory",
    desc: "A public registry of all active GunDB relays, sandbox preview servers, and daemon nodes. Register your own server or discover community-run infrastructure with real-time status and uptime tracking.",
    route: "/S",
  },
  {
    icon: "chat",
    title: "Community Hub",
    desc: "Interactive discussion forum powered by GitHub Discussions API + local D1 database. Create, edit, delete posts and comments with real-time GunDB P2P sync across all connected users.",
    route: "/C",
  },
  {
    icon: "lock",
    title: "GitHub OAuth + E2EE Mesh",
    desc: "Secure authentication via GitHub OAuth with derived SEA keypairs for end-to-end encrypted peer-to-peer communication. Every session is bound to a cryptographic identity.",
  },
  {
    icon: "cloud",
    title: "Hybrid Cloud Compute",
    desc: "Split execution between local heavy compute (code generation, refactoring, security) and 24/7 serverless cloud runtime. Multi-account fallback rotation for zero-cost uptime.",
  },
  {
    icon: "cpu",
    title: "Background Daemon Engine",
    desc: "OS-native persistent services: systemd (Linux), launchd (macOS), Task Scheduler (Windows), Termux sticky notification (Android), Docker restart policy (VPS).",
  },
  {
    icon: "shield",
    title: "Branding & Anti-Tamper",
    desc: "Mandatory footer injection with MutationObserver DOM integrity guard. If the branding is removed or hidden, the page instantly redirects to this security landing.",
  },
  {
    icon: "sync",
    title: "Bi-Directional DB Sync",
    desc: "Automatic state synchronization between Cloudflare D1, KV, and local databases. Periodic snapshots persisted to GitHub Private Fork for offline fallback rendering.",
  },
];

interface RouteInfo {
  path: string;
  title: string;
  desc: string;
}

const ROUTES: RouteInfo[] = [
  {
    path: "/",
    title: "Home Dashboard",
    desc: "3D Cobe globe, live metrics, leaderboards",
  },
  {
    path: "/u/{username}",
    title: "Device Admin",
    desc: "Multi-device telemetry & management",
  },
  {
    path: "/o/{org}/{company}",
    title: "Org Showcase",
    desc: "Company profile & AI workforce",
  },
  {
    path: "/s/{org}/{project}",
    title: "Sandbox",
    desc: "Isolated preview & live server",
  },
  { path: "/T", title: "Templates", desc: "Multi-agent template marketplace" },
  {
    path: "/C",
    title: "Community Hub",
    desc: "Discussions with real-time P2P sync",
  },
  { path: "/S", title: "Servers", desc: "Public server directory & registry" },
  { path: "/U", title: "Users", desc: "Community user directory" },
  {
    path: "/F",
    title: "Feature Showcase",
    desc: "Project overview & feature documentation",
  },
];

const TECH = [
  "React 18",
  "TypeScript",
  "Vite 5",
  "Tailwind CSS 3",
  "React Router 6",
  "Cloudflare Pages",
  "Cloudflare D1",
  "Cloudflare KV",
  "GunDB",
  "Cobe WebGL",
  "GitHub OAuth",
  "GitHub GraphQL API",
  "GitHub Discussions API",
];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function FeatureIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      className="h-6 w-6 text-emerald-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      {ICONS[name]}
    </svg>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const [hovered, setHovered] = useState(false);

  const content = (
    <>
      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
        <FeatureIcon name={feature.icon} />
      </div>
      <h3 className="mb-2 text-base font-semibold text-slate-100">
        {feature.title}
      </h3>
      <p className="text-sm leading-relaxed text-slate-400">{feature.desc}</p>
      {feature.route && (
        <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-emerald-400">
          <code className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-mono">
            {feature.route}
          </code>
          <svg
            className="h-3 w-3"
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
        </div>
      )}
    </>
  );

  if (feature.route) {
    return (
      <a
        href={feature.route}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`group rounded-2xl border p-5 backdrop-blur transition-all duration-200 ${
          hovered
            ? "-translate-y-0.5 border-emerald-500/40 bg-slate-800/60 shadow-lg shadow-emerald-950/40"
            : "border-slate-700/60 bg-slate-900/40 hover:border-emerald-600/40 hover:bg-slate-800/50"
        }`}
      >
        {content}
      </a>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5 backdrop-blur">
      {content}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function SecurityLanding() {
  const [showRestricted, setShowRestricted] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-16 pb-32">
        {/* ── Hero ────────────────────────────────────────────────── */}
        <div className="relative mb-16 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/60 p-10 text-center backdrop-blur">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl" />

          <div className="relative">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_30px_rgba(16,185,129,0.25)]">
              <svg
                className="h-9 w-9 text-emerald-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
                />
              </svg>
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                OpenCodeABsUI
              </span>
              <span className="text-white/30">/UX</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
              Enterprise-grade OpenCode ecosystem plugin and hybrid
              infrastructure manager — bridging local developer environments
              with a 24/7 serverless cloud runtime via a decentralized GunDB
              P2P data synchronization layer.
            </p>

            {/* Live status chip */}
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-600/60 bg-slate-800/60 px-4 py-1.5 text-sm">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.7)]" />
              <span className="font-medium text-emerald-400">Online</span>
              <span className="mx-1 text-slate-600">•</span>
              <span className="text-slate-400">v1.0.0-EA</span>
              <span className="mx-1 text-slate-600">•</span>
              <span className="text-slate-500">
                {FEATURES.length} capabilities
              </span>
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="/"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white shadow-lg shadow-emerald-900/40 transition hover:bg-emerald-500 hover:shadow-emerald-800/40"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                  />
                </svg>
                Launch Dashboard
              </a>
              <a
                href="https://github.com/OpenCodeWEB/UI"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/40 px-6 py-3 font-medium text-slate-300 transition hover:border-emerald-600/50 hover:text-emerald-300"
              >
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                View on GitHub
              </a>
              <button
                onClick={() => setShowRestricted(!showRestricted)}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-6 py-3 font-medium text-amber-300 transition hover:border-amber-500/50 hover:text-amber-200"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                Security Notice
              </button>
            </div>

            {/* Collapsible security notice */}
            {showRestricted && (
              <div className="mx-auto mt-6 max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-left">
                <div className="mb-2 flex items-center gap-2 text-amber-400">
                  <span className="text-lg">🔒</span>
                  <span className="text-sm font-semibold">Access Restricted</span>
                </div>
                <p className="text-xs leading-relaxed text-amber-300/60">
                  You may have landed here due to DOM tampering detection
                  (branding integrity check failed), invalid or expired
                  credentials, or an attempt to access a restricted namespace
                  without proper authorization. If you believe this is an
                  error, please return home and try again.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Route Map ───────────────────────────────────────────── */}
        <section className="mb-16">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold text-slate-100">Route Map</h2>
            <p className="mt-1 text-sm text-slate-400">
              Every route on{" "}
              <code className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-300">
                pocwu.pages.dev
              </code>
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ROUTES.map((r) => (
              <a
                key={r.path}
                href={r.path}
                className="group flex items-center gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4 backdrop-blur transition-all hover:border-emerald-600/50 hover:bg-slate-800/60"
              >
                <div className="shrink-0">
                  <code className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-mono text-xs font-medium text-emerald-300">
                    {r.path}
                  </code>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-200 transition-colors group-hover:text-emerald-300">
                    {r.title}
                  </div>
                  <div className="text-xs text-slate-500">{r.desc}</div>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────── */}
        <section className="mb-16">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold text-slate-100">
              Everything It Does
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              A comprehensive ecosystem plugin with {FEATURES.length} core
              capabilities
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} feature={f} />
            ))}
          </div>
        </section>

        {/* ── Architecture ────────────────────────────────────────── */}
        <section className="mb-16">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold text-slate-100">Architecture</h2>
            <p className="mt-1 text-sm text-slate-400">
              Three-tier decentralized infrastructure
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6 backdrop-blur">
            <pre className="whitespace-pre font-mono text-xs leading-relaxed text-slate-400">
              {`💻 Local Active Nodes          📡 GunDB P2P Graph            ☁️ Cloudflare / GitHub
 (PC / Phone / Docker)         (Peer-to-Peer Sync)           (Serverless & Storage)
┌────────────────────┐        ┌────────────────────┐       ┌────────────────────┐
│ • Heavy Processing │ ◄────► │ Real-Time Bi-Dir  │ ◄───► │ • 24/7 API Gateway │
│ • Local GunDB Node │ WebRTC │ DB Sync / CRDT     │  WS   │ • Private Fork     │
│ • OS Daemon        │        │ • E2EE via SEA     │       │ • D1 / KV Storage  │
│ • Offline-First    │        │ • Offline Queue    │       │ • Workers Runtime  │
└────────────────────┘        └────────────────────┘       └────────────────────┘
                                      │
                                      ▼
                              🔐 Encrypted P2P Mesh
                    ┌───────────┼───────────┐
                    │           │           │
                    ▼           ▼           ▼
            pocwu.pages.dev  /u/ /o/ /s/  GitHub Fork
             (Home / Globe)  (Routes)     (Offline Backup)`}
            </pre>
          </div>
        </section>

        {/* ── Tech Stack ──────────────────────────────────────────── */}
        <section className="mb-16">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold text-slate-100">Tech Stack</h2>
            <p className="mt-1 text-sm text-slate-400">
              Built on modern, free-tier technologies
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {TECH.map((t) => (
              <span
                key={t}
                className="rounded-full border border-slate-600/60 bg-slate-800/40 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-emerald-600/50 hover:text-emerald-300"
              >
                {t}
              </span>
            ))}
          </div>
        </section>

        {/* ── Footer / Attribution ───────────────────────────────── */}
        <div className="text-center text-xs text-slate-600">
          <p>
            Maintained by{" "}
            <a
              href="https://github.com/ABsUP"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400/70 hover:text-emerald-400"
            >
              @ABsUP
            </a>{" "}
            &middot;{" "}
            <a
              href="https://github.com/ABsUPs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400/70 hover:text-emerald-400"
            >
              @ABsUPs
            </a>
          </p>
          <p className="mt-1">OpenCodeABsUI/UX v1.0.0-EA</p>
        </div>
      </div>
    </div>
  );
}