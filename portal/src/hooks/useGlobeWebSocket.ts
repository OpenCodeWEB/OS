/**
 * useGlobeWebSocket — Real-time peer position sync for the multiplayer globe.
 *
 * Protocol (matching GlobeRelayDO):
 *   Server → Client: { type: "add-marker",    position: { lat, lng, id, self? } }
 *   Server → Client: { type: "remove-marker", id }
 *   Server → Client: { type: "move-marker",   id, lat, lng }
 *   Client → Server: { type: "MOVE",          lat, lng }
 *
 * Geo-position is resolved server-side via Cloudflare cf-* headers
 * (no browser Geolocation API needed).
 *
 * Reference:
 *   https://github.com/cloudflare/templates/tree/main/multiplayer-globe-template
 */

import { useEffect, useRef, useState, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PeerPosition {
  id: string;
  lat: number;
  lng: number;
  /** true for the local user's own marker */
  self?: boolean;
}

export type ConnectionStatus =
  "connecting" | "connected" | "disconnected" | "error";

interface UseGlobeWebSocketReturn {
  /** ALL known positions including self (self has self=true) */
  allPositions: PeerPosition[];
  /** Remote peers only (excludes self) */
  peers: PeerPosition[];
  /** Our own position (or null if not yet received) */
  selfPosition: PeerPosition | null;
  connectionStatus: ConnectionStatus;
  peerCount: number;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useGlobeWebSocket(): UseGlobeWebSocketReturn {
  const [allPositions, setAllPositions] = useState<PeerPosition[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [selfPosition, setSelfPosition] = useState<PeerPosition | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;

    // Pass session token (if available) so the server can associate this
    // WebSocket connection with an authenticated user for online-status tracking.
    const token = localStorage.getItem("pocwu_session_token");
    const url = token
      ? `${protocol}//${host}/api/globe-ws?token=${encodeURIComponent(token)}`
      : `${protocol}//${host}/api/globe-ws`;

    setConnectionStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      setConnectionStatus("connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;

      try {
        const data = JSON.parse(event.data as string);

        setAllPositions((prev) => {
          let updated: PeerPosition[];

          switch (data.type) {
            case "add-marker": {
              const pos = data.position as PeerPosition;
              // Replace if exists, otherwise add
              const existing = prev.findIndex((p) => p.id === pos.id);
              if (existing >= 0) {
                updated = [...prev];
                updated[existing] = pos;
              } else {
                updated = [...prev, pos];
              }
              break;
            }
            case "remove-marker": {
              updated = prev.filter((p) => p.id !== data.id);
              break;
            }
            case "move-marker": {
              updated = prev.map((p) =>
                p.id === data.id ? { ...p, lat: data.lat, lng: data.lng } : p,
              );
              break;
            }
            default:
              return prev;
          }

          // Update selfPosition whenever we detect our own marker
          const self = updated.find((p) => p.self);
          if (self && (!selfPosition || self.id !== selfPosition.id)) {
            setSelfPosition(self);
          }

          return updated;
        });
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnectionStatus("disconnected");
      wsRef.current = null;
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setConnectionStatus("error");
    };
  }, []);

  // ── Heartbeat ping ── keep ws_active:<login> KV key fresh ──────//
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => {
    if (connectionStatus !== "connected") {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = undefined;
      }
      return;
    }

    // Ping every 60 s to keep the presence key alive (TTL is 130 s)
    const token = localStorage.getItem("pocwu_session_token");
    if (!token) return;

    const ping = () => {
      fetch("/api/globe-ping", {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {
        /* best-effort */
      });
    };

    ping(); // immediate first ping
    heartbeatRef.current = setInterval(ping, 60_000);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = undefined;
      }
    };
  }, [connectionStatus]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = undefined;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null; // suppress reconnect
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const peers = allPositions.filter((p) => !p.self);

  return {
    allPositions,
    peers,
    selfPosition,
    connectionStatus,
    peerCount: peers.length,
  };
}
