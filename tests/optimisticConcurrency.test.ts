import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  acknowledgeQueueItem, applyRemoteSnapshot, loadEditSource, loadInspections, loadReviewDraft,
  loadSyncQueue, openFieldOpsDB, replaceReviewedUpdate, resolveExpectedVersion, saveInspection,
  saveInspectionWithSync, saveReviewDraft,
} from "../src/db";
import type { StoredInspection, SyncQueueItem } from "../src/db";
import { renameInspection, toggleInspection } from "../src/inspections";
import { sendQueueItem, VersionConflictFailure } from "../src/api";
import { fetchReviewInspection, parseSnapshot } from "../src/remoteApi";
import { createSyncManager } from "../src/sync";

const id = "00000000-0000-4000-8000-000000000022";
const row: StoredInspection = { id, title: "Original", status: "draft", version: 3 };
const signal = () => new AbortController().signal;
const serverRow = (value: StoredInspection) => ({ ...value, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const managers: ReturnType<typeof createSyncManager>[] = [];
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { managers.forEach(manager => manager.stop()); managers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("replays immutable offline chains using causal ACKs and gives later new edits the latest ACK version", async () => {
  await saveInspection(row);
  await renameInspection(id, "First");
  await toggleInspection(id);
  const queue = await loadSyncQueue();
  expect(queue[0].expectation).toEqual({ version: 3 });
  expect(queue[1].expectation).toEqual({ operationId: queue[0].id });
  await applyRemoteSnapshot({ inspections: [{ ...row, title: "Remote", version: 99 }], deletedIds: [] }, signal());
  expect(await loadSyncQueue()).toEqual(queue);
  expect(await resolveExpectedVersion(queue[1], signal())).toBeUndefined();
  const bodies: Record<string, unknown>[] = [];
  for (const [index, item] of queue.entries()) {
    const version = await sendQueueItem(item, "", signal(), vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string));
      return json(serverRow({ ...item.payload!, version: 4 + index }));
    }));
    await acknowledgeQueueItem(item, version as number, signal());
  }
  expect(bodies.map(body => body.expectedVersion)).toEqual([3, 4]);
  expect(bodies.map(body => body.mutationId)).toEqual(queue.map(item => item.id));
  expect((await loadInspections())[0]).toEqual({ ...row, title: "First", status: "completed" });
  await renameInspection(id, "Later");
  expect((await loadSyncQueue())[0].expectation).toEqual({ version: 5 });
});

it("anchors CREATE successors to the original CREATE receipt instead of a current snapshot", async () => {
  const local = { id, title: "New local", status: "draft" as const };
  await saveInspectionWithSync(local, "CREATE");
  await renameInspection(id, "Offline edit");
  const [create, update] = await loadSyncQueue();
  expect(update.expectation).toEqual({ operationId: create.id });
  const transport = vi.fn(async () => json(serverRow({ ...local, version: 1 }), 201));
  expect(await sendQueueItem(create, "", signal(), transport)).toBe(1);
  await acknowledgeQueueItem(create, 1, signal());
  expect(await resolveExpectedVersion(update, signal())).toBe(1);
  expect((await loadInspections())[0].title).toBe("Offline edit");
});

it("rolls back dequeue and ACK together on storage failure; abort keeps the operation", async () => {
  await saveInspection(row); await renameInspection(id, "One"); await renameInspection(id, "Two");
  const [first, second] = await loadSyncQueue();
  const original = IDBObjectStore.prototype.delete;
  const fault = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function(this: IDBObjectStore, key) {
    const request = original.call(this, key);
    if (this.name === "syncQueue") this.transaction.abort();
    return request;
  });
  await expect(acknowledgeQueueItem(first, 4, signal())).rejects.toThrow();
  fault.mockRestore();
  expect(await loadSyncQueue()).toEqual([first, second]);
  expect(await resolveExpectedVersion(second, signal())).toBeUndefined();
  const controller = new AbortController(); controller.abort();
  await expect(acknowledgeQueueItem(first, 4, controller.signal)).rejects.toThrow();
  expect(await loadSyncQueue()).toEqual([first, second]);
  await acknowledgeQueueItem(first, 4, signal());
  expect(await resolveExpectedVersion(second, signal())).toBe(4);
  expect((await loadInspections())[0].title).toBe("Two");
});

