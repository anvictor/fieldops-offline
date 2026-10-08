import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import pg from "../server/node_modules/pg/lib/index.js";
import { createApp } from "../server/dist/app.js";
import { migrate } from "../server/dist/migrations.js";

// This test only accepts the explicit disposable TEST_DATABASE_URL. Virtual HTTPS
// origins route to loopback fixtures; this is local evidence, never hosted evidence.
assert.ok(process.env.TEST_DATABASE_URL, "Disposable TEST_DATABASE_URL is required");
const schema = "auth_browser_" + randomUUID().replaceAll("-", "");
const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
const token = randomBytes(32).toString("base64url");
const origin = "https://pwa.fieldops.test";
const apiOrigin = "https://api.fieldops.test";
let server, preview, browser;
let sends = 0;
let phase = "setup";
const checks = [];
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool); await migrate(pool);
  server = createApp(pool, { mode: "production", token, origins: [origin] }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const api = `http://127.0.0.1:${server.address().port}`;
  preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4186", "--strictPort"], { stdio: "ignore" });
  for (let i = 0; ; i++) {
    try { if ((await fetch("http://127.0.0.1:4186/fieldops-offline/")).ok) break; } catch { /* startup */ }
    assert.ok(i < 100, "Preview failed to start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.SMOKE_BROWSER_EXECUTABLE ? { executablePath: process.env.SMOKE_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route(origin + "/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: "http://127.0.0.1:4186" + url.pathname + url.search }) });
  });
  await context.route(apiOrigin + "/**", async (route) => {
    sends++;
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: api + url.pathname, maxRedirects: 0 }) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const waitText = (text) => page.getByText(text, { exact: true }).waitFor();
  const add = async (title) => { await page.getByPlaceholder("Inspection title", { exact: true }).fill(title); await page.getByRole("button", { name: "Add inspection", exact: true }).click(); };
  const connect = async (value) => { await page.getByLabel("Owner token", { exact: true }).fill(value); await page.getByRole("button", { name: "Connect", exact: true }).click(); };
  const rows = async () => (await pool.query("SELECT id, title, status FROM inspections ORDER BY title")).rows;
  const waitRows = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      const result = await rows(); if (predicate(result)) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail("Expected disposable database state was not reached");
  };
  await page.goto(origin + "/fieldops-offline/");
  await add("Auth browser fixture"); await waitText("Pending sync: 1");
  assert.equal(sends, 0); assert.equal((await rows()).length, 0);
  checks.push("disconnected offline CRUD makes no API request");
  await connect("incorrect_fixture_".padEnd(43, "x"));
  await page.getByRole("alert").filter({ hasText: "Owner token rejected" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Discard blocked operation" }).count(), 0);
  await waitText("Pending sync: 1");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await connect(token); await waitText("Pending sync: 0");
  const inspection = (await waitRows((result) => result.length === 1))[0]; assert.equal(inspection.title, "Auth browser fixture");
  checks.push("401 retains queue; corrected runtime token creates real PostgreSQL row");
  await page.getByRole("button", { name: "Edit title", exact: true }).click();
  await page.getByLabel("Inspection title", { exact: true }).fill("Auth browser renamed");
  await page.getByRole("button", { name: "Save title", exact: true }).click(); await waitText("Pending sync: 0");
  // Wait for the actual acknowledgment, not an earlier zero-count render.
  await page.waitForFunction(() => document.body.textContent.includes("Card: Auth browser renamed"));
  await waitText("Pending sync: 0");
  await waitRows((result) => result[0]?.title === "Auth browser renamed");
  await page.getByRole("button", { name: "Complete inspection", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("strong.completed") !== null);
  await waitText("Pending sync: 0"); await waitRows((result) => result[0]?.status === "completed");
  checks.push("browser edit and status propagate to PostgreSQL");
  await context.setOffline(true); await waitText("Connection: Offline");
  await add("Offline auth fixture"); await waitText("Pending sync: 1");
  assert.equal((await rows()).length, 1);
  await context.setOffline(false); await waitText("Pending sync: 0"); await waitRows((result) => result.length === 2);
  checks.push("offline queue replays after reconnect");
  await page.reload(); await page.getByLabel("Owner token", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Owner token", { exact: true }).inputValue(), "");
  await add("After reload fixture"); await waitText("Pending sync: 1"); assert.equal((await rows()).length, 2);
  const other = await context.newPage(); await other.goto(origin + "/fieldops-offline/");
  await other.getByLabel("Owner token", { exact: true }).waitFor();
  await connect(token); await waitText("Pending sync: 0"); await waitRows((result) => result.length === 3);
  assert.equal(await other.getByLabel("Owner token", { exact: true }).inputValue(), "");
  const stores = await page.evaluate(async () => {
    const db = await new Promise((resolve) => { const request = indexedDB.open("fieldops-db"); request.onsuccess = () => resolve(request.result); });
    try {
      const data = await Promise.all([...db.objectStoreNames].map((name) => new Promise((resolve) => {
        const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result);
      })));
      return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, data });
    } finally { db.close(); }
  });
  assert.ok(!stores.includes(token));
  checks.push("reload clears token; local data persists; no durable token or sharing between tabs");
  await other.close();
  phase = "delete UI";
  while (await page.getByRole("button", { name: "Delete inspection", exact: true }).count()) {
    const before = await page.getByRole("button", { name: "Delete inspection", exact: true }).count();
    await page.getByRole("button", { name: "Delete inspection", exact: true }).first().click();
    await page.waitForFunction((previous) => [...document.querySelectorAll("button")]
      .filter((button) => button.textContent === "Delete inspection").length < previous, before);
  }
  phase = "delete acknowledgment";
  await waitText("Pending sync: 0"); await waitRows((result) => result.length === 0);
  phase = "direct authentication guards";
  const response = await fetch(api + "/api/inspections", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), []);
  assert.equal((await fetch(api + "/api/inspections")).status, 401);
  assert.equal((await fetch(api + "/api/inspections", { headers: { Authorization: `Bearer ${token}`, Origin: "https://denied.test" } })).status, 403);
  checks.push("browser deletion, anonymous 401 and forbidden-origin 403");
  phase = "secret-free evidence";
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await mkdir("smoke-results", { recursive: true });
  await page.screenshot({ path: "smoke-results/owner-connection.png", fullPage: true });
  await writeFile("smoke-results/auth-browser-report.json", JSON.stringify({ verdict: "pass", evidence: "local virtual HTTPS browser with real disposable PostgreSQL", checks }, null, 2) + "\n");
  console.log(`Authenticated browser smoke passed (${checks.length} checks). Local evidence only.`);
} catch {
  console.error(`Authenticated browser smoke failed in ${phase} after ${checks.length} completed checks. No credentials or request details were logged.`);
  process.exitCode = 1;
} finally {
  await browser?.close(); preview?.kill();
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
