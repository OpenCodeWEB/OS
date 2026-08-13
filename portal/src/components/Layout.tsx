import { useState, useRef, useEffect, Suspense } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Footer from "./Footer";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/T", label: "Templates" },
  { to: "/C", label: "Community" },
  { to: "/S", label: "Servers" },
  { to: "/U", label: "Users" },
  { to: "/ag", label: "Agent" },
  { to: "/F", label: "Features" },
] as const;

// Minimal loading state — keeps header + footer mounted during lazy loads
function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
        <span className="text-sm text-white/30">Loading…</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  User avatar + dropdown                                             */
/* ------------------------------------------------------------------ */

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
        aria-label={`User menu${open ? " open" : ""}`}
      >
        <img
          src={user.avatar}
          alt={user.login}
          className="h-7 w-7 rounded-full"
        />
        <span className="hidden text-sm font-medium text-white/80 md:inline">
          {user.login}
        </span>
        <svg
          className={`hidden h-3 w-3 text-white/40 transition-transform md:block ${
            open ? "rotate-180" : ""
          }`}
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
        <div className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-white/10 bg-surface-raised py-1 shadow-xl shadow-black/30">
          <div className="border-b border-white/5 px-4 py-2.5">
            <p className="truncate text-sm font-medium text-white/90">
              {user.name}
            </p>
            <p className="truncate text-xs text-white/40">@{user.login}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-sm text-white/50 transition-colors hover:bg-white/5 hover:text-white/80"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
              />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Layout                                                             */
/* ------------------------------------------------------------------ */

export default function Layout() {
  const location = useLocation();
  const { user, loading, login } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-surface/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-bold tracking-tight"
          >
            <span className="text-brand-400">OpenCode</span>
            <span className="text-white/40">ABsUI</span>
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => {
              const isActive = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-white/50 hover:bg-white/5 hover:text-white/80"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {/* Auth area */}
            {loading ? (
              <div className="h-7 w-7 animate-pulse rounded-full bg-white/5" />
            ) : user ? (
              <UserMenu />
            ) : (
              <button
                onClick={login}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:border-brand-500/40 hover:text-white"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <span>Login with GitHub</span>
              </button>
            )}
          </div>
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>

      {/* Mobile nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-white/5 bg-surface/95 backdrop-blur-xl md:hidden">
        {NAV_LINKS.map((link) => {
          const isActive = location.pathname === link.to;
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? "text-brand-400"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
        {user && (
          <Link
            to={`/u/${user.login}`}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium text-white/40 hover:text-white/60"
          >
            Profile
          </Link>
        )}
      </nav>

      {/* Mandatory branding footer */}
      <Footer />
    </div>
  );
}
