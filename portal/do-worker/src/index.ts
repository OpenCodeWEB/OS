/**
 * GlobeRelayDO — Durable Object WebSocket relay for MultiplayerGlobe.
 *
 * Based on the Cloudflare multiplayer-globe-template architecture:
 *   https://github.com/cloudflare/templates/tree/main/multiplayer-globe-template
 *
 * A single DO instance ("global") manages all active WebSocket connections.
 * On connect: broadcast "add-marker" to all peers, send existing markers to newcomer.
 * On close:   broadcast "remove-marker" to all remaining peers.
 */

import { DurableObject } from "cloudflare:workers";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Position {
  lat: number;
  lng: number;
  id: string;
}

interface UserIdentity {
  login: string;
  name: string;
  avatar: string;
}

interface PeerState {
  ws: WebSocket;
  position: Position;
  user: UserIdentity | null;
  country: string;
  region: string;
  city: string;
}

/* ------------------------------------------------------------------ */
/*  Env                                                                 */
/* ------------------------------------------------------------------ */

export interface Env {
  GLOBE_RELAY_DO: DurableObjectNamespace<GlobeRelayDO>;
}

/* ------------------------------------------------------------------ */
/*  Durable Object — GlobeRelayDO                                      */
/* ------------------------------------------------------------------ */

export class GlobeRelayDO extends DurableObject<Env> {
  /** Active peer sessions keyed by connection ID */
  private peers = new Map<string, PeerState>();

  // ── fetch: handle WebSocket upgrades ──────────────────────────────//

  async fetch(request: Request): Promise<Response> {
    // Non-WebSocket GET request → return list of active authenticated users
    if (request.method === "GET" && request.headers.get("Upgrade") === null) {
      const activeUsers: Array<{ login: string; name: string; avatar: string }> = [];
      for (const [, peer] of this.peers) {
        if (peer.user) {
          activeUsers.push(peer.user);
        }
      }
      return new Response(JSON.stringify({ activeUsers }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Extract geo-position from request headers.
    // Pages Functions passes these via X-Geo-* headers (set in globe-ws.ts).
    let lat = Number(request.headers.get("X-Geo-Latitude"));
    let lng = Number(request.headers.get("X-Geo-Longitude"));

    // Fall back to Cloudflare cf headers (when DO is reached directly)
    if (!isFinite(lat) || !isFinite(lng)) {
      const cf = (request as any).cf as Record<string, unknown> | undefined;
      if (cf) {
        lat = Number(cf.latitude ?? NaN);
        lng = Number(cf.longitude ?? NaN);
      }
    }

    // Final fallback: NYC
    if (!isFinite(lat) || !isFinite(lng)) {
      lat = 40.7128;
      lng = -74.006;
    }

    // WebSocket handshake
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    const id = crypto.randomUUID();
    const position: Position = { lat, lng, id };

    // Extract optional user identity from headers (set by globe-ws.ts)
    const login = request.headers.get("X-User-Login") ?? "";
    const hasUser = login.length > 0;
    const user: UserIdentity | null = hasUser
      ? {
          login,
          name: request.headers.get("X-User-Name") ?? login,
          avatar: request.headers.get("X-User-Avatar") ?? "",
        }
      : null;

    this.peers.set(id, {
      ws: server,
      position,
      user,
      country: "",
      region: "",
      city: "",
    });

    // 1. Send all existing peers to the new connection
    for (const [, existing] of this.peers) {
      if (existing.position.id !== id) {
        this.safeSend(server, {
          type: "add-marker",
          position: existing.position,
        });
      }
    }

    // 2. Send self marker (marked with self: true so client can style it larger)
    this.safeSend(server, {
      type: "add-marker",
      position: { ...position, self: true },
    });

    // 3. Broadcast new peer to everyone else
    this.broadcast(
      { type: "add-marker", position },
      /* exclude */ id,
    );

    // ── Handle incoming messages (position updates, ping) ────────────//

    server.addEventListener("message", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "MOVE" && typeof data.lat === "number" && typeof data.lng === "number") {
          const peer = this.peers.get(id);
          if (peer) {
            peer.position.lat = data.lat;
            peer.position.lng = data.lng;
            this.broadcast({ type: "move-marker", id, lat: data.lat, lng: data.lng }, id);
          }
        }
      } catch {
        // ignore malformed
      }
    });

    // ── Handle close / error ─────────────────────────────────────────//

    const cleanup = () => {
      this.peers.delete(id);
      this.broadcast({ type: "remove-marker", id });
    };

    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Helpers ───────────────────────────────────────────────────────//

  private broadcast(msg: Record<string, unknown>, excludeId?: string): void {
    const data = JSON.stringify(msg);
    for (const [pid, peer] of this.peers) {
      if (pid !== excludeId) {
        try {
          peer.ws.send(data);
        } catch {
          this.peers.delete(pid);
        }
      }
    }
  }

  private safeSend(ws: WebSocket, msg: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // connection is dead — ignore
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Worker entry point                                                  */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Single global room — everyone sees everyone
    const id = env.GLOBE_RELAY_DO.idFromName("global");
    const stub = env.GLOBE_RELAY_DO.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
