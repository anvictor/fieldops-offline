import type { StoredInspection } from "./db";

export function validVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;
}

// Shared strict contract for snapshots, mutation ACKs and human review responses.
export function parseServerInspection(value: unknown): StoredInspection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id) ||
      typeof row.title !== "string" || !row.title || row.title.trim() !== row.title || [...row.title].length > 200 || row.title.includes("\u0000") ||
      (row.status !== "draft" && row.status !== "completed") || !validVersion(row.version) ||
      typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) return null;
  return { id: row.id, title: row.title, status: row.status, version: row.version };
}
