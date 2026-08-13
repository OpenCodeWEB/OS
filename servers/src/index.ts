/**
 * OpenCodeWEB Core Server Gateway
 *
 * Deployed at: https://opencodewebservers.xup.workers.dev
 * Source repo: https://github.com/OpenCodeWEB/Servers
 *
 * Routes:
 *   GET  /api/sandbox/preview  — Owner-only sandbox preview stage
 *                                 (Authorization: Bearer <OWNER_SECRET_TOKEN>)
 *   GET  /api/public/list      — Public auto-index registry for pocwu.pages.dev/S
 *   GET  /health               — Gateway health probe
 *
 * Secrets:
 *   WEBHOOK_SECRET       — GitHub webhook verification secret
 *   OWNER_SECRET_TOKEN   — Owner (ABsUP) verification token for private
 *                          sandbox preview access
 */

export interface Env {
  WEBHOOK_SECRET: string;
  OWNER_SECRET_TOKEN: string; // Cloudflare Secret set for Owner verification
}

const FRONTEND_ORIGIN = "https://pocwu.pages.dev";
const SANDBOX_REPO = "https://github.com/OpenCodeWEB/SandBox";
const SERVERS_REPO = "https://github.com/OpenCodeWEB/Servers";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS Preflight Configuration
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Hub-Signature-256",
        },
      });
    }

    // 2. STAGE 1: PRIVATE OWNER SANDBOX PREVIEW ROUTE (OpenCodeWEB/SandBox)
    if (url.pathname.startsWith("/api/sandbox/preview")) {
      const authHeader =
        request.headers.get("Authorization") || url.searchParams.get("token");

      // Verify Owner Authentication (ABsUP)
      if (authHeader !== `Bearer ${env.OWNER_SECRET_TOKEN}`) {
        return json(
          { error: "Access Denied: Owner-Only Sandbox Preview" },
          403,
        );
      }

      return json({
        mode: "Owner-Sandbox",
        status: "Authorized",
        sourceRepo: SANDBOX_REPO,
        message: "Executing isolated skill verification...",
      });
    }

    // 3. STAGE 2: PUBLIC AUTOMATIC LISTING REGISTRY (pocwu.pages.dev/S)
    if (url.pathname === "/api/public/list") {
      const publicItems = [
        {
          id: "server-core-skill",
          name: "OpenCodeWEB Core Server Engine",
          version: "2.0.26",
          status: "Live Production",
          source: SERVERS_REPO,
          publishedAt: "2026-08-05",
          url: "https://pocwu.pages.dev/S/server-core-skill",
        },
      ];

      return json(publicItems, 200);
    }

    // 4. GATEWAY HEALTH ENDPOINT
    if (url.pathname === "/health") {
      return json({
        status: "Online",
        serversRepo: SERVERS_REPO,
        sandBoxRepo: SANDBOX_REPO,
        gateway: "opencodewebservers.xup.workers.dev",
      });
    }

    return new Response("OpenCodeWEB Active Gateway", { status: 200 });
  },
};
