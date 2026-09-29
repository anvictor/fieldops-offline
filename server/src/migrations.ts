import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize migration runners; the lock is released with the transaction.
    await client.query("SELECT pg_advisory_xact_lock(5005)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = new URL("../migrations/", import.meta.url);
    const names = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    for (const name of names) {
      const applied = await client.query("SELECT name FROM schema_migrations WHERE name = $1", [name]);
      if (applied.rowCount) continue;
      await client.query(await readFile(new URL(name, directory), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
