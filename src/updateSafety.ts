const blockers = new Set<symbol>();
const listeners = new Set<() => void>();
function notify() { for (const listener of listeners) listener(); }

// Tab-local only: no draft text or credentials are stored here.
export function blockAppUpdate() {
  const key = Symbol();
  blockers.add(key);
  notify();
  return () => { if (blockers.delete(key)) notify(); };
}
export const appUpdateBlocked = () => blockers.size > 0;
export function subscribeUpdateSafety(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export async function withUpdateWork<T>(work: () => Promise<T>): Promise<T> {
  const release = blockAppUpdate();
  try { return await work(); } finally { release(); }
}
