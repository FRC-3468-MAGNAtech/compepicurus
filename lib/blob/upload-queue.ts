// Offline-tolerant photo upload queue. Scouts are often on bad venue wifi, so a photo is stored (blob and all) in IndexedDB
// the moment it is taken and uploaded whenever the network allows. Nothing here is React; form code subscribes and renders.
//
// Lifecycle of an item: pending -> uploading -> done, or -> failed (retried later with exponential backoff).
// A `done` item keeps its `result` (url etc.) but drops the blob; it stays until the form code calls `remove(id)` after
// saving the URL into the form, so a reload between "uploaded" and "form saved" can't lose the link.

import type { UploadResult } from "@/lib/blob/client";

export type QueueItemStatus = "pending" | "uploading" | "failed" | "done";

export type QueueItem = {
  id: string;
  /** Null once done (the bytes are on Vercel Blob by then). */
  blob: Blob | null;
  path: string;
  /** JSON string sent to /api/blob/upload as `clientPayload`. */
  clientPayload: string;
  /** Opaque text the form code uses to find where this photo belongs (e.g. "pit-scout-v1/photos/0"). */
  fieldRef: string;
  status: QueueItemStatus;
  /** Failures so far. */
  attempts: number;
  /** Epoch ms before which a failed item isn't retried by processAll (unless forced). 0 = now. */
  nextAttemptAt: number;
  createdAt: number;
  /** Insertion order, so items queued in the same millisecond still upload in the order they were added. */
  seq: number;
  lastError: string | null;
  result: UploadResult | null;
};

export type NewQueueItem = { id: string; blob: Blob; path: string; clientPayload: string; fieldRef: string };

/** Storage layer. IndexedDB in the browser, a Map in tests. */
export interface QueueStore {
  getAll(): Promise<QueueItem[]>;
  put(item: QueueItem): Promise<void>;
  delete(id: string): Promise<void>;
}

export type Uploader = (item: QueueItem & { blob: Blob }) => Promise<UploadResult>;

export type ProcessSummary = { uploaded: number; failed: number };

export type QueueOptions = { now?: () => number; baseDelayMs?: number; maxDelayMs?: number };

export const DEFAULT_BASE_DELAY_MS = 2_000;
export const DEFAULT_MAX_DELAY_MS = 5 * 60_000;

/** Wait after the Nth consecutive failure: base, 2x, 4x, ... capped. 0 failures = no wait. */
export function retryDelay(attempts: number, baseMs = DEFAULT_BASE_DELAY_MS, maxMs = DEFAULT_MAX_DELAY_MS): number {
  if (!Number.isFinite(attempts) || attempts <= 0) return 0;
  // Cap the exponent too: 2 ** 1024 is Infinity, and Infinity * base would turn into NaN logic downstream.
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempts - 1, 30));
}

export interface UploadQueue {
  enqueue(item: NewQueueItem): Promise<QueueItem>;
  /** Items in upload order (oldest first). */
  list(): QueueItem[];
  get(id: string): QueueItem | undefined;
  /** Drops an item and its blob. Call for `done` items once their URL is saved, or to cancel a pending photo. */
  remove(id: string): Promise<void>;
  /** Uploads every pending/failed item that is due, one at a time. Concurrent calls share one run. `force` ignores backoff (e.g. a "Retry now" button). */
  processAll(uploader: Uploader, opts?: { force?: boolean }): Promise<ProcessSummary>;
  /** Anything not done yet? */
  hasWork(): boolean;
  /** The listener gets the full list now and after every change. Returns unsubscribe. */
  subscribe(listener: (items: QueueItem[]) => void): () => void;
}

