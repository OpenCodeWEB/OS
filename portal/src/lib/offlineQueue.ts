/**
 * OfflineQueue — durable action queue with exponential backoff retry.
 *
 * Guarantees eventual delivery of portal writes (GunDB publishes, and by
 * extension REST calls) even when the network or the GunDB relay is
 * unreachable. Actions are persisted to IndexedDB; a background flusher
 * retries them with exponential backoff whenever connectivity returns.
 *
 * Design:
 *   enqueue(type, payload)
 *     ├─ online + runner available  → run now; on failure persist & retry
 *     └─ offline                    → persist immediately
 *   flusher (interval + 'online' event + peer changes)
 *     └─ runs due actions (nextRetryAt <= now) with backoff 1s..5min
 *
 * The queue is deliberately generic: `configure()` maps action types to
 * runner functions, so any async side effect can be queued.
 */
import { getPeerCount } from "./gun";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface QueuedAction<T = unknown> {
  id?: number;
  type: string;
  payload: T;
  createdAt: number;
  attempts: number;
  nextRetryAt: number;
  lastError?: string;
}

export interface QueueStatus {
  /** Connectivity + flush state */
  state: "idle" | "syncing" | "offline";
  /** Number of actions waiting (incl. failed-retry actions) */
  pending: number;
  /** ms timestamp of the last successful flush of a queued action */
  lastSyncedAt: number | null;
  online: boolean;
  peers: number;
}

type Runner = (action: QueuedAction) => Promise<void>;
type Runners = Record<string, Runner>;

/* ------------------------------------------------------------------ */
/*  IndexedDB plumbing                                                 */
/* ------------------------------------------------------------------ */

const DB_NAME = "opencodeweb-offline-queue";
const STORE = "actions";
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const FLUSH_INTERVAL_MS = 10 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("due", "nextRetryAt");
        store.createIndex("type", "type");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function listDue(now: number): Promise<QueuedAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const index = store.index("due");
    const range = IDBKeyRange.upperBound(now);
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result as QueuedAction[]);
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function countPending(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveAction(action: QueuedAction): Promise<number> {
  return withStore("readwrite", (s) => s.put(action) as IDBRequest<number>);
}

async function removeAction(id: number): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

/* ------------------------------------------------------------------ */
/*  Singleton queue                                                    */
/* ------------------------------------------------------------------ */

class OfflineQueue {
  private runners: Runners = {};
  private listeners = new Set<(s: QueueStatus) => void>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private status: QueueStatus = {
    state: "idle",
    pending: 0,
    lastSyncedAt: null,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    peers: 0,
  };

  /** Register runners per action type and start the flusher. */
  configure(runners: Runners): void {
    this.runners = { ...this.runners, ...runners };
    this.start();
    void this.refresh();
  }

  subscribe(cb: (s: QueueStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  /** Current status snapshot (for hooks' initial state). */
  getStatus(): QueueStatus {
    return this.status;
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.status);
  }

  private setStatus(patch: Partial<QueueStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit();
  }

  /** Queue an action; executes immediately when online, persists on failure. */
  async enqueue<T>(type: string, payload: T): Promise<QueuedAction<T>> {
    const action: QueuedAction<T> = {
      type,
      payload,
      createdAt: Date.now(),
      attempts: 0,
      nextRetryAt: 0,
    };

    const runner = this.runners[type];
    if (this.status.online && runner) {
      try {
        await runner(action as QueuedAction);
        this.setStatus({ lastSyncedAt: Date.now() });
        return action;
      } catch (e) {
        // fall through — persist and retry with backoff
        action.lastError = e instanceof Error ? e.message : String(e);
      }
    }

    action.attempts = 1;
    action.nextRetryAt = Date.now() + BASE_BACKOFF_MS;
    action.id = await saveAction(action);
    await this.refresh();
    return action;
  }

  /** Try to run every due action; requeue failures with exponential backoff. */
  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      if (!navigator.onLine) {
        this.setStatus({ state: "offline", online: false });
        return;
      }
      this.setStatus({ online: true, peers: getPeerCount() });
      const due = await listDue(Date.now());
      if (due.length === 0) {
        this.setStatus({ state: "idle" });
        return;
      }
      this.setStatus({ state: "syncing" });
      for (const action of due) {
        const runner = this.runners[action.type];
        if (!runner) continue; // unknown type: leave queued, do not burn attempts
        try {
          await runner(action);
          if (action.id !== undefined) await removeAction(action.id);
          this.setStatus({ lastSyncedAt: Date.now() });
        } catch (e) {
          action.attempts += 1;
          action.lastError = e instanceof Error ? e.message : String(e);
          action.nextRetryAt =
            Date.now() + Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (action.attempts - 1));
          if (action.id !== undefined) await saveAction(action);
        }
      }
      const pending = await countPending();
      this.setStatus({ pending, state: pending === 0 ? "idle" : "syncing" });
    } finally {
      this.flushing = false;
    }
  }

  private async refresh(): Promise<void> {
    try {
      const pending = await countPending();
      this.setStatus({
        pending,
        online: navigator.onLine,
        peers: getPeerCount(),
        state: pending > 0 ? "syncing" : "idle",
      });
    } catch {
      /* IndexedDB unavailable — queue degrades to fire-and-forget */
    }
  }

  start(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.setStatus({ online: true });
        void this.flush();
      });
      window.addEventListener("offline", () => {
        this.setStatus({ online: false, state: "offline" });
      });
    }
  }

  stop(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export const offlineQueue = new OfflineQueue();