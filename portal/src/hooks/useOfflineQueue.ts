/**
 * useOfflineQueue — React binding for the durable offline action queue.
 *
 * Exposes live queue status (pending count, connectivity, sync state) and
 * an `enqueue` helper. Registering the GunDB runners happens in
 * queueRunners (via useGunSync), so the hook stays render-safe.
 */
import { useCallback, useEffect, useState } from "react";
import {
  offlineQueue,
  type QueueStatus,
  type QueuedAction,
} from "../lib/offlineQueue";

export function useOfflineQueue() {
  const [status, setStatus] = useState<QueueStatus>(() =>
    offlineQueue.getStatus(),
  );

  useEffect(() => {
    const unsubscribe = offlineQueue.subscribe(setStatus);
    return unsubscribe;
  }, []);

  const enqueue = useCallback(
    <T,>(type: string, payload: T): Promise<QueuedAction<T>> =>
      offlineQueue.enqueue(type, payload),
    [],
  );

  return { ...status, enqueue };
}