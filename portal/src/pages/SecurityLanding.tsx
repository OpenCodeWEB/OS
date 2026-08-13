import { useState } from "react";

/* ------------------------------------------------------------------ */
/*  Feature data                                                       */
/* ------------------------------------------------------------------ */

interface Feature {
  icon: string;
  title: string;
  desc: string;
  route?: string;
}

const FEATURES: Feature[] = [
  {
    icon: "🌐",
    title: "3D Global Dashboard",
    desc: "Interactive Cobe WebGL globe with live node metrics, real-time telemetry, and top leaderboards — the command center of your infrastructure.",
    route: "/",
  },
  {
    icon: "📡",
    title: "GunDB P2P Graph Network",
    desc: "Decentralized, offline-first peer-to-peer data synchronization. CRDT conflict resolution, SEA end-to-end encryption, and IndexedDB persistence for zero-cost real-time sync across all your devices.",
  },
  {
    icon: "📱",
    title: "Multi-Device Management",
    desc: "Register and monitor all your active nodes — PC, Mac, Linux, Docker, VPS, Termux. Live WebSocket telemetry, multi-stream logs, and offline snapshot fallback via GitHub Private Fork.",
    route: "/u/{username}",
  },
  {
    icon: "🏢",
    title: "Company Orchestration",
    desc: "AI workforce management with 33+ multi-agent roles. Organization showcase pages with live token throughput gauges, agent activity metrics, and public project cards.",
    route: "/o/{org}/{company}",
  },
  {
    icon: "🔬",
    title: "Isolated Sandboxes",
    desc: "Multi-tenant sandbox environments with auto-backup, PREVIEW mode, and one-click publish. Strict filesystem isolation with human-in-the-loop escalation guardrails.",
    route: "/s/{org}/{project}",
  },
  {
    icon: "🧩",
    title: "Template Marketplace",
    desc: "Discover and share multi-agent templates and OpenCode setups. Search by category, filter by stack, and clone with one click.",
    route: "/T",
  },
  {
    icon: "👥",
    title: "Users Directory",
    desc: "Browse all registered users of the platform. See who's online, view their profiles and connected devices, and discover the community behind the infrastructure.",
    route: "/U",
  },
  {
    icon: "🗄️",
    title: "Server Directory",
    desc: "A public registry of all active GunDB relays, sandbox preview servers, and daemon nodes. Register your own server or discover community-run infrastructure with real-time status and uptime tracking.",
    route: "/S",
  },
  {
    icon: "💬",
    title: "Community Hub",
    desc: "Interactive discussion forum powered by GitHub Discussions API + local D1 database. Create, edit, delete posts and comments with real-time GunDB P2P sync across all connected users.",
    route: "/C",
  },
  {
    icon: "🔐",
    title: "GitHub OAuth + E2EE Mesh",
    desc: "Secure authentication via GitHub OAuth with derived SEA keypairs for end-to-end encrypted peer-to-peer communication. Every session is bound to a cryptographic identity.",
  },
  {
    icon: "⚡",
    title: "Hybrid Cloud Compute",
    desc: "Split execution between local heavy compute (code generation, refactoring, security) and 24/7 serverless cloud runtime. Multi-account fallback rotation for zero-cost uptime.",
  },
  {
    icon: "🤖",
    title: "Background Daemon Engine",
    desc: "OS-native persistent services: systemd (Linux), launchd (macOS), Task Scheduler (Windows), Termux sticky notification (Android), Docker restart policy (VPS).",
  },
  {
    icon: "🛡️",
    title: "Branding & Anti-Tamper",
    desc: "Mandatory footer injection with MutationObserver DOM integrity guard. If the branding is removed or hidden, the page instantly redirects to this security landing.",
  },
  {
    icon: "🔁",
    title: "Bi-Directional DB Sync",
    desc: "Automatic state synchronization between Cloudflare D1, KV, and local databases. Periodic snapshots persisted to GitHub Private Fork for offline fallback rendering.",
  },
];

/* ------------------------------------------------------------------ */
/*  Route map                                                          */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Tech stack badges                                                  */
/* ------------------------------------------------------------------ */

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

