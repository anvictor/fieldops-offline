import assert from "node:assert/strict";

// Only called inside the authenticated fixture's disposable PostgreSQL schema.
// Each context has independent browser storage, like separate devices.
export async function checkConcurrentEdits({ browser, origin, apiOrigin, api, token, pool }) {
  const contexts = [];
  let stage = "setup";
  const checks = [];
  let id;
  let lostAcknowledgments = 0;
  let aPatchAttempts = 0;
  const card = page => page.locator(".inspection-card");
  const review = page => page.getByRole("region", { name: "Review conflicting inspection", exact: true });
  const waitRow = async predicate => {
    for (let i = 0; i < 150; i++) {
      const row = (await pool.query("SELECT id, title, status, version FROM inspections WHERE id = $1", [id])).rows[0];
      if (predicate(row)) return row;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("Disposable concurrency row did not reach expected state");
  };
  const make = async (loseFirstPatchAck = false) => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    context.setDefaultTimeout(15000);
    contexts.push(context);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.fulfill({ response: await route.fetch({ url: "http://127.0.0.1:4186" + url.pathname + url.search }) });
      if (url.origin === apiOrigin) {
        const response = await route.fetch({ url: api + url.pathname, maxRedirects: 0 });
        if (loseFirstPatchAck && route.request().method() === "PATCH") {
          aPatchAttempts++;
          if (!lostAcknowledgments && response.ok()) {
            lostAcknowledgments++;
            return route.abort("failed"); // The server committed; this device did not receive its ACK.
          }
        }
        return route.fulfill({ response });
      }
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(origin + "/fieldops-offline/");
    return { page, context };
  };
  const connect = async page => {
    await page.getByLabel("Owner token", { exact: true }).fill(token);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByText("Owner token entered for this tab.", { exact: true }).waitFor();
  };
  const edit = async (page, title) => {
    await card(page).getByRole("button", { name: "Edit title", exact: true }).click();
    await card(page).getByLabel("Inspection title", { exact: true }).fill(title);
    await card(page).getByRole("button", { name: "Save title", exact: true }).click();
    await card(page).getByRole("button", { name: "Edit title", exact: true }).waitFor();
  };
  const pending = async page => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("fieldops-db");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error("Fixture storage unavailable"));
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("syncQueue").objectStore("syncQueue").getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error("Fixture queue unavailable"));
      });
    } finally { db.close(); }
  });
  try {
    const { page: a } = await make(true);
    const { page: b, context: contextB } = await make();
    await a.getByLabel("New inspection title", { exact: true }).fill("OCC initial inspection");
    await a.getByRole("button", { name: "Add inspection", exact: true }).click();
    await connect(a);
    await a.getByText("Pending sync: 0", { exact: true }).waitFor();
    id = (await pool.query("SELECT id FROM inspections WHERE title = $1", ["OCC initial inspection"])).rows[0]?.id;
    assert.ok(id);
    await connect(b);
    await b.getByRole("heading", { name: "Card: OCC initial inspection", exact: true }).waitFor();

    stage = "stale cross-device save";
    await card(b).getByRole("button", { name: "Edit title", exact: true }).click();
    await card(b).getByLabel("Inspection title", { exact: true }).fill("OCC inspector B queued draft");
    await edit(a, "OCC inspector A accepted");
    await waitRow(row => row?.title === "OCC inspector A accepted" && row.version === 2);
    await a.getByText("Pending sync: 0", { exact: true }).waitFor();
    assert.equal(lostAcknowledgments, 1);
    assert.ok(aPatchAttempts >= 2);
    assert.equal((await waitRow(row => !!row)).version, 2);
    checks.push("a real committed PATCH with a deliberately dropped ACK retries without another version increment");
    await card(b).getByRole("button", { name: "Save title", exact: true }).click();
    await review(b).waitFor();
    await review(b).getByText(/OCC inspector A accepted/).waitFor();
    assert.equal((await waitRow(row => !!row)).title, "OCC inspector A accepted");
    const original = await pending(b);
    assert.equal(original.length, 1);
    assert.equal(original[0].payload.title, "OCC inspector B queued draft");
    checks.push("separate device storage: stale title edit cannot overwrite accepted PostgreSQL change; queued intent retained");

    stage = "draft retention and review race";
    await card(b).getByRole("button", { name: "Edit title", exact: true }).click();
    await card(b).getByLabel("Inspection title", { exact: true }).fill("Still typing while reviewing another conflict");
    await review(b).getByRole("button", { name: "Review server version", exact: true }).click();
    await review(b).getByLabel("Reviewed title", { exact: true }).fill("OCC B deliberate resolution");
    await edit(a, "OCC inspector A changed again");
    await waitRow(row => row?.title === "OCC inspector A changed again" && row.version === 3);
    await review(b).getByRole("button", { name: "Save reviewed changes", exact: true }).click();
    await review(b).getByText(/OCC inspector A changed again/).waitFor();
    assert.equal((await waitRow(row => !!row)).version, 3);
    assert.equal(await card(b).getByLabel("Inspection title", { exact: true }).inputValue(), "Still typing while reviewing another conflict");
    assert.equal((await pending(b)).length, 1);
    await b.screenshot({ path: "smoke-results/occ-conflict-review.png", fullPage: true });
    checks.push("conflict review preserves unsaved editor text; intervening remote edit causes another conflict instead of silent rebase");

    stage = "reload and explicit reconciliation";
    await card(b).getByRole("button", { name: "Cancel", exact: true }).click();
    await review(b).getByLabel("Reviewed title", { exact: true }).fill("Unsaved review draft survives reload");
    stage = "commit reviewed draft before reload";
    await review(b).getByText("Review draft saved on this device.", { exact: true }).waitFor();
    await b.reload();
    stage = "reconnect after reload";
    await connect(b);
    await review(b).waitFor();
    stage = "restore persisted reviewed title";
    await b.waitForFunction(() => [...document.querySelectorAll("label")].some(label =>
      label.textContent.startsWith("Reviewed title") && label.querySelector("input")?.value === "Unsaved review draft survives reload"));
    stage = "save deliberate reviewed change after reload";
    await review(b).getByRole("button", { name: "Review server version", exact: true }).click();
    await review(b).getByText(/OCC inspector A changed again/).waitFor();
    await review(b).getByLabel("Reviewed title", { exact: true }).fill("OCC B reviewed and saved");
    await review(b).getByRole("button", { name: "Save reviewed changes", exact: true }).click();
    await waitRow(row => row?.title === "OCC B reviewed and saved" && row.version === 4);
    await b.getByText("Pending sync: 0", { exact: true }).waitFor();
    assert.deepEqual(await pending(b), []);
    checks.push("queued recovery survives reload; deliberate reviewed save succeeds against shown version with no duplicated update");

    stage = "offline causal chain";
    await contextB.setOffline(true);
    await b.getByText("Connection: Offline", { exact: true }).waitFor();
    await edit(b, "OCC offline first edit");
    await edit(b, "OCC offline second edit");
    const offline = await pending(b);
    assert.equal(offline.length, 2);
    assert.deepEqual(offline.map(item => item.payload.title).sort(), ["OCC offline first edit", "OCC offline second edit"]);
    assert.equal((await waitRow(row => !!row)).version, 4);
    await contextB.setOffline(false);
    await waitRow(row => row?.title === "OCC offline second edit" && row.version === 6);
    await b.getByText("Pending sync: 0", { exact: true }).waitFor();
    checks.push("two immutable offline updates replay from their own causal acknowledgments and increment exactly once each");

    stage = "status-only remote change while editor stays open";
    const { page: c } = await make();
    await connect(c);
    await c.getByRole("heading", { name: "Card: OCC offline second edit", exact: true }).waitFor();
    await card(c).getByRole("button", { name: "Edit title", exact: true }).click();
    await card(c).getByLabel("Inspection title", { exact: true }).fill("OCC stale editor after status change");
    await card(b).getByRole("button", { name: "Complete inspection", exact: true }).click();
    await waitRow(row => row?.status === "completed" && row.version === 7);
    await c.clock.fastForward(31000);
    await c.mouse.move(35, 35);
    await card(c).locator("strong.completed").waitFor();
    await card(c).getByRole("button", { name: "Save title", exact: true }).click();
    await c.getByRole("alert").filter({ hasText: /changed|conflict|review/i }).first().waitFor();
    const protectedRow = await waitRow(row => !!row);
    assert.equal(protectedRow.version, 7);
    assert.equal(protectedRow.title, "OCC offline second edit");
    assert.equal(protectedRow.status, "completed");
    const stillTyped = await card(c).getByLabel("Inspection title", { exact: true }).count()
      ? await card(c).getByLabel("Inspection title", { exact: true }).inputValue() : null;
    const queued = await pending(c);
    assert.ok(stillTyped === "OCC stale editor after status change" || queued.some(item => item.payload?.title === "OCC stale editor after status change"));
    checks.push("an editor opened before a status-only remote change cannot silently adopt the refreshed version; intent remains recoverable");
    return checks;
  } catch {
    console.error(`Concurrency regression failed at ${stage}. No request details logged.`);
    throw new Error(`Disposable concurrency browser check failed in ${stage}. No request details or credentials logged.`);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    if (id) await pool.query("DELETE FROM inspections WHERE id = $1", [id]);
  }
}
