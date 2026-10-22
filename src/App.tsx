import { PwaUpdateBanner } from "./PwaUpdateBanner";
import { useUpdateBlocker } from "./hooks/useUpdateBlocker";
import { withUpdateWork } from "./updateSafety";
import "./App.css";
import { OwnerConnection } from "./OwnerConnection";
import { ImportInspections } from "./ImportInspections";
import { searchInspections } from "./search";
import { useInspections } from "./hooks/useInspections";
import { renameInspection, toggleInspection } from "./inspections";
import { exportInspections } from "./export";
import { normalizeTitle, resolveApiConfig } from "./api";
import { subscribeActivity } from "./activity";
import { createSyncManager } from "./sync";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import {
  deleteInspectionWithSync,
  InspectionUnavailableError,
  InspectionConflictError,
  saveInspectionWithSync,
} from "./db";

type InspectionStatus = "draft" | "completed";

type Inspection = {
  id: string;
  title: string;
  status: InspectionStatus;
};

type InspectionCardProps = {
  deleted: boolean;
  onEditing: (editing: boolean) => void;
  title: string;
  status: InspectionStatus;
  onToggleStatus: () => void;
  onDelete: () => void;
  onRename: (title: string, expectedTitle: string) => Promise<void>;
};

function InspectionCard({
  deleted,
  onEditing,
  title,
  status,
  onToggleStatus,
  onDelete,
  onRename,
}: InspectionCardProps) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [originalTitle, setOriginalTitle] = useState(title);
  const [missing, setMissing] = useState(false);
  const unavailable = deleted || missing;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const validTitle = normalizeTitle(draftTitle);
  useUpdateBlocker(editing || saving);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !validTitle || unavailable) return;
    setSaving(true);
    setError("");
    try {
      await onRename(draftTitle, originalTitle);
      setEditing(false);
      onEditing(false);
    } catch (error) {
      if (error instanceof InspectionUnavailableError) setMissing(true);
      setError(error instanceof InspectionUnavailableError || error instanceof InspectionConflictError
        ? error.message : "Could not save the title. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h3>{unavailable ? "Deleted inspection" : "Card"}: {title}</h3>
      <p>
        Status:{" "}
        <strong className={status === "completed" ? "completed" : "draft"}>
          {status}
        </strong>
      </p>
      {editing ? <form className="edit-form" onSubmit={(event) => void handleSave(event)}>
        <label htmlFor={inputId}>Inspection title</label>
        <input id={inputId} value={draftTitle} disabled={saving}
          onChange={(event) => setDraftTitle(event.target.value)} autoFocus />
        <button className="button-primary" type="submit" disabled={saving || !validTitle || unavailable}>Save title</button>
        <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(""); onEditing(false); }}>{unavailable ? "Dismiss draft" : "Cancel"}</button>
        {!validTitle && <p role="alert">Title must contain 1–200 Unicode characters and no null character.</p>}
        <div aria-live="polite">{saving && <p>Saving title…</p>}</div>
        {unavailable ? <p role="alert">This inspection was deleted in another tab or device. Copy your draft before dismissing it.</p> : error && <p role="alert">{error}</p>}
      </form> : <button onClick={() => { setDraftTitle(title); setOriginalTitle(title); setError(""); setEditing(true); onEditing(true); }}>Edit title</button>}
      <button disabled={saving || unavailable} onClick={onToggleStatus}>
        {status === "draft" ? "Complete inspection" : "Reopen inspection"}
      </button>
      <button className="button-danger" disabled={saving || unavailable} onClick={onDelete}>Delete inspection</button>
    </>
  );
}

