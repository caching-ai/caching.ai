import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(databaseUrl?: string): pg.Pool {
  if (!pool) {
    const raw = databaseUrl ?? process.env.DATABASE_URL;
    if (!raw) throw new Error("DATABASE_URL is not set");
    // Managed postgres requires TLS but presents a cert that can't be
    // hostname-verified (SNI proxy). pg treats sslmode=require in the URL as
    // verify-full, so strip it from the URL and pass an explicit ssl option.
    const needsTls = raw.includes("sslmode=require");
    const connectionString = raw
      .replace(/([?&])sslmode=require&?/, "$1")
      .replace(/[?&]$/, "");
    pool = new Pool({
      connectionString,
      max: 10,
      ssl: needsTls ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export function setPool(p: pg.Pool) {
  pool = p;
}

/**
 * Minimal forward-only migration runner. Applies migrations/NNN_*.sql in
 * lexical order, one row per version in schema_migrations
 * (INSERT ... ON CONFLICT DO NOTHING only — never UPDATE without WHERE).
 */
export async function migrate(migrationsDir: string, databaseUrl?: string): Promise<string[]> {
  const p = getPool(databaseUrl);
  await p.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations(
       version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  );
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    const version = f.replace(/\.sql$/, "");
    const { rows } = await p.query("SELECT 1 FROM schema_migrations WHERE version=$1", [version]);
    if (rows.length) continue;
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING",
        [version]
      );
      await client.query("COMMIT");
      applied.push(version);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}
