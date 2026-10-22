// Events signal an opportunity; the coordinator owns throttling and eligibility.
export function subscribeActivity(window: Pick<Window, "addEventListener" | "removeEventListener">,
  document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">, check: () => void, hidden: () => void = () => {}) {
  const activity = () => { if (document.visibilityState === "visible") check(); };
  const events = ["pointerdown", "pointermove", "keydown", "scroll", "focus"];
  for (const event of events) window.addEventListener(event, activity, { passive: true });
  const visibility = () => { if (document.visibilityState === "visible") activity(); else hidden(); };
  document.addEventListener("visibilitychange", visibility);
  return () => {
    for (const event of events) window.removeEventListener(event, activity);
    document.removeEventListener("visibilitychange", visibility);
  };
}
