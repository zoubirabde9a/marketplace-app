import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type DbClient = PostgresJsDatabase<typeof schema>;

/**
 * Lightweight readiness probe for the db. Cheap roundtrip (Postgres parses,
 * executes, returns one row); no table access so a vacuum or table-level
 * lock can't block it. Used by the api's /readyz endpoint — see
 * packages/api/src/routes/health.ts.
 */
export async function dbPing(db: DbClient): Promise<void> {
  await db.execute(sql`SELECT 1`);
}

export interface DbConfig {
  url: string;
  max?: number;
  ssl?: boolean | "require";
  applicationName?: string;
}

export function createDb(config: DbConfig): { db: DbClient; close: () => Promise<void> } {
  const sql = postgres(config.url, {
    max: config.max ?? 20,
    ...(config.ssl !== undefined ? { ssl: config.ssl } : {}),
    connection: { application_name: config.applicationName ?? "marketplace" },
    types: {
      bigint: postgres.BigInt,
    },
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    close: () => sql.end(),
  };
}
