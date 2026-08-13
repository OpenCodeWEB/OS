import { Link } from "react-router-dom";

export default function AGLicense() {
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
            MIT License
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Copyright &copy; 2026 OpenCodeWEB &amp; ABsUP Engine
          </p>
        </div>

        {/* Intro */}
        <div className="mb-8 rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <p className="leading-relaxed text-slate-300">
            Permission is hereby granted, free of charge, to any person
            obtaining a copy of this software and associated documentation
            files (the "Software"), to deal in the Software without
            restriction, including without limitation the rights to use, copy,
            modify, merge, publish, distribute, sublicense, and/or sell copies
            of the Software, and to permit persons to whom the Software is
            furnished to do so, subject to the following conditions.
          </p>
        </div>

        {/* License text */}
        <div className="space-y-8">
          {/* Condition */}
          <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-6">
            <h2 className="mb-3 text-lg font-semibold text-slate-200">
              Conditions
            </h2>
            <p className="leading-relaxed text-slate-400">
              The above copyright notice and this permission notice shall be
              included in all copies or substantial portions of the Software.
            </p>
          </section>

          {/* Disclaimer */}
          <section className="rounded-lg border border-amber-800/40 bg-amber-900/10 p-6">
            <h2 className="mb-3 text-lg font-semibold text-amber-300">
              Disclaimer of Warranty
            </h2>
            <p className="leading-relaxed text-slate-400">
              <strong className="text-slate-300">THE SOFTWARE IS PROVIDED "AS IS"</strong>
              , WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
              NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE AND NONINFRINGEMENT.
            </p>
          </section>

          {/* Liability */}
          <section className="rounded-lg border border-red-800/40 bg-red-900/10 p-6">
            <h2 className="mb-3 text-lg font-semibold text-red-300">
              Limitation of Liability
            </h2>
            <p className="leading-relaxed text-slate-400">
              <strong className="text-slate-300">IN NO EVENT SHALL</strong> THE
              AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
              OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
              OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
              SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
            </p>
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
          <Link
            to="/ag/terms"
            className="text-sm text-slate-500 transition-colors hover:text-emerald-400"
          >
            Terms of Service
          </Link>
          <span className="text-slate-700">&middot;</span>
          <span className="text-sm text-slate-500">
            MIT License
          </span>
        </div>
      </div>
    </div>
  );
}
