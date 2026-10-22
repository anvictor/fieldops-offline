import { AuthenticationFailure, normalizeTitle, REQUEST_TIMEOUT, SyncFailure } from "./api";
import type { StoredInspection } from "./db";

export type RemoteSnapshot = { inspections: StoredInspection[]; deletedIds: string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid = () => new SyncFailure("Could not verify server changes. Local data was kept.", true);
export function parseSnapshot(value: unknown): RemoteSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.inspections) || !Array.isArray(data.deletedIds) ||
      data.inspections.length > 5000 || data.deletedIds.length > 5000) throw invalid();
  const seen = new Set<string>();
  const inspections = data.inspections.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !uuid.test(row.id) || seen.has(row.id) || typeof row.title !== "string" ||
        normalizeTitle(row.title) !== row.title || (row.status !== "draft" && row.status !== "completed") ||
        typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) ||
        typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) throw invalid();
    seen.add(row.id);
    return { id: row.id, title: row.title, status: row.status as StoredInspection["status"] };
  });
  const deletedIds = data.deletedIds.map((id: unknown) => {
    if (typeof id !== "string" || !uuid.test(id) || seen.has(id)) throw invalid();
    seen.add(id); return id;
  });
  return { inspections, deletedIds };
}

// A single bounded read attempt; retries require a later eligible user action.
export async function fetchSnapshot(base: string, signal: AbortSignal, credential?: () => string | null,
  fetcher: typeof fetch = fetch): Promise<RemoteSnapshot> {
  const token = credential?.();
  if (credential && (!token || !base.startsWith("https://"))) throw new AuthenticationFailure("Connect with your owner token to check server changes.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.throwIfAborted();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT);
  try {
    const response = await fetcher(`${base}/api/inspections/snapshot`, { signal: controller.signal, cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (response.status === 401 || response.status === 403) throw new AuthenticationFailure("Owner token rejected or API access denied. Reconnect to check server changes.");
    if (!response.ok) throw new SyncFailure("Could not check server changes. Try again through activity after 30 seconds.", false);
    if (!/^application\/json(;|$)/i.test(response.headers.get("content-type") ?? "")) throw invalid();
    const max = 2 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > max) throw invalid();
    const reader = response.body?.getReader();
    if (!reader) throw invalid();
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > max) { await reader.cancel(); throw invalid(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const result = parseSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
    signal.throwIfAborted();
    if (controller.signal.aborted) throw invalid();
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof SyncFailure) throw error;
    throw new SyncFailure("Could not check server changes. Local data was kept; try later activity.", false);
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
