import { useCallback, useEffect, useRef, useState } from "react";
import { loadInspections, subscribeQueueChanges } from "../db";
import type { StoredInspection } from "../db";

export type InspectionRow = { inspection: StoredInspection; editing: boolean; deleted: boolean };

export function reconcileInspections(previous: InspectionRow[], stored: StoredInspection[]): InspectionRow[] {
  const existing = new Map(previous.map(row => [row.inspection.id, row]));
  const ids = new Set(stored.map(item => item.id));
  return [
    ...stored.map(inspection => ({ inspection, editing: existing.get(inspection.id)?.editing ?? false, deleted: false })),
    ...previous.filter(row => row.editing && !ids.has(row.inspection.id)).map(row => ({ ...row, deleted: true })),
  ];
}

export function useInspections() {
  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [error, setError] = useState("");
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const stored = await loadInspections();
      if (request === version.current) {
        setRows(previous => reconcileInspections(previous, stored));
        setError("");
      }
    } catch {
      if (request === version.current) setError("Could not refresh local inspections. Try returning to this tab.");
    }
  }, []);
  const edit = useCallback((id: string, editing: boolean) => {
    setRows(previous => previous.filter(row => row.inspection.id !== id || editing || !row.deleted)
      .map(row => row.inspection.id === id ? { ...row, editing } : row));
  }, []);
  useEffect(() => {
    let active = true;
    const counter = version;
    const unsubscribe = subscribeQueueChanges(() => { void refresh(); });
    const resume = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    queueMicrotask(() => { if (active) void refresh(); });
    return () => {
      active = false;
      ++counter.current;
      unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);
  return { rows, refresh, edit, error };
}
