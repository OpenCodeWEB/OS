/**
 * OpenCodeWEB Worker — Cloudflare Worker entry point.
 *
 * Routes:
 *   GET  /health          → 200 OK (health check)
 *   GET  /installations   → Sync & list all GitHub App installations from API
 *   POST /webhook         → GitHub webhook handler (HMAC-verified)
 *
 * Secrets (set via `wrangler secret put`):
 *   WEBHOOK_SECRET   — GitHub webhook secret
 *   APP_ID           — GitHub App ID (numeric)
 *   PRIVATE_KEY      — GitHub App RSA private key (PEM)
 *   INSTALLATION_ID  — GitHub App installation ID
 *   ALLOWED_ACCOUNTS  — comma-separated GitHub logins allowed to drive the
 *                       bot (tenant isolation; app is public). Defaults to
 *                       OpenCodeWEB, ABsUP, ABsUPs when unset.
 *
 * KV namespace:
 *   AG_TOKENS_KV     — stores OAuth / installation tokens
 */

import type { Env } from "./_shared.js";
import { handleWebhook } from "./webhook/handler.js";
import { handleListInstallations } from "./installations.js";
import { handleCreateRepo } from "./repos.js";
import { handleSandboxRepo } from "./sandbox.js";
import { handleGetMetrics, handleUpdateMetrics, handleSyncMetrics, runDashboardSync } from "./metrics.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // ── CORS preflight ────────────────────────────────────────── //
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery, Authorization, X-Gateway-Token",
        },
      });
    }

    // ── GET /health ───────────────────────────────────────────── //
    // Whitelisted before gateway guard — called via Pages Function service binding
    if (method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "opencodewebsag-worker",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          },
        },
      );
    }

    // ── GET /installations ────────────────────────────────────── //
    // Whitelisted before gateway guard — called via Pages Function service binding
    if (method === "GET" && url.pathname === "/installations") {
      return handleListInstallations(env);
    }

    // ── GET /api/sandbox ──────────────────────────────────────── //
    // Read-only sandbox repo status — whitelisted for the Pages binding;
    // also reachable via the gateway proxy (/api/ag/sandbox → /sandbox).
    if (
      method === "GET" &&
      (url.pathname === "/api/sandbox" || url.pathname === "/sandbox")
    ) {
      return handleSandboxRepo(env, request);
    }

    // ── GET /api/metrics/live ─────────────────────────────────── //
    // Public read (no credentials) — self-authenticating via KV guard on POST.
    // Called via gateway proxy AND Pages Function service binding.
    if (method === "GET" && url.pathname === "/api/metrics/live") {
      return handleGetMetrics(env);
    }

    // ── POST /api/metrics/update ──────────────────────────────── //
    // HMAC-authenticated write (X-Hub-Signature-256) — no gateway token needed.
    if (method === "POST" && url.pathname === "/api/metrics/update") {
      return handleUpdateMetrics(env, request);
    }

    // ── POST /api/metrics/sync ────────────────────────────────── //
    // HMAC-authenticated manual trigger of the daily GitHub sync.
    if (method === "POST" && url.pathname === "/api/metrics/sync") {
      return handleSyncMetrics(env, request);
    }

    // ── Gateway-only access check ─────────────────────────────── //
    // All requests MUST come through opencodeweb.xup.workers.dev.
    // Direct access to this worker URL is blocked.
    const gatewayToken = request.headers.get("X-Gateway-Token");
    if (env.INTERNAL_GATEWAY_TOKEN && gatewayToken !== env.INTERNAL_GATEWAY_TOKEN) {
      return new Response(
        JSON.stringify({
          error: "Direct access denied",
          message: "This worker is only accessible via opencodeweb.xup.workers.dev",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // ── POST /repos ──────────────────────────────────────────────── //
    // Create a repository on behalf of an installation (orgs only).
    // Protected by the gateway guard — only reachable via the gateway.
    if (method === "POST" && url.pathname === "/repos") {
      return handleCreateRepo(env, request);
    }

    // ── POST /webhook ─────────────────────────────────────────── //
    if (method === "POST" && url.pathname === "/webhook") {
      const event = request.headers.get("X-GitHub-Event") ?? "";
      const delivery = request.headers.get("X-GitHub-Delivery") ?? "";
      const signature = request.headers.get("X-Hub-Signature-256");
      const body = await request.text();

      if (!event || !delivery) {
        return new Response("Missing X-GitHub-Event or X-GitHub-Delivery header", { status: 400 });
      }

      return handleWebhook(env, event, delivery, body, signature, ctx);
    }

    // ── 404 ───────────────────────────────────────────────────── //
    return new Response("Not found", { status: 404 });
  },

  /**
   * Cron: daily 00:00 UTC — recompute Live Analytics + Contributor
   * Leaderboard from the GitHub API (authoritative daily snapshot).
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const started = Date.now();
    const result = await runDashboardSync(env);
    if (result.ok && result.data) {
      const s = result.data.system_stats;
      console.log(
        `[sync] dashboard refreshed in ${Date.now() - started}ms ` +
          `commits=${s.total_commits} backups=${s.total_backups} ` +
          `bugs=${s.bugs_fixed} contributors=${result.data.contributors.length}`,
      );
    } else {
      console.error(`[sync] daily sync failed: ${result.error}`);
    }
  },
} satisfies ExportedHandler<Env>;
