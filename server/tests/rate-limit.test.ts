import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { privateDemoRateLimit } from "../src/rate-limit.js";

test("shared cap excludes exact GET health, rejects bursts before handler, and recovers after one minute", async () => {
  let time = 0; let handled = 0;
  const app = express();
  app.use(privateDemoRateLimit(2, () => time));
  app.use((_req, res) => { handled++; res.json({ ok: true }); });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(base + "/api/health")).status, 200);
    assert.equal((await fetch(base + "/api/inspections")).status, 200);
    assert.equal((await fetch(base + "/api/health", { method: "HEAD" })).status, 200);
    const blocked = await fetch(base + "/api/inspections");
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get("retry-after"), "60");
    assert.equal(handled, 3);
    time = 60_000;
    assert.equal((await fetch(base + "/api/inspections")).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
