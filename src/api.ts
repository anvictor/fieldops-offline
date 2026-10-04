import type { SyncQueueItem } from "./db";

export type ApiConfig = { base: string | null; reason: string | null };
export function resolveApiConfig(development: boolean, value?: string): ApiConfig {
  if (development) return { base: "", reason: null };
  const unavailable = { base: null, reason: "Synchronization unavailable: configure a valid API base URL." };
  if (!value || value !== value.trim() || /[?#]/.test(value) || /^https?:\/\/[^/]*@/i.test(value)) return unavailable;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return unavailable;
    const path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/api")) return unavailable;
    return { base: url.origin + path, reason: null };
  } catch { return unavailable; }
}

export function normalizeTitle(value: string): string | null {
  const title = value.trim();
  return title && [...title].length <= 200 && !title.includes("\u0000") ? title : null;
}

export class SyncFailure extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) { super(message); this.permanent = permanent; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REQUEST_TIMEOUT = 8000;
export const RETRY_DELAYS = [500, 1000];
const invalidAck = () => new SyncFailure("Unexpected server acknowledgment. Operation retained.", true);

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function sendQueueItem(item: SyncQueueItem, base: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<void> {
  if (item.entityType !== "inspection" || !UUID.test(item.entityId) || !["CREATE", "UPDATE", "DELETE"].includes(item.operation)) {
    throw new SyncFailure("Invalid queued operation. Review or discard it to continue.", true);
  }
  const payload = item.payload;
  let title: string | null = null;
  if (item.operation !== "DELETE") {
    title = payload && typeof payload.title === "string" ? normalizeTitle(payload.title) : null;
    if (!payload || payload.id !== item.entityId || !title || !["draft", "completed"].includes(payload.status)) {
      throw new SyncFailure("Invalid queued inspection. Review or discard it to continue.", true);
    }
  }
  const url = `${base}/api/inspections${item.operation === "CREATE" ? "" : `/${encodeURIComponent(item.entityId)}`}`;
  const method = { CREATE: "POST", UPDATE: "PATCH", DELETE: "DELETE" }[item.operation];
  // Serialize once: all retries send the same queued snapshot, never the latest local row.
  const body = item.operation === "DELETE" ? undefined : JSON.stringify({
    ...(item.operation === "CREATE" ? { id: item.entityId } : {}), title, status: payload!.status,
  });

  async function attempt() {
    signal.throwIfAborted();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => { controller.abort(); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new SyncFailure("API request timed out. Retry when available.", false));
      }, REQUEST_TIMEOUT);
    });
    try {
      await Promise.race([cancelled, (async () => {
        const response = await fetcher(url, { method, headers: { "Content-Type": "application/json" }, body,
          signal: controller.signal, redirect: "error" });
        if (response.status >= 500 && response.status <= 599) throw new SyncFailure("API unavailable. Retry when available.", false);
        if (item.operation === "DELETE" && response.status === 204) return;
        const json = /^(application\/json)(;|$)/i.test(response.headers.get("content-type") ?? "");
        // Body transport failures are retryable; only a complete invalid JSON body is permanent.
        const text = json ? await response.text() : null;
        let data: Record<string, unknown>;
        try { data = text === null ? null : JSON.parse(text); } catch { throw invalidAck(); }
        if (!data || typeof data !== "object" || Array.isArray(data)) throw invalidAck();
        const error = data.error as { code?: unknown; message?: unknown } | undefined;
        const missing = response.status === 404 && error?.code === "INSPECTION_NOT_FOUND" && typeof error.message === "string";
        if (item.operation === "DELETE" && missing) return;
        if (item.operation === "UPDATE" && missing) throw new SyncFailure("Server inspection is missing. Operation blocked.", true);
        if (response.status === 409 && error?.code === "ID_CONFLICT") throw new SyncFailure("Inspection ID conflicts with server content. Operation blocked.", true);
        if (!response.ok) throw new SyncFailure("Server rejected the operation. Review or discard it to continue.", true);
        const expectedStatus = item.operation === "CREATE" ? [200, 201] : [200];
        if (item.operation === "DELETE" || !expectedStatus.includes(response.status) ||
            data.id !== item.entityId.toLowerCase() || data.title !== title || data.status !== payload!.status ||
            typeof data.createdAt !== "string" || !Number.isFinite(Date.parse(data.createdAt)) ||
            typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))) throw invalidAck();
      })()]);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof SyncFailure) throw error;
      throw new SyncFailure("Network request failed. Retry when available.", false);
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener("abort", abort!);
    }
  }
  for (let attemptNumber = 0; ; attemptNumber++) {
    try { await attempt(); return; } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof SyncFailure) || error.permanent || attemptNumber >= RETRY_DELAYS.length) throw error;
      await delay(RETRY_DELAYS[attemptNumber], signal);
    }
  }
}
