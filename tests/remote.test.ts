import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { fetchSnapshot, parseSnapshot } from "../src/remoteApi";
import { applyRemoteSnapshot, reserveRemoteCheck, saveInspectionWithSync, loadInspections, loadSyncQueue, openFieldOpsDB, deleteInspectionWithSync, importInspectionBatch } from "../src/db";
import { createSyncManager } from "../src/sync";
import { renameInspection } from "../src/inspections";
import { subscribeActivity } from "../src/activity";

const id = "00000000-0000-4000-8000-000000000021";
const row = { id, title: "Shared", status: "draft" as const };
const remote = { ...row, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" };
const empty = { inspections: [], deletedIds: [] };
const signal = () => new AbortController().signal;
const managers: ReturnType<typeof createSyncManager>[] = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function locks() {
  let held = false;
  return { request: ((_name: string, _options: unknown, callback: (value: unknown) => Promise<void>) => {
    if (held) return Promise.resolve(callback(null));
    held = true;
    return Promise.resolve().then(() => callback({ name: "test", mode: "exclusive" })).finally(() => { held = false; });
  }) as LockManager["request"] };
}
function setup(overrides: Partial<Parameters<typeof createSyncManager>[0]> = {}) {
  let now = 100000;
  const snapshot = vi.fn(async () => empty);
  const manager = createSyncManager({ remote: true, config: { base: "", reason: null },
    locks: locks(), load: async () => [], online: () => true, visible: () => true, now: () => now, snapshot, ...overrides });
  managers.push(manager);
  manager.start();
  return { manager, snapshot, advance: (ms: number) => { now += ms; } };
}
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { managers.splice(0).forEach(manager => manager.stop()); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("validates snapshots completely before returning local fields", async () => {
  expect(parseSnapshot({ inspections: [remote], deletedIds: [] })).toEqual({ inspections: [row], deletedIds: [] });
  for (const data of [[], null, {}, { inspections: [], deletedIds: ["invalid"] },
    { inspections: [remote, remote], deletedIds: [] }, { inspections: [remote], deletedIds: [id] },
    { inspections: [{ ...remote, title: " " }], deletedIds: [] },
    { inspections: [{ ...remote, updatedAt: "invalid" }], deletedIds: [] },
    { inspections: [], deletedIds: Array(5001).fill(id) }]) expect(() => parseSnapshot(data)).toThrow();
  for (const result of [response({}, 500), response({}, 401), response({ inspections: [] }),
    new Response("<html>no</html>", { headers: { "Content-Type": "text/html" } })]) {
    await expect(fetchSnapshot("", signal(), undefined, vi.fn(async () => result))).rejects.toThrow();
  }
  const fetcher = vi.fn(async () => response({ inspections: [remote], deletedIds: [] }));
  expect(await fetchSnapshot("", signal(), undefined, fetcher)).toEqual({ inspections: [row], deletedIds: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects an oversized streamed response rather than partially applying it", async () => {
  const fetcher = vi.fn(async () => new Response(" ".repeat(2 * 1024 * 1024 + 1), { headers: { "Content-Type": "application/json" } }));
  await expect(fetchSnapshot("", signal(), undefined, fetcher)).rejects.toThrow();
});

it("merges remote active rows but protects every pending id and unknown local-only rows", async () => {
  await saveInspectionWithSync(row, "CREATE");
  const before = await loadSyncQueue();
  const other = { ...row, id: "00000000-0000-4000-8000-000000000022", title: "Downloaded" };
  await applyRemoteSnapshot({ inspections: [{ ...row, title: "Remote overwrite" }, other], deletedIds: [] }, signal());
  expect((await loadInspections()).find(value => value.id === id)?.title).toBe("Shared");
  expect(await loadInspections()).toContainEqual(other);
  await applyRemoteSnapshot(empty, signal());
  expect(await loadInspections()).toHaveLength(2);
  expect(await loadSyncQueue()).toEqual(before);
});

it("retirement removes live record while immutable pending payload survives and future writes fail", async () => {
  await saveInspectionWithSync(row, "CREATE");
  const before = await loadSyncQueue();
  await applyRemoteSnapshot({ inspections: [], deletedIds: [id] }, signal());
  expect(await loadInspections()).toEqual([]);
  expect(await loadSyncQueue()).toEqual(before);
  await expect(renameInspection(id, "Late draft")).rejects.toThrow("deleted");
  await applyRemoteSnapshot({ inspections: [row], deletedIds: [] }, signal());
  expect(await loadInspections()).toEqual([]);
  expect(await loadSyncQueue()).toEqual(before);
});

it("rolls back a partial reconciliation on write failure or aborted lifetime", async () => {
  await applyRemoteSnapshot({ inspections: [row], deletedIds: [] }, signal());
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value, key) {
    if (this.name === "syncMetadata") throw new Error("fixture fault");
    return put.call(this, value, key);
  });
  await expect(applyRemoteSnapshot({ inspections: [], deletedIds: [id] }, signal())).rejects.toThrow();
  expect(await loadInspections()).toEqual([row]);
  const aborted = new AbortController(); aborted.abort();
  await expect(applyRemoteSnapshot(empty, aborted.signal)).rejects.toThrow();
});

it("persists shared 30sec reservations and repairs malformed/future timestamps fail-closed", async () => {
  expect(await reserveRemoteCheck("", 100000, signal())).toBe(true);
  expect(await reserveRemoteCheck("", 129999, signal())).toBe(false);
  expect(await reserveRemoteCheck("", 130000, signal())).toBe(true);
  const db = await openFieldOpsDB();
  await new Promise<void>((resolve) => { const tx = db.transaction("syncMetadata", "readwrite"); tx.objectStore("syncMetadata").put("broken", "remoteCheck:"); tx.oncomplete = () => resolve(); }); db.close();
  expect(await reserveRemoteCheck("", 200000, signal())).toBe(false);
  expect(await reserveRemoteCheck("", 230000, signal())).toBe(true);
  expect(await reserveRemoteCheck("", 220000, signal())).toBe(false);
  expect(await reserveRemoteCheck("", 250000, signal())).toBe(true);
});

describe("activity read coordinator", () => {
  it("does no idle polling, ignores bursts, and waits for next activity after interval", async () => {
    const { manager, snapshot, advance } = setup();
    await manager.retry(); await tick();
    expect(snapshot).not.toHaveBeenCalled();
    await manager.pull();
    expect(snapshot).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i++) await manager.pull();
    advance(29999); await manager.pull(); expect(snapshot).toHaveBeenCalledTimes(1);
    advance(60000); await tick(); expect(snapshot).toHaveBeenCalledTimes(1);
    await manager.pull(); expect(snapshot).toHaveBeenCalledTimes(2);
  });
  it("shares rate budget across independent managers and reload-like recreation, including failed GET", async () => {
    const shared = locks();
    const failure = vi.fn(async () => { throw new Error("offline fixture"); });
    const a = setup({ locks: shared, snapshot: failure });
    await a.manager.retry(); await tick(); await a.manager.pull();
    a.manager.stop();
    const b = setup({ locks: shared });
    await b.manager.retry(); await tick(); await b.manager.pull();
    expect(failure).toHaveBeenCalledTimes(1); expect(b.snapshot).not.toHaveBeenCalled();
    await b.manager.retry(); b.advance(30000); await b.manager.pull(); expect(b.snapshot).toHaveBeenCalledTimes(1);
  });
  it("never overlaps; an obsolete response cannot apply after disconnect/lifetime stop", async () => {
    let release!: (value: typeof empty) => void;
    const pending = new Promise<typeof empty>(resolve => { release = resolve; });
    const snapshot = vi.fn(async () => pending);
    const { manager, advance } = setup({ snapshot });
    await manager.retry(); await tick();
    const running = manager.pull();
    while (!snapshot.mock.calls.length) await tick();
    advance(60000); await manager.pull(); expect(snapshot).toHaveBeenCalledTimes(1);
    manager.stop();
    release({ inspections: [row], deletedIds: [] }); await running;
    expect(await loadInspections()).toEqual([]);
  });
  it("requires visible online state and per-tab credentials", async () => {
    for (const options of [{ visible: () => false }, { online: () => false },
      { requireCredential: true, config: { base: "https://api.example.test", reason: null } }]) {
      const { manager, snapshot } = setup(options); await tick(); await manager.pull();
      expect(snapshot).not.toHaveBeenCalled(); manager.stop();
    }
  });
});

it("subscribes to activity/visible resume only and cleans up; hidden state cancels", () => {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const check = vi.fn(); const hidden = vi.fn();
  const stop = subscribeActivity(window as unknown as Window, document as unknown as Document, check, hidden);
  expect(check).not.toHaveBeenCalled();
  for (const event of ["pointermove", "pointerdown", "keydown", "scroll", "focus"]) window.dispatchEvent(new Event(event));
  expect(check).toHaveBeenCalledTimes(5);
  document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("keydown")); expect(check).toHaveBeenCalledTimes(5); expect(hidden).toHaveBeenCalledTimes(1);
  document.visibilityState = "visible"; document.dispatchEvent(new Event("visibilitychange")); expect(check).toHaveBeenCalledTimes(6);
  stop(); window.dispatchEvent(new Event("focus")); expect(check).toHaveBeenCalledTimes(6);
});

