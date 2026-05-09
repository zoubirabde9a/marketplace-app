import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type DbClient = PostgresJsDatabase<typeof schema>;

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
