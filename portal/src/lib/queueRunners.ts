/**
 * queueRunners — registers the GunDB runners used by the offline queue.
 *
 * Kept separate from offlineQueue.ts so the generic queue stays relay-free;
 * any module that may enqueue actions calls ensureQueueConfigured() first
 * (idempotent).
 */
import { offlineQueue, type QueuedAction } from "./offlineQueue";
import { publishPost, unpublishPost, publishComment } from "./gdbx";
import type { GunPost, GunComment } from "./gdbx";

let configured = false;

/** Register GunDB runners once. Safe to call from any module. */
export function ensureQueueConfigured(): void {
  if (configured) return;
  configured = true;
  offlineQueue.configure({
    "gdbx.post": async (a: QueuedAction) => {
      publishPost(a.payload as GunPost);
    },
    "gdbx.unpost": async (a: QueuedAction) => {
      unpublishPost(a.payload as string);
    },
    "gdbx.comment": async (a: QueuedAction) => {
      publishComment(a.payload as GunComment);
    },
  });
}