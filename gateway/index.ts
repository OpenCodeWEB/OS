/**
 * OpenCodeWEB Secure Gateway Worker — v2.0.0
 *
 * Single ingress point for ALL traffic.
 * Routes requests to internal workers via service bindings.
 *
 * AUTHENTICATION:
 *   All routes require one of:
 *     A) Authorization: Bearer <GATEWAY_API_KEY>
 *     B) X-Gateway-Token: <INTERNAL_GATEWAY_TOKEN>
 *     C) Valid X-Hub-Signature-256 HMAC (webhook only)
 *
 * WORKER BINDINGS:
 *   AG_WORKER    → opencodewebsag-worker  (GitHub App automation)
 *   GLOBE_RELAY  → pocwu-globe-relay      (Globe Durable Object relay)
 *
 * Routes:
 *   /health               — Health check
 *   /api/github/webhook   — GitHub webhook (HMAC verified)
 *   /api/auth/callback    — OAuth callback for GitHub App
 *   /api/ag/*             — Proxy to AG worker
 *                            (POST /api/ag/repos → create repository)
 *   /api/metrics/live     — Public metrics read (GET, no credentials)
 *   /api/metrics/update   — Metrics write (POST, HMAC verified)
 *   /api/globe/*          — Proxy to Globe Relay
 */

export interface Env {
  // Secrets
  WEBHOOK_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GATEWAY_API_KEY?: string;
  INTERNAL_GATEWAY_TOKEN?: string;

  // Service bindings
  AG_WORKER: Fetcher;
  GLOBE_RELAY?: Fetcher;

  // Environment
  ENVIRONMENT?: string;
}

const MAX_WEBHOOK_BODY_BYTES = 50_000_000; // 50 MB (GitHub max)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error("Gateway unhandled error:", err);
      return new Response(
        JSON.stringify({
          error: "Internal Server Error",
          message: err instanceof Error ? err.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }
  },
};

// ─── Request Router ──────────────────────────────────────────────────────

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  // ── 0. CORS Preflight ────────────────────────────────────────────
  if (method === "OPTIONS") {
    return corsPreflight();
  }

  // ── 1. Authentication ────────────────────────────────────────────
  const authResult = await authenticate(request, env, url.pathname);
  if (!authResult.authenticated) {
    return authResult.response!;
  }

  // ── 2. Route Matching ────────────────────────────────────────────
  const path = url.pathname;

  // Health
  if (path === "/health") {
    return handleHealth();
  }

  // GitHub webhook
  if (path === "/api/github/webhook" && method === "POST") {
    return handleWebhook(request, env);
  }

  // OAuth callback
  if (path === "/api/auth/callback") {
    return handleAuthCallback(request, env);
  }

  // Proxy to AG Worker (includes POST /api/ag/repos → repo creation)
  if (path.startsWith("/api/ag/")) {
    return proxyToWorker(request, env, env.AG_WORKER, url, "/api/ag");
  }

  // Proxy to AG Worker metrics endpoints (no prefix strip — worker owns the full path)
  if (path.startsWith("/api/metrics/")) {
    return proxyToWorker(request, env, env.AG_WORKER, url, "");
  }

  // Proxy to Globe Relay (WebSocket-compatible)
  if ((path.startsWith("/api/globe/") || path === "/api/globe-ws") && env.GLOBE_RELAY) {
    return proxyToGlobe(request, env, url);
  }

  // ── 3. Fallback (Root / Unknown) ────────────────────────────────
  return new Response(
    JSON.stringify({
      service: "OpenCodeWEB Gateway",
      version: "2.0.0",
      authenticated: true,
      endpoints: [
        "/health",
        "/api/github/webhook",
        "/api/auth/callback",
        "/api/ag/*",
        "/api/ag/repos (POST — create repository)",
        "/api/metrics/live (GET — public metrics)",
        "/api/metrics/update (POST — HMAC metrics write)",
        "/api/globe/*",
      ],
    }),
    {
      status: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    }
  );
}

