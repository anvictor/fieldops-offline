import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { allowedRequest, assertBuildInfo, parseTarget, PUBLIC_SITE, validateSha } from "./smoke-config.mjs";

function bounded(promise, milliseconds = 15000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Smoke phase timeout")), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

const checks = [];
let phase = "configuration";
let browser;
let page;
const report = { verdict: "FAIL", checks, limitations: "Synthetic isolated IndexedDB only; API synchronization and browser online indicator are not asserted." };
await mkdir("smoke-results", { recursive: true });

async function isolate(context, target, onBlocked = () => {}) {
  context.setDefaultTimeout(15000);
  await context.route("**/*", route => {
    if (allowedRequest(route.request().url(), route.request().method(), target)) return route.continue();
    onBlocked(route.request());
    return route.abort("blockedbyclient");
  });
  // Current application fetches from the window. Install before startup sync, even
  // before the worker controls this page. Network routes also protect worker fetches.
  await context.addInitScript(({ origin, path }) => {
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const value = input instanceof Request ? input.url : String(input);
      const url = new URL(value, location.href);
      const method = options?.method ?? (input instanceof Request ? input.method : "GET");
      if (method !== "GET" || url.origin !== origin || !url.pathname.startsWith(path) ||
          /(^|\/)api(?:\/|$)/.test(url.pathname)) return Promise.reject(new TypeError("Smoke API isolation"));
      return original(input, options);
    };
  }, { origin: target.origin, path: target.pathname });
}

