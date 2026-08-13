import { Link } from "react-router-dom";

export default function AGTerms() {
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
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Effective Date: July 29, 2026
          </p>
        </div>

        {/* Intro */}
        <div className="mb-8 rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <p className="leading-relaxed text-slate-300">
            By installing and authorizing OpenCodeWEB, you agree to the
            following terms.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-8">
          {/* 1 */}
          <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-6">
            <h2 className="mb-3 text-xl font-semibold text-slate-200">
              1. License & Usage
            </h2>
            <p className="leading-relaxed text-slate-400">
              OpenCodeWEB is granted permission to inspect repository
              contents, generate snapshot backup branches (
              <code className="rounded bg-slate-700/60 px-1.5 py-0.5 font-mono text-xs text-emerald-300">
                backup/opencode-ag-*
              </code>
              ), and submit automated commits using the configured
              dual/triple co-authorship syntax.
            </p>
          </section>

          {/* 2 */}
          <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-6">
            <h2 className="mb-3 text-xl font-semibold text-slate-200">
              2. Limitation of Liability
            </h2>
            <p className="leading-relaxed text-slate-400">
              OpenCodeWEB is provided{" "}
              <strong className="text-slate-300">"as is"</strong> without
              warranty of any kind. While the bot enforces mandatory
              pre-mutation snapshots prior to code modifications, the
              maintainers are not liable for unintended code mutations or
              build failures.
            </p>
          </section>

          {/* 3 */}
          <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-6">
            <h2 className="mb-3 text-xl font-semibold text-slate-200">
              3. Acceptable Use
            </h2>
            <p className="leading-relaxed text-slate-400">
              You agree not to use OpenCodeWEB to:
            </p>
            <ul className="mt-3 space-y-2 text-slate-400">
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                <span>
                  Distribute malicious code
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                <span>
                  Execute unauthorized crypto mining
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                <span>
                  Bypass security boundaries outside your designated
                  organization scope
                </span>
              </li>
            </ul>
          </section>
        </div>

        {/* Legal nav */}
        <div className="mt-10 flex items-center justify-center gap-6 border-t border-slate-700 pt-6">
          <Link
            to="/ag/privacy"
            className="text-sm text-slate-500 transition-colors hover:text-emerald-400"
          >
            Privacy Policy
          </Link>
          <span className="text-slate-700">&middot;</span>
          <span className="text-sm text-slate-500">
            Terms of Service
          </span>
        </div>
      </div>
    </div>
  );
}
