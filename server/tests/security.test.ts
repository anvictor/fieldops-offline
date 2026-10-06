import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { serverConfiguration } from "../src/config.js";

// Public deterministic fixtures, never real credentials.
const token = "test_fixture_".padEnd(43, "x");
const origin = "https://anvictor.github.io";
const production = { API_MODE: "production", API_TOKEN: token, CORS_ORIGINS: origin };

test("configuration fails closed and keeps development on loopback", () => {
  assert.equal(serverConfiguration({}).host, "127.0.0.1");
  for (const host of ["127.0.0.1", "::1", "localhost"]) assert.equal(serverConfiguration({ HOST: host }).host, host);
  for (const host of ["0.0.0.0", "::", "192.168.1.2", "127.0.0.2", "", " localhost "]) {
    assert.throws(() => serverConfiguration({ HOST: host }));
  }
  for (const config of [{ API_MODE: "invalid" }, { NODE_ENV: "production" },
    { ...production, NODE_ENV: "production", API_MODE: "development" },
    { ...production, API_TOKEN: undefined }, { ...production, API_TOKEN: "short" },
    { ...production, API_TOKEN: "x".repeat(129) }, { ...production, API_TOKEN: " ".repeat(43) },
    { ...production, CORS_ORIGINS: undefined }, { ...production, CORS_ORIGINS: "" }]) {
    assert.throws(() => serverConfiguration(config));
  }
  for (const bad of ["*", "https://*", "https://*.example.com", "null", "http://example.com", "https://example.com/", "https://example.com/path",
    "https://user:password@example.com", "https://example.com?x=1", "https://example.com#x", `${origin},`, "https://example.com:443"]) {
    assert.throws(() => serverConfiguration({ ...production, CORS_ORIGINS: bad }));
  }
  for (const port of ["0", "65536", "3.1", "", "wrong"]) assert.throws(() => serverConfiguration({ ...production, PORT: port }));
  const config = serverConfiguration({ ...production, CORS_ORIGINS: `${origin}, https://example.com, ${origin}` });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 3001);
  assert.deepEqual(config.security, { mode: "production", token, origins: [origin, "https://example.com"] });
  assert.equal(serverConfiguration({ ...production, API_MODE: undefined, NODE_ENV: "production" }).security.mode, "production");
});

test("production HTTP guards precede parsing/SQL, implement exact CORS and minimal health", async () => {
  let queries = 0;
  const pool = { async query() { queries++; return { rows: [], rowCount: 0 }; } } as unknown as Pool;
  const config = serverConfiguration(production);
  const server = createApp(pool, config.security).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, init: RequestInit = {}) => fetch(base + path, init);
  const auth = { Authorization: `Bearer ${token}` };
  const safe = (response: Response) => {
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("vary") ?? "", /Origin/);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
  };
  try {
    const health = await request("/api/health");
    assert.equal(health.status, 200); safe(health);
    assert.deepEqual(await health.json(), { status: "ok", service: "fieldops-api" });
    for (const method of ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const path = method === "GET" ? "/api/inspections" : "/api/inspections/00000000-0000-0000-0000-000000000000";
      const response = await request(path, { method });
      assert.equal(response.status, 401); safe(response);
      assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="fieldops-api"');
      if (method !== "HEAD") assert.deepEqual(await response.json(), { error: { code: "UNAUTHORIZED", message: "Authentication required." } });
    }
    for (const path of ["/api/health", "/unknown", "/API/health", "/api/health/"]) {
      assert.equal((await request(path, { method: "HEAD" })).status, 401);
    }
    for (const credential of ["Bearer wrong", `Bearer ${"z".repeat(43)}`, `Basic ${token}`, `bearer ${token}`, `Bearer ${token} extra`]) {
      assert.equal((await request("/api/inspections", { headers: { Authorization: credential } })).status, 401);
    }
    // Oversized/malformed JSON must not be parsed before credentials are checked.
    for (const body of ["{", "x".repeat(17000)]) {
      assert.equal((await request("/api/inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body })).status, 401);
    }
    assert.equal(queries, 0);
    for (const bad of ["https://evil.example", `${origin}.evil.example`, "null", `${origin}/`]) {
      const response = await request("/api/inspections", { headers: { ...auth, Origin: bad } });
      assert.equal(response.status, 403);safe(response);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
    assert.equal(queries, 0);
    const preflight = await request("/api/inspections", { method: "OPTIONS", headers: {
      Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Authorization, Content-Type",
    } });
    assert.equal(preflight.status, 204);safe(preflight);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "POST");
    assert.equal(preflight.headers.get("access-control-allow-headers"), "authorization, content-type");
    for (const headers of ([{}, { "Access-Control-Request-Method": "PUT" },
      { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "X-Admin" },
      { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": ",authorization" }] as Record<string, string>[])) {
      assert.equal((await request("/api/inspections", { method: "OPTIONS", headers: { Origin: origin, ...headers } })).status, 403);
    }
    assert.equal(queries, 0);
    const anonymousAllowedOrigin = await request("/api/inspections", { headers: { Origin: origin } });
    assert.equal(anonymousAllowedOrigin.status, 401);
    assert.equal(anonymousAllowedOrigin.headers.get("access-control-allow-origin"), origin);
    for (const headers of [auth, { ...auth, Origin: origin }]) {
      const response = await request("/api/inspections", { headers });
      assert.equal(response.status, 200);safe(response);assert.deepEqual(await response.json(), []);
    }
    assert.equal(queries, 2);
    assert.equal((await request("/unknown", { headers: auth })).status, 404);
    const invalidBody = await request("/api/inspections", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{" });
    assert.equal(invalidBody.status, 400);safe(invalidBody);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
