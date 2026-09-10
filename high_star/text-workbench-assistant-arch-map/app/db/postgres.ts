import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

let pool: Pool | undefined;

/** Lazily creates the shared PostgreSQL pool; the app can still run in JSON mode without DATABASE_URL. */
export function getPostgresDb(): NodePgDatabase<typeof schema> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL runtime mode.");
  pool ??= new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 10) });
  return drizzle(pool, { schema });
}

export async function closePostgresPool(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
}
