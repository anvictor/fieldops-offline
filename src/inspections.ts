import { normalizeTitle } from "./api";
import { loadInspections, saveInspectionWithSync } from "./db";

export async function renameInspection(id: string, value: string) {
  const title = normalizeTitle(value);
  if (!title) throw new Error("Invalid inspection title.");
  const current = (await loadInspections()).find((inspection) => inspection.id === id);
  if (!current) throw new Error("Inspection is unavailable.");
  if (current.title === title) return { inspection: current, changed: false };
  const inspection = { ...current, title };
  await saveInspectionWithSync(inspection, "UPDATE");
  return { inspection, changed: true };
}
