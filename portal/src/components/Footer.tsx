import { useEffect } from "react";
import { Link } from "react-router-dom";

const FOOTER_ID = "absup-branding-footer";

declare global {
  interface Window {
    __absup_footer_integrity__?: boolean;
  }
}

/**
 * Runs a MutationObserver that ensures the branding footer
 * is never removed or hidden. On tamper, redirects to /F/.
 *
 * Hardened against false positives: a 2.5 s boot grace period plus a
 * 1 s debounce mean transient render states (cold loads, lazy chunks,
 * layout thrash) can never trigger a redirect — only a persistent,
 * deliberate removal/hide of the branding will.
 */
function initFooterIntegrityGuard() {
  if (typeof window === "undefined") return;
  if (window.__absup_footer_integrity__) return;
  window.__absup_footer_integrity__ = true;

  // Only redirect when the footer has been missing/hidden for a full second —
  // a genuine tamper persists, but transient states (cold-load layout thrash,
  // lazy chunk commits, first-paint offsets) do not.
  const REDIRECT_DELAY = 1000;
  // Skip health checks entirely during initial app boot so slow cold loads
  // (fonts, route chunks, stylesheets) can never false-positive.
  const GRACE_PERIOD = 2500;
  const bootedAt = Date.now();

  let redirectTimer: ReturnType<typeof setTimeout> | null = null;

  const checkFooterHealth = () => {
    if (Date.now() - bootedAt < GRACE_PERIOD) return;

    const footer = document.getElementById(FOOTER_ID);

    // Footer is present AND visible → cancel any pending redirect
    if (footer) {
      const style = window.getComputedStyle(footer);
      const isHidden =
        style.display === "none" ||
        style.opacity === "0" ||
        style.visibility === "hidden" ||
        footer.offsetHeight === 0;
      if (!isHidden) {
        if (redirectTimer) {
          clearTimeout(redirectTimer);
          redirectTimer = null;
        }
        return;
      }
    }

    // Footer is missing or hidden — debounce redirect so transient
    // render states don't false-positive.
    if (!redirectTimer) {
      redirectTimer = setTimeout(() => {
        redirectTimer = null;
        window.location.href = "/F/";
      }, REDIRECT_DELAY);
    }
  };

  const observer = new MutationObserver(() => {
    checkFooterHealth();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden"],
  });

  // Periodic health check as a safety net
  setInterval(checkFooterHealth, 5000);
}

export default function Footer() {
  useEffect(() => {
    initFooterIntegrityGuard();
  }, []);

  return (
    <footer
      id={FOOTER_ID}
      className="w-full border-t border-white/5 bg-surface-raised/50 py-4"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-center px-6">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white/90"
          aria-label="OpenCodeABsUI/UX - Powered by ABsUP.ORG"
        >
          <span aria-hidden="true">🗄️⚡💝</span>
          <span>~ ABsUP.ORG</span>
        </Link>
      </div>
    </footer>
  );
}
