import assert from "node:assert/strict";

// Called only by the authenticated fixture after it creates a disposable PostgreSQL schema.
export async function checkDevices({ browser, origin, apiOrigin, api, token, pool }) {
  let stage = "setup";
  const contexts = [];
  const counts = [0, 0];
  const checks = [];
  const card = page => page.locator(".inspection-card");
  const connect = async page => {
    await page.getByLabel("Owner token", { exact: true }).fill(token);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByText("Owner token entered for this tab.", { exact: true }).waitFor();
  };
  const waitRows = async count => {
    for (let i = 0; i < 100; i++) {
      if ((await pool.query("SELECT id FROM inspections")).rowCount === count) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("Disposable device row count not reached");
  };
  const make = async index => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    context.setDefaultTimeout(15000); contexts.push(context);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.fulfill({ response: await route.fetch({ url: "http://127.0.0.1:4186" + url.pathname + url.search }) });
      if (url.origin === apiOrigin) {
        if (url.pathname === "/api/inspections/snapshot") counts[index]++;
        return route.fulfill({ response: await route.fetch({ url: api + url.pathname, maxRedirects: 0 }) });
      }
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(origin + "/fieldops-offline/");
    return { context, page };
  };
  try {
    const { page: a } = await make(0);
    const { context: contextB, page: b } = await make(1);
    await a.getByLabel("New inspection title", { exact: true }).fill("Two devices shared");
    await a.getByRole("button", { name: "Add inspection", exact: true }).click();
    assert.deepEqual(counts, [0, 0]);
    stage = "connect A with pending CREATE";
    await connect(a); await waitRows(1);
    await a.getByText("Pending sync: 0", { exact: true }).waitFor();
    stage = "connect B initial snapshot";
    await connect(b);
    await b.getByRole("heading", { name: "Card: Two devices shared", exact: true }).waitFor();
    stage = "initial exact read counts";
    assert.deepEqual(counts, [1, 1]);
    checks.push("two separate browser storage contexts connect and download the same PostgreSQL inspection");

    stage = "remote deletion while editing";
    await card(b).getByRole("button", { name: "Edit title", exact: true }).click();
    await card(b).getByLabel("Inspection title", { exact: true }).fill("Unsaved device B draft 💧");
    await card(a).getByRole("button", { name: "Delete inspection", exact: true }).click();
    await waitRows(0);
    await b.clock.fastForward(60000);
    assert.equal(counts[1], 1); // elapsed time alone is not activity
    await b.mouse.move(25, 25);
    await card(b).getByText(/This inspection was deleted in another tab or device/).waitFor();
    assert.equal(counts[1], 2);
    assert.equal(await card(b).getByLabel("Inspection title", { exact: true }).inputValue(), "Unsaved device B draft 💧");
    assert.equal(await card(b).getByRole("button", { name: "Save title", exact: true }).isDisabled(), true);
    await b.screenshot({ path: "smoke-results/device-deletion-draft.png", fullPage: true });
    for (let i = 0; i < 50; i++) await b.mouse.move(30 + i, 30);
    await b.keyboard.press("ArrowLeft");
    assert.equal(counts[1], 2);
    await b.clock.fastForward(120000); assert.equal(counts[1], 2);
    checks.push("remote deletion discovered only by later user activity; retained text, disabled Save, no idle reads or burst requests");

    // Explicitly simulate document visibility; this is not a claim of native OS backgrounding.
    stage = "hidden and visible gates";
    await b.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await b.mouse.move(150, 50); assert.equal(counts[1], 2);
    await b.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await b.getByText("Checking server changes…", { exact: true }).waitFor({ state: "hidden" });
    // Wait for routed response and committed merge rather than only a transient indicator.
    await b.waitForFunction(async () => {
      const db = await new Promise(resolve => { const request = indexedDB.open("fieldops-db"); request.onsuccess = () => resolve(request.result); });
      try { return await new Promise(resolve => { const request = db.transaction("syncMetadata").objectStore("syncMetadata").getAll(); request.onsuccess = () => resolve(request.result.some(value => typeof value === "number" && Date.now() - value < 30000)); }); }
      finally { db.close(); }
    });
    assert.equal(counts[1], 3);
    await card(b).getByRole("button", { name: "Dismiss draft", exact: true }).click();
    stage = "same-context shared reservation";
    const sibling = await contextB.newPage();
    await sibling.clock.install({ time: await b.evaluate(() => Date.now()) });
    await sibling.goto(origin + "/fieldops-offline/");
    await connect(sibling);
    assert.equal(counts[1], 3);
    await sibling.close();
    checks.push("simulated hidden gate and visible resume; another tab with its own token shares the browser read-rate reservation");

    stage = "disconnected activity";
    await b.getByRole("button", { name: "Disconnect", exact: true }).click();
    const disconnected = counts[1];
    await b.clock.fastForward(60000); await b.mouse.move(200, 80);
    assert.equal(counts[1], disconnected);
    checks.push("disconnected activity and elapsed time make no server-change reads");
    stage = "offline queued edit and remote delete";
    await a.getByLabel("New inspection title", { exact: true }).fill("Queued device edit");
    await a.getByRole("button", { name: "Add inspection", exact: true }).click();
    await waitRows(1);
    await connect(b);
    await b.getByRole("heading", { name: "Card: Queued device edit", exact: true }).waitFor();
    await contextB.setOffline(true);
    await b.getByText("Connection: Offline", { exact: true }).waitFor();
    await card(b).getByRole("button", { name: "Edit title", exact: true }).click();
    await card(b).getByLabel("Inspection title", { exact: true }).fill("Saved offline title");
    await card(b).getByRole("button", { name: "Save title", exact: true }).click();
    await b.getByRole("heading", { name: "Card: Saved offline title", exact: true }).waitFor();
    await card(b).getByRole("button", { name: "Edit title", exact: true }).click();
    await card(b).getByLabel("Inspection title", { exact: true }).fill("Still typing on device B");
    await card(a).getByRole("button", { name: "Delete inspection", exact: true }).click();
    await waitRows(0);
    const beforeReconnect = counts[1];
    await contextB.setOffline(false);
    await card(b).getByText(/This inspection was deleted in another tab or device/).waitFor();
    await b.getByRole("alert").filter({ hasText: "Pending changes are retained" }).waitFor();
    await b.getByText("Pending title to copy: Saved offline title", { exact: true }).waitFor();
    assert.equal(counts[1], beforeReconnect); // reconnect only replays the existing push queue
    assert.equal(await card(b).getByLabel("Inspection title", { exact: true }).inputValue(), "Still typing on device B");
    const persisted = await b.evaluate(async () => {
      const db = await new Promise(resolve => { const request = indexedDB.open("fieldops-db"); request.onsuccess = () => resolve(request.result); });
      try {
        const entries = {};
        for (const store of db.objectStoreNames) entries[store] = await new Promise(resolve => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); });
        return entries;
      } finally { db.close(); }
    });
    assert.equal(persisted.inspections.length, 0);
    assert.equal(persisted.syncQueue.length, 1);
    assert.equal(persisted.syncQueue[0].payload.title, "Saved offline title");
    assert.ok(!JSON.stringify(persisted).includes(token));
    await waitRows(0);
    checks.push("offline queued UPDATE later hits server deletion: no resurrection, live editor and immutable pending title retained, no token stored");
    return checks;
  } catch (error) { console.error(`Device regression failed at ${stage}. No request details logged.`); throw error; }
  finally { for (const context of contexts) await context.close(); }
}
