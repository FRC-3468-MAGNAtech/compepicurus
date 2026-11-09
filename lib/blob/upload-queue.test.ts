import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadResult } from "@/lib/blob/client";
import {
  DEFAULT_MAX_DELAY_MS,
  createMemoryStore,
  createUploadQueue,
  retryDelay,
  startQueueProcessing,
  type OnlineSource,
  type QueueItem,
  type Uploader,
} from "@/lib/blob/upload-queue";

const blob = (text = "x") => new Blob([text], { type: "image/jpeg" });
const item = (id: string) => ({ id, blob: blob(id), path: `pit/t/E/1/${id}.jpg`, clientPayload: "{}", fieldRef: `field/${id}` });
const okResult = (i: QueueItem): UploadResult => ({ url: `https://s.public.blob.vercel-storage.com/${i.path}`, pathname: i.path, size: 1, contentType: "image/jpeg" });

let clock = 1_000_000;
const now = () => clock;
const make = (store = createMemoryStore()) => createUploadQueue(store, { now, baseDelayMs: 1000, maxDelayMs: 8000 }).then((queue) => ({ queue, store }));

beforeEach(() => {
  clock = 1_000_000;
});

describe("retryDelay", () => {
  it("doubles from the base and caps", () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelay(n, 1000, 8000))).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(retryDelay(100, 1000, 8000)).toBe(8000);
    expect(retryDelay(10_000)).toBe(DEFAULT_MAX_DELAY_MS);
  });
  it("is zero for no failures or nonsense", () => {
    expect(retryDelay(0)).toBe(0);
    expect(retryDelay(-1)).toBe(0);
    expect(retryDelay(NaN)).toBe(0);
  });
});

describe("enqueue and ordering", () => {
  it("uploads in the order items were added, one at a time", async () => {
    const { queue } = await make();
    await queue.enqueue(item("a"));
    await queue.enqueue(item("b")); // same millisecond as a
    await queue.enqueue(item("c"));
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const uploader: Uploader = async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      order.push(i.id);
      active--;
      return okResult(i);
    };
    expect(await queue.processAll(uploader)).toEqual({ uploaded: 3, failed: 0 });
    expect(order).toEqual(["a", "b", "c"]);
    expect(maxActive).toBe(1);
  });

  it("rejects a duplicate id", async () => {
    const { queue } = await make();
    await queue.enqueue(item("a"));
    await expect(queue.enqueue(item("a"))).rejects.toThrow();
  });

  it("marks done with the result, drops the blob, and removes on request", async () => {
    const { queue, store } = await make();
    await queue.enqueue(item("a"));
    await queue.processAll(async (i) => okResult(i));
    const done = queue.get("a");
    expect(done).toMatchObject({ status: "done", blob: null, result: { pathname: "pit/t/E/1/a.jpg", contentType: "image/jpeg" } });
    expect(queue.hasWork()).toBe(false);
    expect(store.items.get("a")?.blob).toBeNull();
    await queue.remove("a");
    expect(queue.get("a")).toBeUndefined();
    expect(store.items.size).toBe(0);
  });

  it("does not upload done items again", async () => {
    const { queue } = await make();
    await queue.enqueue(item("a"));
    const uploader = vi.fn(async (i: QueueItem) => okResult(i));
    await queue.processAll(uploader);
    await queue.processAll(uploader);
    expect(uploader).toHaveBeenCalledTimes(1);
  });
});

describe("failure, backoff and retry", () => {
  it("fails, waits out the backoff, then succeeds", async () => {
    const { queue } = await make();
    await queue.enqueue(item("a"));
    let calls = 0;
    const uploader: Uploader = async (i) => {
      if (++calls < 3) throw new Error("offline");
      return okResult(i);
    };

    expect(await queue.processAll(uploader)).toEqual({ uploaded: 0, failed: 1 });
    expect(queue.get("a")).toMatchObject({ status: "failed", attempts: 1, lastError: "offline", nextAttemptAt: clock + 1000 });
    expect(queue.get("a")?.blob).not.toBeNull(); // kept until done
    expect(queue.hasWork()).toBe(true);

    // Not due yet: skipped.
    clock += 500;
    expect(await queue.processAll(uploader)).toEqual({ uploaded: 0, failed: 0 });
    expect(calls).toBe(1);

    clock += 600;
    expect(await queue.processAll(uploader)).toEqual({ uploaded: 0, failed: 1 });
    expect(queue.get("a")).toMatchObject({ attempts: 2, nextAttemptAt: clock + 2000 });

    clock += 2000;
    expect(await queue.processAll(uploader)).toEqual({ uploaded: 1, failed: 0 });
    expect(queue.get("a")).toMatchObject({ status: "done", lastError: null });
  });

  it("force ignores the backoff", async () => {
    const { queue } = await make();
    await queue.enqueue(item("a"));
    let fail = true;
    const uploader: Uploader = async (i) => {
      if (fail) throw new Error("nope");
      return okResult(i);
    };
    await queue.processAll(uploader);
    fail = false;
    expect(await queue.processAll(uploader, { force: true })).toEqual({ uploaded: 1, failed: 0 });
  });

  it("one failing item doesn't block the others, and isn't retried within the same run", async () => {
    const { queue } = await make();
    await queue.enqueue(item("bad"));
    await queue.enqueue(item("good"));
    const uploader = vi.fn(async (i: QueueItem) => {
      if (i.id === "bad") throw new Error("boom");
      return okResult(i);
    });
    expect(await queue.processAll(uploader, { force: true })).toEqual({ uploaded: 1, failed: 1 });
    expect(uploader).toHaveBeenCalledTimes(2);
    expect(queue.get("good")?.status).toBe("done");
    expect(queue.get("bad")?.status).toBe("failed");
  });

  it("concurrent processAll calls share one run", async () => {
    const { queue } = await make();
    await queue.enqueue(item("a"));
    const uploader = vi.fn(async (i: QueueItem) => okResult(i));
    const [r1, r2] = await Promise.all([queue.processAll(uploader), queue.processAll(uploader)]);
    expect(r1).toBe(r2);
    expect(uploader).toHaveBeenCalledTimes(1);
  });

  it("an item removed mid-upload stays removed", async () => {
    const { queue, store } = await make();
    await queue.enqueue(item("a"));
    await queue.processAll(async (i) => {
      await queue.remove(i.id);
      return okResult(i);
    });
    expect(queue.get("a")).toBeUndefined();
    expect(store.items.size).toBe(0);
  });
});