// ─── Authentication ──────────────────────────────────────────────────────

interface AuthResult {
  authenticated: boolean;
  response?: Response;
}

async function authenticate(
  request: Request,
  env: Env,
  path: string
): Promise<AuthResult> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const gatewayToken = request.headers.get("X-Gateway-Token") ?? "";
  const apiKey = authHeader.replace("Bearer ", "").trim();

  // Public read: GET /api/metrics/live requires NO credentials
  if (path === "/api/metrics/live" && request.method === "GET") {
    return { authenticated: true };
  }

  // Public health probe: CI/CD pipelines and uptime monitors must be able
  // to verify the gateway without credentials. Returns only status info.
  if (path === "/health" && request.method === "GET") {
    return { authenticated: true };
  }

  // Public OAuth/install callback: the browser arrives here directly from
  // GitHub with a temporary `code` (proof of authorization) — no API
  // credentials are possible in this hop. The handler only exchanges the
  // code or forwards it to the Pages callback; it never mutates state.
  if (path === "/api/auth/callback") {
    return { authenticated: true };
  }

  // Check standard API key / internal token
  const hasValidKey =
    (env.GATEWAY_API_KEY && apiKey === env.GATEWAY_API_KEY) ||
    (env.INTERNAL_GATEWAY_TOKEN &&
      gatewayToken === env.INTERNAL_GATEWAY_TOKEN);

  // Check webhook HMAC as alternative auth (GitHub's secret-key handshake)
  // Applies to /api/github/webhook, POST /api/metrics/update, POST /api/metrics/sync
  const hmacRoutes =
    path === "/api/github/webhook" ||
    (path === "/api/metrics/update" && request.method === "POST") ||
    (path === "/api/metrics/sync" && request.method === "POST");
  const hasValidHmac =
    hmacRoutes && (await isWebhookHmacValid(request, env));

  if (hasValidKey || hasValidHmac) {
    return { authenticated: true };
  }

  return {
    authenticated: false,
    response: new Response(
      JSON.stringify({
        error: "Unauthorized",
        message:
          "Valid credentials required. Provide via Authorization: Bearer <key> or X-Gateway-Token.",
      }),
      {
        status: 401,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
          "WWW-Authenticate":
            'Bearer realm="opencodeweb-gateway", charset="UTF-8"',
        },
      }
    ),
  };
}

// ─── Route Handlers ──────────────────────────────────────────────────────

function handleHealth(): Response {
  return new Response(
    JSON.stringify({
      status: "Online",
      gateway: "opencodeweb.xup.workers.dev",
      mode: "secure-single-ingress",
      version: "2.0.0",
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
    }
  );
}

/**
 * Handle GitHub webhook — forward to AG worker for processing.
 * Body is read once here and passed through.
 */
async function handleWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  // Enforce body size limit
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && parseInt(contentLength, 10) > MAX_WEBHOOK_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Payload too large" }), {
      status: 413,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  const bodyText = await request.text();
  let event: string;
  let repo: string;

  // Safe JSON parse — never crash on malformed payload
  try {
    const payload = JSON.parse(bodyText);
    event = payload.action || "push";
    repo = payload.repository?.full_name || "unknown";
  } catch {
    event = "unknown";
    repo = "unknown";
  }

  // Forward to AG worker via service binding
  // Preserve ALL GitHub webhook headers — the worker re-validates the HMAC
  // and requires X-GitHub-Event + X-GitHub-Delivery.
  const forwardHeaders = new Headers();
  if (env.INTERNAL_GATEWAY_TOKEN) {
    forwardHeaders.set("X-Gateway-Token", env.INTERNAL_GATEWAY_TOKEN);
  }
  const preservedHeaders = [
    "X-GitHub-Event",
    "X-GitHub-Delivery",
    "X-Hub-Signature-256",
    "X-GitHub-Hook-ID",
    "X-GitHub-Hook-Installation-Target-ID",
    "X-GitHub-Hook-Installation-Target-Type",
  ];
  for (const name of preservedHeaders) {
    const value = request.headers.get(name);
    if (value) forwardHeaders.set(name, value);
  }

  let agStatus = 0;
  try {
    const agResponse = await env.AG_WORKER.fetch(
      new Request("https://internal/webhook", {
        method: "POST",
        headers: forwardHeaders,
        body: bodyText,
      })
    );
    agStatus = agResponse.status;
  } catch (err) {
    console.error("Failed to forward webhook to AG worker:", err);
    agStatus = 502;
  }

  return new Response(
    JSON.stringify({
      status: "Accepted",
      event,
      repository: repo,
      agent: "OpenCodeWEB",
      gateway: "opencodeweb.xup.workers.dev",
      ag_worker_status: agStatus,
    }),
    {
      status: 202,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    }
  );
}

