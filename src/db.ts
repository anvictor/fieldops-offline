const DB_NAME = "fieldops-db";
const DB_VERSION = 1;

export function openFieldOpsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("inspections")) {
        const inspectionsStore = db.createObjectStore("inspections", {
          keyPath: "id",
        });

        inspectionsStore.createIndex("status", "status", {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains("syncQueue")) {
        db.createObjectStore("syncQueue", {
          keyPath: "id",
        });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}
type StoredInspection = {
  id: string;
  title: string;
  status: "draft" | "completed";
};

export async function saveInspection(
  inspection: StoredInspection,
): Promise<void> {
  const db = await openFieldOpsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("inspections", "readwrite");

    const store = transaction.objectStore("inspections");

    store.put(inspection);

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
}
export async function loadInspections(): Promise<StoredInspection[]> {
  const db = await openFieldOpsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("inspections", "readonly");

    const store = transaction.objectStore("inspections");

    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}
export async function deleteInspectionFromDB(id: string): Promise<void> {
  const db = await openFieldOpsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("inspections", "readwrite");

    const store = transaction.objectStore("inspections");

    store.delete(id);

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
}
