import "./App.css";
import { useState } from "react";

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
  const [inspections, setInspections] = useState<Inspection[]>([
    {
      id: "1",
      title: "Equipment inspection",
      status: "draft",
    },
    {
      id: "2",
      title: "Safety inspection",
      status: "completed",
    },
    {
      id: "3",
      title: "Pump maintenance",
      status: "draft",
    },
  ]);
  const [newTitle, setNewTitle] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InspectionStatus>(
    "all",
  );
  function toggleInspectionStatus(id: string) {
    setInspections((prevInspections) =>
      prevInspections.map((item) =>
        item.id === id
          ? {
              ...item,
              status: item.status === "draft" ? "completed" : "draft",
            }
          : item,
      ),
    );
  }

  function addInspection() {
    if (!newTitle.trim()) {
      return;
    }
    const newInspection: Inspection = {
      id: crypto.randomUUID(),
      title: newTitle,
      status: "draft",
    };

    setInspections((prevInspections) => [...prevInspections, newInspection]);
    setNewTitle("");
  }

  function deleteInspection(id: string) {
    setInspections((prevInspections) =>
      prevInspections.filter((item) => item.id !== id),
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addInspection();
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
