import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const target = new URL(process.env.SMOKE_SITE_URL || "http://127.0.0.1:4173/fieldops-offline/");
assert.ok(["127.0.0.1", "anvictor.github.io", "fieldops-offline.onrender.com"].includes(target.hostname));
await mkdir("smoke-results", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.SMOKE_BROWSER_EXECUTABLE || undefined });
const checks = [];
let context;
const snapshot = page => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("fieldops-db", 2);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    const result = {};
    for (const name of ["inspections", "syncQueue", "syncMetadata"]) {
      result[name] = await new Promise((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    }
    return result;
  } finally { db.close(); }
});
const card = page => page.locator(".inspection-card");
async function openPair(noChannel = false) {
  context = await browser.newContext({ serviceWorkers: "block" });
  context.setDefaultTimeout(7000);
  // No worker traffic, no backend requests, fresh synthetic storage on each case.
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return route.request().method() === "GET" && url.origin === target.origin &&
      url.pathname.startsWith(target.pathname) && !/(^|\/)api(?:\/|$)/.test(url.pathname)
      ? route.continue() : route.abort("blockedbyclient");
  });
  if (noChannel) await context.addInitScript(() => { window.BroadcastChannel = undefined; });
  const a = await context.newPage(); const b = await context.newPage();
  await a.goto(target.href); await b.goto(target.href);
  return [a, b];
}
async function create(a, title) {
  await a.getByLabel("New inspection title", { exact: true }).fill(title);
  await a.getByRole("button", { name: "Add inspection", exact: true }).click();
  await a.getByRole("heading", { name: `Card: ${title}`, exact: true }).waitFor();
}
try {
  let [a, b] = await openPair();
  await create(a, "Shared record");
  await b.getByRole("heading", { name: "Card: Shared record", exact: true }).waitFor();
  await b.getByLabel("New inspection title", { exact: true }).fill("Unrelated unsaved creation");
  await card(b).getByRole("button", { name: "Edit title", exact: true }).click();
  await card(b).getByLabel("Inspection title", { exact: true }).fill("My unsaved long draft 💧");
  await b.getByLabel("Status filter", { exact: true }).selectOption("draft");
  await card(a).getByRole("button", { name: "Complete inspection", exact: true }).click();
  await card(b).getByText("completed", { exact: true }).waitFor();
  await b.getByText("Completed: 1 / 1", { exact: true }).waitFor();
  assert.equal(await b.getByLabel("Status filter", { exact: true }).inputValue(), "draft");
  assert.equal(await card(b).getByLabel("Inspection title", { exact: true }).inputValue(), "My unsaved long draft 💧");
  await card(a).getByRole("button", { name: "Edit title", exact: true }).click();
  await card(a).getByLabel("Inspection title", { exact: true }).fill("Remote title");
  await card(a).getByRole("button", { name: "Save title", exact: true }).click();
  await card(b).getByRole("heading", { name: "Card: Remote title", exact: true }).waitFor();
  const conflictBefore = await snapshot(b);
  await card(b).getByRole("button", { name: "Save title", exact: true }).click();
  await card(b).getByText(/The title changed in another tab/).waitFor();
  assert.deepEqual(await snapshot(b), conflictBefore);
  await card(a).getByRole("button", { name: "Delete inspection", exact: true }).click();
  await card(b).getByText(/This inspection was deleted in another tab or device/).waitFor();
  assert.equal(await card(b).getByLabel("Inspection title", { exact: true }).inputValue(), "My unsaved long draft 💧");
  assert.equal(await b.getByLabel("New inspection title", { exact: true }).inputValue(), "Unrelated unsaved creation");
  assert.equal(await card(b).getByRole("button", { name: "Save title", exact: true }).isDisabled(), true);
  assert.equal(await card(b).getByRole("button", { name: "Delete inspection", exact: true }).isDisabled(), true);
  await b.getByText("Completed: 0 / 0", { exact: true }).waitFor();
  await b.screenshot({ path: "smoke-results/deleted-inspection-draft.png", fullPage: true });
  await card(b).getByRole("button", { name: "Dismiss draft", exact: true }).click();
  assert.equal(await card(b).count(), 0);
  await a.getByLabel("Import inspections", { exact: true }).setInputFiles({ name: "synthetic-import.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "fieldops-inspections", schemaVersion: 1, exportedAt: "2026-10-22T00:00:00.000Z",
      inspections: [{ id: "00000000-0000-4000-8000-000000000020", title: "Imported in A", status: "draft" }] })) });
  await a.getByRole("button", { name: "Import new inspections", exact: true }).click();
  await b.getByRole("heading", { name: "Card: Imported in A", exact: true }).waitFor();
  await b.getByLabel("Search inspections", { exact: true }).fill("missing");
  assert.equal(await card(b).count(), 0);
  await b.getByRole("button", { name: "Clear search", exact: true }).click();
  await b.getByRole("heading", { name: "Card: Imported in A", exact: true }).waitFor();
  checks.push("Broadcast CRUD/import refresh and filters; remote rename conflict with zero writes; both unsaved inputs retained; deleted editor recovery/dismissal and live counts");
  await context.close();

  [a, b] = await openPair(true);
  await create(a, "Late deletion");
  await b.reload();
  await card(b).getByRole("button", { name: "Edit title", exact: true }).click();
  await card(b).getByLabel("Inspection title", { exact: true }).fill("Late draft");
  await card(a).getByRole("button", { name: "Delete inspection", exact: true }).click();
  await card(a).waitFor({ state: "detached" });
  const before = await snapshot(a);
  assert.equal(await card(b).getByRole("button", { name: "Save title", exact: true }).isEnabled(), true);
  assert.equal(await card(b).getByText(/This inspection was deleted in another tab or device/).count(), 0);
  // Programmatic submit avoids a focus event reread: Save must itself detect deletion.
  await card(b).locator("form").evaluate(form => form.requestSubmit());
  await card(b).getByText(/This inspection was deleted in another tab or device/).waitFor();
  assert.equal(await card(b).getByLabel("Inspection title", { exact: true }).inputValue(), "Late draft");
  assert.deepEqual(await snapshot(b), before);
  checks.push("Suppressed BroadcastChannel: late Save detects deletion transactionally, no resurrection/queue/metadata writes");
  await card(b).getByRole("button", { name: "Dismiss draft", exact: true }).click();
  await create(a, "Fallback record");
  await b.evaluate(() => window.dispatchEvent(new Event("focus")));
  await b.getByRole("heading", { name: "Card: Fallback record", exact: true }).waitFor();
  await context.setOffline(true);
  // Offline persistence is checked directly; shell offline reopen is covered by existing deployed smoke.
  assert.equal((await snapshot(b)).inspections[0].title, "Fallback record");
  checks.push("No-channel focus fallback and durable data available offline");
  await writeFile("smoke-results/cross-tab-report.json", JSON.stringify({ verdict: "PASS", target: target.href, checks,
    limitations: "Fresh synthetic local data; service workers blocked for isolation; no API sync or multi-device conflict test." }, null, 2));
  console.log(JSON.stringify({ verdict: "PASS", checks }));
} finally { await context?.close(); await browser.close(); }
