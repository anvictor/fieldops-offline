const DB_NAME = "fieldops-db";
const DB_VERSION = 2;
const QUEUE_CHANNEL = "fieldops-queue-changed";
const listeners = new Set<() => void>();

export type StoredInspection = { id: string; title: string; status: "draft" | "completed" };
export type SyncQueueItem = {
  id: string;
  entityType: "inspection";
  entityId: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  payload: StoredInspection | null;
  createdAt: string;
  sequence?: number;
};

export function openFieldOpsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("inspections")) {
        db.createObjectStore("inspections", { keyPath: "id" }).createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains("syncQueue")) db.createObjectStore("syncQueue", { keyPath: "id" });
      if (!db.objectStoreNames.contains("syncMetadata")) db.createObjectStore("syncMetadata");
      // Keep v1 queue entries unchanged: their historical insertion order is unknown.
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Close older FieldOps tabs to upgrade local storage.")); };
  });
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void) => void, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const db = await openFieldOpsDB();
  try {
    signal?.throwIfAborted();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      const abort = () => { try { tx.abort(); } catch { /* Already finished. */ } };
      signal?.addEventListener("abort", abort, { once: true });
      const cleanup = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => { cleanup(); resolve(value); };
      tx.onabort = () => { cleanup(); reject(tx.error ?? new Error("Local transaction aborted.")); };
      tx.onerror = () => { /* onabort handles request errors and transaction rollback. */ };
      try { work(tx, (result) => { value = result; }); } catch (error) { abort(); reject(error); }
    });
  } finally { db.close(); }
}

function notifyQueueChanged() {
  for (const listener of listeners) listener();
  // Notification only: receivers always reread IndexedDB, never a supplied count.
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(QUEUE_CHANNEL);
    channel.postMessage("changed");
    channel.close();
  }
}

export function subscribeQueueChanges(listener: () => void): () => void {
  listeners.add(listener);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(QUEUE_CHANNEL);
  if (channel) channel.onmessage = () => listener();
  return () => { listeners.delete(listener); channel?.close(); };
}

export function loadInspections(): Promise<StoredInspection[]> {
  return transaction(["inspections"], "readonly", (tx, result) => {
    const request = tx.objectStore("inspections").getAll();
    request.onsuccess = () => result(request.result);
  });
}

export function saveInspection(inspection: StoredInspection): Promise<void> {
  return transaction(["inspections"], "readwrite", (tx) => { tx.objectStore("inspections").put(inspection); });
}
export function deleteInspectionFromDB(id: string): Promise<void> {
  return transaction(["inspections"], "readwrite", (tx) => { tx.objectStore("inspections").delete(id); });
}

async function mutateWithSync(entityId: string, operation: SyncQueueItem["operation"], payload: StoredInspection | null) {
  // Capture the payload before opening the database: later caller edits cannot change it.
  const item: SyncQueueItem = { id: crypto.randomUUID(), entityType: "inspection", entityId,
    operation, payload: structuredClone(payload), createdAt: new Date().toISOString() };
  await transaction<void>(["inspections", "syncQueue", "syncMetadata"], "readwrite", (tx) => {
    const metadata = tx.objectStore("syncMetadata");
    const request = metadata.get("nextSequence");
    request.onsuccess = () => {
      const sequence = request.result ?? 1;
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER) { tx.abort(); return; }
      item.sequence = sequence;
      metadata.put(sequence + 1, "nextSequence");
      const store = tx.objectStore("inspections");
      if (item.operation === "DELETE") store.delete(entityId); else store.put(item.payload);
      tx.objectStore("syncQueue").add(item);
    };
  });
  notifyQueueChanged();
}

export function saveInspectionWithSync(inspection: StoredInspection, operation: "CREATE" | "UPDATE"): Promise<void> {
  return mutateWithSync(inspection.id, operation, inspection);
}
export function deleteInspectionWithSync(id: string): Promise<void> {
  return mutateWithSync(id, "DELETE", null);
}

export async function loadSyncQueue(): Promise<SyncQueueItem[]> {
  const items = await transaction<SyncQueueItem[]>(["syncQueue"], "readonly", (tx, result) => {
    const request = tx.objectStore("syncQueue").getAll();
    request.onsuccess = () => result(request.result);
  });
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return items.sort((a, b) => {
    if (a.sequence === undefined && b.sequence !== undefined) return -1;
    if (a.sequence !== undefined && b.sequence === undefined) return 1;
    if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
    return compare(a.createdAt, b.createdAt) || compare(a.id, b.id);
  });
}

// Must be called inside the sync Web Lock. Re-read before deleting; never touch inspections.
export async function removeQueueItem(id: string, signal: AbortSignal): Promise<void> {
  await transaction<void>(["syncQueue"], "readwrite", (tx) => {
    const store = tx.objectStore("syncQueue");
    const request = store.get(id);
    request.onsuccess = () => {
      if (signal.aborted) { tx.abort(); return; }
      if (request.result) store.delete(id);
    };
  }, signal);
  notifyQueueChanged();
}

// Imports use the same stores as ordinary mutations, with no schema change.
// The shared transaction rechecks stored and pending IDs before any batch write.
type ImportCounts = { imported: number; skipped: number };
async function inspectionBatch(records: StoredInspection[], commit: boolean): Promise<ImportCounts> {
  const snapshot = structuredClone(records);
  const counts = await transaction<ImportCounts>(["inspections", "syncQueue", "syncMetadata"],
    commit ? "readwrite" : "readonly", (tx, result) => {
      const inspections = tx.objectStore("inspections");
      const queue = tx.objectStore("syncQueue");
      const stored = inspections.getAll();
      stored.onsuccess = () => {
        const reserved = new Set<string>(stored.result.map((record: StoredInspection) => record.id.toLowerCase()));
        const pending = queue.getAll();
        pending.onsuccess = () => {
          for (const item of pending.result as SyncQueueItem[]) {
            if (typeof item.entityId === "string") reserved.add(item.entityId.toLowerCase());
          }
          const candidates = snapshot.filter(record => {
            const id = record.id.toLowerCase();
            if (reserved.has(id)) return false;
            reserved.add(id); return true;
          });
          result({ imported: candidates.length, skipped: snapshot.length - candidates.length });
          if (!commit || candidates.length === 0) return;
          const metadata = tx.objectStore("syncMetadata");
          const next = metadata.get("nextSequence");
          next.onsuccess = () => {
            const sequence = next.result ?? 1;
            if (!Number.isSafeInteger(sequence) || sequence < 1 ||
                sequence > Number.MAX_SAFE_INTEGER - candidates.length) { tx.abort(); return; }
            try {
              candidates.forEach((record, index) => {
                const item: SyncQueueItem = { id: crypto.randomUUID(), entityType: "inspection", entityId: record.id,
                  operation: "CREATE", payload: structuredClone(record), createdAt: new Date().toISOString(),
                  sequence: sequence + index };
                inspections.add(record);
                queue.add(item);
              });
              metadata.put(sequence + candidates.length, "nextSequence");
            } catch { tx.abort(); }
          };
        };
      };
    });
  if (commit && counts.imported > 0) {
    try { notifyQueueChanged(); } catch { /* Durable commit succeeded; caller refreshes persisted state. */ }
  }
  return counts;
}

export function previewInspectionBatch(records: StoredInspection[]): Promise<ImportCounts> {
  return inspectionBatch(records, false);
}
export function importInspectionBatch(records: StoredInspection[]): Promise<ImportCounts> {
  return inspectionBatch(records, true);
}
