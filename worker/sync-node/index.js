/**
 * OpenCodeWEB OS — Auto-Spawned Sync Node (sync-node-<uuid>.xup.workers.dev)
 *
 * Dynamically provisioned by dynamic_edge_provisioner.py when load exceeds
 * thresholds. Serves as a read-only edge replica + health probe target and
 * forwards mutation streams to the primary connector. Zero storage — this
 * worker is intentionally stateless so it can spawn in seconds.
 *
 * Deployed via .github/workflows/deploy-sync-node.yml (workflow_dispatch)
 * with `--name sync-node-<node_id>`.
 *
 * Zero-Constraint Policy: no token limits, no throttling, no artificial
 * quotas. Forwarding uses streaming passthrough so large sync payloads
 * never buffer on the node.
 *
 * Maintainers: ABsUP & ABsUPs
 */

// Primary edge connector (overridable via env)
const PRIMARY = "https://opencodeweb.xup.workers.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const nodeId = env.NODE_ID || "unknown";

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gateway-Token",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Health probe — used by EdgeProvisioner.verify_health() and the
    // NoLimitRouter for latency-aware routing.
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "Online",
          service: "sync-node",
          node_id: nodeId,
          primary: PRIMARY,
          version: "1.0.0",
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Router info — lets the NoLimitRouter confirm this node is part of
    // the fleet and which primary it forwards to.
    if (url.pathname === "/info") {
      return new Response(
        JSON.stringify({ node_id: nodeId, primary: PRIMARY, role: "sync-replica" }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Everything else: stream to the primary edge connector.
    // GET /roadmap & /health pass through; POST /sync, /vote, /upvote,
    // /chat are forwarded so the node behaves as a full ingress replica.
    const target = new URL(url.pathname + url.search, PRIMARY);
    const proxied = await fetch(new Request(target.toString(), request));
    const headers = new Headers(proxied.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Sync-Node", nodeId);
    return new Response(proxied.body, { status: proxied.status, headers });
  },
};
