import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { renameInspection } from "../src/inspections";
import { deleteInspectionWithSync, loadInspections, loadSyncQueue, saveInspectionWithSync } from "../src/db";
import type { StoredInspection } from "../src/db";

const record: StoredInspection = { id: "00000000-0000-4000-8000-000000000012", title: "Original", status: "draft" };
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("offline inspection title editing", () => {
  it("uses the persisted current status and identity, trims Unicode and queues one ordered UPDATE", async () => {
    await saveInspectionWithSync(record, "CREATE");
    await saveInspectionWithSync({ ...record, status: "completed" }, "UPDATE");
    const before = await loadSyncQueue();
    const result = await renameInspection(record.id, "  Насос 💧  ");
    expect(result).toEqual({ inspection: { ...record, status: "completed", title: "Насос 💧" }, changed: true });
    expect(await loadInspections()).toEqual([result.inspection]);
    const after = await loadSyncQueue(); expect(after.slice(0, -1)).toEqual(before);
    expect(after.at(-1)).toMatchObject({ operation: "UPDATE", entityId: record.id, payload: result.inspection,
      sequence: before.at(-1)!.sequence! + 1 });
  });
  it("treats unchanged normalized title as a no-op without storage mutation/queue notification", async () => {
    await saveInspectionWithSync(record, "CREATE"); const queue = await loadSyncQueue();
    const put = vi.spyOn(IDBObjectStore.prototype, "put"); const add = vi.spyOn(IDBObjectStore.prototype, "add");
    expect(await renameInspection(record.id, "  Original  ")).toEqual({ inspection: record, changed: false });
    expect(await loadSyncQueue()).toEqual(queue); expect(put).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled();
  });
  it("rejects blank/overlong/null titles without writing or enqueuing", async () => {
    await saveInspectionWithSync(record, "CREATE"); const queue = await loadSyncQueue();
    for (const title of ["", " \n ", "💧".repeat(201), "A\u0000B"]) await expect(renameInspection(record.id, title)).rejects.toThrow();
    expect(await loadInspections()).toEqual([record]); expect(await loadSyncQueue()).toEqual(queue);
  });
  it("accepts 200 Unicode characters even when surrogate code units exceed 200", async () => {
    await saveInspectionWithSync(record, "CREATE");
    expect((await renameInspection(record.id, "💧".repeat(200))).inspection.title).toBe("💧".repeat(200));
  });
  it("does not resurrect deleted or missing records", async () => {
    await saveInspectionWithSync(record, "CREATE"); await deleteInspectionWithSync(record.id);
    const queue = await loadSyncQueue();
    await expect(renameInspection(record.id, "Changed")).rejects.toThrow();
    await expect(renameInspection("missing", "Changed")).rejects.toThrow();
    expect(await loadInspections()).toEqual([]); expect(await loadSyncQueue()).toEqual(queue);
  });
  it("keeps earlier queued payload snapshots immutable after repeated renames", async () => {
    await saveInspectionWithSync(record, "CREATE"); await renameInspection(record.id, "First edit");
    const previous = await loadSyncQueue(); await renameInspection(record.id, "Second edit");
    const after = await loadSyncQueue(); expect(after.slice(0, -1)).toEqual(previous);
    expect(after.map((item) => item.payload?.title)).toEqual(["Original", "First edit", "Second edit"]);
  });
  it("rolls back inspection and queue together on queue persistence failure and permits retry", async () => {
    await saveInspectionWithSync(record, "CREATE"); const queue = await loadSyncQueue();
    const original = IDBObjectStore.prototype.add;
    const fault = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function(this: IDBObjectStore, value, key) {
      if (this.name === "syncQueue") throw new Error("private fixture storage details");
      return original.call(this, value, key);
    });
    await expect(renameInspection(record.id, "Retry title")).rejects.toThrow(); fault.mockRestore();
    expect(await loadInspections()).toEqual([record]); expect(await loadSyncQueue()).toEqual(queue);
    expect((await renameInspection(record.id, "Retry title")).changed).toBe(true);
  });
});
