import { Link } from "react-router-dom";

const FEATURES = [
  {
    icon: "🌐",
    title: "Universal / Unlimited Language Support",
    description:
      "Fully adaptable to any language, runtime, or framework — TypeScript, JavaScript, Rust, Go, Python, C/C++, Zig, Java, Kotlin, Swift, Ruby, PHP, Shell, Docker, and beyond.",
    color: "emerald",
  },
  {
    icon: "🛡️",
    title: "Pre-Mutation Snapshot Engine",
    description:
      "Automatically generates encrypted public forks or immutable snapshot branches (backup/opencode-ag-{timestamp}) prior to executing any code modifications.",
    color: "blue",
  },
  {
    icon: "✍️",
    title: "Dynamic Multi-Author Commit Standard",
    description:
      "Automatically attributes commits to ABsUP as Primary Author, OpenCodeWEB[bot] as Co-Author, and dynamically captures the active triggering user via ${{ github.actor }}.",
    color: "purple",
  },
  {
    icon: "🔍",
    title: "AST Code Audit & Ledger",
    description:
      "Inspects code syntax trees for errors, security flaws, and type mismatches, appending structured tasks to the project ledger for full traceability.",
    color: "amber",
  },
  {
    icon: "⚡",
    title: "Universal Build Verification",
    description:
      "Seamlessly executes language-agnostic build scripts, static linters, and custom verification suites across all runtime environments.",
    color: "cyan",
  },
  {
    icon: "🚫",
    title: "Direct Push Enforcement",
    description:
      "Mandates structured workflow routing through the ABsUP engine, preventing unauthorized direct branch pushes and ensuring audit trail integrity.",
    color: "rose",
  },
] as const;

const PERMISSIONS = [
  { name: "Contents", level: "Read & write", purpose: "Committing auto-fixes and backup branches" },
  { name: "Pull Requests", level: "Read & write", purpose: "Opening self-healing PRs" },
  { name: "Issues", level: "Read & write", purpose: "Posting AST audit summaries" },
  { name: "Workflows", level: "Read & write", purpose: "Running CI/CD automation pipelines" },
] as const;

function colorClasses(color: string) {
  const map: Record<string, { border: string; bg: string; badge: string }> = {
    emerald: { border: "border-emerald-700/40", bg: "bg-emerald-900/10", badge: "bg-emerald-600/20 text-emerald-300" },
    blue:    { border: "border-blue-700/40",    bg: "bg-blue-900/10",    badge: "bg-blue-600/20 text-blue-300" },
    purple:  { border: "border-purple-700/40",  bg: "bg-purple-900/10",  badge: "bg-purple-600/20 text-purple-300" },
    amber:   { border: "border-amber-700/40",   bg: "bg-amber-900/10",   badge: "bg-amber-600/20 text-amber-300" },
    cyan:    { border: "border-cyan-700/40",    bg: "bg-cyan-900/10",    badge: "bg-cyan-600/20 text-cyan-300" },
    rose:    { border: "border-rose-700/40",    bg: "bg-rose-900/10",    badge: "bg-rose-600/20 text-rose-300" },
  };
  return map[color] ?? map.emerald;
}

export default function AGFeatures() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="mx-auto max-w-4xl px-4 py-12">
        {/* Back link */}
        <Link
          to="/ag"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-emerald-400"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
          Back to AG Dashboard
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-emerald-400">
            Features
          </h1>
          <p className="mt-2 text-slate-400">
            OpenCodeWEB — Autonomous GitHub Bot capabilities
          </p>
        </div>

        {/* Feature cards */}
        <div className="mb-12 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon, title, description, color }) => {
            const c = colorClasses(color);
            return (
              <div
                key={title}
                className={`rounded-lg border ${c.border} ${c.bg} p-5 transition hover:brightness-110`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xl">{icon}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c.badge}`}>
                    {color}
                  </span>
                </div>
                <h3 className="mb-1.5 font-semibold text-slate-200">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-400">
                  {description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Permissions section */}
        <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-6">
          <h2 className="mb-4 text-xl font-semibold text-slate-200">
            Required Permissions
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            When installing the GitHub App, the following permissions are required:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-xs uppercase text-slate-500">
                  <th className="pb-2 pr-4 font-medium">Permission</th>
                  <th className="pb-2 pr-4 font-medium">Level</th>
                  <th className="pb-2 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map(({ name, level, purpose }) => (
                  <tr key={name} className="border-b border-slate-800 last:border-0">
                    <td className="py-3 pr-4 font-medium text-slate-200">
                      {name}
                    </td>
                    <td className="py-3 pr-4">
                      <code className="rounded bg-slate-700/60 px-1.5 py-0.5 font-mono text-xs text-emerald-300">
                        {level}
                      </code>
                    </td>
                    <td className="py-3 text-slate-400">{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Events */}
        <section className="mt-6 rounded-lg border border-slate-700 bg-slate-800/30 p-6">
          <h2 className="mb-4 text-xl font-semibold text-slate-200">
            Subscribed Events
          </h2>
          <div className="flex flex-wrap gap-2">
            {["Push", "Pull Request", "Workflow Dispatch"].map((event) => (
              <span
                key={event}
                className="rounded-full bg-slate-700/50 px-3 py-1 text-sm font-medium text-slate-300"
              >
                {event}
              </span>
            ))}
          </div>
        </section>

        {/* Legal nav */}
        <div className="mt-10 flex items-center justify-center gap-6 border-t border-slate-700 pt-6">
          <Link
            to="/ag/privacy"
            className="text-sm text-slate-500 transition-colors hover:text-emerald-400"
          >
            Privacy Policy
          </Link>
          <span className="text-slate-700">&middot;</span>
          <Link
            to="/ag/terms"
            className="text-sm text-slate-500 transition-colors hover:text-emerald-400"
          >
            Terms of Service
          </Link>
          <span className="text-slate-700">&middot;</span>
          <Link
            to="/ag/license"
            className="text-sm text-slate-500 transition-colors hover:text-emerald-400"
          >
            MIT License
          </Link>
        </div>
      </div>
    </div>
  );
}
