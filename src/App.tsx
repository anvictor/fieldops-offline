import "./App.css";
import { normalizeTitle, resolveApiConfig } from "./api";
import { createSyncManager } from "./sync";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import {
  deleteInspectionWithSync,
  loadInspections,
  loadSyncQueue,
  saveInspectionWithSync,
} from "./db";

type InspectionStatus = "draft" | "completed";

type Inspection = {
  id: string;
  title: string;
  status: InspectionStatus;
};

type InspectionCardProps = {
  title: string;
  status: InspectionStatus;
  onToggleStatus: () => void;
  onDelete: () => void;
};

function InspectionCard({
  title,
  status,
  onToggleStatus,
  onDelete,
}: InspectionCardProps) {
  return (
    <>
      <h2>{title}</h2>
      <p>
        Status:{" "}
        <strong className={status === "completed" ? "completed" : "draft"}>
          {status}
        </strong>
      </p>
      <button onClick={onToggleStatus}>
        {status === "draft" ? "Complete inspection" : "Reopen inspection"}
      </button>
      <button onClick={onDelete}>Delete inspection</button>
    </>
  );
}

function App() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InspectionStatus>(
    "all",
  );
  const [sync] = useState(() => createSyncManager({
    config: resolveApiConfig(import.meta.env.DEV, import.meta.env.VITE_API_BASE_URL),
    locks: navigator.locks,
    online: () => navigator.onLine,
  }));
  const syncState = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const validTitle = normalizeTitle(newTitle);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    async function initDB() {
      try {
        const storedInspections = await loadInspections();

        setInspections(storedInspections);
      } catch (error) {
        console.error("Failed to initialize FieldOps DB:", error);
      }
    }

    initDB();
  }, []);
  useEffect(() => {
    sync.start();
    return () => sync.stop();
  }, [sync]);
  useEffect(() => {
    if (isOnline) void sync.retry(); else sync.pause();
  }, [isOnline, sync]);
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("development mode, StrictMode may re-run effects");
    } else {
      console.log("prod mode");
    }
    async function handleOnline() {
      const syncQueue = await loadSyncQueue();

      console.log("Connection restored. Pending sync:", syncQueue);
    }

    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, []);
  async function toggleInspectionStatus(id: string) {
    const inspection = inspections.find((item) => item.id === id);

    if (!inspection) {
      return;
    }

    const updatedInspection: Inspection = {
      ...inspection,
      status: inspection.status === "draft" ? "completed" : "draft",
    };

    try {
      await saveInspectionWithSync(updatedInspection, "UPDATE");
      if (navigator.onLine) void sync.retry();

      setInspections((prevInspections) =>
        prevInspections.map((item) =>
          item.id === id ? updatedInspection : item,
        ),
      );
    } catch (error) {
      console.error("Failed to update inspection:", error);
    }
  }

  async function addInspection() {
    if (!validTitle) {
      return;
    }

    const newInspection: Inspection = {
      id: crypto.randomUUID(),
      title: validTitle,
      status: "draft",
    };

    try {
      await saveInspectionWithSync(newInspection, "CREATE");
      if (navigator.onLine) void sync.retry();

      setInspections((prevInspections) => [...prevInspections, newInspection]);

      setNewTitle("");
    } catch (error) {
      console.error("Failed to save inspection:", error);
    }
  }

  async function deleteInspection(id: string) {
    try {
      await deleteInspectionWithSync(id);
      if (navigator.onLine) void sync.retry();

      setInspections((prevInspections) =>
        prevInspections.filter((item) => item.id !== id),
      );
    } catch (error) {
      console.error("Failed to delete inspection:", error);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await addInspection();
  }

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setNewTitle(event.target.value);
  }

  const completedCount = inspections.filter(
    (inspection) => inspection.status === "completed",
  ).length;

  const draftCount = inspections.filter(
    (inspection) => inspection.status === "draft",
  ).length;

  const filteredInspections =
    statusFilter === "all"
      ? inspections
      : inspections.filter((inspection) => inspection.status === statusFilter);

  return (
    <main>
      <h1>FieldOps Offline</h1>
      <select
        value={statusFilter}
        onChange={(event) =>
          setStatusFilter(event.target.value as "all" | InspectionStatus)
        }
      >
        <option value="all">All</option>
        <option value="draft">Draft</option>
        <option value="completed">Completed</option>
      </select>
      <p>
        Completed: {completedCount} / {inspections.length}
      </p>
      <p>Draft: {draftCount}</p>
      <p>Pending sync: {syncState.pendingCount}</p>
      <div aria-live="polite">
        {syncState.syncing && <p>Synchronizing…</p>}
        {syncState.unavailable && <p>{syncState.unavailable}</p>}
        {syncState.error && <p role="alert">Synchronization error: {syncState.error.message}</p>}
      </div>
      <button disabled={!isOnline || syncState.syncing || !!syncState.unavailable}
        onClick={() => void sync.retry()}>Retry synchronization</button>
      {syncState.error?.permanent && <button disabled={syncState.syncing || !!syncState.unavailable}
        onClick={() => void sync.discard((message) => window.confirm(message))}>Discard blocked operation</button>}
      <p>Connection: {isOnline ? "Online" : "Offline"}</p>
      <form onSubmit={handleSubmit}>
        <input
          value={newTitle}
          onChange={handleTitleChange}
          placeholder="Inspection title"
        />

        <button type="submit" disabled={!validTitle}>
          Add inspection
        </button>
      </form>
      {newTitle && !validTitle && <p role="alert">Title must contain 1–200 Unicode characters and no null character.</p>}
      {filteredInspections.map((inspection) => (
        <section key={inspection.id}>
          <InspectionCard
            title={`Card: ${inspection.title}`}
            status={inspection.status}
            onToggleStatus={() => toggleInspectionStatus(inspection.id)}
            onDelete={() => deleteInspection(inspection.id)}
          />
        </section>
      ))}
    </main>
  );
}

export default App;
