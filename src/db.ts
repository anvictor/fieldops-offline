const DB_NAME = "fieldops-db";
const DB_VERSION = 2;
const QUEUE_CHANNEL = "fieldops-queue-changed";
const listeners = new Set<() => void>();

export type StoredInspection = { id: string; title: string; status: "draft" | "completed"; version?: number };
export type VersionExpectation = { version: number } | { operationId: string };
export type EditSource = { expectation?: VersionExpectation; inspection?: StoredInspection };
export type SyncQueueItem = {
  id: string;
  entityType: "inspection";
  entityId: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  payload: StoredInspection | null;
  createdAt: string;
  sequence?: number;
  orderId?: string;
  expectation?: VersionExpectation;
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
  // Persistence already committed: a failed notification must not fail the mutation.
  for (const listener of listeners) { try { listener(); } catch { /* Other subscribers still run. */ } }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(QUEUE_CHANNEL);
      try { channel.postMessage("changed"); } finally { channel.close(); }
    }
  } catch { /* Focus/visible resume rereads IndexedDB if notification is unavailable. */ }
}

export function subscribeQueueChanges(listener: () => void): () => void {
  listeners.add(listener);
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(QUEUE_CHANNEL);
      channel.onmessage = () => listener();
    }
  } catch { /* Same-tab listeners and focus fallback still work. */ }
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
  let retiredOperation = false;
  try {
    await transaction<void>(["inspections", "syncQueue", "syncMetadata"], "readwrite", (tx) => {
      const metadata = tx.objectStore("syncMetadata");
      const retired = metadata.get("remoteDeletedIds");
      const request = metadata.get("nextSequence");
      request.onsuccess = () => {
        if (operation !== "DELETE" && (retired.result ?? []).includes(entityId)) { retiredOperation = true; tx.abort(); return; }
        const sequence = request.result ?? 1;
        if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER) { tx.abort(); return; }
        item.sequence = sequence;
        metadata.put(sequence + 1, "nextSequence");
        const store = tx.objectStore("inspections");
        if (item.operation === "DELETE") store.delete(entityId); else store.put(item.payload);
        tx.objectStore("syncQueue").add(item);
      };
    });
  } catch (error) { if (retiredOperation) throw new InspectionUnavailableError(); throw error; }
  notifyQueueChanged();
}

export function saveInspectionWithSync(inspection: StoredInspection, operation: "CREATE" | "UPDATE"): Promise<void> {
  const snapshot = structuredClone(inspection);
  return operation === "UPDATE"
    ? updateInspectionWithSync(snapshot.id, () => snapshot, true).then(() => undefined)
    : mutateWithSync(snapshot.id, operation, snapshot);
}
export function deleteInspectionWithSync(id: string): Promise<void> {
  return mutateWithSync(id, "DELETE", null);
}

export function compareQueueItems(a: SyncQueueItem, b: SyncQueueItem): number {
  const compare = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  if (a.sequence === undefined && b.sequence !== undefined) return -1;
  if (a.sequence !== undefined && b.sequence === undefined) return 1;
  if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
  return compare(a.createdAt, b.createdAt) || compare(a.orderId ?? a.id, b.orderId ?? b.id);
}

