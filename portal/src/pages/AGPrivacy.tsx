import { Link } from "react-router-dom";

export default function AGPrivacy() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="mx-auto max-w-3xl px-4 py-12">
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
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Effective Date: July 29, 2026
          </p>
        </div>

        {/* Intro */}
        <div className="mb-8 rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <p className="leading-relaxed text-slate-300">
            OpenCodeWEB ("we", "bot", "service") is committed to protecting
            the privacy and security of your repositories.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-8">
          {/* 1 */}
          <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-6">
            <h2 className="mb-3 text-xl font-semibold text-slate-200">
              1. Data Collection
            </h2>
            <p className="leading-relaxed text-slate-400">
              OpenCodeWEB processes source code, commit metadata, and
              execution triggers solely to perform automated AST auditing,
              static code analysis, and snapshot backups.
            </p>
          </section>

          {/* 2 */}
          <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-6">
            <h2 className="mb-3 text-xl font-semibold text-slate-200">
              2. Data Storage & Retention
            </h2>
            <ul className="space-y-2 text-slate-400">
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                <span>
                  We do <strong className="text-slate-300">not</strong> store
                  your repository code on external servers.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                <span>
                  All operations execute in isolated ephemeral CI/CD
                  environments (GitHub Actions / Cloudflare Workers).
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                <span>
                  Temporary access tokens are short-lived and automatically
                  invalidated following workflow completion.
                </span>
              </li>
            </ul>
          </section>

          {/* 3 */}
          <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-6">
            <h2 className="mb-3 text-xl font-semibold text-slate-200">
              3. Third-Party Sharing
            </h2>
            <p className="leading-relaxed text-slate-400">
              We do not sell, share, or monetize repository data or metadata.
              Data processing occurs strictly within the authorized GitHub
              Organization boundary (
              <code className="rounded bg-slate-700/60 px-1.5 py-0.5 font-mono text-xs text-emerald-300">
                OpenCodeWEB
              </code>
              ).
            </p>
          </section>

          {/* 4 */}
          <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-6">
            <h2 className="mb-3 text-xl font-semibold text-slate-200">
              4. Contact & Opt-Out
            </h2>
            <p className="leading-relaxed text-slate-400">
              Users can revoke bot access at any time via{" "}
              <strong className="text-slate-300">GitHub App Settings</strong>{" "}
              &rarr; <strong className="text-slate-300">
                Installed GitHub Apps
              </strong>{" "}
              &rarr;{" "}
              <strong className="text-slate-300">OpenCodeWEB</strong> &rarr;{" "}
              <strong className="text-rose-400">Uninstall</strong>.
            </p>
          </section>
        </div>

        {/* Footer note */}
        <div className="mt-10 border-t border-slate-700 pt-6 text-center">
          <p className="text-xs text-slate-600">
            OpenCodeWEB &middot; ABsUP Engine &middot; July 2026
          </p>
        </div>
      </div>
    </div>
  );
}
