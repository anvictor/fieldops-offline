import { normalizeTitle } from "./api";
import { importInspectionBatch, previewInspectionBatch } from "./db";
import type { StoredInspection } from "./db";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_RECORDS = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new Error("Choose a valid FieldOps export (version 1, up to 2 MiB and 1000 inspections).");
function objectWithKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === keys.toSorted().join(",");
}

export function parseInspectionImport(text: string): StoredInspection[] {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw invalid();
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw invalid(); }
  if (!objectWithKeys(value, ["format", "schemaVersion", "exportedAt", "inspections"]) ||
      value.format !== "fieldops-inspections" || value.schemaVersion !== 1 ||
      typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt)) ||
      new Date(value.exportedAt).toISOString() !== value.exportedAt ||
      !Array.isArray(value.inspections) || value.inspections.length > MAX_IMPORT_RECORDS) throw invalid();
  const seen = new Set<string>();
  return value.inspections.map((record: unknown) => {
    if (!objectWithKeys(record, ["id", "title", "status"]) || typeof record.id !== "string" ||
        !UUID.test(record.id) || typeof record.title !== "string" ||
        (record.status !== "draft" && record.status !== "completed")) throw invalid();
    const id = record.id.toLowerCase();
    const title = normalizeTitle(record.title);
    if (!title || seen.has(id)) throw invalid();
    seen.add(id);
    return { id, title, status: record.status };
  });
}

export async function readInspectionImport(file: Pick<File, "size" | "text">) {
  if (file.size > MAX_IMPORT_BYTES) throw invalid();
  return parseInspectionImport(await file.text());
}

export async function previewInspectionImport(records: StoredInspection[]) {
  const snapshot = structuredClone(records);
  const counts = await previewInspectionBatch(snapshot);
  return { records: snapshot, ...counts };
}

export function confirmInspectionImport(records: StoredInspection[]) {
  return importInspectionBatch(records);
}
