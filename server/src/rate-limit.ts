import type { RequestHandler } from "express";

// One bounded counter per private-demo process; no forwarded-IP trust or map growth.
// This is a coarse shared cap, not distributed DDoS protection.
export function privateDemoRateLimit(limit = 600, now = () => performance.now()): RequestHandler {
  let windowStart = now();
  let requests = 0;
  return (req, res, next) => {
    if (req.method === "GET" && req.originalUrl === "/api/health") return next();
    const time = now();
    if (time - windowStart >= 60_000) { windowStart = time; requests = 0; }
    if (++requests <= limit) return next();
    res.set({ "Retry-After": String(Math.max(1, Math.ceil((60_000 - time + windowStart) / 1000))),
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.status(429).json({ error: { code: "RATE_LIMITED", message: "API request limit reached. Retry later." } });
  };
}