it("blocks legacy pending intent without retroactively adopting downloaded versions", async () => {
  const legacy = { id, title: "Legacy", status: "draft" as const };
  await saveInspection(legacy); await renameInspection(id, "Retained legacy edit");
  const [item] = await loadSyncQueue();
  expect(item.expectation).toBeUndefined();
  const fetcher = vi.fn();
  await expect(sendQueueItem(item, "", signal(), fetcher)).rejects.toBeInstanceOf(VersionConflictFailure);
  expect(fetcher).not.toHaveBeenCalled();
  await applyRemoteSnapshot({ inspections: [{ ...row, version: 9 }], deletedIds: [] }, signal());
  expect(await loadSyncQueue()).toEqual([item]);
  expect((await loadInspections())[0].title).toBe("Retained legacy edit");
  await replaceReviewedUpdate(item.id, { ...row, version: 9 }, "Reviewed legacy", "completed", signal());
  const [reviewed] = await loadSyncQueue();
  expect(reviewed.id).not.toBe(item.id);
  expect(reviewed.expectation).toEqual({ version: 9 });
  expect(reviewed.payload?.title).toBe("Reviewed legacy");
});

it("allows a clean legacy row to receive an authoritative snapshot source version", async () => {
  await saveInspection({ id, title: "Legacy", status: "draft" });
  const snapshot = parseSnapshot({ inspections: [serverRow(row)], deletedIds: [] });
  await applyRemoteSnapshot(snapshot, signal());
  await renameInspection(id, "Versioned");
  expect((await loadSyncQueue())[0].expectation).toEqual({ version: 3 });
});

it("preserves descendants after explicit review and never aliases the abandoned predecessor ACK", async () => {
  await saveInspection(row); await renameInspection(id, "First draft"); await renameInspection(id, "Later draft");
  const [first, second] = await loadSyncQueue();
  await saveReviewDraft(first.id, { title: "Reviewed typed draft", status: "completed" });
  expect(await loadReviewDraft(first.id)).toEqual({ title: "Reviewed typed draft", status: "completed" });
  await replaceReviewedUpdate(first.id, { ...row, version: 8 }, "Reconciled", "draft", signal());
  const [replacement, retained] = await loadSyncQueue();
  expect(retained).toEqual(second);
  expect(replacement.id).not.toBe(first.id);
  expect(replacement.sequence).toBe(first.sequence);
  expect((await loadInspections())[0].title).toBe("Later draft");
  await acknowledgeQueueItem(replacement, 9, signal());
  expect(await resolveExpectedVersion(retained, signal())).toBeUndefined();
  const fetcher = vi.fn();
  await expect(sendQueueItem(retained, "", signal(), fetcher)).rejects.toBeInstanceOf(VersionConflictFailure);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await loadSyncQueue()).toEqual([second]);
});

it("keeps legacy FIFO positions and the latest legacy local intent when replacing an earlier item", async () => {
  const legacy = ["100", "200"].map((suffix, index): SyncQueueItem => ({
    id: `00000000-0000-4000-8000-000000000${suffix}`, entityType: "inspection", entityId: id,
    operation: "UPDATE", payload: { ...row, title: index ? "Latest legacy" : "Earlier legacy" }, createdAt: "2020-01-01",
  }));
  await saveInspection({ ...row, title: "Latest legacy" });
  const db = await openFieldOpsDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite"); legacy.forEach(item => tx.objectStore("syncQueue").add(item));
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  }); db.close();
  await replaceReviewedUpdate(legacy[0].id, row, "Reviewed early", "draft", signal());
  const queue = await loadSyncQueue();
  expect(queue[0].payload?.title).toBe("Reviewed early");
  expect(queue[1]).toEqual(legacy[1]);
  expect((await loadInspections())[0].title).toBe("Latest legacy");
});