it("times out a read once without automatic retry", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })) as unknown as typeof fetch;
  const rejected = expect(fetchSnapshot("", signal(), undefined, fetcher)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(8000); await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("aborting after a reconciliation write begins rolls back all local changes", async () => {
  await applyRemoteSnapshot({ inspections: [row], deletedIds: [] }, signal());
  const controller = new AbortController();
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value, key) {
    const request = original.call(this, value, key);
    if (this.name === "inspections") controller.abort();
    return request;
  });
  await expect(applyRemoteSnapshot({ inspections: [{ ...row, title: "Obsolete" }], deletedIds: [] }, controller.signal)).rejects.toThrow();
  expect(await loadInspections()).toEqual([row]);
});

it("a credential generation change cannot apply an old successful read", async () => {
  let release!: (value: typeof empty) => void;
  const pending = new Promise<typeof empty>(resolve => { release = resolve; });
  const snapshot = vi.fn(async () => pending);
  const { manager } = setup({ requireCredential: true, config: { base: "https://api.example.test", reason: null }, snapshot });
  const connecting = manager.setCredential("fixture".padEnd(43, "x"));
  while (!snapshot.mock.calls.length) await tick();
  const disconnecting = manager.setCredential(null);
  release({ inspections: [row], deletedIds: [] });
  await connecting; await disconnecting;
  expect(await loadInspections()).toEqual([]);
  expect(manager.getSnapshot().connected).toBe(false);
});
it("slow reads reserve completion time so next HTTP cannot start too soon", async () => {
  let release!: (value: typeof empty) => void;
  const pending = new Promise<typeof empty>(resolve => { release = resolve; });
  const snapshot = vi.fn().mockImplementationOnce(async () => pending).mockResolvedValue(empty);
  const { manager, advance } = setup({ snapshot });
  await manager.retry(); await tick();
  const running = manager.pull();
  while (!snapshot.mock.calls.length) await tick();
  advance(15000); release(empty); await running; await manager.retry();
  advance(15000); await manager.pull(); expect(snapshot).toHaveBeenCalledTimes(1);
  await manager.retry(); advance(30000); await manager.pull(); expect(snapshot).toHaveBeenCalledTimes(2);
});

