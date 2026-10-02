import { loadSyncQueue, removeQueueItem, subscribeQueueChanges } from "./db";
import type { SyncQueueItem } from "./db";
import { sendQueueItem, SyncFailure } from "./api";
import type { ApiConfig } from "./api";

export const SYNC_LOCK = "fieldops-inspection-sync";
export type SyncState = {
  pendingCount: number;
  syncing: boolean;
  unavailable: string | null;
  error: { message: string; permanent: boolean; itemId: string | null } | null;
};
// Dependencies make the coordinator testable without replacing its lock/abort lifecycle.
type Options = {
  config: ApiConfig;
  locks: Pick<LockManager, "request"> | undefined;
  online: () => boolean;
  load?: typeof loadSyncQueue;
  remove?: typeof removeQueueItem;
  subscribeQueue?: typeof subscribeQueueChanges;
  send?: typeof sendQueueItem;
};

export function createSyncManager(options: Options) {
  const load = options.load ?? loadSyncQueue;
  const remove = options.remove ?? removeQueueItem;
  const send = options.send ?? sendQueueItem;
  let state: SyncState = { pendingCount: 0, syncing: false, error: null,
    unavailable: !options.locks ? "Synchronization unavailable in this browser" : options.config.reason };
  const listeners = new Set<() => void>();
  const publish = (update: Partial<SyncState>) => {
    state = { ...state, ...update };
    for (const listener of listeners) listener();
  };
  let lifetime = new AbortController();
  let active: Promise<void> | null = null;
  let rerun = false;
  let runController: AbortController | null = null;
  let unsubscribe: (() => void) | undefined;
  let refreshVersion = 0;
  async function refresh() {
    const version = ++refreshVersion;
    const signal = lifetime.signal;
    try {
      const queue = await load();
      if (!signal.aborted && version === refreshVersion) {
        const error = state.error?.itemId && !queue.some((item) => item.id === state.error!.itemId) ? null : state.error;
        publish({ pendingCount: queue.length, error });
      }
    } catch {
      if (!signal.aborted) publish({ error: { message: "Could not read the local queue.", permanent: false, itemId: null } });
    }
  }

  function trigger(): Promise<void> {
    if (active) { rerun = true; return active; }
    if (lifetime.signal.aborted || state.unavailable || state.error || !options.online()) return Promise.resolve();
    const controller = new AbortController();
    runController = controller;
    const signal = controller.signal;
    const abort = () => controller.abort();
    const owner = lifetime.signal;
    owner.addEventListener("abort", abort, { once: true });
    // ifAvailable and signal are mutually exclusive in Web Locks; check our abort signal inside.
    const work = options.locks!.request(SYNC_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock || signal.aborted) return;
      publish({ syncing: true });
      let item: SyncQueueItem | undefined;
      try {
        while (options.online()) {
          signal.throwIfAborted();
          item = (await load())[0];
          signal.throwIfAborted();
          if (!item) break;
          await send(item, options.config.base!, signal);
          signal.throwIfAborted();
          await remove(item.id, signal);
          await refresh();
        }
      } catch (error) {
        if (!signal.aborted) publish({ error: {
          message: error instanceof SyncFailure ? error.message : "Could not confirm the local queue update. Retry safely.",
          permanent: error instanceof SyncFailure && error.permanent,
          itemId: item?.id ?? null,
        } });
      } finally {
        if (!owner.aborted) { publish({ syncing: false }); await refresh(); }
      }
    }).catch(() => {
      if (!signal.aborted) publish({ error: { message: "Could not acquire synchronization lock.", permanent: false, itemId: null } });
    });
    active = work.finally(() => {
      owner.removeEventListener("abort", abort);
      if (runController === controller) {
        active = null; runController = null;
        if (rerun && !owner.aborted) { rerun = false; void trigger(); }
      }
    });
    return active;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      lifetime = new AbortController();
      const signal = lifetime.signal;
      unsubscribe = (options.subscribeQueue ?? subscribeQueueChanges)(() => {
        void refresh().then(() => { if (!signal.aborted) void trigger(); });
      });
      void refresh().then(() => { if (!signal.aborted) void trigger(); });
    },
    stop() { lifetime.abort(); unsubscribe?.(); active = null; runController = null; },
    pause() { runController?.abort(); },
    trigger,
    async retry() {
      // Retry after an active/aborted run has released its Web Lock.
      if (active) await active;
      publish({ error: null });
      await trigger();
    },
    async discard(confirm: (message: string) => boolean) {
      const blocked = state.error;
      if (!blocked?.permanent || !blocked.itemId || !options.locks || lifetime.signal.aborted) return;
      if (!confirm("Discard this blocked queue operation? Local inspection data will stay unchanged. Discarding CREATE may leave later UPDATE/DELETE operations blocked.")) return;
      const signal = lifetime.signal;
      try {
        await options.locks.request(SYNC_LOCK, { mode: "exclusive", signal }, async () => {
          signal.throwIfAborted();
          const item = (await load()).find((entry) => entry.id === blocked.itemId);
          signal.throwIfAborted();
          if (item) await remove(item.id, signal);
          if (!signal.aborted) publish({ error: null });
          await refresh();
        });
        await trigger();
      } catch {
        if (!signal.aborted) publish({ error: { ...blocked, message: "Could not discard the queued operation. Retry safely." } });
      }
    },
  };
}
