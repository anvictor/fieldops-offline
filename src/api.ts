import { resolveExpectedVersion } from "./db";
import type { StoredInspection, SyncQueueItem } from "./db";
import { parseServerInspection, validVersion } from "./inspectionVersion";

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

export class RemoteDeletionFailure extends SyncFailure {
  constructor() { super("This inspection was deleted on the server. Pending changes are retained for review or discard.", true); }
}

export class VersionConflictFailure extends SyncFailure {
  readonly current?: StoredInspection;
  constructor(current?: StoredInspection) {
    super(current ? "This inspection changed on another device. Review the server version before saving."
      : "This pending change has no confirmed version or its predecessor was replaced. Review the server version before saving.", true);
    this.current = current;
  }
}

export class AuthenticationFailure extends SyncFailure {
  constructor(message: string) { super(message, true); }
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
  fetcher: typeof fetch = fetch, credential?: () => string | null): Promise<number | void> {
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
  const expectedVersion = item.operation === "UPDATE" ? await resolveExpectedVersion(item, signal) : undefined;
  if (item.operation === "UPDATE" && (!validVersion(expectedVersion) || expectedVersion >= 2147483647)) throw new VersionConflictFailure();
  if (item.operation !== "DELETE" && !UUID.test(item.id)) throw new SyncFailure("Invalid mutation identity. Operation retained.", true);
  const url = `${base}/api/inspections${item.operation === "CREATE" ? "" : `/${encodeURIComponent(item.entityId)}`}`;
  const method = { CREATE: "POST", UPDATE: "PATCH", DELETE: "DELETE" }[item.operation];
  // Serialize once: all retries send the same queued snapshot, never the latest local row.
  const body = item.operation === "DELETE" ? undefined : JSON.stringify({
    ...(item.operation === "CREATE" ? { id: item.entityId } : { expectedVersion }), mutationId: item.id, title, status: payload!.status,
  });

  async function attempt(): Promise<number | void> {
    signal.throwIfAborted();
    const token = credential?.();
    if (credential && (!token || !base.startsWith("https://"))) {
      throw new AuthenticationFailure("Connect with an owner token to synchronize securely.");
    }
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
      const version = await Promise.race([cancelled, (async () => {
        const response = await fetcher(url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body,
          signal: controller.signal, redirect: "error" });
        if (response.status === 401 || response.status === 403) {
          throw new AuthenticationFailure(response.status === 401
            ? "Owner token rejected. Disconnect and enter a valid token."
            : "API access denied. Check the token and allowed site origin.");
        }
        if (response.status === 429) throw new SyncFailure("API request limit reached. Wait before retrying synchronization.", false);
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
        if (item.operation === "UPDATE" && missing) throw new RemoteDeletionFailure();
        if (response.status === 409 && error?.code === "INSPECTION_DELETED") throw new RemoteDeletionFailure();
        if (response.status === 409 && error?.code === "VERSION_CONFLICT") {
          const current = parseServerInspection(data.current);
          if (!current || current.id !== item.entityId.toLowerCase()) throw invalidAck();
          throw new VersionConflictFailure(current);
        }
        if (error?.code === "VERSION_REQUIRED" && response.status === 400) throw new VersionConflictFailure();
        if (response.status === 409 && error?.code === "ID_CONFLICT") throw new SyncFailure("Inspection ID conflicts with server content. Operation blocked.", true);
        if (!response.ok) throw new SyncFailure("Server rejected the operation. Review or discard it to continue.", true);
        const expectedStatus = item.operation === "CREATE" ? [200, 201] : [200];
        if (item.operation === "DELETE" || !expectedStatus.includes(response.status) ||
            data.id !== item.entityId.toLowerCase() || data.title !== title || data.status !== payload!.status ||
            typeof data.createdAt !== "string" || !Number.isFinite(Date.parse(data.createdAt)) ||
            typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt)) ||
            !parseServerInspection(data) || (item.operation === "UPDATE" && data.version !== expectedVersion! + 1) ||
            (item.operation === "CREATE" && data.version !== 1)) throw invalidAck();
        return data.version as number;
      })()]);
      signal.throwIfAborted();
      return version;
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
    try { return await attempt(); } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof SyncFailure) || error.permanent || attemptNumber >= RETRY_DELAYS.length) throw error;
      await delay(RETRY_DELAYS[attemptNumber], signal);
    }
  }
}
