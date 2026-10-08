import { useEffect, useId, useRef, useState } from "react";
import { confirmInspectionImport, previewInspectionImport, readInspectionImport } from "./import";

type Preview = Awaited<ReturnType<typeof previewInspectionImport>> & { filename: string };
export function ImportInspections({ onImported }: { onImported: () => Promise<void> }) {
  const inputId = useId();
  const generation = useRef(0);
  const committing = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => () => { generation.current++; }, []);

  function cancel() {
    if (committing.current) return;
    generation.current++; setPreview(null); setReading(false); setError(""); setMessage("");
  }
  async function select(file?: File) {
    if (committing.current) return;
    const current = ++generation.current;
    setPreview(null); setError(""); setMessage(""); setReading(!!file);
    if (!file) return;
    try {
      const records = await readInspectionImport(file);
      if (generation.current !== current) return;
      const next = await previewInspectionImport(records);
      if (generation.current === current) setPreview({ ...next, filename: file.name });
    } catch {
      if (generation.current === current) setError("Could not preview this file. Use a valid FieldOps version 1 export, up to 2 MiB and 1000 inspections.");
    } finally {
      if (generation.current === current) setReading(false);
    }
  }
  async function confirm() {
    if (!preview || preview.imported === 0 || committing.current) return;
    committing.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const counts = await confirmInspectionImport(preview.records);
      setPreview(null);
      setMessage(`Imported ${counts.imported}; skipped ${counts.skipped}.`);
      try { await onImported(); } catch {
        setError("Import was saved. Reload the page to refresh the inspection list.");
      }
    } catch {
      setError("Could not save the import. No records were added. Please try again.");
    } finally {
      committing.current = false; setBusy(false);
    }
  }
  return <aside aria-label="Inspection import">
    <label htmlFor={inputId}>Import inspections</label>
    <input id={inputId} type="file" accept=".json,application/json" disabled={busy}
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        void select(file);
      }} />
    <div aria-live="polite">
      {reading && <p>Reading import…</p>}
      {busy && <p>Saving import…</p>}
      {message && <p>{message}</p>}
    </div>
    {preview && <div>
      <p style={{ overflowWrap: "anywhere" }}>Preview: {preview.filename}</p>
      <p>Total: {preview.records.length}; new: {preview.imported}; skipped: {preview.skipped}.</p>
      <p>Existing or pending IDs are skipped. Counts are checked again when saving.</p>
      <ul style={{ width: "fit-content", maxWidth: "100%", boxSizing: "border-box", margin: "1rem auto", textAlign: "left", overflowWrap: "anywhere" }}>{preview.records.slice(0, 5).map(record => <li key={record.id}>{record.title} — {record.status}</li>)}</ul>
      {preview.records.length > 5 && <p>Showing the first five inspections.</p>}
      <button disabled={busy || preview.imported === 0} onClick={() => void confirm()}>Import new inspections</button>
    </div>}
    {(preview || reading) && <button disabled={busy} onClick={cancel}>Cancel import</button>}
    {error && <p role="alert">{error}</p>}
  </aside>;
}
