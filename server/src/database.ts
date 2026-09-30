import pg from "pg";

export function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10,
  });
  // Never log connection strings or raw driver errors, which may contain secrets.
  pool.on("error", () => console.error("Unexpected idle PostgreSQL connection error."));
  return pool;
}