/**
 * Handle OAuth callback from GitHub.
 * Exchanges code for access token and redirects to the SPA dashboard.
 * Security: token is passed in URL fragment (#), not query string (?),
 * so it is never sent to the server on subsequent requests.
 */
async function handleAuthCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";

  if (!code) {
    return new Response(
      JSON.stringify({ error: "Missing authorization code" }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // ── GitHub App install-and-authorize flow ──────────────────────────
  // GitHub redirects the browser here (or to the app's registered callback)
  // with `code` + `installation_id` + `setup_action=install`. The install
  // must be recorded by the Pages callback (AG_TOKENS_KV), so forward the
  // browser back to pocwu.pages.dev preserving every query parameter.
  const installationId = url.searchParams.get("installation_id");
  if (installationId) {
    const pagesUrl = new URL(
      "https://pocwu.pages.dev/api/ag/auth/callback" + url.search
    );
    return Response.redirect(pagesUrl.toString(), 302);
  }

  // ── Plain OAuth code exchange (legacy SPA token flow) ──────────────

  // Exchange code for access token
  let tokenData: Record<string, unknown>;
  try {
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      }
    );
    tokenData = (await tokenResponse.json()) as Record<string, unknown>;
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Token exchange failed",
        message: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 502,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  if (tokenData.error) {
    return new Response(
      JSON.stringify({
        error: tokenData.error_description || tokenData.error,
      }),
      {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      }
    );
  }

  // Use URL fragment (#) to avoid exposing token in server logs / referrer headers.
  // The SPA reads `window.location.hash` instead of query params.
  const redirectUrl = `https://pocwu.pages.dev/ag#access_token=${encodeURIComponent(
    (tokenData.access_token as string) ?? ""
  )}&state=${encodeURIComponent(state)}`;

  return Response.redirect(redirectUrl, 302);
}

// ─── Proxy Helper ────────────────────────────────────────────────────────

/**
 * Proxy a request to an internal worker via service binding.
 * Strips the prefix path and forwards the rest.
 */
async function proxyToWorker(
  request: Request,
  env: Env,
  worker: Fetcher,
  url: URL,
  prefix: string
): Promise<Response> {
  const internalPath = url.pathname.replace(
    new RegExp(`^${escapeRegex(prefix)}`),
    ""
  ) || "/";
  const internalUrl = new URL(
    `https://internal${internalPath}${url.search}`
  );

  // Add gateway token for internal authentication
  const proxyHeaders = new Headers(request.headers);
  if (env.INTERNAL_GATEWAY_TOKEN) {
    proxyHeaders.set("X-Gateway-Token", env.INTERNAL_GATEWAY_TOKEN);
  }

  let proxied: Response;
  try {
    proxied = await worker.fetch(
      new Request(internalUrl.toString(), {
        method: request.method,
        headers: proxyHeaders,
        body:
          request.method !== "GET" && request.method !== "HEAD"
            ? request.body
            : undefined,
        redirect: "manual",
      })
    );
  } catch (err) {
    console.error(`Proxy to ${prefix} worker failed:`, err);
    return new Response(
      JSON.stringify({
        error: "Upstream unavailable",
        message: err instanceof Error ? err.message : "Connection failed",
      }),
      {
        status: 502,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
          "X-Gateway": "opencodeweb.xup.workers.dev",
        },
      }
    );
  }

  // Read proxied body
  let respBody: string;
  try {
    respBody = await proxied.text();
  } catch {
    respBody = JSON.stringify({ error: "Failed to read upstream response" });
  }

  return new Response(respBody, {
    status: proxied.status,
    headers: {
      ...corsHeaders(),
      "Content-Type":
        proxied.headers.get("Content-Type") || "application/json",
      "Cache-Control": proxied.headers.get("Cache-Control") || "no-cache",
      "X-Gateway": "opencodeweb.xup.workers.dev",
    },
  });
}

