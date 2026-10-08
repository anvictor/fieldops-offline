import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationFailure, sendQueueItem } from "../src/api";
import { createSyncManager } from "../src/sync";
import type { SyncQueueItem } from "../src/db";

const token = "synthetic_owner_token_".padEnd(43, "x");
const id = "00000000-0000-4000-8000-000000000016";
const item: SyncQueueItem = { id: "queue-16", entityId: id, entityType: "inspection", operation: "CREATE",
  payload: { id, title: "Auth fixture", status: "draft" }, createdAt: "2026-01-01T00:00:00Z" };
const response = () => new Response(JSON.stringify({ ...item.payload, createdAt: item.createdAt, updatedAt: item.createdAt }),
  { status: 201, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.useRealTimers(); });

describe("private owner transport", () => {
  it("never sends without credentials or over HTTP", async () => {
    const fetcher = vi.fn();
    for (const [base, value] of [["https://api.test", null], ["http://api.test", token]] as const) {
      await expect(sendQueueItem(item, base, new AbortController().signal, fetcher, () => value)).rejects.toBeInstanceOf(AuthenticationFailure);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends runtime Authorization and rejects redirects without putting token in URL or body", async () => {
    const fetcher = vi.fn(async () => response());
    await sendQueueItem(item, "https://api.test", new AbortController().signal, fetcher, () => token);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(token);
    expect(init.body).not.toContain(token);
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });
    expect(init.redirect).toBe("error");
  });
  it.each([401, 403])("retains safe authentication failure without retrying %s", async (status) => {
    const fetcher = vi.fn(async () => new Response("secret body must not be shown", { status }));
    await expect(sendQueueItem(item, "https://api.test", new AbortController().signal, fetcher, () => token)).rejects.toBeInstanceOf(AuthenticationFailure);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rechecks credentials before retrying instead of reusing a captured token", async () => {
    vi.useFakeTimers();
    let value: string | null = token;
    const fetcher = vi.fn(async () => { value = null; return new Response("", { status: 503 }); });
    const sent = sendQueueItem(item, "https://api.test", new AbortController().signal, fetcher, () => value);
    const assertion = expect(sent).rejects.toBeInstanceOf(AuthenticationFailure);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains transient rate-limit failure with bounded retry and no permanent-discard classification", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response("", { status: 429 }));
    const sent = sendQueueItem(item, "https://api.test", new AbortController().signal, fetcher, () => token);
    const assertion = expect(sent).rejects.toMatchObject({ permanent: false });
    await vi.runAllTimersAsync(); await assertion;
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

function fixture(send: typeof sendQueueItem) {
  let queue = [item];
  const remove = vi.fn(async () => { queue = []; });
  const locks = { request: async (_name: string, _options: LockOptions, callback: (lock: Lock) => Promise<void>) => callback({} as Lock) };
  const manager = createSyncManager({ config: { base: "https://api.test", reason: null }, requireCredential: true,
    online: () => true, locks: locks as unknown as LockManager, load: async () => queue, remove, send,
    subscribeQueue: () => () => {} });
  return { manager, remove };
}

describe("credential lifecycle and queue recovery", () => {
  it("does not send while disconnected, connects FIFO, and never shares credentials with another manager", async () => {
    const send = vi.fn(async () => {});
    const a = fixture(send); const b = fixture(send);
    a.manager.start(); b.manager.start();
    await a.manager.trigger(); await b.manager.trigger();
    expect(send).not.toHaveBeenCalled();
    expect(await a.manager.setCredential("short")).toBe(false);
    await a.manager.setCredential(token);
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.remove).toHaveBeenCalledWith(item.id, expect.any(AbortSignal));
    expect(b.manager.getSnapshot().connected).toBe(false);
    a.manager.stop(); b.manager.stop();
    expect(a.manager.getSnapshot().connected).toBe(false);
  });
  it("aborts an in-flight send on disconnect and never removes its queued item", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const a = fixture(async (_item, _base, signal) => {
      entered();
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    a.manager.start();
    const connecting = a.manager.setCredential(token);
    await started;
    await a.manager.setCredential(null);
    await connecting;
    expect(a.remove).not.toHaveBeenCalled();
    expect(a.manager.getSnapshot().pendingCount).toBe(1);
    expect(a.manager.getSnapshot().connected).toBe(false);
    a.manager.stop();
  });
  it("never permits Discard for authentication failures and resumes after corrected credentials", async () => {
    const send = vi.fn().mockRejectedValueOnce(new AuthenticationFailure("Token rejected.")).mockResolvedValue(undefined);
    const a = fixture(send); a.manager.start();
    await a.manager.setCredential(token);
    expect(a.manager.getSnapshot().error?.authentication).toBe(true);
    const confirm = vi.fn(() => true);
    await a.manager.discard(confirm);
    expect(confirm).not.toHaveBeenCalled(); expect(a.remove).not.toHaveBeenCalled();
    await a.manager.setCredential(null);
    await a.manager.setCredential(token);
    expect(a.remove).toHaveBeenCalledTimes(1);
    a.manager.stop();
  });
  it("replacement waits for aborted work to settle, then uses only the new credential without dropping the old queue item", async () => {
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const settled = new Promise<void>((resolve) => { release = resolve; });
    const tokens: Array<string | null | undefined> = [];
    let running = 0; let maximum = 0;
    const a = fixture(async (_item, _base, _signal, _fetcher, credential) => {
      tokens.push(credential?.()); maximum = Math.max(maximum, ++running);
      if (tokens.length === 1) { entered(); await settled; }
      running--;
    });
    a.manager.start();
    const first = a.manager.setCredential(token); await started;
    const replacement = token + "new";
    const second = a.manager.setCredential(replacement);
    await Promise.resolve();
    expect(tokens).toEqual([token]); expect(a.remove).not.toHaveBeenCalled();
    release(); await Promise.all([first, second]);
    expect(tokens).toEqual([token, replacement]); expect(maximum).toBe(1);
    expect(a.remove).toHaveBeenCalledTimes(1);
    a.manager.stop();
  });
});
