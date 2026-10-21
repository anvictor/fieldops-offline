export const UPDATE_INTERVAL = 5 * 60 * 1000;
export const UPDATE_THROTTLE = 60 * 1000;
export const ACTIVATION_TIMEOUT = 15000;
type State = { available: boolean; dismissed: boolean; applying: boolean; error: string | null };
type Options = {
  serviceWorker: ServiceWorkerContainer | undefined;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  base: string;
  online: () => boolean;
  blocked: () => boolean;
  reload: () => void;
  now?: () => number;
};

export function createPwaUpdates(options: Options) {
  let state: State = { available: false, dismissed: false, applying: false, error: null };
  const listeners = new Set<() => void>();
  const publish = (change: Partial<State>) => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  let registration: ServiceWorkerRegistration | undefined;
  let registering: Promise<ServiceWorkerRegistration> | undefined;
  let checking = false;
  let lastCheck = -Infinity;
  let consent = false;
  let previousController: ServiceWorker | null = null;
  let initialWorker: ServiceWorker | null = null;
  let updateWorker: ServiceWorker | null = null;
  let activationTimer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const now = options.now ?? Date.now;
  const ready = () => publish({ available: true });
  function finish() {
    clearTimeout(activationTimer);
    consent = false;
    if (options.blocked()) {
      publish({ applying: false, available: true, dismissed: false,
        error: "Update ready. Finish or cancel your current work, then choose Update now again." });
      return;
    }
    options.reload();
  }
  async function check() {
    if (!registration || checking || registration.installing || !options.online() ||
        options.document.visibilityState !== "visible" || now() - lastCheck < UPDATE_THROTTLE) return;
    checking = true;
    lastCheck = now();
    try { await registration.update(); } catch {
      // An unavailable host or offline transition must not interrupt inspections.
    } finally { checking = false; }
  }
  function start() {
    if (stop || !options.serviceWorker) return;
    const container = options.serviceWorker;
    let alive = true;
    const cleanups: Array<() => void> = [];
    previousController = container.controller;
    initialWorker ??= container.controller;
    const changed = () => {
      const current = container.controller;
      if (current && current !== previousController && (previousController || current === updateWorker)) {
        ready();
        if (consent && (!updateWorker || updateWorker.state === "activated")) finish();
      }
      previousController = current;
    };
    container.addEventListener("controllerchange", changed);
    cleanups.push(() => container.removeEventListener("controllerchange", changed));
    const resume = () => { void check(); };
    options.window.addEventListener("focus", resume);
    options.window.addEventListener("online", resume);
    options.document.addEventListener("visibilitychange", resume);
    const timer = setInterval(resume, UPDATE_INTERVAL);
    cleanups.push(() => {
      clearInterval(timer);
      options.window.removeEventListener("focus", resume);
      options.window.removeEventListener("online", resume);
      options.document.removeEventListener("visibilitychange", resume);
    });
    // Reuse the promise across React StrictMode effect setup/cleanup.
    registering ??= container.register(`${options.base}sw.js`, { scope: options.base, updateViaCache: "none" });
    void registering.then((value) => {
      if (!alive) return;
      registration = value;
      initialWorker ??= value.active;
      const watch = (worker: ServiceWorker | null, replacement: boolean) => {
        if (!worker) return;
        initialWorker ??= worker;
        const isUpdate = replacement || worker !== initialWorker;
        if (isUpdate) updateWorker = worker;
        const transitioned = () => {
          if (!isUpdate && worker === initialWorker && worker.state === "redundant" && !value.active) {
            initialWorker = null;
          }
          if (!isUpdate || worker !== updateWorker) return;
          if (["installed", "activating", "activated"].includes(worker.state)) ready();
          // An uncontrolled first-visit page may never receive controllerchange.
          if (worker.state === "activated" && consent) finish();
        };
        worker.addEventListener("statechange", transitioned);
        cleanups.push(() => worker.removeEventListener("statechange", transitioned));
        transitioned();
      };
      const observe = () => watch(value.installing, false);
      value.addEventListener("updatefound", observe);
      cleanups.push(() => value.removeEventListener("updatefound", observe));
      watch(value.waiting, true);
      if (value.active && value.active !== initialWorker) watch(value.active, true);
      observe();
      void check();
    }).catch(() => {
      registering = undefined;
      // Retry registration on next mount; the app remains usable without a worker.
    });
    stop = () => {
      alive = false;
      for (const cleanup of cleanups) cleanup();
      clearTimeout(activationTimer);
      consent = false;
      stop = undefined;
    };
  }
  function apply() {
    if (!state.available || state.applying) return;
    if (options.blocked()) {
      publish({ error: "Finish or cancel unsaved forms and wait for local work and synchronization to finish." });
      return;
    }
    publish({ applying: true, error: null });
    const target = registration?.waiting ?? updateWorker;
    if (!target || target.state === "activated") { finish(); return; }
    if (target.state === "redundant") {
      publish({ applying: false, error: "This update is no longer available. Keep working and wait for the next check." });
      return;
    }
    consent = true;
    activationTimer = setTimeout(() => {
      consent = false;
      publish({ applying: false, error: "Could not finish the update. Keep working or try Update now again." });
    }, ACTIVATION_TIMEOUT);
    try { target.postMessage({ type: "SKIP_WAITING" }); } catch {
      clearTimeout(activationTimer);
      consent = false;
      publish({ applying: false, error: "Could not activate the update. Please try again." });
    }
  }
  return {
    start, stop: () => stop?.(), check, apply,
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    later: () => publish({ dismissed: true, error: null }),
    show: () => publish({ dismissed: false }),
  };
}
