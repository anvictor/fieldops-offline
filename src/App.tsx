import "./App.css";
import { useEffect, useState } from "react";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import {
  deleteInspectionWithSync,
  loadInspections,
  loadSyncQueue,
  openFieldOpsDB,
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
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    async function initDB() {
      try {
        const db = await openFieldOpsDB();

        console.log("FieldOps DB opened:", db.name);

        const storedInspections = await loadInspections();

        setInspections(storedInspections);
        const syncQueue = await loadSyncQueue();

        setPendingSyncCount(syncQueue.length);
      } catch (error) {
        console.error("Failed to initialize FieldOps DB:", error);
      }
    }

    initDB();
  }, []);
  useEffect(() => {
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
      await refreshPendingSyncCount();

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
    if (!newTitle.trim()) {
      return;
    }

    const newInspection: Inspection = {
      id: crypto.randomUUID(),
      title: newTitle,
      status: "draft",
    };

    try {
      await saveInspectionWithSync(newInspection, "CREATE");
      await refreshPendingSyncCount();

      setInspections((prevInspections) => [...prevInspections, newInspection]);

      setNewTitle("");
    } catch (error) {
      console.error("Failed to save inspection:", error);
    }
  }

  async function deleteInspection(id: string) {
    try {
      await deleteInspectionWithSync(id);
      await refreshPendingSyncCount();

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

  async function refreshPendingSyncCount() {
    const syncQueue = await loadSyncQueue();
    setPendingSyncCount(syncQueue.length);
  }

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
      <p>Pending sync: {pendingSyncCount}</p>
      <p>Connection: {isOnline ? "Online" : "Offline"}</p>
      <form onSubmit={handleSubmit}>
        <input
          value={newTitle}
          onChange={handleTitleChange}
          placeholder="Inspection title"
        />

        <button type="submit" disabled={!newTitle.trim()}>
          Add inspection
        </button>
      </form>
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
