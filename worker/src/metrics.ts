/**
 * AG Metrics & Contributor Leaderboard — Cloudflare KV-backed telemetry.
 *
 * Routes:
 *   GET  /api/metrics/live    → public, edge-cached read of dashboard data
 *   POST /api/metrics/update  → HMAC-authenticated write (backup | bug_fix | commit)
 *
 * Storage: KV namespace `AG_METRICS`, key `dashboard_data`.
 *
 * The write path mirrors GitHub's webhook HMAC scheme
 * (X-Hub-Signature-256) so GitHub Actions / agents can sign payloads
 * with the same secret tooling they already use for webhooks.
 */

import type { Env } from "./_shared.js";
import { generateAppJwt, getInstallationToken } from "../../src/auth/github.js";
import type { GitHubAppConfig } from "../../src/auth/github.js";
import { githubFetch } from "../../src/github-api.js";

const KV_KEY = "dashboard_data";
const GITHUB_API = "https://api.github.com";

/** CORS origin allowed for browser access (Pages SPA). */
const ALLOWED_ORIGIN = "https://pocwu.pages.dev";

export type MetricsEvent = "backup" | "bug_fix" | "commit";

export interface Contributor {
  username: string;
  role: string;
  avatar: string;
  commits_count: number;
  last_active: string;
}

export interface MetricsData {
  system_stats: {
    total_backups: number;
    bugs_fixed: number;
    total_commits: number;
    last_updated: string;
  };
  contributors: Contributor[];
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

export function emptyMetrics(): MetricsData {
  return {
    system_stats: {
      total_backups: 0,
      bugs_fixed: 0,
      total_commits: 0,
      last_updated: new Date(0).toISOString(),
    },
    contributors: [],
  };
}

/** Verify GitHub-style `X-Hub-Signature-256: sha256=<hex>` (constant-time). */
export async function verifyGitHubSignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const algo = { name: "HMAC", hash: "SHA-256" };
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    algo,
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  if (expected.length !== signatureHeader.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return result === 0;
}

/** Sanitise a GitHub login so it is safe for JSON/KV round-trips. */
export function sanitizeLogin(actor: string): string {
  return (actor || "").replace(/[^\w-]/g, "").slice(0, 64);
}

/** Read the current metrics blob (empty defaults when unset/corrupt). */
export async function readMetrics(env: Env): Promise<MetricsData> {
  if (!env.AG_METRICS) return emptyMetrics();
  try {
    const raw = await env.AG_METRICS.get(KV_KEY);
    if (!raw) return emptyMetrics();
    const parsed = JSON.parse(raw) as MetricsData;
    if (!parsed.system_stats || !Array.isArray(parsed.contributors)) {
      return emptyMetrics();
    }
    return parsed;
  } catch {
    return emptyMetrics();
  }
}

/** Apply one event to the metrics blob and persist it. */
async function applyAndPersist(
  env: Env,
  event: MetricsEvent,
  actor: string,
): Promise<MetricsData | null> {
  if (!env.AG_METRICS) return null;

  const data = await readMetrics(env);
  const now = new Date().toISOString();
  const s = data.system_stats;

  if (event === "backup") s.total_backups += 1;
  if (event === "bug_fix") s.bugs_fixed += 1;
  s.total_commits += 1;
  s.last_updated = now;

  // Contributor upsert (case-insensitive on username).
  // Bot logins (e.g. "opencodeweb[bot]") resolve through the identity map
  // so webhook/pipeline events merge into the branded OpenCodeWEB entry
  // instead of creating sanitized junk entries ("opencodewebbot").
  const bot = BOT_IDENTITY_MAP[actor];
  const display = bot ? bot.username : sanitizeLogin(actor) || "anonymous";
  const role = bot ? bot.role : "Co-Author / Contributor";
  const avatar = bot
    ? OPENCODEWEB_AVATAR
    : `https://github.com/${display}.png`;
  const existing = data.contributors.find(
    (c) => c.username.toLowerCase() === display.toLowerCase(),
  );
  if (existing) {
    existing.commits_count += 1;
    existing.last_active = now;
  } else {
    data.contributors.push({
      username: display,
      role,
      avatar,
      commits_count: 1,
      last_active: now,
    });
  }

  // Sort by commits desc, then last_active desc
  data.contributors.sort(
    (a, b) =>
      b.commits_count - a.commits_count ||
      b.last_active.localeCompare(a.last_active),
  );

  await env.AG_METRICS.put(KV_KEY, JSON.stringify(data));
  return data;
}

/* ------------------------------------------------------------------ */
/*  Route handlers                                                     */
/* ------------------------------------------------------------------ */

/** GET /api/metrics/live — public read with edge caching + CORS. */
export async function handleGetMetrics(env: Env): Promise<Response> {
  const data = await readMetrics(env);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Hub-Signature-256",
    },
  });
}