// ─── CORS Helpers ────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "https://pocwu.pages.dev",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Hub-Signature-256, X-API-Key, X-Gateway-Token",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// ─── Authentication Helpers ──────────────────────────────────────────────

/**
 * Verify webhook HMAC signature without consuming the original request body.
 * Clones the request so the handler can still read it.
 */
async function isWebhookHmacValid(
  request: Request,
  env: Env
): Promise<boolean> {
  const signature = request.headers.get("X-Hub-Signature-256");
  if (!signature || !env.WEBHOOK_SECRET) return false;

  try {
    const cloned = request.clone();
    const bodyText = await cloned.text();
    return verifyGitHubSignature(bodyText, signature, env.WEBHOOK_SECRET);
  } catch {
    return false;
  }
}

// ─── HMAC Verification ──────────────────────────────────────────────────

async function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigHex = signature.replace("sha256=", "");
    const sigBytes = hexToBytes(sigHex);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      encoder.encode(payload)
    );
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ─── Utilities ────────────────────────────────────────────────────────────

// ─── Globe Relay Proxy (WebSocket-aware) ─────────────────────────────

/**
 * Proxy a request to the Globe Relay worker.
 * Handles both HTTP and WebSocket upgrade requests.
 */
async function proxyToGlobe(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const proxyHeaders = new Headers(request.headers);
  if (env.INTERNAL_GATEWAY_TOKEN) {
    proxyHeaders.set("X-Gateway-Token", env.INTERNAL_GATEWAY_TOKEN);
  }

  const isUpgrade =
    request.headers.get("Upgrade")?.toLowerCase() === "websocket";

  try {
    const proxied = await env.GLOBE_RELAY!.fetch(
      new Request(url.toString(), {
        method: request.method,
        headers: proxyHeaders,
        body:
          request.method !== "GET" && request.method !== "HEAD"
            ? request.body
            : undefined,
        redirect: "manual",
      })
    );

    // For WebSocket upgrades (101), return the response as-is
    if (isUpgrade || proxied.status === 101) {
      return proxied;
    }

    // For regular HTTP responses, add CORS and gateway headers
    let respBody: string;
    try {
      respBody = await proxied.text();
    } catch {
      respBody = JSON.stringify({ error: "Failed to read response" });
    }

    return new Response(respBody, {
      status: proxied.status,
      headers: {
        ...corsHeaders(),
        "Content-Type":
          proxied.headers.get("Content-Type") || "application/json",
        "X-Gateway": "opencodeweb.xup.workers.dev",
      },
    });
  } catch (err) {
    console.error("Globe relay proxy failed:", err);
    return new Response(
      JSON.stringify({
        error: "Globe relay unavailable",
        message: err instanceof Error ? err.message : "Connection failed",
      }),
      {
        status: 502,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
          "X-Gateway": "opencodeweb.xup.workers.dev",
        },
      }
    );
  }
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type { Env as WorkerEnv };