it("blocks an editor opened before status-only or ABA source changes despite unchanged title", async () => {
  await saveInspection(row);
  const source = await loadEditSource(id);
  await applyRemoteSnapshot({ inspections: [{ ...row, status: "completed", version: 4 }], deletedIds: [] }, signal());
  await expect(renameInspection(id, "Typed stale draft", row.title, source)).rejects.toThrow("changed in another tab");
  expect(await loadSyncQueue()).toEqual([]);
  await applyRemoteSnapshot({ inspections: [{ ...row, version: 5 }], deletedIds: [] }, signal());
  await expect(renameInspection(id, "Typed stale draft", row.title, source)).rejects.toThrow("changed in another tab");
  expect((await loadInspections())[0]).toEqual({ ...row, version: 5 });
});

it("retains malformed version ACKs and rejects oversized or aborted explicit review responses", async () => {
  await saveInspection(row); await renameInspection(id, "Draft");
  const [item] = await loadSyncQueue();
  for (const version of [undefined, 0, 3, 5, "4"]) {
    await expect(sendQueueItem(item, "", signal(), vi.fn(async () => json(serverRow({ ...item.payload!, version: version as number }))))).rejects.toThrow("acknowledgment");
  }
  expect(await loadSyncQueue()).toEqual([item]);
  await expect(fetchReviewInspection(id, "", signal(), undefined, vi.fn(async () => new Response(" ".repeat(16385), {
    headers: { "Content-Type": "application/json" },
  })))).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(fetchReviewInspection(id, "", controller.signal)).rejects.toThrow();
});

it("manager exposes server conflict, explicit review and a second race without rewriting later operations", async () => {
  await saveInspection(row); await renameInspection(id, "Typed queued draft"); await renameInspection(id, "Dependent draft");
  const original = await loadSyncQueue();
  let serverVersion = 4;
  const locks = { request: (async (_name: string, _options: unknown, work: (lock: unknown) => Promise<void>) =>
    work({ name: "test", mode: "exclusive" })) as LockManager["request"] };
  const manager = createSyncManager({ locks, online: () => true, config: { base: "", reason: null },
    send: async () => { throw new VersionConflictFailure({ ...row, title: "Server winner", version: serverVersion }); },
    review: async () => ({ ...row, title: "Current server", version: serverVersion }),
  }); managers.push(manager); manager.start();
  for (let i = 0; i < 50 && !manager.getSnapshot().error; i++) await tick();
  expect(manager.getSnapshot().error?.conflict?.current?.version).toBe(4);
  expect(await loadSyncQueue()).toEqual(original);
  await manager.reviewConflict();
  expect(manager.getSnapshot().error?.conflict?.current?.title).toBe("Current server");
  serverVersion = 5;
  await manager.saveReviewedChanges("Reviewed typed draft", "completed", 4);
  const queue = await loadSyncQueue();
  expect(queue[0].id).not.toBe(original[0].id);
  expect(queue[0].expectation).toEqual({ version: 4 });
  expect(queue[0].payload?.title).toBe("Reviewed typed draft");
  expect(queue[1]).toEqual(original[1]);
  expect(manager.getSnapshot().error?.conflict?.current?.version).toBe(5);
});

it("serializes simultaneous same-origin edits into a causal chain", async () => {
  await saveInspection(row);
  await Promise.all([renameInspection(id, "Concurrent tab title"), toggleInspection(id)]);
  const [first, second] = await loadSyncQueue();
  expect(first.expectation).toEqual({ version: 3 });
  expect(second.expectation).toEqual({ operationId: first.id });
  expect((await loadInspections())[0]).toMatchObject({ title: "Concurrent tab title", status: "completed" });
});

it("UPDATE retries a lost acknowledgment with identical immutable version and mutation identity", async () => {
  await saveInspection(row); await renameInspection(id, "Lost ACK draft");
  const [item] = await loadSyncQueue();
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("ACK transport lost"))
      .mockResolvedValueOnce(json(serverRow({ ...item.payload!, version: 4 })));
    const work = sendQueueItem(item, "", signal(), fetcher);
    await vi.runAllTimersAsync();
    expect(await work).toBe(4);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ expectedVersion: 3, mutationId: item.id });
  } finally { vi.useRealTimers(); }
  expect(await loadSyncQueue()).toEqual([item]);
});