export async function loadSyncQueue(): Promise<SyncQueueItem[]> {
  const items = await transaction<SyncQueueItem[]>(["syncQueue"], "readonly", (tx, result) => {
    const request = tx.objectStore("syncQueue").getAll();
    request.onsuccess = () => result(request.result);
  });
  return items.sort(compareQueueItems);
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
      const retired = tx.objectStore("syncMetadata").get("remoteDeletedIds");
      const stored = inspections.getAll();
      stored.onsuccess = () => {
        const reserved = new Set<string>(stored.result.map((record: StoredInspection) => record.id.toLowerCase()));
        for (const id of retired.result ?? []) reserved.add(id);
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

export class InspectionUnavailableError extends Error {
  constructor() { super("This inspection was deleted in another tab or device. Copy your draft before dismissing it."); }
}
export class InspectionConflictError extends Error {
  constructor() { super("The title or inspection status changed in another tab or device. Copy your draft, then cancel and reopen the editor to review the latest value."); }
}

// Read, validate and patch current fields inside the same serialized write transaction.
export async function updateInspectionWithSync(id: string, update: (current: StoredInspection) => StoredInspection, enqueueUnchanged = false, expectedSource?: EditSource) {
  let failure: unknown;
  let result: { inspection: StoredInspection; changed: boolean };
  try {
    result = await transaction(["inspections", "syncQueue", "syncMetadata"], "readwrite", (tx, done) => {
      const store = tx.objectStore("inspections");
      const current = store.get(id);
      current.onsuccess = () => {
        const retired = tx.objectStore("syncMetadata").get("remoteDeletedIds");
        retired.onsuccess = () => {
          try {
            if ((retired.result ?? []).includes(id)) throw new InspectionUnavailableError();
            if (!current.result) throw new InspectionUnavailableError();
            const before = current.result as StoredInspection;
            const inspection = update(structuredClone(before));
            if (inspection.id !== id) throw new Error("Inspection identity cannot change.");
            const changed = enqueueUnchanged || before.title !== inspection.title || before.status !== inspection.status;
            done({ inspection, changed });
            if (!changed) return;
            const metadata = tx.objectStore("syncMetadata");
            const next = metadata.get("nextSequence");
            next.onsuccess = () => {
              try {
                const sequence = next.result ?? 1;
                if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER) throw new Error("Invalid queue sequence.");
                const acknowledged = metadata.get(`inspectionVersion:${id}`);
                const openedPredecessor = expectedSource?.expectation && "operationId" in expectedSource.expectation
                  ? metadata.get(`mutationAck:${expectedSource.expectation.operationId}`) : undefined;
                const pending = tx.objectStore("syncQueue").getAll();
                pending.onsuccess = () => {
                  try {
                    const predecessors = (pending.result as SyncQueueItem[]).filter(item => item.entityId === id && item.operation !== "DELETE");
                    predecessors.sort(compareQueueItems);
                    const predecessor = predecessors.at(-1);
                    const version = Math.max(before.version ?? 0, acknowledged.result ?? 0);
                    const expectation = predecessor ? { operationId: predecessor.id } : version > 0 ? { version } : undefined;
                    const sameCausalAcknowledgment = expectation && "version" in expectation &&
                      openedPredecessor?.result?.entityId === id && openedPredecessor.result.version === expectation.version;
                    if (expectedSource && JSON.stringify(expectedSource.expectation) !== JSON.stringify(expectation) && !sameCausalAcknowledgment) {
                      failure = new InspectionConflictError(); tx.abort(); return;
                    }
                    store.put(inspection);
                    tx.objectStore("syncQueue").add({ id: crypto.randomUUID(), entityType: "inspection", entityId: id,
                      operation: "UPDATE", payload: structuredClone(inspection), expectation, createdAt: new Date().toISOString(), sequence });
                    metadata.put(sequence + 1, "nextSequence");
                  } catch (error) { failure = error; tx.abort(); }
                };
              } catch (error) { failure = error; tx.abort(); }
            };
          } catch (error) { failure = error; tx.abort(); }
        };
      };
    });
  } catch (error) { throw failure ?? error; }
  if (result.changed) notifyQueueChanged();
  return result;
}

export const REMOTE_INTERVAL = 30000;
const retiredKey = "remoteDeletedIds";

// Caller holds SYNC_LOCK. Reserve before HTTP, including failures and reloads.
export function reserveRemoteCheck(base: string, now: number, signal: AbortSignal): Promise<boolean> {
  return transaction(["syncMetadata"], "readwrite", (tx, done) => {
    const store = tx.objectStore("syncMetadata");
    const key = `remoteCheck:${base}`;
    const request = store.get(key);
    request.onsuccess = () => {
      const previous = request.result;
      if (previous !== undefined && (!Number.isFinite(previous) || previous > now || previous < 0)) {
        store.put(now, key); done(false); return;
      }
      if (previous !== undefined && now - previous < REMOTE_INTERVAL) { done(false); return; }
      store.put(now, key); done(true);
    };
  }, signal);
}

export async function applyRemoteSnapshot(snapshot: { inspections: StoredInspection[]; deletedIds: string[] }, signal: AbortSignal) {
  await transaction<void>(["inspections", "syncQueue", "syncMetadata"], "readwrite", (tx) => {
    const inspections = tx.objectStore("inspections");
    const metadata = tx.objectStore("syncMetadata");
    const retired = metadata.get(retiredKey);
    const pending = tx.objectStore("syncQueue").getAll();
    pending.onsuccess = () => {
      try {
      if (signal.aborted) { tx.abort(); return; }
      const blocked = new Set((pending.result as SyncQueueItem[]).map(item => item.entityId));
      const deleted = new Set<string>([...(retired.result ?? []), ...snapshot.deletedIds]);
      for (const id of deleted) inspections.delete(id);
      for (const row of snapshot.inspections) {
        if (!blocked.has(row.id) && !deleted.has(row.id)) inspections.put(row);
      }
      metadata.put([...deleted], retiredKey);
      } catch { try { tx.abort(); } catch { /* Already aborted. */ } }
    };
  }, signal);
  notifyQueueChanged();
}

// Persist completion as well: slow reads/DB waits cannot permit a closely following GET.
// Rate-only metadata outlives a cancelled credential generation; no response data is applied here.
export function finishRemoteCheck(base: string, now: number): Promise<void> {
  return transaction(["syncMetadata"], "readwrite", (tx) => {
    tx.objectStore("syncMetadata").put(now, `remoteCheck:${base}`);
  });
}


// Called only while holding SYNC_LOCK. ACK metadata and dequeue commit together.
export async function acknowledgeQueueItem(item: SyncQueueItem, version: number, signal: AbortSignal) {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid acknowledgment version.");
  await transaction<void>(["syncQueue", "syncMetadata"], "readwrite", (tx) => {
    const queue = tx.objectStore("syncQueue");
    const current = queue.get(item.id);
    current.onsuccess = () => {
      if (!current.result) return;
      const metadata = tx.objectStore("syncMetadata");
      metadata.put({ entityId: item.entityId, version }, `mutationAck:${item.id}`);
      const previous = metadata.get(`inspectionVersion:${item.entityId}`);
      previous.onsuccess = () => metadata.put(Math.max(previous.result ?? 0, version), `inspectionVersion:${item.entityId}`);
      queue.delete(item.id);
    };
  }, signal);
  notifyQueueChanged();
}

export function resolveExpectedVersion(item: SyncQueueItem, signal: AbortSignal): Promise<number | undefined> {
  const expectation = item.expectation;
  if (!expectation || typeof expectation !== "object" || Array.isArray(expectation)) return Promise.resolve(undefined);
  if ("version" in expectation) return Promise.resolve(expectation.version);
  if (!expectation || !("operationId" in expectation)) return Promise.resolve(undefined);
  return transaction(["syncMetadata"], "readonly", (tx, done) => {
    const request = tx.objectStore("syncMetadata").get(`mutationAck:${expectation.operationId}`);
    request.onsuccess = () => done(request.result?.entityId === item.entityId ? request.result.version : undefined);
  }, signal);
}

// Explicit human resolution replaces only the reviewed item; descendants keep their identities/expectations.
export async function replaceReviewedUpdate(itemId: string, current: StoredInspection, title: string,
  status: StoredInspection["status"], signal: AbortSignal) {
  if (!Number.isSafeInteger(current.version) || current.version! < 1) throw new Error("Review a server version first.");
  await transaction<void>(["syncQueue", "inspections", "syncMetadata"], "readwrite", (tx) => {
    const queue = tx.objectStore("syncQueue");
    const selected = queue.get(itemId);
    selected.onsuccess = () => {
      const item = selected.result as SyncQueueItem | undefined;
      if (!item || item.operation !== "UPDATE" || item.entityId !== current.id) { tx.abort(); return; }
      const metadata = tx.objectStore("syncMetadata");
      const retired = metadata.get("remoteDeletedIds");
      retired.onsuccess = () => {
        if ((retired.result ?? []).includes(current.id)) { tx.abort(); return; }
        const payload = { id: current.id, title, status };
        queue.delete(item.id);
        queue.add({ ...item, id: crypto.randomUUID(), orderId: item.orderId ?? item.id, payload, expectation: { version: current.version } });
        // Keep a later local edit untouched; update the row only if this was its latest pending edit.
        const all = queue.getAll();
        all.onsuccess = () => {
          const later = (all.result as SyncQueueItem[]).some(entry => entry.entityId === current.id &&
            entry.id !== item.id && compareQueueItems(entry, item) > 0);
          if (!later) tx.objectStore("inspections").put(payload);
        };
        metadata.delete(`reviewDraft:${item.id}`);
      };
    };
  }, signal);
  notifyQueueChanged();
}

export function saveReviewDraft(itemId: string, value: { title: string; status: StoredInspection["status"] }) {
  return transaction<void>(["syncMetadata"], "readwrite", tx => { tx.objectStore("syncMetadata").put(value, `reviewDraft:${itemId}`); });
}
export function loadReviewDraft(itemId: string): Promise<{ title: string; status: StoredInspection["status"] } | undefined> {
  return transaction(["syncMetadata"], "readonly", (tx, done) => {
    const request = tx.objectStore("syncMetadata").get(`reviewDraft:${itemId}`);
    request.onsuccess = () => done(request.result);
  });
}


// Capture the causal source when opening an editor, including same-title/ABA changes.
export function loadEditSource(id: string): Promise<EditSource> {
  return transaction(["inspections", "syncQueue", "syncMetadata"], "readonly", (tx, done) => {
    const current = tx.objectStore("inspections").get(id);
    const acknowledged = tx.objectStore("syncMetadata").get(`inspectionVersion:${id}`);
    const pending = tx.objectStore("syncQueue").getAll();
    pending.onsuccess = () => {
      const predecessor = (pending.result as SyncQueueItem[]).filter(item => item.entityId === id && item.operation !== "DELETE").sort(compareQueueItems).at(-1);
      if (!current.result) { tx.abort(); return; }
      const version = Math.max(current.result.version ?? 0, acknowledged.result ?? 0);
      done({ inspection: current.result, expectation: predecessor ? { operationId: predecessor.id } : version > 0 ? { version } : undefined });
    };
  });
}
