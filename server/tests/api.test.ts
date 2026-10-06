import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import pg from "pg";
import { createApp } from "../src/app.js";
import { migrate } from "../src/migrations.js";

// Never silently skip database verification. Use a disposable test database.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required; use a disposable test database.");

await test("PostgreSQL API: migrations, CRUD, persistence, validation, and safe errors", async (t) => {
  const admin = new pg.Pool({ connectionString });
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  const server = createApp(pool).listen(0, "127.0.0.1");
  await once(server, "listening");
  let base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const expectError = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.deepEqual(Object.keys(body.error).sort(), ["code", "message"]);
    assert.equal(body.error.code, code);
    assert.equal(typeof body.error.message, "string");
  };
  try {
    await t.test("migration applies once and reruns without changing data", async () => {
      await migrate(pool);
      await migrate(pool);
      assert.equal((await pool.query("SELECT * FROM schema_migrations")).rowCount, 1);
    });
    await t.test("health and empty collection", async () => {
      const health = await request("/api/health");
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: "ok", service: "fieldops-api" });
      assert.deepEqual(await (await request("/api/inspections")).json(), []);
    });
    let id = "";
    let createdAt = "";
    await t.test("create defaults to draft, generates identity/timestamps, safely stores SQL-like text", async () => {
      const response = await request("/api/inspections", "POST", { title: "  O'Brien'); DROP TABLE inspections; --  " });
      assert.equal(response.status, 201);
      const inspection = await response.json();
      assert.deepEqual(Object.keys(inspection).sort(), ["createdAt", "id", "status", "title", "updatedAt"]);
      id = inspection.id;
      createdAt = inspection.createdAt;
      assert.match(id, /^[0-9a-f-]{36}$/);
      assert.equal(response.headers.get("location"), `/api/inspections/${id}`);
      assert.equal(inspection.title, "O'Brien'); DROP TABLE inspections; --");
      assert.equal(inspection.status, "draft");
      assert.ok(Number.isFinite(Date.parse(createdAt)));
      assert.equal(inspection.updatedAt, createdAt);
      assert.equal((await pool.query("SELECT * FROM inspections")).rowCount, 1);
    });
    await t.test("partial updates preserve identity, creation time and omitted fields", async () => {
      const response = await request(`/api/inspections/${id}`, "PATCH", { status: "completed" });
      assert.equal(response.status, 200);
      const updated = await response.json();
      assert.equal(updated.id, id);
      assert.equal(updated.createdAt, createdAt);
      assert.equal(updated.status, "completed");
      assert.equal(updated.title, "O'Brien'); DROP TABLE inspections; --");
      assert.ok(Date.parse(updated.updatedAt) >= Date.parse(createdAt));
      const renamed = await (await request(`/api/inspections/${id}`, "PATCH", { title: "Updated" })).json();
      assert.equal(renamed.title, "Updated");
      assert.equal(renamed.status, "completed");
    });
    await t.test("a new app and database pool read persisted data; migration preserves it", async () => {
      const secondPool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
      const secondServer = createApp(secondPool).listen(0, "127.0.0.1");
      await once(secondServer, "listening");
      const original = base;
      base = `http://127.0.0.1:${(secondServer.address() as AddressInfo).port}`;
      try {
        await migrate(secondPool);
        assert.equal((await (await request(`/api/inspections/${id}`)).json()).title, "Updated");
        assert.equal((await (await request("/api/inspections")).json()).length, 1);
      } finally {
        base = original;
        await new Promise<void>((resolve) => secondServer.close(() => resolve()));
        await secondPool.end();
      }
    });
    await t.test("reject invalid fields, titles, statuses, IDs and empty patches", async () => {
      for (const body of [{}, [], { title: " " }, { title: 1 }, { title: "x".repeat(201) },
        { title: "bad\u0000text" }, { title: "x", status: "pending" }, { title: "x", id: "invalid" },
        { title: "x", createdAt }, { title: "x", status: null }]) {
        await expectError(await request("/api/inspections", "POST", body), 400, "INVALID_INPUT");
      }
      for (const body of [{}, { title: null }, { status: "pending" }, { updatedAt: createdAt }]) {
        await expectError(await request(`/api/inspections/${id}`, "PATCH", body), 400, "INVALID_INPUT");
      }
      for (const method of ["GET", "PATCH", "DELETE"]) {
        await expectError(await request("/api/inspections/not-a-uuid", method, method === "PATCH" ? { title: "x" } : undefined), 400, "INVALID_INPUT");
      }
    });
    await t.test("malformed encoded route IDs return safe 400 JSON errors", async () => {
      for (const encodedId of ["%ZZ", "%E0%A4%A"]) {
        for (const method of ["GET", "PATCH", "DELETE"]) {
          const response = await request(`/api/inspections/${encodedId}`, method,
            method === "PATCH" ? { title: "x" } : undefined);
          assert.equal(response.status, 400);
          assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
          assert.deepEqual(await response.json(), {
            error: { code: "INVALID_INPUT", message: "Invalid path parameter encoding." },
          });
        }
      }
    });
    await t.test("unrelated errors with status 400 remain generic server errors", async () => {
      for (const error of [new Error("Private failure"), new URIError("Unrelated URI failure")]) {
        const query = t.mock.method(pool, "query", () => { throw Object.assign(error, { status: 400 }); });
        try {
          const response = await request("/api/inspections");
          assert.equal(response.status, 500);
          assert.deepEqual(await response.json(), {
            error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." },
          });
        } finally {
          query.mock.restore();
        }
      }
    });
    await t.test("malformed, oversized and unsupported request bodies return JSON", async () => {
      await expectError(await request("/api/inspections", "POST", null), 400, "INVALID_BODY");
      await expectError(await fetch(`${base}/api/inspections`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
      }), 400, "INVALID_BODY");
      await expectError(await request("/api/inspections", "POST", { title: "x".repeat(17000) }), 413, "INVALID_BODY");
      await expectError(await fetch(`${base}/api/inspections`, { method: "POST", body: "text" }), 415, "UNSUPPORTED_MEDIA_TYPE");
    });
    await t.test("missing resources, unknown routes and deletion", async () => {
      const missing = randomUUID();
      await expectError(await request(`/api/inspections/${missing}`), 404, "INSPECTION_NOT_FOUND");
      await expectError(await request(`/api/inspections/${missing}`, "PATCH", { title: "x" }), 404, "INSPECTION_NOT_FOUND");
      await expectError(await request(`/api/inspections/${missing}`, "DELETE"), 404, "INSPECTION_NOT_FOUND");
      await expectError(await request("/unknown"), 404, "NOT_FOUND");
      const deleted = await request(`/api/inspections/${id}`, "DELETE");
      assert.equal(deleted.status, 204);
      assert.equal(await deleted.text(), "");
      await expectError(await request(`/api/inspections/${id}`), 404, "INSPECTION_NOT_FOUND");
      assert.deepEqual(await (await request("/api/inspections")).json(), []);
    });
    await t.test("client UUID replay normalizes content and rejects conflicts", async () => {
      const clientId = randomUUID();
      const first = await request("/api/inspections", "POST", { id: clientId, title: "  Client title  " });
      assert.equal(first.status, 201);
      const original = await first.json();
      assert.equal(original.id, clientId);
      for (const body of [{ id: clientId, title: "Client title", status: "draft" },
        { id: clientId.toUpperCase(), title: " Client title " }]) {
        const replay = await request("/api/inspections", "POST", body);
        assert.equal(replay.status, 200);
        assert.deepEqual(await replay.json(), original);
      }
      await expectError(await request("/api/inspections", "POST", { id: clientId, title: "Different" }), 409, "ID_CONFLICT");
      await expectError(await request("/api/inspections", "POST", { id: clientId, title: "Client title", status: "completed" }), 409, "ID_CONFLICT");
      await expectError(await request(`/api/inspections/${clientId}`, "PATCH", { id: randomUUID() }), 400, "INVALID_INPUT");
      for (const invalidId of [null, 5, "invalid"]) {
        await expectError(await request("/api/inspections", "POST", { id: invalidId, title: "x" }), 400, "INVALID_INPUT");
      }
      await request(`/api/inspections/${clientId}`, "DELETE");
    });
    await t.test("concurrent same-ID creates are safely idempotent or conflicting", async () => {
      for (const conflict of [false, true]) {
        const clientId = randomUUID();
        const responses = await Promise.all(["First", conflict ? "Second" : "First"].map((title) =>
          request("/api/inspections", "POST", { id: clientId, title })));
        assert.deepEqual(responses.map((r) => r.status).sort(), conflict ? [201, 409] : [200, 201]);
        if (conflict) await expectError(responses.find((r) => r.status === 409)!, 409, "ID_CONFLICT");
        assert.equal((await pool.query("SELECT id FROM inspections WHERE id = $1", [clientId])).rowCount, 1);
        await request(`/api/inspections/${clientId}`, "DELETE");
      }
    });
    await t.test("database errors never expose SQL, stack traces, or credentials", async () => {
      await pool.query("DROP TABLE inspections");
      await expectError(await request("/api/inspections"), 500, "INTERNAL_ERROR");
      // Health is process liveness, not database readiness.
      assert.equal((await request("/api/health")).status, 200);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});