/**
 * POST /api/metrics/update — HMAC-protected write.
 *
 * Headers: `X-Hub-Signature-256: sha256=<hex>` over the raw body.
 * Secret: `METRICS_WEBHOOK_SECRET` if set, else `WEBHOOK_SECRET`.
 * Body:   { "event": "backup" | "bug_fix" | "commit", "actor": "<login>" }
 */
export async function handleUpdateMetrics(
  env: Env,
  request: Request,
): Promise<Response> {
  const secret = env.METRICS_WEBHOOK_SECRET ?? env.WEBHOOK_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: "Metrics secret not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("X-Hub-Signature-256");

  const valid = await verifyGitHubSignature(secret, rawBody, signature);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: { event?: string; actor?: string };
  try {
    payload = JSON.parse(rawBody) as { event?: string; actor?: string };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const event = payload.event;
  const actor = payload.actor;
  if (event !== "backup" && event !== "bug_fix" && event !== "commit") {
    return new Response(
      JSON.stringify({ error: "event must be backup | bug_fix | commit" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!actor || !sanitizeLogin(actor)) {
    return new Response(
      JSON.stringify({ error: "actor (GitHub login) is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const data = await applyAndPersist(env, event, actor);
  if (!data) {
    return new Response(
      JSON.stringify({ error: "AG_METRICS KV not bound" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, totals: data.system_stats }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Record a metrics event from internal processing (webhook pipeline).
 * Fire-and-forget: never throws, logs failures only.
 */
export async function recordMetricsEvent(
  env: Env,
  event: MetricsEvent,
  actor: string,
): Promise<void> {
  try {
    await applyAndPersist(env, event, actor);
  } catch (err) {
    console.error(`[metrics] record ${event} failed: ${err}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Daily sync (cron 00:00 UTC) — authoritative GitHub recompute       */
/* ------------------------------------------------------------------ */

interface GitHubRepo {
  full_name: string;
  name: string;
  private: boolean;
  fork: boolean;
}

interface GitHubContributor {
  login: string | null;
  avatar_url: string | null;
  contributions: number;
}

interface GitHubCommit {
  author: { login: string | null; avatar_url?: string | null } | null;
  commit: { author: { date: string } };
}

/**
 * Automation identities displayed in the leaderboard as OpenCodeWEB.
 * GitHub's /contributors endpoint excludes bot accounts, and its `author`
 * query filter does not resolve `[bot]` logins — exact per-bot counts use
 * the bot user's noreply email ({user_id}+{slug}[bot]@users.noreply.github.com).
 */
const BOT_IDENTITY_MAP: Record<
  string,
  { username: string; role: string; email: string }
> = {
  "github-actions[bot]": {
    username: "OpenCodeWEB",
    role: "Bot / Automation",
    email: "41898282+github-actions[bot]@users.noreply.github.com",
  },
  "opencodewebsag[bot]": {
    username: "OpenCodeWEB",
    role: "Bot / Automation",
    email: "310317445+opencodewebsag[bot]@users.noreply.github.com",
  },
  "opencodeweb[bot]": {
    username: "OpenCodeWEB",
    role: "Bot / Automation",
    email: "311941023+opencodeweb[bot]@users.noreply.github.com",
  },
};

/** Public avatar for the OpenCodeWEB GitHub App bot users (org avatar). */
const OPENCODEWEB_AVATAR =
  "https://avatars.githubusercontent.com/u/310319632?v=4";

/**
 * Aggregate real leaderboard stats from the GitHub API using an
 * installation access token:
 *   - contributors        → /installation/repositories + /repos/{r}/contributors
 *   - last_active         → most recent commit date per author (per repo, 100 newest)
 *   - total_commits       → sum of GitHub `contributions` (default-branch commits)
 *   - total_backups       → count of `backup/opencode-*` branches across repos
 *
 * Pure function (token in, data out) — never touches KV.
 */
export async function aggregateGitHubStats(
  token: string,
): Promise<MetricsData> {
  const reposResp = await githubFetch(
    `${GITHUB_API}/installation/repositories?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "OpenCodeWEB/1.0",
      },
    },
  );
  if (!reposResp.ok) {
    throw new Error(
      `Failed to list installation repositories: ${reposResp.status} ${await reposResp.text()}`,
    );
  }
  const reposData = (await reposResp.json()) as {
    repositories: GitHubRepo[];
  };

  const contributors = new Map<
    string,
    { username: string; commits: number; avatar: string; lastActive: string }
  >();
  // Raw bot logins seen in commits windows → exact counts (per repo via Link header).
  const botCounts = new Map<string, number>();
  const botMeta = new Map<
    string,
    { avatar: string; lastActive: string }
  >();
  let totalBackups = 0;

  for (const repo of reposData.repositories) {
    // Skip forks: backup snapshots (AG-backup-*/UI-backup-*/SandBox-backup-*)
    // and imported forks would double-count every commit and blow the
    // Worker 50-subrequest invocation limit.
    if (repo.fork) {
      console.log(`[sync] skip fork ${repo.full_name}`);
      continue;
    }
    try {
      // ── Contributor commit counts (default branch) ──────────────── //
      const cResp = await githubFetch(
        `${GITHUB_API}/repos/${repo.full_name}/contributors?per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "OpenCodeWEB/1.0",
          },
        },
      );
      if (cResp.ok) {
        const list = (await cResp.json()) as GitHubContributor[];
        for (const c of list) {
          const raw = c.login ?? "";
          // Bot accounts are counted exactly via the email-filtered path —
          // skip them here to avoid duplicate leaderboard entries.
          if (raw.endsWith("[bot]")) continue;
          const login = sanitizeLogin(raw);
          if (!login) continue; // anonymous contributors are not leaderboard members
          const avatar =
            c.avatar_url ?? `https://github.com/${login}.png`;
          const cur = contributors.get(login);
          if (cur) {
            cur.commits += c.contributions;
          } else {
            contributors.set(login, {
              username: login,
              commits: c.contributions,
              avatar,
              lastActive: new Date(0).toISOString(),
            });
          }
        }
      }

      // ── Last-active timestamps (100 newest commits per repo) ────── //
      const mResp = await githubFetch(
        `${GITHUB_API}/repos/${repo.full_name}/commits?per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "OpenCodeWEB/1.0",
          },
        },
      );
      if (mResp.ok) {
        const commits = (await mResp.json()) as GitHubCommit[];
        // bot login → occurrences inside the 100-commit window (fallback)
        const windowBots = new Map<string, number>();
        for (const c of commits) {
          const rawLogin = c.author?.login ?? "";
          const date = c.commit?.author?.date;
          if (!rawLogin || !date) continue;

          // Bot authors are excluded by /contributors — count them separately.
          if (rawLogin.endsWith("[bot]")) {
            const meta = botMeta.get(rawLogin) ?? {
              avatar: "",
              lastActive: new Date(0).toISOString(),
            };
            if (c.author?.avatar_url) meta.avatar = c.author.avatar_url;
            if (date > meta.lastActive) meta.lastActive = date;
            botMeta.set(rawLogin, meta);
            windowBots.set(rawLogin, (windowBots.get(rawLogin) ?? 0) + 1);
            continue;
          }

          const login = sanitizeLogin(rawLogin);
          if (!login) continue;
          const cur = contributors.get(login);
          if (cur && date > cur.lastActive) cur.lastActive = date;
        }

        // Exact bot totals via email-filtered pagination (login filter does
        // not resolve [bot] logins). Falls back to the window count.
        for (const [bot, windowCount] of windowBots) {
          const mapped = BOT_IDENTITY_MAP[bot];
          if (!mapped) continue;
          const lResp = await githubFetch(
            `${GITHUB_API}/repos/${repo.full_name}/commits?author=${encodeURIComponent(mapped.email)}&per_page=1`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "OpenCodeWEB/1.0",
              },
            },
          );
          if (!lResp.ok) {
            botCounts.set(bot, (botCounts.get(bot) ?? 0) + windowCount);
            continue;
          }
          const link = lResp.headers.get("Link") ?? "";
          // GitHub quirks: exactly-1 result reports rel="last" page=0;
          // multi-page reports the real last page number.
          const last = link.match(/page=(\d+)>; rel="last"/);
          const page = last ? parseInt(last[1], 10) : 0;
          const body = (await lResp.json()) as GitHubCommit[];
          const exact = Math.max(page, body.length > 0 ? 1 : 0, windowCount);
          botCounts.set(bot, (botCounts.get(bot) ?? 0) + exact);
        }
      }

      // ── Real backup snapshot count ──────────────────────────────── //
      const bResp = await githubFetch(
        `${GITHUB_API}/repos/${repo.full_name}/branches?per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "OpenCodeWEB/1.0",
          },
        },
      );
      if (bResp.ok) {
        const branches = (await bResp.json()) as { name: string }[];
        totalBackups += branches.filter((b) =>
          b.name.startsWith("backup/opencode-"),
        ).length;
      }
    } catch (err) {
      // One repo failing must not kill the whole daily sync.
      console.error(`[metrics] sync skip repo ${repo.full_name}: ${err}`);
    }
  }

  // Merge mapped bot identities into the leaderboard (e.g. github-actions[bot]
  // and opencodewebsag[bot] both display as OpenCodeWEB).
  const mergedBots = new Map<
    string,
    { count: number; avatar: string; lastActive: string; role: string }
  >();
  for (const [rawLogin, count] of botCounts) {
    const mapped = BOT_IDENTITY_MAP[rawLogin];
    if (!mapped) continue;
    const meta = botMeta.get(rawLogin) ?? {
      avatar: OPENCODEWEB_AVATAR,
      lastActive: new Date(0).toISOString(),
    };
    const cur = mergedBots.get(mapped.username);
    if (cur) {
      cur.count += count;
      if (meta.lastActive > cur.lastActive) cur.lastActive = meta.lastActive;
      if (!cur.avatar) cur.avatar = meta.avatar;
    } else {
      mergedBots.set(mapped.username, {
        count,
        avatar: meta.avatar || OPENCODEWEB_AVATAR,
        lastActive: meta.lastActive,
        role: mapped.role,
      });
    }
  }

  const list = [...contributors.values()]
    .map((c) => ({
      username: c.username,
      role: "Co-Author / Contributor",
      avatar: c.avatar,
      commits_count: c.commits,
      last_active: c.lastActive,
    }))
    .concat(
      [...mergedBots.entries()].map(([username, b]) => ({
        username,
        role: b.role,
        avatar: b.avatar,
        commits_count: b.count,
        last_active: b.lastActive,
      })),
    )
    .sort(
      (a, b) =>
        b.commits_count - a.commits_count ||
        b.last_active.localeCompare(a.last_active),
    );

  return {
    system_stats: {
      total_backups: totalBackups,
      bugs_fixed: 0, // preserved from existing data by runDashboardSync
      total_commits: list.reduce((s, c) => s + c.commits_count, 0),
      last_updated: new Date().toISOString(),
    },
    contributors: list,
  };
}

/**
 * Run the daily dashboard sync (cron 00:00 UTC or manual POST):
 * obtains an installation token, recomputes authoritative stats from
 * GitHub, preserves the `bugs_fixed` accumulator, and rewrites KV.
 * Never corrupts KV on failure — the previous snapshot stays intact.
 */
export async function runDashboardSync(
  env: Env,
): Promise<{ ok: boolean; data?: MetricsData; error?: string }> {
  try {
    if (!env.AG_METRICS) {
      return { ok: false, error: "AG_METRICS KV not bound" };
    }
    const appId = env.APP_ID;
    const privateKey = env.PRIVATE_KEY;
    const installationId = env.INSTALLATION_ID;
    if (!appId || !privateKey || !installationId) {
      return { ok: false, error: "GitHub App secrets not configured" };
    }

    const config: GitHubAppConfig = { appId, privateKey, installationId };
    const jwt = await generateAppJwt(config);
    const { token } = await getInstallationToken(jwt, installationId);

    const fresh = await aggregateGitHubStats(token);

    // Preserve the event-accumulated bug-fix counter across resyncs.
    const existing = await readMetrics(env);
    fresh.system_stats.bugs_fixed = existing.system_stats.bugs_fixed;

    await env.AG_METRICS.put(KV_KEY, JSON.stringify(fresh));
    return { ok: true, data: fresh };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * POST /api/metrics/sync — HMAC-protected manual trigger of the daily
 * sync (same auth scheme as /api/metrics/update). Primarily an ops
 * tool; the cron trigger is the automatic path.
 */
export async function handleSyncMetrics(
  env: Env,
  request: Request,
): Promise<Response> {
  const secret = env.METRICS_WEBHOOK_SECRET ?? env.WEBHOOK_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: "Metrics secret not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("X-Hub-Signature-256");

  const valid = await verifyGitHubSignature(secret, rawBody, signature);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await runDashboardSync(env);
  if (!result.ok || !result.data) {
    return new Response(
      JSON.stringify({ error: result.error ?? "sync failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, totals: result.data.system_stats }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
