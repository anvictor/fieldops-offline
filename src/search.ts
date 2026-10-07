import type { StoredInspection } from "./db";

export function searchInspections(inspections: readonly StoredInspection[], query: string,
  status: "all" | StoredInspection["status"]) {
  const term = query.trim().toLowerCase();
  return inspections.filter((inspection) =>
    (status === "all" || inspection.status === status) &&
    inspection.title.toLowerCase().includes(term));
}
