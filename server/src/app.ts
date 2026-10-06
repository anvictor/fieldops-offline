import { randomUUID } from "node:crypto";
import express from "express";
import type { ErrorRequestHandler } from "express";
import type { Pool } from "pg";
import type { ApiSecurity } from "./config.js";
import { securityMiddleware } from "./security.js";
import { ApiError, inspectionId, inspectionInput } from "./validation.js";

const columns = 'id, title, status, created_at AS "createdAt", updated_at AS "updatedAt"';
const notFound = () => new ApiError(404, "INSPECTION_NOT_FOUND", "Inspection not found.");

export function createApp(pool: Pool, security: ApiSecurity = { mode: "development" }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityMiddleware(security));
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
  app.get("/api/inspections/:id", async (req, res) => {
    const result = await pool.query(`SELECT ${columns} FROM inspections WHERE id = $1`, [inspectionId(req.params.id)]);
    if (!result.rowCount) throw notFound();
    res.json(result.rows[0]);
  });
  app.post("/api/inspections", async (req, res) => {
    const input = inspectionInput(req.body, false, true);
    const id = input.id ?? randomUUID();
    const status = input.status ?? "draft";
    const result = await pool.query(
      `INSERT INTO inspections (id, title, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING ${columns}`,
      [id, input.title, status],
    );
    if (!result.rowCount) {
      // A separate statement sees the winning concurrent INSERT after it commits.
      const existing = await pool.query(`SELECT ${columns} FROM inspections WHERE id = $1`, [id]);
      const row = existing.rows[0];
      if (!row || row.title !== input.title || row.status !== status) {
        throw new ApiError(409, "ID_CONFLICT", "Inspection ID already has different content.");
      }
      res.status(200).json(row);
      return;
    }
    res.status(201).location(`/api/inspections/${result.rows[0].id}`).json(result.rows[0]);
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
    const result = await pool.query("DELETE FROM inspections WHERE id = $1", [inspectionId(req.params.id)]);
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