/** Loads whatever the store holds (so the queue survives reloads) and returns the queue. An item that was mid-upload when the page died goes back to pending. */
export async function createUploadQueue(store: QueueStore, options: QueueOptions = {}): Promise<UploadQueue> {
  const now = options.now ?? Date.now;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  const items = new Map<string, QueueItem>();
  const listeners = new Set<(items: QueueItem[]) => void>();
  let running: Promise<ProcessSummary> | null = null;
  let seq = 0;

  for (const stored of await store.getAll()) {
    const item = stored.status === "uploading" ? { ...stored, status: "pending" as const } : stored;
    items.set(item.id, item);
    seq = Math.max(seq, item.seq ?? 0);
  }

  const sorted = () => [...items.values()].sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
  const emit = () => {
    const snapshot = sorted();
    for (const l of listeners) {
      try {
        l(snapshot);
      } catch {
        // One broken listener must not stop the queue.
      }
    }
  };
  const save = async (item: QueueItem) => {
    items.set(item.id, item);
    await store.put(item);
    emit();
  };

  async function run(uploader: Uploader, force: boolean): Promise<ProcessSummary> {
    const summary: ProcessSummary = { uploaded: 0, failed: 0 };
    const tried = new Set<string>();
    for (;;) {
      const t = now();
      const next = sorted().find((i) => !tried.has(i.id) && (i.status === "pending" || i.status === "failed") && i.blob && (force || i.nextAttemptAt <= t));
      if (!next) return summary;
      tried.add(next.id);
      await save({ ...next, status: "uploading" });
      try {
        const result = await uploader({ ...next, status: "uploading", blob: next.blob as Blob });
        // Re-read: the item may have been removed while the upload ran.
        const current = items.get(next.id);
        if (current) await save({ ...current, status: "done", blob: null, result, lastError: null, nextAttemptAt: 0 });
        summary.uploaded++;
      } catch (err) {
        const current = items.get(next.id);
        if (current) {
          const attempts = current.attempts + 1;
          await save({
            ...current,
            status: "failed",
            attempts,
            nextAttemptAt: now() + retryDelay(attempts, baseDelayMs, maxDelayMs),
            lastError: err instanceof Error ? err.message : "Upload failed.",
          });
        }
        summary.failed++;
      }
    }
  }

  return {
    async enqueue(input) {
      if (items.has(input.id)) throw new Error(`Upload ${input.id} is already queued.`);
      const item: QueueItem = {
        ...input,
        status: "pending",
        attempts: 0,
        nextAttemptAt: 0,
        createdAt: now(),
        seq: ++seq,
        lastError: null,
        result: null,
      };
      await save(item);
      return item;
    },
    list: sorted,
    get: (id) => items.get(id),
    async remove(id) {
      if (!items.delete(id)) return;
      await store.delete(id);
      emit();
    },
    processAll(uploader, opts = {}) {
      if (!running) running = run(uploader, opts.force === true).finally(() => (running = null));
      return running;
    },
    hasWork: () => [...items.values()].some((i) => i.status !== "done"),
    subscribe(listener) {
      listeners.add(listener);
      try {
        listener(sorted());
      } catch {
        // Same as emit(): a broken listener is its own problem.
      }
      return () => listeners.delete(listener);
    },
  };
}

// --- IndexedDB store -------------------------------------------------------------------------------------------------------

const DB_NAME = "compepicurus-photo-uploads";
const STORE_NAME = "uploads";

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed."));
  });

/** Raw-IndexedDB QueueStore. Throws if IndexedDB can't be opened (some private modes). */
export async function createIndexedDbStore(factory: IDBFactory = indexedDB): Promise<QueueStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("Couldn't open IndexedDB."));
    open.onblocked = () => reject(new Error("IndexedDB is blocked."));
  });
  const store = (mode: IDBTransactionMode) => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  return {
    getAll: () => request(store("readonly").getAll() as IDBRequest<QueueItem[]>),
    put: async (item) => void (await request(store("readwrite").put(item))),
    delete: async (id) => void (await request(store("readwrite").delete(id))),
  };
}

/** In-memory QueueStore: the fallback when IndexedDB is unavailable (photos then don't survive a reload), and the fake in tests. */
export function createMemoryStore(initial: QueueItem[] = []): QueueStore & { items: Map<string, QueueItem> } {
  const items = new Map(initial.map((i) => [i.id, i]));
  return {
    items,
    getAll: async () => [...items.values()].map((i) => ({ ...i })),
    put: async (item) => void items.set(item.id, { ...item }),
    delete: async (id) => void items.delete(id),
  };
}

/** The queue backed by IndexedDB; falls back to memory (`persistent: false`) when IndexedDB isn't usable. Browser only. */
export async function openUploadQueue(options: QueueOptions = {}): Promise<{ queue: UploadQueue; persistent: boolean }> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("No IndexedDB.");
    return { queue: await createUploadQueue(await createIndexedDbStore(), options), persistent: true };
  } catch {
    return { queue: await createUploadQueue(createMemoryStore(), options), persistent: false };
  }
}

// --- background processing -------------------------------------------------------------------------------------------------

export type OnlineSource = { isOnline(): boolean; subscribe(onOnline: () => void): () => void };

/** navigator.onLine plus the window 'online' event. */
export const browserOnlineSource: OnlineSource = {
  isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  subscribe(onOnline) {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  },
};

/**
 * Runs `queue.processAll` once now, whenever the browser comes back online, and every `intervalMs` while work remains (that
 * is what retries a failed item once its backoff has passed). Returns `stop()`. Errors never escape: failures are recorded on the item.
 */
export function startQueueProcessing(
  queue: UploadQueue,
  uploader: Uploader,
  options: { onlineSource?: OnlineSource; intervalMs?: number } = {},
): () => void {
  const online = options.onlineSource ?? browserOnlineSource;
  const intervalMs = options.intervalMs ?? 15_000;
  let stopped = false;

  const tick = (force: boolean) => {
    if (stopped || !queue.hasWork() || !online.isOnline()) return;
    queue.processAll(uploader, { force }).catch(() => {});
  };

  tick(false);
  // Coming back online is a good reason to retry now instead of waiting out the backoff.
  const unsubscribe = online.subscribe(() => tick(true));
  const timer = setInterval(() => tick(false), intervalMs);
  return () => {
    stopped = true;
    unsubscribe();
    clearInterval(timer);
  };
}
