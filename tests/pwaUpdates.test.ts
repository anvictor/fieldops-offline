import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVATION_TIMEOUT, createPwaUpdates, UPDATE_INTERVAL, UPDATE_THROTTLE } from "../src/pwaUpdates";
import { appUpdateBlocked, blockAppUpdate, withUpdateWork } from "../src/updateSafety";

class Worker extends EventTarget {
  state = "installed";
  postMessage = vi.fn();
}
function fixture(waiting = true, controlled = true) {
  vi.useFakeTimers();
  const worker = new Worker();
  const registration = Object.assign(new EventTarget(), {
    waiting: waiting ? worker : null, installing: null as Worker | null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const container = Object.assign(new EventTarget(), {
    controller: controlled ? new Worker() : null as Worker | null,
    register: vi.fn().mockResolvedValue(registration),
  });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let online = true;
  let blocked = false;
  const reload = vi.fn();
  const manager = createPwaUpdates({
    serviceWorker: container as unknown as ServiceWorkerContainer,
    window: win as unknown as Window, document: doc as unknown as Document,
    base: "/fieldops-offline/", online: () => online, blocked: () => blocked, reload,
  });
  const activate = () => {
    registration.waiting = null;
    container.controller = worker;
    container.dispatchEvent(new Event("controllerchange"));
  };
  manager.start();
  return { manager, worker, registration, container, win, doc, reload, activate,
    setOnline: (value: boolean) => { online = value; },
    setBlocked: (value: boolean) => { blocked = value; } };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe("production update lifecycle", () => {
  it("detects waiting update without reloading, defers and reopens it", async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(0);
    expect(f.manager.getSnapshot().available).toBe(true);
    expect(f.reload).not.toHaveBeenCalled();
    f.manager.later(); expect(f.manager.getSnapshot().dismissed).toBe(true);
    f.manager.show(); expect(f.manager.getSnapshot().dismissed).toBe(false);
    f.manager.stop();
  });
  it("does not treat first installation as update and registers only once across restart", async () => {
    const f = fixture(false, false);
    f.manager.stop(); f.manager.start(); await vi.advanceTimersByTimeAsync(0);
    f.registration.installing = f.worker;
    f.registration.dispatchEvent(new Event("updatefound"));
    f.worker.dispatchEvent(new Event("statechange"));
    expect(f.manager.getSnapshot().available).toBe(false);
    expect(f.container.register).toHaveBeenCalledTimes(1);
    expect(f.container.register).toHaveBeenCalledWith("/fieldops-offline/sw.js", {
      scope: "/fieldops-offline/", updateViaCache: "none",
    });
    f.manager.stop();
  });
  it("observes a new installation after startup", async () => {
    const f = fixture(false); await vi.advanceTimersByTimeAsync(0);
    f.registration.installing = f.worker;
    f.registration.dispatchEvent(new Event("updatefound"));
    f.worker.dispatchEvent(new Event("statechange"));
    expect(f.manager.getSnapshot().available).toBe(true);
    f.manager.stop();
  });
  it("checks on resume and timer with throttling, visibility, offline and cleanup guards", async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(0);
    expect(f.registration.update).toHaveBeenCalledTimes(1);
    f.win.dispatchEvent(new Event("focus")); expect(f.registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_THROTTLE);
    f.win.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
    expect(f.registration.update).toHaveBeenCalledTimes(2);
    f.setOnline(false); await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL);
    expect(f.registration.update).toHaveBeenCalledTimes(2);
    f.setOnline(true); f.doc.visibilityState = "hidden";
    f.win.dispatchEvent(new Event("online")); expect(f.registration.update).toHaveBeenCalledTimes(2);
    f.doc.visibilityState = "visible"; f.doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0); expect(f.registration.update).toHaveBeenCalledTimes(3);
    f.manager.stop(); await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL * 2);
    f.win.dispatchEvent(new Event("focus")); expect(f.registration.update).toHaveBeenCalledTimes(3);
  });
  it("deduplicates concurrent checks and tolerates failed update requests", async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(0);
    let reject!: (error: Error) => void;
    f.registration.update.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await vi.advanceTimersByTimeAsync(UPDATE_THROTTLE);
    const pending = f.manager.check();
    await vi.advanceTimersByTimeAsync(UPDATE_THROTTLE); await f.manager.check();
    expect(f.registration.update).toHaveBeenCalledTimes(2);
    reject(new Error("offline")); await pending;
    expect(f.manager.getSnapshot().applying).toBe(false);
    f.manager.stop();
  });
  it("blocks before activation and rechecks dirty state before reload", async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(0);
    f.setBlocked(true); f.manager.apply(); expect(f.worker.postMessage).not.toHaveBeenCalled();
    f.setBlocked(false); f.manager.apply();
    expect(f.worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    f.setBlocked(true); f.activate(); expect(f.reload).not.toHaveBeenCalled();
    f.setBlocked(false); f.manager.apply(); expect(f.reload).toHaveBeenCalledTimes(1);
    f.manager.stop();
  });
  it("reloads only the consenting tab after activation, never on external controller change", async () => {
    const consenting = fixture(); const other = fixture(); await vi.advanceTimersByTimeAsync(0);
    consenting.manager.apply(); consenting.activate(); other.activate();
    expect(consenting.reload).toHaveBeenCalledTimes(1);
    expect(other.reload).not.toHaveBeenCalled();
    expect(other.manager.getSnapshot().available).toBe(true);
    consenting.manager.stop(); other.manager.stop();
  });
  it("activation timeout allows retry and does not turn late activation into automatic reload", async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(0);
    f.manager.apply(); await vi.advanceTimersByTimeAsync(ACTIVATION_TIMEOUT);
    expect(f.manager.getSnapshot().applying).toBe(false);
    expect(f.manager.getSnapshot().error).toMatch(/try/);
    f.activate(); expect(f.reload).not.toHaveBeenCalled();
    f.manager.apply(); expect(f.reload).toHaveBeenCalledTimes(1);
    f.manager.stop();
  });
  it("handles postMessage failures without stuck applying state", async () => {
    const f = fixture(); await vi.advanceTimersByTimeAsync(0);
    f.worker.postMessage.mockImplementation(() => { throw new Error("redundant"); });
    f.manager.apply(); expect(f.manager.getSnapshot().applying).toBe(false);
    expect(f.reload).not.toHaveBeenCalled(); f.manager.stop();
  });
  it("nested work blocks update until all operations finish, including failure", async () => {
    const release = blockAppUpdate();
    await expect(withUpdateWork(async () => {
      expect(appUpdateBlocked()).toBe(true); throw new Error("write failed");
    })).rejects.toThrow("write failed");
    expect(appUpdateBlocked()).toBe(true); release();
    expect(appUpdateBlocked()).toBe(false);
  });
});
