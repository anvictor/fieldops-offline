import "dotenv/config";

export function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  }
  return value;
}

export function serverPort(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.PORT ?? "3001";
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}


export type ApiSecurity = { mode: "development" } | {
  mode: "production";
  token: string;
  origins: readonly string[];
};

export function serverConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.API_MODE ?? (env.NODE_ENV === "production" ? "production" : "development");
  if (!["development", "production"].includes(mode) ||
      (env.NODE_ENV === "production" && mode !== "production")) {
    throw new Error("Invalid API mode.");
  }
  const port = serverPort(env);
  const host = env.HOST ?? (mode === "production" ? "0.0.0.0" : "127.0.0.1");
  if (!host || host !== host.trim()) throw new Error("Invalid HOST.");
  if (mode === "development") {
    if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
      throw new Error("Development API must bind to loopback.");
    }
    return { host, port, security: { mode: "development" } as ApiSecurity };
  }
  const token = env.API_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
    throw new Error("Production API requires a generated owner token.");
  }
  const origins = env.CORS_ORIGINS?.split(",").map((origin) => origin.trim());
  if (!origins?.length || origins.some((origin) => {
    try {
      const url = new URL(origin);
      return origin.includes("*") || url.protocol !== "https:" || url.origin !== origin;
    } catch { return true; }
  })) throw new Error("Production API requires explicit HTTPS origins.");
  return { host, port, security: { mode: "production", token, origins: [...new Set(origins)] } as ApiSecurity };
}
