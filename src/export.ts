import { loadInspections } from "./db";
import type { StoredInspection } from "./db";

export function serializeInspections(inspections: StoredInspection[], now = new Date()) {
  const exportedAt = now.toISOString();
  return {
    filename: `fieldops-inspections-${exportedAt.replace(/[:.]/g, "-")}.json`,
    json: JSON.stringify({
      format: "fieldops-inspections",
      schemaVersion: 1,
      exportedAt,
      inspections: inspections.map(({ id, title, status }) => ({ id, title, status })),
    }, null, 2) + "\n",
  };
}

export function downloadInspectionFile(file: ReturnType<typeof serializeInspections>) {
  const url = URL.createObjectURL(new Blob([file.json], { type: "application/json;charset=utf-8" }));
  let link: HTMLAnchorElement | undefined;
  try {
    link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
  } finally {
    link?.remove();
    // Give the browser time to dispatch the download before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function exportInspections() {
  const inspections = await loadInspections();
  downloadInspectionFile(serializeInspections(inspections));
}