function App() {
  const { rows, refresh, edit, error: refreshError } = useInspections();
  const inspections = rows.filter(row => !row.deleted).map(row => row.inspection);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InspectionStatus>(
    "all",
  );
  const [sync] = useState(() => createSyncManager({
    remote: true,
    visible: () => document.visibilityState === "visible",
    requireCredential: !import.meta.env.DEV,
    config: resolveApiConfig(import.meta.env.DEV, import.meta.env.VITE_API_BASE_URL),
    locks: navigator.locks,
    online: () => navigator.onLine,
  }));
  const syncState = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const validTitle = normalizeTitle(newTitle);
  const isOnline = useOnlineStatus();
  useUpdateBlocker(newTitle.length > 0 || exporting || syncState.syncing || syncState.checking);

  useEffect(() => {
    sync.start();
    return () => sync.stop();
  }, [sync]);
  useEffect(() => {
    if (isOnline) void sync.retry(); else sync.pause();
  }, [isOnline, sync]);
  useEffect(() => subscribeActivity(window, document, () => { void sync.pull(); }, () => sync.pauseReads()), [sync]);
  async function toggleInspectionStatus(id: string) {
    try {
      await withUpdateWork(() => toggleInspection(id));
      if (navigator.onLine) void sync.retry();
    } catch (error) {
      console.error("Failed to update inspection:", error);
    } finally { await refresh(); }
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
      await withUpdateWork(() => saveInspectionWithSync(newInspection, "CREATE"));
      if (navigator.onLine) void sync.retry();

      await refresh();

      setNewTitle("");
    } catch (error) {
      console.error("Failed to save inspection:", error);
    }
  }

  async function deleteInspection(id: string) {
    try {
      await withUpdateWork(() => deleteInspectionWithSync(id));
      if (navigator.onLine) void sync.retry();

      await refresh();
    } catch (error) {
      console.error("Failed to delete inspection:", error);
    }
  }

  async function changeInspectionTitle(id: string, title: string, expectedTitle: string) {
    try {
      const result = await withUpdateWork(() => renameInspection(id, title, expectedTitle));
      if (result.changed && navigator.onLine) void sync.retry();
    } finally { await refresh(); }
  }

  async function handleExport() {
    setExporting(true);
    setExportMessage("");
    setExportError("");
    try {
      await withUpdateWork(() => exportInspections());
      setExportMessage("Download requested. Check your browser downloads.");
    } catch {
      setExportError("Could not export inspections. Please try again.");
    } finally {
      setExporting(false);
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

  const filteredInspections = searchInspections(inspections, searchQuery, statusFilter);

  return (
    <main className="app-shell">
      <PwaUpdateBanner />
      <header className="app-header">
        <div>
          <p className="eyebrow">Inspection workspace</p>
          <h1>FieldOps Offline</h1>
          <p className="intro">Record inspections, keep working offline, and sync when you are ready.</p>
        </div>
        <p className="connection-status">Connection: {isOnline ? "Online" : "Offline"}</p>
      </header>

      <div className="workspace-grid">
        <div className="workspace-main">
          <div className="panel" role="region" aria-labelledby="new-inspection-heading">
            <h2 id="new-inspection-heading">New inspection</h2>
            <form className="create-form" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="new-inspection-title">New inspection title</label>
                <input id="new-inspection-title" value={newTitle}
                  onChange={handleTitleChange} placeholder="Inspection title" />
              </div>
              <button className="button-primary" type="submit" disabled={!validTitle}>Add inspection</button>
            </form>
            {newTitle && !validTitle && <p role="alert">Title must contain 1–200 Unicode characters and no null character.</p>}
          </div>

          <div className="inspection-list" role="region" aria-labelledby="inspections-heading">
            <div className="list-heading">
              <h2 id="inspections-heading">Inspections</h2>
              <div className="inspection-counts">
                <p>Completed: {completedCount} / {inspections.length}</p>
                <p>Draft: {draftCount}</p>
              </div>
            </div>
            <div className="filters">
              <div className="field">
                <label htmlFor="inspection-search">Search inspections</label>
                <input id="inspection-search" type="search" value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)} />
                {searchQuery && <button onClick={() => setSearchQuery("")}>Clear search</button>}
              </div>
              <div className="field">
                <label htmlFor="inspection-status-filter">Status filter</label>
                <select id="inspection-status-filter" value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as "all" | InspectionStatus)}>
                  <option value="all">All</option>
                  <option value="draft">Draft</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
            <div aria-live="polite">
              {inspections.length > 0 && filteredInspections.length === 0 &&
                <p className="empty-message">No inspections match your search and status filter.</p>}
            </div>
            {refreshError && <p role="alert">{refreshError}</p>}
            {inspections.length === 0 && <p className="empty-message">{rows.some(row => row.deleted) ? "No current inspections. An unsaved draft is retained below." : "No inspections yet. Add one to get started."}</p>}
            <div className="inspection-cards">
              {rows.filter(row => row.editing || (!row.deleted && filteredInspections.some(item => item.id === row.inspection.id))).map(({ inspection, deleted }) => (
                <section className="inspection-card" key={inspection.id}>
                  <InspectionCard deleted={deleted} onEditing={(editing) => edit(inspection.id, editing)} title={inspection.title} status={inspection.status}
                    onToggleStatus={() => toggleInspectionStatus(inspection.id)}
                    onDelete={() => deleteInspection(inspection.id)}
                    onRename={(title, expectedTitle) => changeInspectionTitle(inspection.id, title, expectedTitle)} />
                </section>
              ))}
            </div>
          </div>
        </div>

        <div className="workspace-sidebar">
          <div className="panel" role="region" aria-labelledby="sync-heading">
            <h2 id="sync-heading">Synchronization</h2>
            <p className="pending-count">Pending sync: {syncState.pendingCount}</p>
            <div aria-live="polite">
              {syncState.syncing && <p>Synchronizing…</p>}
              {syncState.checking && <p>Checking server changes…</p>}
              {syncState.remoteError && <p role="alert">{syncState.remoteError}</p>}
              {syncState.unavailable && <p>{syncState.unavailable}</p>}
              {syncState.error && <p role="alert">Synchronization error: {syncState.error.message}</p>}
              {syncState.error?.recoveryTitle && <p>Pending title to copy: {syncState.error.recoveryTitle}</p>}
            </div>
            <div className="sync-actions">
              <button disabled={!isOnline || syncState.syncing || !!syncState.unavailable}
                onClick={() => void sync.retry()}>Retry synchronization</button>
              {syncState.error?.permanent && !syncState.error.authentication && <button disabled={syncState.syncing || !!syncState.unavailable}
                onClick={() => void sync.discard((message) => window.confirm(message))}>Discard blocked operation</button>}
            </div>
            {!import.meta.env.DEV && <OwnerConnection connected={syncState.connected}
              available={!!navigator.locks && !!resolveApiConfig(false, import.meta.env.VITE_API_BASE_URL).base?.startsWith("https://")}
              unavailableReason={!navigator.locks ? "Synchronization is unavailable in this browser. You can keep working offline." : undefined}
              connect={(token) => sync.setCredential(token)} />}
          </div>

          <div className="panel file-tools" role="region" aria-labelledby="data-heading">
            <h2 id="data-heading">Import &amp; export</h2>
            <ImportInspections onImported={async () => {
              if (navigator.onLine) void sync.retry();
              await refresh();
            }} />
            <button disabled={exporting} onClick={() => void handleExport()}>Export inspections</button>
            <div aria-live="polite">
              {exporting && <p>Preparing export…</p>}
              {exportMessage && <p>{exportMessage}</p>}
            </div>
            {exportError && <p role="alert">{exportError}</p>}
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
