import { createApp } from "./app.js";
import { databaseUrl, serverConfiguration } from "./config.js";
import { createPool } from "./database.js";

try {
  const { port, host, security } = serverConfiguration();
  const pool = createPool(databaseUrl());
  const server = createApp(pool, security).listen(port, host, () => {
    console.log(`FieldOps API listening on ${host}:${port}`);
  });
  server.on("error", () => {
    console.error("API listener failed.");
    void pool.end();
    process.exitCode = 1;
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(() => {
      void pool.end().then(() => clearTimeout(deadline)).catch(() => { process.exitCode = 1; });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch {
  console.error("API startup failed. Check database and API configuration.");
  process.exitCode = 1;
}
