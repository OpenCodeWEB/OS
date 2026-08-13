/**
 * Health check endpoint — used by devices to verify connectivity
 * GET /api/health
 *
 * Cached at edge for 60s to reduce function invocations.
 */
export const onRequest: PagesFunction = async () => {
  const body = JSON.stringify({
    status: "ok",
    service: "OpenCodeABsUI/UX API",
    version: "1.0.0-EA",
    timestamp: new Date().toISOString(),
    uptime: "cloudflare-edge",
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Edge cache for 60s, allow stale for 10s while revalidating
      "Cache-Control": "public, max-age=60, stale-while-revalidate=10",
    },
  });
};
