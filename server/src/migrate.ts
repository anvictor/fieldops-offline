import { databaseUrl } from "./config.js";
import { createPool } from "./database.js";
import { migrate } from "./migrations.js";

async function main() {
  const pool = createPool(databaseUrl());
  try {
    await migrate(pool);
    console.log("Database migrations completed.");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("Migration failed. Check database configuration and availability.");
  process.exitCode = 1;
});