function FeatureCard({ feature }: { feature: Feature }) {
  const [hovered, setHovered] = useState(false);

  const content = (
    <>
      <div className="mb-3 text-2xl">{feature.icon}</div>
      <h3 className="mb-2 text-base font-semibold text-white/90">
        {feature.title}
      </h3>
      <p className="text-sm text-white/50 leading-relaxed">{feature.desc}</p>
      {feature.route && (
        <div className="mt-3 inline-flex items-center gap-1 text-xs text-brand-400">
          <code className="rounded bg-brand-400/10 px-1.5 py-0.5">
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
        className={`group rounded-xl border p-5 transition-all duration-200 ${
          hovered
            ? "border-brand-500/40 bg-brand-500/5 -translate-y-0.5"
            : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
        }`}
      >
        {content}
      </a>
    );
  }

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
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
    <div className="mx-auto max-w-6xl px-6 py-16 pb-32">
      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="mb-20 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/20">
          <span className="text-2xl font-bold text-white">A</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          OpenCode<span className="text-brand-400">ABsUI</span>
          <span className="text-white/30">/UX</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-white/40 leading-relaxed">
          Enterprise-grade OpenCode ecosystem plugin and hybrid infrastructure
          manager — bridging local developer environments with a 24/7 serverless
          cloud runtime via a decentralized GunDB P2P data synchronization
          layer.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href="/"
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-500 hover:shadow-lg hover:shadow-brand-500/25"
          >
            Launch Dashboard
          </a>
          <a
            href="https://github.com/OpenCodeWEB/UI"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-white/10 px-5 py-2.5 text-sm font-semibold text-white/60 transition-all hover:border-white/20 hover:text-white"
          >
            View on GitHub
          </a>
          <button
            onClick={() => setShowRestricted(!showRestricted)}
            className="rounded-lg border border-amber-500/20 px-5 py-2.5 text-sm font-medium text-amber-400/70 transition-all hover:border-amber-500/40 hover:text-amber-400"
          >
            ⚠ Security Notice
          </button>
        </div>

        {/* Collapsible security notice */}
        {showRestricted && (
          <div className="mx-auto mt-6 max-w-xl rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-left">
            <div className="mb-2 flex items-center gap-2 text-amber-400">
              <span className="text-lg">🔒</span>
              <span className="text-sm font-semibold">Access Restricted</span>
            </div>
            <p className="text-xs text-amber-300/60 leading-relaxed">
              You may have landed here due to DOM tampering detection (branding
              integrity check failed), invalid or expired credentials, or an
              attempt to access a restricted namespace without proper
              authorization. If you believe this is an error, please return home
              and try again.
            </p>
          </div>
        )}
      </div>

      {/* ── Route Map ───────────────────────────────────────────── */}
      <section className="mb-20">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-white/90">Route Map</h2>
          <p className="mt-1 text-sm text-white/40">
            Every route on{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 text-brand-400">
              pocwu.pages.dev
            </code>
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROUTES.map((r) => (
            <a
              key={r.path}
              href={r.path}
              className="group flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10 hover:bg-white/[0.04]"
            >
              <div className="shrink-0">
                <code className="rounded-md bg-brand-600/10 px-2 py-1 text-xs font-medium text-brand-400">
                  {r.path}
                </code>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-white/80 group-hover:text-brand-400 transition-colors">
                  {r.title}
                </div>
                <div className="text-xs text-white/30">{r.desc}</div>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────── */}
      <section className="mb-20">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-white/90">
            Everything It Does
          </h2>
          <p className="mt-1 text-sm text-white/40">
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
      <section className="mb-20">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-white/90">Architecture</h2>
          <p className="mt-1 text-sm text-white/40">
            Three-tier decentralized infrastructure
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-white/[0.02] p-6">
          <pre className="text-xs text-white/50 leading-relaxed whitespace-pre font-mono">
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
      <section className="mb-20">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-white/90">Tech Stack</h2>
          <p className="mt-1 text-sm text-white/40">
            Built on modern, free-tier technologies
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {TECH.map((t) => (
            <span
              key={t}
              className="rounded-full border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-white/50 transition-colors hover:border-white/10 hover:text-white/70"
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* ── Footer / Attribution ───────────────────────────────── */}
      <div className="text-center text-xs text-white/20">
        <p>
          Maintained by{" "}
          <a
            href="https://github.com/ABsUP"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-400/60 hover:text-brand-400"
          >
            @ABsUP
          </a>{" "}
          &middot;{" "}
          <a
            href="https://github.com/ABsUPs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-400/60 hover:text-brand-400"
          >
            @ABsUPs
          </a>
        </p>
        <p className="mt-1">OpenCodeABsUI/UX v1.0.0-EA</p>
      </div>
    </div>
  );
}
