import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { confirmInspectionImport, MAX_IMPORT_BYTES, MAX_IMPORT_RECORDS, parseInspectionImport,
  previewInspectionImport, readInspectionImport } from "../src/import";
import { serializeInspections } from "../src/export";
import { deleteInspectionWithSync, loadInspections, loadSyncQueue, openFieldOpsDB, saveInspectionWithSync } from "../src/db";
import type { StoredInspection } from "../src/db";

const a: StoredInspection = { id: "abcdef00-0000-4000-8000-000000000001", title: "Pump 💧", status: "draft" };
const b: StoredInspection = { id: "abcdef00-0000-4000-8000-000000000002", title: "Valve", status: "completed" };
const date = new Date("2026-10-07T08:00:00.000Z");
const document = (inspections: unknown = [a, b], extra = {}) => JSON.stringify({
  format: "fieldops-inspections", schemaVersion: 1, exportedAt: date.toISOString(), inspections, ...extra,
});
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function metadata(value?: number) {
  const db = await openFieldOpsDB();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction("syncMetadata", value === undefined ? "readonly" : "readwrite");
      const store = tx.objectStore("syncMetadata");
      if (value !== undefined) store.put(value, "nextSequence");
      const read = store.get("nextSequence");
      tx.oncomplete = () => resolve(read.result); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function state() {
  return { inspections: await loadInspections(), queue: await loadSyncQueue(), sequence: await metadata() };
}

describe("bounded exact export parser", () => {
  it("roundtrips real exports and normalizes UUID/title without changing status", () => {
    expect(parseInspectionImport(serializeInspections([a, b], date).json)).toEqual([a, b]);
    expect(parseInspectionImport(document([{ ...a, id: a.id.toUpperCase(), title: "  Насос 💧  " }]))).toEqual([
      { ...a, title: "Насос 💧" },
    ]);
    expect(parseInspectionImport(document([{ ...a, title: "💧".repeat(200) }]))[0].title).toHaveLength(400);
    expect(parseInspectionImport(document([]))).toEqual([]);
  });
  it("rejects bad metadata and root shapes without including private content in errors", () => {
    for (const text of ["{ private-secret", "null", "[]", document([], { format: "other" }), document([], { schemaVersion: 2 }),
      document([], { exportedAt: "not-a-date" }), document([], { exportedAt: "2026-10-07" }),
      document([], { unknown: "private-secret" }), document(null)]) {
      expect(() => parseInspectionImport(text)).toThrow();
      try { parseInspectionImport(text); } catch (error) { expect(String(error)).not.toContain("private-secret"); }
    }
  });
  it("rejects any malformed row and repeated IDs including normalized variants", () => {
    for (const record of [null, {}, { ...a, id: "bad" }, { ...a, title: "" }, { ...a, title: "💧".repeat(201) },
      { ...a, title: "A\u0000B" }, { ...a, title: 3 }, { ...a, status: "other" }, { ...a, extra: true }]) {
      expect(() => parseInspectionImport(document([b, record]))).toThrow();
    }
    expect(() => parseInspectionImport(document([a, a]))).toThrow();
    expect(() => parseInspectionImport(document([a, { ...a, id: a.id.toUpperCase() }]))).toThrow();
  });
  it("enforces UTF-8 bytes and row limits before accepting any records", () => {
    expect(() => parseInspectionImport(" ".repeat(MAX_IMPORT_BYTES + 1))).toThrow();
    expect(() => parseInspectionImport("💧".repeat(MAX_IMPORT_BYTES / 4 + 1))).toThrow();
    const rows = Array.from({ length: MAX_IMPORT_RECORDS + 1 }, (_, index) => ({ ...a,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
    expect(() => parseInspectionImport(document(rows))).toThrow();
    expect(parseInspectionImport(document(rows.slice(0, MAX_IMPORT_RECORDS)))).toHaveLength(MAX_IMPORT_RECORDS);
  });
  it("rejects oversized File objects before text reading", async () => {
    const text = vi.fn(async () => document());
    await expect(readInspectionImport({ size: MAX_IMPORT_BYTES + 1, text })).rejects.toThrow();
    expect(text).not.toHaveBeenCalled();
    expect(await readInspectionImport({ size: 100, text })).toEqual([a, b]);
  });
});

describe("atomic new-only import", () => {
  it("previews read-only and skips stored/pending-delete IDs case-insensitively", async () => {
    await saveInspectionWithSync({ ...a, id: a.id.toUpperCase(), title: "Keep original" }, "CREATE");
    await saveInspectionWithSync(b, "CREATE"); await deleteInspectionWithSync(b.id);
    const before = await state();
    const preview = await previewInspectionImport([a, b]);
    expect(preview).toMatchObject({ imported: 0, skipped: 2 });
    expect(await state()).toEqual(before);
    expect(await confirmInspectionImport(preview.records)).toEqual({ imported: 0, skipped: 2 });
    expect(await state()).toEqual(before);
  });
  it("preserves prior queue snapshots and adds immutable file-order CREATEs with one sequence advance", async () => {
    await saveInspectionWithSync(a, "CREATE"); const before = await state();
    const c = { ...b, id: "abcdef00-0000-4000-8000-000000000003", title: "Third" };
    expect(await confirmInspectionImport([b, a, c])).toEqual({ imported: 2, skipped: 1 });
    const after = await state();
    expect(after.queue.slice(0, before.queue.length)).toEqual(before.queue);
    expect(after.queue.slice(before.queue.length).map(item => ({ operation: item.operation, payload: item.payload, sequence: item.sequence })))
      .toEqual([{ operation: "CREATE", payload: b, sequence: 2 }, { operation: "CREATE", payload: c, sequence: 3 }]);
    expect(after.sequence).toBe(4);
    expect(after.inspections).toEqual(expect.arrayContaining([a, b, c]));
    expect(await confirmInspectionImport([a, b, c])).toEqual({ imported: 0, skipped: 3 });
    expect(await state()).toEqual(after);
  });
  it("rechecks conflicts introduced after preview and serializes concurrent imports", async () => {
    const preview = await previewInspectionImport([a, b]); expect(preview.imported).toBe(2);
    await saveInspectionWithSync({ ...a, title: "Concurrent local edit" }, "CREATE");
    const results = await Promise.all([confirmInspectionImport(preview.records), confirmInspectionImport(preview.records)]);
    expect(results.reduce((sum, result) => sum + result.imported, 0)).toBe(1);
    expect(await loadInspections()).toEqual([{ ...a, title: "Concurrent local edit" }, b]);
    expect(await loadSyncQueue()).toHaveLength(2);
  });
  it("captures caller inputs before any await", async () => {
    const records = [{ ...a }, { ...b }];
    const pending = confirmInspectionImport(records);
    records[0].title = "Changed by caller"; records.pop();
    expect(await pending).toEqual({ imported: 2, skipped: 0 });
    expect(await loadInspections()).toEqual([a, b]);
    expect((await loadSyncQueue()).map(item => item.payload)).toEqual([a, b]);
  });
  it("rolls back every store on queue constraint failure after an earlier insertion and permits retry", async () => {
    const before = await state();
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000099");
    await expect(confirmInspectionImport([a, b])).rejects.toThrow(); uuid.mockRestore();
    expect(await state()).toEqual(before);
    expect(await confirmInspectionImport([a, b])).toEqual({ imported: 2, skipped: 0 });
  });
  it("rolls back synchronous queue write failure without notifying", async () => {
    const before = await state(); const original = IDBObjectStore.prototype.add;
    const fail = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function(this: IDBObjectStore, value, key) {
      if (this.name === "syncQueue") throw new Error("private storage fixture");
      return original.call(this, value, key);
    });
    await expect(confirmInspectionImport([a, b])).rejects.toThrow(); fail.mockRestore();
    expect(await state()).toEqual(before);
  });
  it("checks sequence validity/capacity before any batch write", async () => {
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER - 1]) {
      await metadata(sequence); const before = await state();
      await expect(confirmInspectionImport([a, b])).rejects.toThrow();
      expect(await state()).toEqual(before);
    }
  });
  it("preserves empty batches and exhausted metadata when all IDs are skipped", async () => {
    expect(await confirmInspectionImport([])).toEqual({ imported: 0, skipped: 0 }); expect(await metadata()).toBeUndefined();
    await saveInspectionWithSync(a, "CREATE"); await metadata(Number.MAX_SAFE_INTEGER); const before = await state();
    expect(await confirmInspectionImport([a])).toEqual({ imported: 0, skipped: 1 });
    expect(await state()).toEqual(before);
  });
  it("does not misreport a committed batch when optional notification transport fails", async () => {
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("Unavailable transport"); } });
    expect(await confirmInspectionImport([a])).toEqual({ imported: 1, skipped: 0 });
    expect(await loadInspections()).toEqual([a]);
  });
});
