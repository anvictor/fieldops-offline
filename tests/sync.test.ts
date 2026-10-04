import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createSyncManager, SYNC_LOCK } from "../src/sync";
import { resolveApiConfig, sendQueueItem, normalizeTitle, SyncFailure } from "../src/api";
import { deleteInspectionWithSync, loadInspections, loadSyncQueue, openFieldOpsDB,
  removeQueueItem, saveInspectionWithSync, subscribeQueueChanges } from "../src/db";
import type { SyncQueueItem, StoredInspection } from "../src/db";

const id = "00000000-0000-4000-8000-000000000001";
const inspection: StoredInspection = { id, title: "Pump", status: "draft" };
const item = (operation: SyncQueueItem["operation"] = "CREATE"): SyncQueueItem => ({
  id: crypto.randomUUID(), entityId: id, entityType: "inspection", operation,
  payload: operation === "DELETE" ? null : { ...inspection }, createdAt: "2026-01-01T00:00:00Z",
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const ack = (status = 201) => json({ ...inspection, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }, status);
const missing = () => json({ error: { code: "INSPECTION_NOT_FOUND", message: "Inspection not found." } }, 404);
const signal = () => new AbortController().signal;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// An origin-wide lock model, shared by independent managers. No component-local exclusion.
function locks() {
  let held = false;
  let tail = Promise.resolve();
  const names: string[] = [];
  const request = vi.fn((name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
    if (options.ifAvailable && options.signal) throw new Error("Invalid Web Locks options");
    names.push(name);
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    if (held && options.ifAvailable) return Promise.resolve().then(() => callback(null));
    const run = async () => {
      options.signal?.throwIfAborted();
      held = true;
      try { await callback({ name, mode: "exclusive" } as Lock); } finally { held = false; }
    };
    // Reserve immediately so simultaneous ifAvailable calls cannot both enter.
    if (!held) { held = true; const p = Promise.resolve().then(run); tail = p.catch(() => {}); return p; }
    const p = tail.then(run); tail = p.catch(() => {}); return p;
  });
  return { request: request as unknown as LockManager["request"], names, spy: request };
}
class Channel {
  static channels = new Set<Channel>();
  onmessage: (() => void) | null = null;
  constructor(public name: string) { Channel.channels.add(this); }
  postMessage(message: unknown) {
    void message;
    for (const other of Channel.channels) if (other !== this && other.name === this.name) queueMicrotask(() => other.onmessage?.());
  }
  close() { Channel.channels.delete(this); }
}
const managers: ReturnType<typeof createSyncManager>[] = [];
function manager(options: Partial<Parameters<typeof createSyncManager>[0]> = {}) {
  const m = createSyncManager({ config: { base: "", reason: null }, locks: locks(), online: () => true, ...options });
  managers.push(m); return m;
}
async function seed(items: SyncQueueItem[]) {
  const db = await openFieldOpsDB();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    for (const i of items) tx.objectStore("syncQueue").put(i);
    tx.oncomplete = () => resolve();tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", Channel); });
afterEach(() => { for (const m of managers.splice(0)) m.stop(); Channel.channels.clear(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("configuration and validation", () => {
  it("uses relative development API and normalizes production base", () => {
    expect(resolveApiConfig(true).base).toBe("");
    expect(resolveApiConfig(false, "https://api.example.com/").base).toBe("https://api.example.com");
    expect(resolveApiConfig(false, "http://localhost:3001/base/").base).toBe("http://localhost:3001/base");
  });
  it.each([undefined, "", "garbage", "/api", "ftp://example.com", "https://u:p@example.com", "https://@example.com", "https://example.com?q=1", "https://example.com#x", "https://example.com/api", " https://example.com"])("disables invalid production config %s", (value) => {
    expect(resolveApiConfig(false, value).base).toBeNull();
  });
  it("aligns Unicode title rules", () => {
    expect(normalizeTitle("  Pump  ")).toBe("Pump");expect(normalizeTitle("😀".repeat(200))).not.toBeNull();
    for (const title of [" ", "x\0", "😀".repeat(201)]) expect(normalizeTitle(title)).toBeNull();
  });
});

describe("durable IndexedDB queue", () => {
  it("upgrades v1 without data loss and puts deterministic legacy order first", async () => {
    const legacyA = { ...item(), id: "a", createdAt: "2020-01-01" };
    const legacyB = { ...item(), id: "b", createdAt: "2020-01-01" };
    const legacyC = { ...item(), id: "c", createdAt: "2019-01-01" };
    await new Promise<void>((resolve) => {
      const r = indexedDB.open("fieldops-db", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("inspections", { keyPath: "id" }).put(inspection);
        const q = r.result.createObjectStore("syncQueue", { keyPath: "id" });[legacyB, legacyA, legacyC].forEach((i) => q.put(i));
      };
      r.onsuccess = () => { r.result.close(); resolve(); };
    });
    await saveInspectionWithSync(inspection, "UPDATE");
    expect((await loadSyncQueue()).slice(0, 3)).toEqual([legacyC, legacyA, legacyB]);
    expect((await loadSyncQueue())[3].sequence).toBe(1);
    expect(await loadInspections()).toEqual([inspection]);
  });
  it("allocates monotonic sequence with mutations despite reversed timestamps", async () => {
    vi.setSystemTime(new Date("2030-01-01")); await saveInspectionWithSync(inspection, "CREATE");
    vi.setSystemTime(new Date("2020-01-01")); await saveInspectionWithSync({ ...inspection, status: "completed" }, "UPDATE");
    await deleteInspectionWithSync(id);
    const q = await loadSyncQueue();expect(q.map((i) => i.operation)).toEqual(["CREATE", "UPDATE", "DELETE"]);
    expect(q.map((i) => i.sequence)).toEqual([1, 2, 3]);expect(q[0].createdAt > q[1].createdAt).toBe(true);
    expect(await loadInspections()).toEqual([]);
    await saveInspectionWithSync(inspection, "CREATE");expect((await loadSyncQueue())[3].sequence).toBe(4);
  });
  it("rolls back inspection, insertion and sequence if queue insertion aborts", async () => {
    const original = IDBObjectStore.prototype.add;
    const mock = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === "syncQueue") { const result = original.apply(this, args); this.transaction.abort(); return result; }
      return original.apply(this, args);
    });
    await expect(saveInspectionWithSync(inspection, "CREATE")).rejects.toThrow();mock.mockRestore();
    expect(await loadInspections()).toEqual([]);expect(await loadSyncQueue()).toEqual([]);
    await saveInspectionWithSync(inspection, "CREATE");expect((await loadSyncQueue())[0].sequence).toBe(1);
  });
  it("snapshots payload before awaiting and leaves newer local state untouched on ack", async () => {
    const data = { ...inspection };const write = saveInspectionWithSync(data, "CREATE");data.title = "Changed caller";await write;
    await saveInspectionWithSync({ ...inspection, title: "New local" }, "UPDATE");
    const q = await loadSyncQueue();expect(q[0].payload!.title).toBe("Pump");
    await removeQueueItem(q[0].id, signal());expect((await loadInspections())[0].title).toBe("New local");expect((await loadSyncQueue()).length).toBe(1);
  });
});

describe("HTTP delivery and acknowledgment", () => {
  it.each([200, 201])("accepts CREATE acknowledgment %s", async (status) => {
    await expect(sendQueueItem(item(), "", signal(), vi.fn().mockResolvedValue(ack(status)))).resolves.toBeUndefined();
  });
  it("replays CREATE after a lost response with the same ID and immutable body", async () => {
    vi.useFakeTimers();const f = vi.fn().mockRejectedValueOnce(new TypeError("lost response")).mockResolvedValueOnce(ack(200));
    const p = sendQueueItem(item(), "", signal(), f);await vi.runAllTimersAsync();await p;
    expect(f).toHaveBeenCalledTimes(2);expect(f.mock.calls[0][1].body).toBe(f.mock.calls[1][1].body);
  });
  it.each(["network", "timeout", "5xx"])("bounds retries after %s failure", async (kind) => {
    vi.useFakeTimers();const f = vi.fn(kind === "network" ? () => Promise.reject(new TypeError("network")) : kind === "timeout" ? () => new Promise<Response>(() => {}) : () => Promise.resolve(json({}, 503)));
    const p = sendQueueItem(item(), "", signal(), f);const check = expect(p).rejects.toMatchObject({ permanent: false });await vi.runAllTimersAsync();await check;expect(f).toHaveBeenCalledTimes(3);
  });
  it("uses exactly the 8s timeout and 500ms/1000ms backoffs", async () => {
    vi.useFakeTimers();const f = vi.fn(() => new Promise<Response>(() => {}));const p = sendQueueItem(item(), "", signal(), f);const check = expect(p).rejects.toMatchObject({ permanent: false });
    expect(f).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(8499);expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(f).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(8999);expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);expect(f).toHaveBeenCalledTimes(3);await vi.advanceTimersByTimeAsync(8000);await check;
  });
  it.each([400, 401, 409, 429])("retains permanent HTTP %s without retry", async (status) => {
    const f = vi.fn().mockResolvedValue(json({ error: { code: status === 409 ? "ID_CONFLICT" : "INVALID_INPUT", message: "private server detail" } }, status));
    await expect(sendQueueItem(item(), "", signal(), f)).rejects.toMatchObject({ permanent: true });expect(f).toHaveBeenCalledTimes(1);
  });
  it("PATCH missing entity permanently blocks, repeated DELETE missing is confirmed", async () => {
    await expect(sendQueueItem(item("UPDATE"), "", signal(), vi.fn().mockResolvedValue(missing()))).rejects.toMatchObject({ permanent: true });
    await expect(sendQueueItem(item("DELETE"), "", signal(), vi.fn().mockResolvedValue(missing()))).resolves.toBeUndefined();
    await expect(sendQueueItem(item("DELETE"), "", signal(), vi.fn().mockResolvedValue(new Response(null, { status: 204 })))).resolves.toBeUndefined();
  });
  it.each([() => json({ error: { code: "NOT_FOUND", message: "proxy" } }, 404), () => new Response("not found", { status: 404 }),
    () => new Response(JSON.stringify({ error: { code: "INSPECTION_NOT_FOUND", message: "x" } }), { status: 404 }),
    () => json({ error: { code: "INSPECTION_NOT_FOUND" } }, 404)])("never confirms an untrusted DELETE 404", async (response) => {
    await expect(sendQueueItem(item("DELETE"), "", signal(), vi.fn().mockResolvedValue(response()))).rejects.toMatchObject({ permanent: true });
  });
  it.each([() => json({ ...inspection }), () => json({ ...inspection, id: crypto.randomUUID(), createdAt: "2026-01-01", updatedAt: "2026-01-01" }),
    () => new Response("invalid", { status: 201, headers: { "Content-Type": "application/json" } }), () => ack(202)])("rejects malformed/unexpected acknowledgment", async (response) => {
    await expect(sendQueueItem(item(), "", signal(), vi.fn().mockResolvedValue(response()))).rejects.toMatchObject({ permanent: true });
  });
  it("preserves invalid legacy payload without a network request", async () => {
    const i = item();i.payload!.title = " ";const f = vi.fn();await expect(sendQueueItem(i, "", signal(), f)).rejects.toMatchObject({ permanent: true });expect(f).not.toHaveBeenCalled();
  });
  it("aborts promptly even if a lost request later resolves", async () => {
    const c = new AbortController();const response = deferred<Response>();const p = sendQueueItem(item(), "", c.signal, () => response.promise);
    c.abort();await expect(p).rejects.toMatchObject({ name: "AbortError" });response.resolve(ack());
  });
});

describe("Web Lock coordination and UI state", () => {
  it("replays CREATE -> UPDATE -> DELETE in order and picks up newly queued work", async () => {
    await saveInspectionWithSync(inspection, "CREATE");const seen: string[] = [];
    const m = manager({ send: async (i) => { seen.push(i.operation);if (i.operation === "CREATE") {
      await saveInspectionWithSync({ ...inspection, status: "completed" }, "UPDATE");await deleteInspectionWithSync(id);
    } } });
    const states: boolean[] = [];m.subscribe(() => states.push(m.getSnapshot().syncing));await m.trigger();
    expect(seen).toEqual(["CREATE", "UPDATE", "DELETE"]);expect(await loadSyncQueue()).toEqual([]);expect(states).toContain(true);
    expect(m.getSnapshot()).toMatchObject({ pendingCount: 0, syncing: false, error: null });
  });
  it("retains failed and following items, exposes safe failure, and Retry resumes", async () => {
    await saveInspectionWithSync(inspection, "CREATE");await deleteInspectionWithSync(id);
    const send = vi.fn().mockRejectedValue(new SyncFailure("Blocked", true));const m = manager({ send });await m.trigger();
    expect((await loadSyncQueue()).length).toBe(2);expect(m.getSnapshot()).toMatchObject({ pendingCount: 2, syncing: false, error: { permanent: true } });
    send.mockResolvedValue(undefined);await m.trigger();expect(send).toHaveBeenCalledTimes(1);await m.retry();expect((await loadSyncQueue()).length).toBe(0);
  });
  it("does not remove until acknowledgment, and abort prevents removal after late completion", async () => {
    await saveInspectionWithSync(inspection, "CREATE");const gate = deferred();const entered = deferred();
    const remove = vi.fn(removeQueueItem);const m = manager({ send: async () => { entered.resolve();await gate.promise; }, remove });
    const run = m.trigger();await entered.promise;expect((await loadSyncQueue()).length).toBe(1);m.stop();gate.resolve();await run;
    expect(remove).not.toHaveBeenCalled();expect((await loadSyncQueue()).length).toBe(1);
  });
  it("acknowledgment transaction failure keeps queued operation and local state", async () => {
    await saveInspectionWithSync(inspection, "CREATE");
    const original = IDBObjectStore.prototype.delete;
    const mock = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, key) {
      const result = original.call(this, key);if (this.name === "syncQueue") this.transaction.abort();return result;
    });
    const m = manager({ send: async () => {} });await m.trigger();mock.mockRestore();
    expect((await loadSyncQueue()).length).toBe(1);expect(await loadInspections()).toEqual([inspection]);expect(m.getSnapshot().error?.permanent).toBe(false);
  });
  it("shares one Web Lock across two live runners and overlapping triggers", async () => {
    await saveInspectionWithSync(inspection, "CREATE");const lock = locks();const gate = deferred();const entered = deferred();let inFlight = 0;let max = 0;
    const send = vi.fn(async () => { inFlight++;max = Math.max(max, inFlight);entered.resolve();await gate.promise;inFlight--; });
    const a = manager({ locks: lock, send });const b = manager({ locks: lock, send });const one = a.trigger();await entered.promise;
    const two = a.trigger();await b.trigger();expect(send).toHaveBeenCalledTimes(1);gate.resolve();await Promise.all([one, two]);
    expect(max).toBe(1);expect(new Set(lock.names)).toEqual(new Set([SYNC_LOCK]));expect(await loadSyncQueue()).toEqual([]);
  });
  it("unsupported Web Locks or missing production config preserves queue and never sends", async () => {
    await saveInspectionWithSync(inspection, "CREATE");const send = vi.fn();const a = manager({ locks: undefined, send });a.start();await tick();await a.trigger();
    expect(a.getSnapshot().unavailable).toBe("Synchronization unavailable in this browser");
    const b = manager({ config: resolveApiConfig(false), send });b.start();await tick();await b.trigger();
    expect(b.getSnapshot().unavailable).toBeTruthy();expect(send).not.toHaveBeenCalled();expect((await loadSyncQueue()).length).toBe(1);
  });
  it("discard requires confirmation, uses same lock and never deletes local inspection", async () => {
    await saveInspectionWithSync(inspection, "CREATE");const lock = locks();const m = manager({ locks: lock, send: async () => { throw new SyncFailure("Blocked", true); } });await m.trigger();
    const before = lock.names.length;await m.discard(() => false);expect(lock.names.length).toBe(before);expect((await loadSyncQueue()).length).toBe(1);
    const confirm = vi.fn(() => true);await m.discard(confirm);expect(confirm.mock.calls[0][0]).toContain("Discarding CREATE");
    expect(lock.names[before]).toBe(SYNC_LOCK);expect(await loadSyncQueue()).toEqual([]);expect(await loadInspections()).toEqual([inspection]);
  });
  it("discard waits for same lock and rechecks an item removed by another runner", async () => {
    await saveInspectionWithSync(inspection, "CREATE");const lock = locks();const remove = vi.fn(removeQueueItem);
    const m = manager({ locks: lock, remove, send: async () => { throw new SyncFailure("Blocked", true); } });await m.trigger();
    const gate = deferred();const entered = deferred();const other = lock.request(SYNC_LOCK, { mode: "exclusive" }, async () => {
      entered.resolve();await gate.promise;await removeQueueItem((await loadSyncQueue())[0].id, signal());
    });await entered.promise;
    const discarded = m.discard(() => true);expect(remove).not.toHaveBeenCalled();gate.resolve();await other;await discarded;expect(remove).not.toHaveBeenCalled();
  });
  it("cross-tab notification rereads IndexedDB rather than trusting a message count", async () => {
    let online = false;const m = manager({ online: () => online, send: async () => {} });m.start();await tick();
    await seed([item()]);const other = new Channel("fieldops-queue-changed");other.postMessage({ count: 999 });
    await vi.waitFor(() => expect(m.getSnapshot().pendingCount).toBe(1));expect((await loadSyncQueue()).length).toBe(1);
    online = true;await m.trigger();expect(m.getSnapshot().pendingCount).toBe(0);other.close();
  });
  it("online startup and online queue mutation automatically trigger synchronization", async () => {
    await saveInspectionWithSync(inspection, "CREATE");
    const send = vi.fn(async () => {});const m = manager({ send });m.start();
    await vi.waitFor(() => expect(m.getSnapshot().pendingCount).toBe(0));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await deleteInspectionWithSync(id);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(m.getSnapshot().pendingCount).toBe(0));
  });
  it("aborted acknowledgment cannot start a removal transaction", async () => {
    await saveInspectionWithSync(inspection, "CREATE");const q = await loadSyncQueue();const c = new AbortController();c.abort();
    await expect(removeQueueItem(q[0].id, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect((await loadSyncQueue()).length).toBe(1);
  });
  it("queue subscription cleanup stops notifications", async () => {
    const notify = vi.fn();const stop = subscribeQueueChanges(notify);stop();await saveInspectionWithSync(inspection, "CREATE");expect(notify).not.toHaveBeenCalled();
  });
});

describe("review regressions: restart ownership and response streams", () => {
  it.each(["load", "send"])("waits for the old lock after stop/start during %s", async (stage) => {
    const queued = item();let queue = [queued];
    const entered = deferred();const release = deferred();const nextEntered = deferred();const nextRelease = deferred();
    const lock = locks();let firstLoad = true;let sends = 0;
    const load = async () => {
      if (firstLoad) {
        firstLoad = false;
        if (stage === "load") { entered.resolve();await release.promise; }
      }
      return [...queue];
    };
    const send = vi.fn(async (_item, _base, owner: AbortSignal) => {
      sends++;
      if (stage === "send" && sends === 1) { entered.resolve();await release.promise;expect(owner.aborted).toBe(true); }
      else { nextEntered.resolve();await nextRelease.promise; }
    });
    const remove = vi.fn(async () => { queue = []; });
    const m = manager({ locks: lock, load, send, remove, subscribeQueue: () => () => {} });
    const old = m.trigger();await entered.promise;
    m.stop();m.start();void m.trigger();
    release.resolve();await old;
    await nextEntered.promise;
    expect(remove).not.toHaveBeenCalled();
    expect(lock.spy).toHaveBeenCalledTimes(2);
    expect(m.getSnapshot().syncing).toBe(true);
    nextRelease.resolve();
    await vi.waitFor(() => expect(m.getSnapshot()).toMatchObject({ syncing: false, pendingCount: 0, error: null }));
    expect(remove).toHaveBeenCalledExactlyOnceWith(queued.id, expect.any(AbortSignal));
    expect(queue).toEqual([]);
    // Retry is enabled once idle and can process newly queued work.
    queue = [item()];await m.retry();expect(remove).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale refresh failure after a new generation starts", async () => {
    const release = deferred();let first = true;
    const m = manager({ load: async () => {
      if (first) { first = false;await release.promise;throw new Error("old read failed"); }
      return [];
    }, subscribeQueue: () => () => {} });
    m.start();m.stop();m.start();void m.trigger();
    release.resolve();await tick();
    expect(m.getSnapshot()).toMatchObject({ syncing: false, pendingCount: 0, error: null });
  });

  it("an old pending Retry cannot clear the restarted generation's failure", async () => {
    const entered = deferred();const release = deferred();let first = true;const queued = item();
    const m = manager({ load: async () => [queued], send: async () => {
      if (first) { first = false;entered.resolve();await release.promise; }
      else throw new SyncFailure("New failure", true);
    }, subscribeQueue: () => () => {} });
    const old = m.trigger();await entered.promise;const retry = m.retry();
    m.stop();m.start();release.resolve();await old;await retry;
    await vi.waitFor(() => expect(m.getSnapshot().error?.message).toBe("New failure"));
    expect(m.getSnapshot().syncing).toBe(false);
  });

  it("retries an errored response stream exactly three times and retains the queue", async () => {
    vi.useFakeTimers();const queued = item();const bodies: unknown[] = [];
    const f = vi.fn(async (_url, init) => {
      bodies.push(init.body);
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"id":')); },
        pull(controller) { controller.error(new TypeError("socket terminated")); },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    const remove = vi.fn();const m = manager({ load: async () => [queued], remove,
      send: (entry, base, owner) => sendQueueItem(entry, base, owner, f) });
    const run = m.trigger();
    await vi.advanceTimersByTimeAsync(499);expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);await run;expect(f).toHaveBeenCalledTimes(3);
    expect(new Set(bodies).size).toBe(1);expect(remove).not.toHaveBeenCalled();
    expect(m.getSnapshot()).toMatchObject({ pendingCount: 1, syncing: false, error: { permanent: false } });
  });

  it.each(['{"id":', '{"id":"wrong"}'])("complete invalid acknowledgment %s is permanent without retry", async (body) => {
    const f = vi.fn(async () => new Response(body, { status: 201, headers: { "Content-Type": "application/json" } }));
    await expect(sendQueueItem(item(), "", signal(), f)).rejects.toMatchObject({ permanent: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("aborts during response body reading without retry or acknowledgment", async () => {
    const reading = deferred();let stream!: ReadableStreamDefaultController<Uint8Array>;
    const f = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { stream = controller;controller.enqueue(new TextEncoder().encode('{"id":')); },
      pull() { reading.resolve(); },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    const remove = vi.fn();const m = manager({ load: async () => [item()], remove,
      send: (entry, base, owner) => sendQueueItem(entry, base, owner, f) });
    const run = m.trigger();await reading.promise;m.pause();await run;
    expect(f).toHaveBeenCalledTimes(1);expect(remove).not.toHaveBeenCalled();
    expect(m.getSnapshot()).toMatchObject({ syncing: false, error: null, pendingCount: 1 });
    stream.close();
  });
});
