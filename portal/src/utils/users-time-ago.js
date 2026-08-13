/**
 * users-time-ago.js — Human-readable relative timestamps
 *
 * Language: JavaScript (plain, no TypeScript)
 * Purpose: Converts ISO date strings to fuzzy relative times like
 *          "3m ago", "2h ago", "1d ago". Extracted from Users.tsx
 *          to reduce TypeScript surface area per the polyglot mandate.
 */

/**
 * Format an ISO date string as a human-friendly relative time.
 *
 * @param {string} iso — ISO-8601 date string (e.g. "2026-07-27T10:30:00.000Z")
 * @returns {string} — e.g. "just now", "5m ago", "3h ago", "2d ago"
 */
export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
