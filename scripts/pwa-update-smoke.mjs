import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { chromium } from "playwright";

// Two actual generated production workers, isolated browser storage, no API access.
const temp = await mkdtemp(join(tmpdir(), "fieldops-update-"));
const marker = resolve("public/task018-smoke-version.js");
let browser;
let server;
let release = "v1";
const checks = [];
const snapshot = page => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("fieldops-db", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const values = {};
    for (const name of ["inspections", "syncQueue"]) values[name] = await new Promise((resolve, reject) => {
      const tx = db.transaction(name); const request = tx.objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return values;
  } finally { db.close(); }
});
try {
  for (const version of ["v1", "v2"]) {
    await writeFile(marker, `/* synthetic update fixture ${version} */`);
    execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", join(temp, version)], {
      stdio: "pipe", env: { ...process.env, VITE_API_BASE_URL: "https://api.fieldops.invalid" },
    });
  }
  await rm(marker);
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/fieldops-offline/") || /(^|\/)api(?:\/|$)/.test(url.pathname)) {
        res.writeHead(404); res.end(); return;
      }
      const relative = decodeURIComponent(url.pathname.slice("/fieldops-offline/".length)) || "index.html";
      const path = resolve(temp, release, relative);
      if (!path.startsWith(resolve(temp, release) + "/")) throw new Error("path");
      const body = await readFile(path);
      const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" }[extname(path)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ executablePath: process.env.SMOKE_BROWSER_EXECUTABLE || undefined });
  const context = await browser.newContext();
  context.setDefaultTimeout(20000);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && !/(^|\/)api(?:\/|$)/.test(url.pathname)
      ? route.continue() : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}/fieldops-offline/`;
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(await page.getByRole("heading", { name: "A new version is available" }).count(), 0);
  await page.getByLabel("New inspection title", { exact: true }).fill("Saved before update");
  await page.getByRole("button", { name: "Add inspection", exact: true }).click();
  await page.getByRole("heading", { name: "Card: Saved before update", exact: true }).waitFor();
  let before = await snapshot(page);
  assert.equal(before.inspections.length, 1); assert.equal(before.syncQueue.length, 1);
  const other = await context.newPage(); await other.goto(url);
  await other.getByLabel("New inspection title", { exact: true }).fill("Other tab unsaved title");
  await page.getByLabel("New inspection title", { exact: true }).fill("Do not lose this draft");
  release = "v2";
  // Fast-forward the real controller's timer rather than directly calling update().
  await page.clock.install(); await page.clock.fastForward(5 * 60 * 1000 + 1);
  await page.getByRole("heading", { name: "A new version is available" }).waitFor();
  assert.equal(await page.getByLabel("New inspection title", { exact: true }).inputValue(), "Do not lose this draft");
  assert.equal(await page.getByRole("button", { name: "Update now", exact: true }).isDisabled(), true);
  checks.push("Idle periodic check discovered a real waiting v2 worker; create draft retained and activation blocked");
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await page.getByRole("button", { name: "App update available", exact: true }).click();
  await page.getByLabel("New inspection title", { exact: true }).fill("");
  await page.getByRole("button", { name: "Edit title", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Update now", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByLabel("Owner token", { exact: true }).fill("not-a-secret-synthetic-draft");
  assert.equal(await page.getByRole("button", { name: "Update now", exact: true }).isDisabled(), true);
  await page.getByLabel("Owner token", { exact: true }).fill("");
  await page.getByLabel("Import inspections", { exact: true }).setInputFiles({
    name: "synthetic.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      format: "fieldops-inspections", schemaVersion: 1, exportedAt: new Date().toISOString(),
      inspections: [{ id: "75638d32-4e33-4199-a9fb-32525720c411", title: "Import fixture", status: "draft" }],
    })),
  });
  await page.getByRole("button", { name: "Cancel import", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Update now", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Cancel import", exact: true }).click();
  checks.push("Later/reopen works; rename, owner-token and import drafts block update");
  await page.getByLabel("New inspection title", { exact: true }).fill("Busy write fixture");
  await page.getByRole("button", { name: "Add inspection", exact: true }).click();
  await page.getByRole("heading", { name: "Card: Busy write fixture", exact: true }).waitFor();
  // Hold a real readwrite transaction so App's delete cannot commit yet.
  await page.evaluate(async () => {
    const db = await new Promise(resolve => {
      const request = indexedDB.open("fieldops-db", 2);
      request.onsuccess = () => resolve(request.result);
    });
    let hold = true;
    window.releaseHeldWrite = () => { hold = false; };
    const tx = db.transaction("inspections", "readwrite");
    tx.oncomplete = () => db.close();
    const keepAlive = () => {
      const request = tx.objectStore("inspections").get("held-test-write");
      request.onsuccess = () => { if (hold) keepAlive(); };
    };
    keepAlive();
  });
  await page.getByRole("heading", { name: "Card: Busy write fixture", exact: true })
    .locator("..").getByRole("button", { name: "Delete inspection", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Update now", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.releaseHeldWrite());
  await page.getByRole("heading", { name: "Card: Busy write fixture", exact: true }).waitFor({ state: "detached" });
  before = await snapshot(page);
  checks.push("Update blocked during a real pending local delete transaction, then unblocked after commit");
  await page.screenshot({ path: join(temp, "update-banner.png"), fullPage: true });
  let otherLoads = 0; other.on("load", () => { otherLoads++; });
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Update now", exact: true }).click(),
  ]);
  await page.getByRole("heading", { name: "Card: Saved before update", exact: true }).waitFor();
  assert.deepEqual(await snapshot(page), before);
  assert.equal(otherLoads, 0);
  assert.equal(await other.getByLabel("New inspection title", { exact: true }).inputValue(), "Other tab unsaved title");
  checks.push("Explicit update reloaded only consenting tab; IndexedDB inspection and queue unchanged; another dirty tab intact");
  await context.setOffline(true); await page.reload();
  await page.getByRole("heading", { name: "Card: Saved before update", exact: true }).waitFor();
  checks.push("Updated shell and saved inspection reopen offline");
  await mkdir("smoke-results", { recursive: true });
  await writeFile("smoke-results/pwa-update-banner.png", await readFile(join(temp, "update-banner.png")));
  await writeFile("smoke-results/pwa-update-report.json", JSON.stringify({ verdict: "PASS", checks }, null, 2));
  console.log(JSON.stringify({ verdict: "PASS", checks }, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(marker, { force: true }); await rm(temp, { recursive: true, force: true });
}
