/**
 * GET /api/ag/metrics — return AG live metrics + contributor leaderboard.
 *
 * Proxies the AG worker's public `/api/metrics/live` endpoint via the
 * AG_WORKER service binding (same-origin for the SPA, no CORS needed).
 */

import { Env, json } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env } = context;

  if (!env.AG_WORKER) {
    return json({ error: "AG_WORKER binding not configured" }, 500);
  }

  try {
    const metricsResp = await env.AG_WORKER.fetch("https://worker/api/metrics/live");
    if (!metricsResp.ok) {
      return json({ error: "Metrics endpoint unreachable", status: metricsResp.status }, 502);
    }
    const metrics = await metricsResp.json();
    return json(metrics);
  } catch (err) {
    return json(
      { error: "Metrics proxy failed", message: err instanceof Error ? err.message : "Unknown" },
      502,
    );
  }
};
