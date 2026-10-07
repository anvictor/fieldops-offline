import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { downloadInspectionFile, exportInspections, serializeInspections } from "../src/export";
import { deleteInspectionWithSync, loadInspections, loadSyncQueue, openFieldOpsDB, saveInspectionWithSync } from "../src/db";
import type { StoredInspection } from "../src/db";

const first: StoredInspection = { id: "one", title: "  Насос 💧\n\"quoted\" <script>  ", status: "draft" };
const second: StoredInspection = { id: "two", title: "Done", status: "completed" };
const now = new Date("2026-10-07T08:00:00.000Z");

function browserDownload() {
  const link = { href: "", download: "", hidden: false, click: vi.fn(), remove: vi.fn() };
  const createElement = vi.fn(() => link);
  const append = vi.fn();
  vi.stubGlobal("document", { createElement, body: { append } });
  const createURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-export");
  const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { link, createElement, append, createURL, revokeURL };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("offline inspection export", () => {
  it("roundtrips all statuses/Unicode/legacy whitespace without extra fields or mutation", () => {
    const rows = [{ ...first, token: "excluded", queuedPayload: "excluded" }, second];
    const before = structuredClone(rows);
    const file = serializeInspections(rows, now);
    expect(JSON.parse(file.json)).toEqual({ format: "fieldops-inspections", schemaVersion: 1,
      exportedAt: now.toISOString(), inspections: [first, second] });
    expect(file.filename).toBe("fieldops-inspections-2026-10-07T08-00-00-000Z.json");
    expect(rows).toEqual(before);
  });
  it("exports a versioned empty dataset", () => {
    expect(JSON.parse(serializeInspections([], now).json).inspections).toEqual([]);
  });
  it("rereads persisted data, not a previous snapshot, without changing queue/metadata or HTTP", async () => {
    const browser = browserDownload();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await saveInspectionWithSync(first, "CREATE");
    await saveInspectionWithSync(second, "CREATE");
    const oldRows = await loadInspections();
    await saveInspectionWithSync({ ...first, status: "completed" }, "UPDATE");
    await deleteInspectionWithSync(second.id);
    const rows = await loadInspections();
    const queue = await loadSyncQueue();
    const metadata = async () => {
      const db = await openFieldOpsDB();
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction("syncMetadata", "readonly").objectStore("syncMetadata").getAll();
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    };
    const beforeMetadata = await metadata();
    await exportInspections();
    const blob = browser.createURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/json;charset=utf-8");
    expect(JSON.parse(await blob.text()).inspections).toEqual(rows);
    expect(rows).not.toEqual(oldRows);
    expect(await loadInspections()).toEqual(rows);
    expect(await loadSyncQueue()).toEqual(queue);
    expect(await metadata()).toEqual(beforeMetadata);
    expect(fetch).not.toHaveBeenCalled();
    expect(browser.link.click).toHaveBeenCalledOnce();
  });
  it("rejects storage failures without creating a partial download and can retry", async () => {
    const browser = browserDownload();
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("private storage failure"); } });
    await expect(exportInspections()).rejects.toThrow();
    expect(browser.createURL).not.toHaveBeenCalled();
    vi.stubGlobal("indexedDB", new IDBFactory());
    await exportInspections();
    const blob = browser.createURL.mock.calls[0]![0] as Blob;
    expect(JSON.parse(await blob.text()).inspections).toEqual([]);
    expect(browser.link.click).toHaveBeenCalledOnce();
  });
  it("dispatches a hidden downloadable link and releases URL only after dispatch", () => {
    vi.useFakeTimers(); const b = browserDownload(); const file = serializeInspections([first], now);
    downloadInspectionFile(file);
    expect(b.link.href).toBe("blob:local-export"); expect(b.link.download).toBe(file.filename);
    expect(b.link.hidden).toBe(true); expect(b.append).toHaveBeenCalledWith(b.link);
    expect(b.link.click).toHaveBeenCalledOnce(); expect(b.link.remove).toHaveBeenCalledOnce();
    expect(b.revokeURL).not.toHaveBeenCalled(); vi.runAllTimers();
    expect(b.revokeURL).toHaveBeenCalledExactlyOnceWith("blob:local-export");
  });
  it("cleans up link/URL when dispatch fails", () => {
    vi.useFakeTimers(); const b = browserDownload(); b.link.click.mockImplementation(() => { throw new Error("blocked"); });
    expect(() => downloadInspectionFile(serializeInspections([], now))).toThrow("blocked");
    expect(b.link.remove).toHaveBeenCalledOnce(); vi.runAllTimers();
    expect(b.revokeURL).toHaveBeenCalledExactlyOnceWith("blob:local-export");
  });
  it("releases URL even if link creation fails", () => {
    vi.useFakeTimers(); const b = browserDownload(); b.createElement.mockImplementation(() => { throw new Error("unavailable"); });
    expect(() => downloadInspectionFile(serializeInspections([], now))).toThrow("unavailable");
    vi.runAllTimers(); expect(b.revokeURL).toHaveBeenCalledExactlyOnceWith("blob:local-export");
  });
});
