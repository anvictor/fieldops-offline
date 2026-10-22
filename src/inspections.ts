import { normalizeTitle } from "./api";
import { InspectionConflictError, updateInspectionWithSync } from "./db";

export async function renameInspection(id: string, value: string, expectedTitle?: string) {
  const title = normalizeTitle(value);
  if (!title) throw new Error("Invalid inspection title.");
  return updateInspectionWithSync(id, (current) => {
    if (expectedTitle !== undefined && current.title !== expectedTitle) throw new InspectionConflictError();
    return { ...current, title };
  });
}

export function toggleInspection(id: string) {
  return updateInspectionWithSync(id, (current) => ({ ...current,
    status: current.status === "draft" ? "completed" : "draft" }));
}
