import { useEffect, useState, useSyncExternalStore } from "react";
import { createPwaUpdates } from "./pwaUpdates";
import { appUpdateBlocked, subscribeUpdateSafety } from "./updateSafety";

export function PwaUpdateBanner() {
  const [updates] = useState(() => createPwaUpdates({
    serviceWorker: import.meta.env.PROD ? navigator.serviceWorker : undefined,
    window, document, base: import.meta.env.BASE_URL,
    online: () => navigator.onLine, blocked: appUpdateBlocked,
    reload: () => window.location.reload(),
  }));
  const state = useSyncExternalStore(updates.subscribe, updates.getSnapshot);
  const blocked = useSyncExternalStore(subscribeUpdateSafety, appUpdateBlocked);
  useEffect(() => { updates.start(); return updates.stop; }, [updates]);
  if (!state.available) return null;
  if (state.dismissed) return <div className="update-reminder">
    <button onClick={updates.show}>App update available</button>
  </div>;
  return <aside className="update-banner" aria-labelledby="update-heading">
    <div role="status"><h2 id="update-heading">A new version is available</h2>
      <p>Update when you are ready. Saved inspections and pending operations stay on this device.
        Reloading clears this tab’s owner token; reconnect afterward. Other tabs will not reload.</p>
    </div>
    {blocked && <p>Finish or cancel unsaved forms and wait for local work and synchronization to finish before updating.</p>}
    <div className="sync-actions">
      <button className="button-primary" disabled={blocked || state.applying} onClick={updates.apply}>
        {state.applying ? "Updating…" : "Update now"}</button>
      <button disabled={state.applying} onClick={updates.later}>Later</button>
    </div>
    {state.error && <p role="alert">{state.error}</p>}
  </aside>;
}
