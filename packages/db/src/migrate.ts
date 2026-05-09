import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";
import { createLogger } from "@marketplace/shared/logger";

const log = createLogger("db.migrate");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const { db, close } = createDb({ url });
  log.info("Running migrations…");
  await migrate(db, { migrationsFolder: "./migrations" });
  log.info("Migrations complete.");
  await close();
}

main().catch((err) => {
  log.error({ err }, "Migration failed");
  process.exit(1);
});