it("pending DELETE cannot be undone by active snapshot; retired IDs cannot be imported/recreated locally", async () => {
  await saveInspectionWithSync(row, "CREATE"); await deleteInspectionWithSync(id);
  const before = await loadSyncQueue();
  await applyRemoteSnapshot({ inspections: [row], deletedIds: [] }, signal());
  expect(await loadInspections()).toEqual([]); expect(await loadSyncQueue()).toEqual(before);
  await applyRemoteSnapshot({ inspections: [], deletedIds: [id] }, signal());
  await expect(saveInspectionWithSync(row, "CREATE")).rejects.toThrow("deleted");
  expect(await importInspectionBatch([row])).toEqual({ imported: 0, skipped: 1 });
  expect(await loadSyncQueue()).toEqual(before);
});
it("a changed API base or hidden page cannot apply a late response", async () => {
  let release!: (value: typeof empty) => void;
  const pending = new Promise<typeof empty>(resolve => { release = resolve; });
  const snapshot = vi.fn(async () => pending);
  const config = { base: "https://api.old.test", reason: null };
  let visible = true;
  const { manager } = setup({ config, visible: () => visible, snapshot });
  await manager.retry(); await tick(); const running = manager.pull();
  while (!snapshot.mock.calls.length) await tick();
  config.base = "https://api.new.test"; visible = false; manager.pauseReads();
  release({ inspections: [row], deletedIds: [] }); await running;
  expect(await loadInspections()).toEqual([]);
});