it("keeps an opened editor's exact causal predecessor valid across its own ACK, without rebasing later server edits", async () => {
  await saveInspection(row); await renameInspection(id, "Own pending edit");
  const [pending] = await loadSyncQueue();
  const source = await loadEditSource(id);
  expect(source.expectation).toEqual({ operationId: pending.id });
  await acknowledgeQueueItem(pending, 4, signal());
  await renameInspection(id, "Typed after own ACK", "Own pending edit", source);
  const [next] = await loadSyncQueue();
  expect(next.expectation).toEqual({ version: 4 });
  await acknowledgeQueueItem(next, 5, signal());
  await applyRemoteSnapshot({ inspections: [{ ...row, title: "Typed after own ACK", version: 6 }], deletedIds: [] }, signal());
  await expect(renameInspection(id, "Stale source", "Typed after own ACK", source)).rejects.toThrow();
  expect(await loadSyncQueue()).toEqual([]);
});

it("verified missing manual-review response retains intent and marks the editor unavailable", async () => {
  await saveInspection(row); await renameInspection(id, "Pending deletion recovery");
  const queue = await loadSyncQueue();
  const locks = { request: (async (_name: string, _options: unknown, work: (lock: unknown) => Promise<void>) =>
    work({ name: "test", mode: "exclusive" })) as LockManager["request"] };
  const manager = createSyncManager({ locks, online: () => true, config: { base: "", reason: null },
    send: async () => { throw new VersionConflictFailure({ ...row, version: 4 }); },
    review: (entityId, base, owner) => fetchReviewInspection(entityId, base, owner, undefined,
      vi.fn(async () => json({ error: { code: "INSPECTION_NOT_FOUND", message: "Missing inspection." } }, 404))),
  }); managers.push(manager); manager.start();
  for (let i = 0; i < 50 && !manager.getSnapshot().error; i++) await tick();
  await manager.reviewConflict();
  expect(manager.getSnapshot().error?.conflict?.current).toBeUndefined();
  expect(manager.getSnapshot().error?.conflict?.pending.title).toBe("Pending deletion recovery");
  expect(await loadSyncQueue()).toEqual(queue);
  expect(await loadInspections()).toEqual([]);
  await expect(renameInspection(id, "Cannot resurrect")).rejects.toThrow("deleted");
});

it("opens an editor with fields and source from one coherent persisted transaction", async () => {
  await saveInspection(row);
  // A render can be older than the persisted row when the editor-opening read begins.
  await applyRemoteSnapshot({ inspections: [{ ...row, title: "Latest title", status: "completed", version: 7 }], deletedIds: [] }, signal());
  const source = await loadEditSource(id);
  expect(source.inspection).toEqual({ ...row, title: "Latest title", status: "completed", version: 7 });
  expect(source.expectation).toEqual({ version: 7 });
});

function deferredReview<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function exclusiveReviewLocks() {
  let held = false;
  return { request: vi.fn(async (_name: string, options: LockOptions, work: (lock: Lock | null) => Promise<void>) => {
    if (held && options.ifAvailable) return work(null);
    if (held) throw new Error("Unexpected overlapping lock request");
    held = true;
    try { await work({ name: "test", mode: "exclusive" } as Lock); } finally { held = false; }
  }) as unknown as LockManager["request"] };
}

it("keeps manual review busy through activity and abort; skipped activity cannot release its checking owner", async () => {
  await saveInspection(row); await renameInspection(id, "Retained draft");
  const original = await loadSyncQueue();
  const pendingReview = deferredReview<StoredInspection>();
  const review = vi.fn(async () => pendingReview.promise);
  const snapshot = vi.fn(async () => ({ inspections: [], deletedIds: [] }));
  const manager = createSyncManager({ locks: exclusiveReviewLocks(), remote: true, online: () => true,
    config: { base: "", reason: null }, snapshot, review,
    send: async () => { throw new VersionConflictFailure({ ...row, version: 4 }); },
  }); managers.push(manager); manager.start();
  for (let i = 0; i < 50 && !manager.getSnapshot().error; i++) await tick();
  const work = manager.reviewConflict();
  expect(review).toHaveBeenCalledTimes(1);
  expect(manager.getSnapshot().checking).toBe(true);
  await manager.pull();
  expect(snapshot).not.toHaveBeenCalled();
  expect(manager.getSnapshot().checking).toBe(true);
  await manager.reviewConflict();
  await manager.saveReviewedChanges("Cannot overlap review", "draft", 4);
  expect(review).toHaveBeenCalledTimes(1);
  expect(await loadSyncQueue()).toEqual(original);
  manager.pauseReads();
  // Abort keeps the work busy until it has actually settled/released the lock.
  expect(manager.getSnapshot().checking).toBe(true);
  pendingReview.resolve({ ...row, title: "Stale aborted response", version: 99 });
  await work;
  expect(manager.getSnapshot().checking).toBe(false);
  expect(manager.getSnapshot().error?.conflict?.current?.version).toBe(4);
  await manager.pull();
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(manager.getSnapshot().checking).toBe(false);
});

