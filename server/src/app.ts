import { randomUUID } from "node:crypto";
import express from "express";
import type { ErrorRequestHandler } from "express";
import type { Pool, PoolClient } from "pg";
import type { ApiSecurity } from "./config.js";
import { securityMiddleware } from "./security.js";
import { privateDemoRateLimit } from "./rate-limit.js";
import { ApiError, inspectionId, inspectionInput } from "./validation.js";

const columns = 'id, title, status, created_at AS "createdAt", updated_at AS "updatedAt"';
const notFound = () => new ApiError(404, "INSPECTION_NOT_FOUND", "Inspection not found.");

export function createApp(pool: Pool, security: ApiSecurity = { mode: "development" }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityMiddleware(security));
  if (security.mode === "production") app.use(privateDemoRateLimit());
  app.use((req, _res, next) => {
    if (["POST", "PATCH"].includes(req.method) && !req.is("application/json")) {
      return next(new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json."));
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "fieldops-api" }));
  app.get("/api/inspections", async (_req, res) => {
    const result = await pool.query(`SELECT ${columns} FROM inspections ORDER BY created_at, id`);
    res.json(result.rows);
  });
  app.get("/api/inspections/snapshot", async (_req, res) => {
    // One statement gives both collections the same MVCC read snapshot.
    const result = await pool.query(`SELECT
      COALESCE((SELECT json_agg(rows) FROM (SELECT ${columns} FROM inspections ORDER BY created_at, id LIMIT 5001) rows), '[]') AS inspections,
      COALESCE((SELECT json_agg(id) FROM (SELECT id FROM inspection_tombstones ORDER BY id LIMIT 5001) retired), '[]') AS "deletedIds"`);
    const snapshot = result.rows[0];
    if (snapshot.inspections.length > 5000 || snapshot.deletedIds.length > 5000) {
      throw new ApiError(413, "SNAPSHOT_TOO_LARGE", "The private demo snapshot limit was exceeded.");
    }
    res.set("Cache-Control", "no-store").json(snapshot);
  });
  async function identityTransaction<T>(id: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Hash collisions only serialize unrelated IDs; they cannot bypass deletion protection.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [id]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  app.get("/api/inspections/:id", async (req, res) => {
    const result = await pool.query(`SELECT ${columns} FROM inspections WHERE id = $1`, [inspectionId(req.params.id)]);
    if (!result.rowCount) throw notFound();
    res.json(result.rows[0]);
  });
  app.post("/api/inspections", async (req, res) => {
    const input = inspectionInput(req.body, false, true);
    const id = input.id ?? randomUUID();
    const status = input.status ?? "draft";
    const result = await identityTransaction(id, async (client) => {
      if ((await client.query("SELECT id FROM inspection_tombstones WHERE id = $1", [id])).rowCount) {
        throw new ApiError(409, "INSPECTION_DELETED", "This inspection identity was deleted.");
      }
      const inserted = await client.query(
        `INSERT INTO inspections (id, title, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING ${columns}`,
        [id, input.title, status],
      );
      if (inserted.rowCount) return { row: inserted.rows[0], created: true };
      const existing = await client.query(`SELECT ${columns} FROM inspections WHERE id = $1`, [id]);
      const row = existing.rows[0];
      if (!row || row.title !== input.title || row.status !== status) {
        throw new ApiError(409, "ID_CONFLICT", "Inspection ID already has different content.");
      }
      return { row, created: false };
    });
    if (result.created) res.status(201).location(`/api/inspections/${id}`).json(result.row);
    else res.status(200).json(result.row);
  });

  app.patch("/api/inspections/:id", async (req, res) => {
    const id = inspectionId(req.params.id);
    const input = inspectionInput(req.body, true);
    const result = await pool.query(
      `UPDATE inspections SET title = COALESCE($2, title), status = COALESCE($3, status),
       updated_at = clock_timestamp() WHERE id = $1 RETURNING ${columns}`,
      [id, input.title, input.status],
    );
    if (!result.rowCount) throw notFound();
    res.json(result.rows[0]);
  });
  app.delete("/api/inspections/:id", async (req, res) => {
    const id = inspectionId(req.params.id);
    const result = await identityTransaction(id, async (client) => {
      await client.query("INSERT INTO inspection_tombstones (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [id]);
      return client.query("DELETE FROM inspections WHERE id = $1", [id]);
    });
    if (!result.rowCount) throw notFound();
    res.status(204).end();
  });
  app.use((_req, _res, next) => next(new ApiError(404, "NOT_FOUND", "Route not found.")));

  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    // Express's router marks malformed route-parameter decoding with this signature.
    if (error instanceof URIError && "status" in error && error.status === 400 &&
        error.message.startsWith("Failed to decode param '")) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid path parameter encoding." } });
      return;
    }
    const type = typeof error === "object" && error !== null && "type" in error ? error.type : undefined;
    if (type === "entity.parse.failed" || type === "entity.too.large" || type === "charset.unsupported" || type === "encoding.unsupported") {
      const status = type === "entity.too.large" ? 413 : type === "entity.parse.failed" ? 400 : 415;
      res.status(status).json({ error: { code: "INVALID_BODY", message: "Invalid, unsupported, or oversized JSON body." } });
      return;
    }
    console.error("API request failed unexpectedly.");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
  };
  app.use(errors);
  return app;
}
