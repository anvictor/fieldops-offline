import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { ApiSecurity } from "./config.js";
import { ApiError } from "./validation.js";

const methods = new Set(["GET", "POST", "PATCH", "DELETE"]);
const headers = new Set(["authorization", "content-type"]);

export function securityMiddleware(config: ApiSecurity): RequestHandler {
  if (config.mode === "development") return (_req, _res, next) => next();
  const expected = createHash("sha256").update(config.token).digest();
  const origins = new Set(config.origins);
  return (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.vary("Origin");
    const origin = req.get("Origin");
    if (origin !== undefined) {
      if (!origins.has(origin)) return next(new ApiError(403, "ORIGIN_DENIED", "Origin not allowed."));
      res.set("Access-Control-Allow-Origin", origin);
      if (req.method === "OPTIONS") {
        const method = req.get("Access-Control-Request-Method");
        const requested = req.get("Access-Control-Request-Headers");
        const requestedHeaders = requested?.split(",").map((name) => name.trim().toLowerCase()) ?? [];
        if (!method || !methods.has(method) || requestedHeaders.some((name) => !headers.has(name))) {
          return next(new ApiError(403, "PREFLIGHT_DENIED", "Preflight not allowed."));
        }
        res.vary("Access-Control-Request-Method");
        res.vary("Access-Control-Request-Headers");
        res.set("Access-Control-Allow-Methods", method);
        if (requestedHeaders.length) res.set("Access-Control-Allow-Headers", requestedHeaders.join(", "));
        res.status(204).end();
        return;
      }
    }
    // Express implicitly supports HEAD for GET handlers; only this exact GET is anonymous.
    if (req.method === "GET" && req.path === "/api/health") return next();
    const authorization = req.get("Authorization");
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/);
    if (!match || !timingSafeEqual(expected, createHash("sha256").update(match[1]!).digest())) {
      res.set("WWW-Authenticate", 'Bearer realm="fieldops-api"');
      return next(new ApiError(401, "UNAUTHORIZED", "Authentication required."));
    }
    next();
  };
}