// Fail closed if the installed Chromium/Playwright does not intercept SW traffic.
// No public site or backend is visited until this disposable loopback proof passes.
async function proveIsolation() {
  let mutations = 0;
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url.includes("/api")) {
      mutations++; response.end("unexpected"); return;
    }
    if (request.url.endsWith("guard-worker.js")) {
      response.setHeader("Content-Type", "text/javascript");
      response.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));");
    } else {
      response.setHeader("Content-Type", "text/html"); response.end("<title>Synthetic guard proof</title>");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const target = parseTarget(`http://127.0.0.1:${server.address().port}/fieldops-offline/`);
  const context = await browser.newContext();
  try {
    let workerBlocked = 0;
    await isolate(context, target, request => {
      if (request.serviceWorker()) workerBlocked++;
    });
    const probe = await context.newPage();
    await probe.goto(target.href);
    assert.equal(await probe.evaluate(() => fetch("api/inspections", { method: "POST", body: "synthetic" }).then(() => false, () => true)), true);
    const workerReady = context.waitForEvent("serviceworker");
    await probe.evaluate(() => navigator.serviceWorker.register("guard-worker.js"));
    const worker = await workerReady;
    const denied = await bounded(worker.evaluate(async origin => {
      const requests = [
        [origin + "/fieldops-offline/api/inspections", "GET"],
        [origin + "/fieldops-offline/api/inspections", "POST"],
        [origin.replace("127.0.0.1", "localhost") + "/fieldops-offline/backend", "GET"],
      ];
      return Promise.all(requests.map(([url, method]) => fetch(url, { method }).then(() => false, () => true)));
    }, target.origin));
    assert.deepEqual(denied, [true, true, true]);
    assert.equal(workerBlocked, 3);
    assert.equal(mutations, 0);
    checks.push("API isolation before startup: page guard and three SW-owned requests blocked; zero backend requests");
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function snapshot() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("fieldops-db", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = {};
    for (const name of ["inspections", "syncQueue", "syncMetadata"]) {
      result[name] = await new Promise((resolve, reject) => {
        const request = db.transaction(name, "readonly").objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close(); return result;
  });
}

async function add(title) {
  await page.getByPlaceholder("Inspection title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add inspection", exact: true }).click();
  await page.getByRole("heading", { name: "Card: " + title, exact: true }).waitFor();
}

async function downloadAll(expected) {
  const before = await snapshot();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export inspections", exact: true }).click();
  const download = await pending;
  const data = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(data.format, "fieldops-inspections");
  assert.equal(data.schemaVersion, 1);
  assert.ok(Number.isFinite(Date.parse(data.exportedAt)));
  assert.deepEqual(data.inspections.sort((a, b) => a.id.localeCompare(b.id)),
    expected.toSorted((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual(await snapshot(), before);
}

try {
  const target = parseTarget(process.env.SMOKE_SITE_URL ?? PUBLIC_SITE);
  const sha = validateSha(process.env.SMOKE_EXPECTED_SHA);
  Object.assign(report, { target: target.href, expectedSha: sha,
    evidence: target.href === PUBLIC_SITE ? "direct automated hosted browser" : "loopback production preview" });
  phase = "browser API isolation proof";
  browser = await chromium.launch({ executablePath: process.env.SMOKE_BROWSER_EXECUTABLE || undefined });
  await proveIsolation();
  phase = "deployment version";
  let matched = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const marker = new URL("build-info.json", target);
      marker.searchParams.set("smoke", `${Date.now()}-${attempt}`);
      const response = await fetch(marker, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      assertBuildInfo(await response.json(), sha);
      matched = true; break;
    } catch {
      if (attempt < 23) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  assert.ok(matched, "Expected deployment version did not become available.");
  report.observedSha = sha;
  checks.push("uncached deployment marker equals exact expected SHA");
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 900 } });
  await isolate(context, target);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  let pageErrors = 0;
  page.on("pageerror", () => pageErrors++);
  phase = "online persistence";
  await page.goto(target.href);
  await page.getByRole("heading", { name: "FieldOps Offline", exact: true }).waitFor();
  await add("Smoke Pump"); await add("Smoke Valve");
  const pump = page.locator("section").filter({ has: page.getByRole("heading", { name: "Card: Smoke Pump", exact: true }) });
  await pump.getByRole("button", { name: "Complete inspection", exact: true }).click();
  await pump.getByRole("button", { name: "Reopen inspection", exact: true }).waitFor();
  const original = (await snapshot()).inspections.find(item => item.title === "Smoke Pump");
  await pump.getByRole("button", { name: "Edit title", exact: true }).click();
  await pump.getByLabel("Inspection title", { exact: true }).fill("Smoke Renamed Pump");
  await pump.getByRole("button", { name: "Save title", exact: true }).click();
  await page.getByRole("heading", { name: "Card: Smoke Renamed Pump", exact: true }).waitFor();
  await page.reload();
  const renamed = page.locator("section").filter({ has: page.getByRole("heading", { name: "Card: Smoke Renamed Pump", exact: true }) });
  await renamed.getByRole("button", { name: "Reopen inspection", exact: true }).waitFor();
  const stored = (await snapshot()).inspections.find(item => item.id === original.id);
  assert.deepEqual(stored, { ...original, title: "Smoke Renamed Pump" });
  const before = await snapshot();
  await renamed.getByRole("button", { name: "Edit title", exact: true }).click();
  await renamed.getByLabel("Inspection title", { exact: true }).fill("Cancelled synthetic title");
  await renamed.getByRole("button", { name: "Cancel", exact: true }).click();
  await renamed.getByRole("button", { name: "Edit title", exact: true }).click();
  await renamed.getByLabel("Inspection title", { exact: true }).fill(" Smoke Renamed Pump ");
  await renamed.getByRole("button", { name: "Save title", exact: true }).click();
  await renamed.getByRole("button", { name: "Edit title", exact: true }).waitFor();
  assert.deepEqual(await snapshot(), before);
  checks.push("create/status/edit/reload preserves ID/status; Cancel and normalized no-op leave storage unchanged");
  phase = "search and export";
  const search = page.getByLabel("Search inspections", { exact: true });
  await search.fill(" pump ");
  await page.getByRole("combobox").selectOption("draft");
  await page.getByText("No inspections match your search and status filter.", { exact: true }).waitFor();
  await page.getByRole("combobox").selectOption("completed");
  await renamed.waitFor(); assert.equal(await page.locator("section").count(), 1);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  assert.equal(await search.inputValue(), "");
  assert.equal(await page.getByRole("combobox").inputValue(), "completed");
  await search.fill("missing synthetic title");
  await page.getByText("No inspections match your search and status filter.", { exact: true }).waitFor();
  assert.deepEqual(await snapshot(), before);
  await downloadAll(before.inspections);
  checks.push("trimmed case-insensitive search AND status/Clear/no-match and filtered export-all are read-only");
  phase = "cached offline CRUD and export";
  await bounded(page.evaluate(() => navigator.serviceWorker.ready));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "Card: Smoke Renamed Pump", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => fetch("uncached-smoke-probe", { cache: "no-store" }).then(() => false, () => true)), true);
  await add("Smoke Offline");
  const offline = page.locator("section").filter({ has: page.getByRole("heading", { name: "Card: Smoke Offline", exact: true }) });
  await offline.getByRole("button", { name: "Complete inspection", exact: true }).click();
  await offline.getByRole("button", { name: "Reopen inspection", exact: true }).waitFor();
  await downloadAll((await snapshot()).inspections);
  await offline.getByRole("button", { name: "Delete inspection", exact: true }).click();
  await page.getByText("Completed: 1 / 2", { exact: true }).waitFor();
  await page.reload();
  await renamed.waitFor(); assert.equal(await page.locator("section").count(), 2);
  assert.deepEqual((await snapshot()).inspections, before.inspections);
  assert.equal(pageErrors, 0);
  checks.push("cached PWA offline reopen/create/status/delete/reload/export; uncached transport fails; no page errors");
  phase = "offline JSON import";
  const beforeImport = await snapshot();
  const upload = page.getByLabel("Import inspections", { exact: true });
  await upload.setInputFiles({ name: "synthetic-invalid.json", mimeType: "application/json", buffer: Buffer.from("{invalid") });
  await page.getByText("Could not preview this file. Use a valid FieldOps version 1 export, up to 2 MiB and 1000 inspections.", { exact: true }).waitFor();
  assert.deepEqual(await snapshot(), beforeImport);
  const imported = { id: "00000000-0000-4000-8000-000000000015", title: "Smoke Imported", status: "completed" };
  const source = { format: "fieldops-inspections", schemaVersion: 1, exportedAt: new Date().toISOString(),
    inspections: [{ ...beforeImport.inspections[0], title: "Must not overwrite" }, imported] };
  const file = { name: "synthetic-import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(source)) };
  // Control delayed reads to test Cancel and replacement without timing guesses.
  await page.evaluate(() => {
    const original = File.prototype.text;
    window.__smokeRestoreRead = () => { File.prototype.text = original; };
    File.prototype.text = function() {
      if (this.name !== "synthetic-delayed.json") return original.call(this);
      return new Promise(resolve => {
        window.__smokeReleaseRead = async () => resolve(await original.call(this));
      });
    };
  });
  const delayed = { ...file, name: "synthetic-delayed.json", buffer: Buffer.from(JSON.stringify({
    ...source, inspections: [{ ...imported, title: "Stale must not replace the newer preview" }],
  })) };
  await upload.setInputFiles(delayed);
  await page.getByText("Reading import…", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel import", exact: true }).click();
  await page.evaluate(async () => { await window.__smokeReleaseRead(); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(await page.getByRole("button", { name: "Import new inspections", exact: true }).count(), 0);
  await upload.setInputFiles(delayed);
  await page.getByText("Reading import…", { exact: true }).waitFor();
  await upload.setInputFiles(file);
  await page.getByText("Total: 2; new: 1; skipped: 1.", { exact: true }).waitFor();
  await page.evaluate(async () => { await window.__smokeReleaseRead(); window.__smokeRestoreRead(); await new Promise(resolve => setTimeout(resolve, 0)); });
  await page.getByText("Total: 2; new: 1; skipped: 1.", { exact: true }).waitFor();
  assert.deepEqual(await snapshot(), beforeImport);
  await page.screenshot({ path: "smoke-results/import-preview.png", fullPage: true });
  await page.getByRole("button", { name: "Cancel import", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Import new inspections", exact: true }).count(), 0);
  assert.deepEqual(await snapshot(), beforeImport);
  await upload.setInputFiles(file);
  await page.getByText("Total: 2; new: 1; skipped: 1.", { exact: true }).waitFor();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    window.__smokeRestoreWrite = () => { IDBObjectStore.prototype.add = original; };
    IDBObjectStore.prototype.add = function(value, key) {
      if (this.name === "syncQueue") throw new Error("Synthetic storage fault");
      return original.call(this, value, key);
    };
  });
  await page.getByRole("button", { name: "Import new inspections", exact: true }).click();
  await page.getByText("Could not save the import. No records were added. Please try again.", { exact: true }).waitFor();
  assert.deepEqual(await snapshot(), beforeImport);
  await page.getByText("Total: 2; new: 1; skipped: 1.", { exact: true }).waitFor();
  await page.evaluate(() => window.__smokeRestoreWrite());
  await page.getByRole("button", { name: "Import new inspections", exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.getByText("Imported 1; skipped 1.", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Card: Smoke Imported", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Card: Smoke Imported", exact: true }).waitFor();
  const afterImport = await snapshot();
  assert.deepEqual(afterImport.inspections.find(item => item.id === imported.id), imported);
  assert.deepEqual(afterImport.inspections.filter(item => item.id !== imported.id), beforeImport.inspections);
  const oldIds = new Set(beforeImport.syncQueue.map(item => item.id));
  assert.deepEqual(afterImport.syncQueue.filter(item => oldIds.has(item.id)), beforeImport.syncQueue);
  const addedQueue = afterImport.syncQueue.filter(item => !oldIds.has(item.id));
  assert.equal(addedQueue.length, 1);
  assert.deepEqual(addedQueue[0].payload, imported);
  assert.equal(addedQueue[0].operation, "CREATE");
  await downloadAll(afterImport.inspections);
  await upload.setInputFiles(file);
  await page.getByText("Total: 2; new: 0; skipped: 2.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Import new inspections", exact: true }).isDisabled(), true);
  assert.deepEqual(await snapshot(), afterImport);
  await page.getByRole("button", { name: "Cancel import", exact: true }).click();
  assert.equal(pageErrors, 0);
  checks.push("offline JSON import: invalid/preview/Cancel/stale-read isolation; conflict skip; failure rollback/retry/double submit; atomic CREATE; reload/re-export/repeat no-op");
  await page.screenshot({ path: "smoke-results/site.png", fullPage: true });
  report.verdict = "PASS";
} catch {
  report.failedPhase = phase;
  process.exitCode = 1;
  if (page) await page.screenshot({ path: "smoke-results/failure.png", fullPage: true }).catch(() => {});
} finally {
  if (browser) await browser.close();
  await writeFile("smoke-results/report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