await test("production owner authorization and CORS preserve PostgreSQL CRUD and replay", async () => {
  const admin = new pg.Pool({ connectionString });
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  const token = "integration_fixture_".padEnd(43, "x");
  const origin = "https://anvictor.github.io";
  const server = createApp(pool, { mode: "production", token, origins: [origin] }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, method = "GET", body?: unknown) => fetch(base + path, {
    method, headers: { Authorization: `Bearer ${token}`, Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await migrate(pool);
    const id = randomUUID();
    const denied = await fetch(`${base}/api/inspections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title: "Private" }) });
    assert.equal(denied.status, 401);
    assert.equal((await pool.query("SELECT * FROM inspections")).rowCount, 0);
    const first = await request("/api/inspections", "POST", { id, title: "Private" });
    assert.equal(first.status, 201);
    assert.equal(first.headers.get("access-control-allow-origin"), origin);
    assert.equal((await request("/api/inspections", "POST", { id, title: "Private" })).status, 200);
    assert.equal((await request(`/api/inspections/${id}`)).status, 200);
    assert.equal((await request(`/api/inspections/${id}`, "PATCH", { status: "completed" })).status, 200);
    assert.equal((await (await request(`/api/inspections/${id}`)).json()).status, "completed");
    assert.equal((await request(`/api/inspections/${id}`, "DELETE")).status, 204);
    const missing = await request(`/api/inspections/${id}`, "DELETE");
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "INSPECTION_NOT_FOUND");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();
  }
});
