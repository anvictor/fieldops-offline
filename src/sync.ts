import { fetchSnapshot } from "./remoteApi";
import { loadSyncQueue, removeQueueItem, subscribeQueueChanges, applyRemoteSnapshot, reserveRemoteCheck, finishRemoteCheck, REMOTE_INTERVAL } from "./db";
import type { SyncQueueItem } from "./db";
import { sendQueueItem, SyncFailure, AuthenticationFailure, RemoteDeletionFailure } from "./api";
import type { ApiConfig } from "./api";

export const SYNC_LOCK = "fieldops-inspection-sync";
export type SyncState = {
  checking: boolean;
  remoteError: string | null;
  connected: boolean;
  pendingCount: number;
  syncing: boolean;
  unavailable: string | null;
  error: { message: string; permanent: boolean; itemId: string | null; authentication?: boolean; recoveryTitle?: string } | null;
};
// Dependencies make the coordinator testable without replacing its lock/abort lifecycle.
type Options = {
  remote?: boolean;
  visible?: () => boolean;
  now?: () => number;
  snapshot?: typeof fetchSnapshot;
  config: ApiConfig;
  requireCredential?: boolean;
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
  let token: string | null = null;
  let credentialVersion = 0;
  const configurationReason = !options.locks ? "Synchronization unavailable in this browser" : options.config.reason;
  const disconnected = "Connect with your owner token to synchronize pending operations.";
  let state: SyncState = { checking: false, remoteError: null, connected: false, pendingCount: 0, syncing: false, error: null,
    unavailable: configurationReason ?? (options.requireCredential ? disconnected : null) };
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
  const isCurrent = (owner: AbortSignal) => owner === lifetime.signal && !owner.aborted;
  let remoteActive: Promise<void> | null = null;
  let remoteController: AbortController | null = null;
  let lastRemoteAttempt = -Infinity;
  function pull(): Promise<void> {
    const now = (options.now ?? Date.now)();
    if (lastRemoteAttempt > now) lastRemoteAttempt = -Infinity;
    if (!options.remote || lifetime.signal.aborted || configurationReason || state.error?.authentication || !options.online() ||
        options.visible?.() === false || (options.requireCredential && !token) || active || remoteActive ||
        now - lastRemoteAttempt < REMOTE_INTERVAL) return Promise.resolve();
    lastRemoteAttempt = now;
    const owner = lifetime.signal;
    const generation = credentialVersion;
    const base = options.config.base!;
    const controller = new AbortController();
    remoteController = controller;
    const signal = controller.signal;
    const abort = () => controller.abort();
    owner.addEventListener("abort", abort, { once: true });
    const current = () => isCurrent(owner) && !signal.aborted && generation === credentialVersion &&
      base === options.config.base && options.online() && options.visible?.() !== false;
    const work = options.locks!.request(SYNC_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock || !current()) return;
      if (!await reserveRemoteCheck(base, (options.now ?? Date.now)(), signal) || !current()) return;
      publish({ checking: true });
      try {
        const snapshot = await (options.snapshot ?? fetchSnapshot)(base, signal, options.requireCredential ? () => token : undefined);
        if (!current()) return;
        await applyRemoteSnapshot(snapshot, signal);
        if (current()) publish({ remoteError: null });
      } catch (error) {
        if (current()) publish({ remoteError: error instanceof SyncFailure ? error.message : "Could not check server changes. Local data was kept." });
      } finally {
        try { await finishRemoteCheck(base, (options.now ?? Date.now)()); }
        catch { if (current()) publish({ remoteError: "Could not preserve the check interval. Try later activity." }); }
      }
    }).catch(() => {
      if (current()) publish({ remoteError: "Could not check server changes safely. Try later activity." });
    });
    remoteActive = work.finally(() => {
      owner.removeEventListener("abort", abort);
      if (remoteController === controller) {
        remoteController = null; remoteActive = null;
        if (isCurrent(owner)) { publish({ checking: false }); void trigger(); }
      }
    });
    return remoteActive;
  }
  async function refresh(signal = lifetime.signal) {
    if (!isCurrent(signal)) return;
    const version = ++refreshVersion;
    try {
      const queue = await load();
      if (isCurrent(signal) && version === refreshVersion) {
        const error = state.error?.itemId && !queue.some((item) => item.id === state.error!.itemId) ? null : state.error;
        publish({ pendingCount: queue.length, error });
      }
    } catch {
      if (isCurrent(signal) && version === refreshVersion) publish({ error: { message: "Could not read the local queue.", permanent: false, itemId: null } });
    }
  }

  function trigger(): Promise<void> {
    if (lifetime.signal.aborted || state.unavailable || state.error || !options.online()) return Promise.resolve();
    if (active) { rerun = true; return active; }
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
          await send(item, options.config.base!, signal, undefined, options.requireCredential ? () => token : undefined);
          signal.throwIfAborted();
          await remove(item.id, signal);
          await refresh(owner);
        }
      } catch (error) {
        let failure = error;
        if (!signal.aborted && item && error instanceof RemoteDeletionFailure) {
          try { await applyRemoteSnapshot({ inspections: [], deletedIds: [item.entityId] }, signal); }
          catch { failure = new SyncFailure("Could not save server deletion locally. Retry safely.", false); }
        }
        if (!signal.aborted) publish({ error: {
          message: failure instanceof SyncFailure ? failure.message : "Could not confirm the local queue update. Retry safely.",
          permanent: failure instanceof SyncFailure && failure.permanent,
          itemId: item?.id ?? null,
          authentication: failure instanceof AuthenticationFailure,
          recoveryTitle: error instanceof RemoteDeletionFailure ? item?.payload?.title : undefined,
        } });
      } finally {
        if (isCurrent(owner)) { publish({ syncing: false }); await refresh(owner); }
      }
    }).catch(() => {
      if (!signal.aborted) publish({ error: { message: "Could not acquire synchronization lock.", permanent: false, itemId: null } });
    });
    active = work.finally(() => {
      owner.removeEventListener("abort", abort);
      if (runController === controller) {
        active = null; runController = null;
        // A restart may have requested work while this generation still owned the lock.
        if (rerun) { rerun = false; void trigger(); }
      }
    });
    return active;
  }

  return {
    pull,
    pauseReads() { remoteController?.abort(); },
    getSnapshot: () => state,
    async setCredential(value: string | null) {
      if (!options.requireCredential) return false;
      if (value !== null && (!/^[A-Za-z0-9_-]{43,128}$/.test(value) || configurationReason || !options.config.base?.startsWith("https://"))) return false;
      const version = ++credentialVersion;
      runController?.abort();
      remoteController?.abort();
      rerun = false;
      token = value;
      publish({ connected: value !== null, error: null, remoteError: null, unavailable: configurationReason ?? (value ? null : disconnected) });
      if (active) await active;
      if (remoteActive) await remoteActive;
      if (version === credentialVersion && token) {
        await trigger();
        while (active && version === credentialVersion && token) await active;
        if (version === credentialVersion && token) await pull();
      }
      return true;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      lifetime.abort();
      unsubscribe?.();
      lifetime = new AbortController();
      const signal = lifetime.signal;
      publish({ syncing: false });
      unsubscribe = (options.subscribeQueue ?? subscribeQueueChanges)(() => {
        void refresh(signal).then(() => { if (isCurrent(signal)) void trigger(); });
      });
      void refresh(signal).then(() => { if (isCurrent(signal)) void trigger(); });
    },
    // Keep active until the lock request settles: abort does not release a held Web Lock.
    stop() { lifetime.abort(); remoteController?.abort(); unsubscribe?.(); rerun = false; token = null; credentialVersion++; publish({ syncing: false, checking: false, remoteError: null, connected: false, unavailable: configurationReason ?? (options.requireCredential ? disconnected : null) }); },
    pause() { runController?.abort(); remoteController?.abort(); },
    trigger,
    async retry() {
      const owner = lifetime.signal;
      // Retry after an active/aborted run has released its Web Lock.
      if (active) await active;
      if (!isCurrent(owner)) return;
      publish({ error: null });
      await trigger();
    },
    async discard(confirm: (message: string) => boolean) {
      const blocked = state.error;
      if (blocked?.authentication || !blocked?.permanent || !blocked.itemId || !options.locks || lifetime.signal.aborted) return;
      if (!confirm("Discard this blocked queue operation? Local inspection data will stay unchanged. Discarding CREATE may leave later UPDATE/DELETE operations blocked.")) return;
      const signal = lifetime.signal;
      try {
        await options.locks.request(SYNC_LOCK, { mode: "exclusive", signal }, async () => {
          signal.throwIfAborted();
          const item = (await load()).find((entry) => entry.id === blocked.itemId);
          signal.throwIfAborted();
          if (item) await remove(item.id, signal);
          if (!signal.aborted) publish({ error: null });
          await refresh(signal);
        });
        if (isCurrent(signal)) await trigger();
      } catch {
        if (!signal.aborted) publish({ error: { ...blocked, message: "Could not discard the queued operation. Retry safely." } });
      }
    },
  };
}
