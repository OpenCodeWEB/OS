/**
 * Cloudflare Pages Functions — Global Middleware
 *
 * Handles CORS, security headers, error wrapping, and auth context.
 * Runs on EVERY request to /api/* before the route handler.
 */

// CORS & security headers applied to all API responses
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://*.mongodb.net https://api.github.com https://cloudflareinsights.com https://*.cloudflareinsights.com; img-src 'self' data: blob: https://avatars.githubusercontent.com; font-src 'self' https://fonts.gstatic.com;",
};

function corsHeaders(origin: string): Record<string, string> {
  const allowed = [
    "https://pocwu.pages.dev",
    "http://localhost:5173",
    "http://localhost:8788",
  ];
  const origin_ = allowed.includes(origin) ? origin : "https://pocwu.pages.dev";
  return {
    "Access-Control-Allow-Origin": origin_,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Device-Hash",
    "Access-Control-Max-Age": "86400",
    ...SECURITY_HEADERS,
  };
}

export const onRequest: PagesFunction = async (context) => {
  const { request, next } = context;
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") ?? "";
  const method = request.method;

  // ── API-only middleware ──────────────────────────────────────────────
  // Static assets (CSS, JS, SVG, PNG, etc.) pass through without
  // modification so we don't crash on immutable response headers.
  if (!url.pathname.startsWith("/api/")) {
    return next();
  }

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  try {
    const response = await next();
    const headers = corsHeaders(origin);

    // Merge CORS headers into response
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }

    return response;
  } catch (err) {
    console.error("Middleware error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      },
    );
  }
};