it("does not start manual review while an activity snapshot reserves or owns the read lock", async () => {
  await saveInspection(row); await renameInspection(id, "Retained draft");
  const original = await loadSyncQueue();
  const pendingSnapshot = deferredReview<{ inspections: StoredInspection[]; deletedIds: string[] }>();
  const snapshot = vi.fn(async () => pendingSnapshot.promise);
  const review = vi.fn(async () => ({ ...row, title: "Reviewed after snapshot", version: 4 }));
  const manager = createSyncManager({ locks: exclusiveReviewLocks(), remote: true, online: () => true,
    config: { base: "", reason: null }, snapshot, review,
    send: async () => { throw new VersionConflictFailure({ ...row, version: 4 }); },
  }); managers.push(manager); manager.start();
  for (let i = 0; i < 50 && !manager.getSnapshot().error; i++) await tick();
  const work = manager.pull();
  // Reservation is asynchronous: checking is not set yet, but remoteActive owns the read.
  await manager.reviewConflict();
  expect(review).not.toHaveBeenCalled();
  for (let i = 0; i < 50 && !snapshot.mock.calls.length; i++) await tick();
  expect(manager.getSnapshot().checking).toBe(true);
  await manager.reviewConflict();
  await manager.saveReviewedChanges("Cannot overlap snapshot", "draft", 4);
  expect(review).not.toHaveBeenCalled();
  expect(await loadSyncQueue()).toEqual(original);
  pendingSnapshot.resolve({ inspections: [], deletedIds: [] }); await work;
  expect(manager.getSnapshot().checking).toBe(false);
  await manager.reviewConflict();
  expect(review).toHaveBeenCalledTimes(1);
  expect(manager.getSnapshot().error?.conflict?.current?.title).toBe("Reviewed after snapshot");
});

it("cleans up cancelled review ownership across lifetime generations without applying a stale response", async () => {
  await saveInspection(row); await renameInspection(id, "Retained draft");
  const first = deferredReview<StoredInspection>();
  const second = deferredReview<StoredInspection>();
  const review = vi.fn().mockImplementationOnce(async () => first.promise).mockImplementationOnce(async () => second.promise);
  const manager = createSyncManager({ locks: exclusiveReviewLocks(), online: () => true,
    config: { base: "", reason: null }, review,
    send: async () => { throw new VersionConflictFailure({ ...row, version: 4 }); },
  }); managers.push(manager); manager.start();
  for (let i = 0; i < 50 && !manager.getSnapshot().error; i++) await tick();
  const oldWork = manager.reviewConflict();
  expect(manager.getSnapshot().checking).toBe(true);
  manager.stop(); manager.start();
  expect(manager.getSnapshot().checking).toBe(false);
  await manager.reviewConflict();
  expect(review).toHaveBeenCalledTimes(1);
  first.resolve({ ...row, title: "Wrong old generation", version: 98 }); await oldWork;
  expect(manager.getSnapshot().error?.conflict?.current?.version).toBe(4);
  const newWork = manager.reviewConflict();
  expect(review).toHaveBeenCalledTimes(2);
  expect(manager.getSnapshot().checking).toBe(true);
  second.resolve({ ...row, title: "Current generation", version: 5 }); await newWork;
  expect(manager.getSnapshot().checking).toBe(false);
  expect(manager.getSnapshot().error?.conflict?.current?.title).toBe("Current generation");
  manager.stop(); await manager.reviewConflict();
  expect(review).toHaveBeenCalledTimes(2);
  expect(manager.getSnapshot().checking).toBe(false);
});