describe("persistence across reloads", () => {
  it("restores items and puts a crashed 'uploading' item back to pending", async () => {
    const store = createMemoryStore();
    const first = (await make(store)).queue;
    await first.enqueue(item("a"));
    await first.enqueue(item("b"));
    await first.processAll(async (i) => okResult(i), { force: true });
    await first.enqueue(item("c"));
    // Simulate a reload that interrupted c mid-upload.
    store.items.set("c", { ...store.items.get("c")!, status: "uploading" });

    const second = (await make(store)).queue;
    expect(second.list().map((i) => [i.id, i.status])).toEqual([
      ["a", "done"],
      ["b", "done"],
      ["c", "pending"],
    ]);
    expect(second.get("a")?.result?.pathname).toBe("pit/t/E/1/a.jpg");
    expect(second.get("c")?.blob).toBeInstanceOf(Blob);
    // seq continues, so new items still sort after restored ones.
    await second.enqueue(item("d"));
    expect(second.list().map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    const done: string[] = [];
    await second.processAll(async (i) => (done.push(i.id), okResult(i)));
    expect(done).toEqual(["c", "d"]);
  });
});

describe("subscribe", () => {
  it("gets the current list, then every change, until unsubscribed", async () => {
    const { queue } = await make();
    const seen: string[][] = [];
    const unsubscribe = queue.subscribe((items) => seen.push(items.map((i) => `${i.id}:${i.status}`)));
    expect(seen).toEqual([[]]);
    await queue.enqueue(item("a"));
    await queue.processAll(async (i) => okResult(i));
    expect(seen.map((s) => s.join())).toEqual(["", "a:pending", "a:uploading", "a:done"]);
    unsubscribe();
    await queue.remove("a");
    expect(seen).toHaveLength(4);
  });

  it("survives a throwing listener", async () => {
    const { queue } = await make();
    queue.subscribe(() => {
      throw new Error("bad listener");
    });
    await expect(queue.enqueue(item("a"))).resolves.toBeDefined();
  });
});

describe("startQueueProcessing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const fakeOnline = () => {
    const listeners = new Set<() => void>();
    const source: OnlineSource & { online: boolean; fire(): void } = {
      online: true,
      isOnline() {
        return this.online;
      },
      subscribe(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      fire() {
        listeners.forEach((l) => l());
      },
    };
    return source;
  };

  it("processes on start, when back online (ignoring backoff), and on the interval while work remains", async () => {
    const { queue } = await make();
    await queue.enqueue(item("a"));
    const online = fakeOnline();
    let failures = 2;
    const uploader = vi.fn(async (i: QueueItem) => {
      if (failures-- > 0) throw new Error("offline");
      return okResult(i);
    });

    const stop = startQueueProcessing(queue, uploader, { onlineSource: online, intervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(uploader).toHaveBeenCalledTimes(1); // start: fails, backoff to clock+1000

    // The interval fires but the (fake) clock hasn't moved, so the item isn't due.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(uploader).toHaveBeenCalledTimes(1);

    // 'online' forces it.
    online.fire();
    await vi.advanceTimersByTimeAsync(0);
    expect(uploader).toHaveBeenCalledTimes(2);
    expect(queue.get("a")?.status).toBe("failed");

    // Due again after the backoff: the interval picks it up.
    clock += 5000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(queue.get("a")?.status).toBe("done");

    // Nothing left: no more calls.
    const calls = uploader.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(uploader).toHaveBeenCalledTimes(calls);
    stop();
  });

  it("does nothing while offline, and stop() halts everything", async () => {
    const { queue } = await make();
    await queue.enqueue(item("a"));
    const online = fakeOnline();
    online.online = false;
    const uploader = vi.fn(async (i: QueueItem) => okResult(i));
    const stop = startQueueProcessing(queue, uploader, { onlineSource: online, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(uploader).not.toHaveBeenCalled();
    stop();
    online.online = true;
    online.fire();
    await vi.advanceTimersByTimeAsync(5000);
    expect(uploader).not.toHaveBeenCalled();
  });
});
