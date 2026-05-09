import { sql } from "drizzle-orm";
import { customType, timestamp, varchar } from "drizzle-orm/pg-core";

// All UUIDs in the system are v7 (time-ordered). We store them as the native uuid type but
// always generate them application-side via @marketplace/shared/ids#uuidv7 so we keep the
// monotonic ordering Postgres' default `gen_random_uuid()` (v4) doesn't give us.
export const uuidv7 = (name: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => "uuid",
  })(name);

export const idCol = (name = "id") => uuidv7(name).primaryKey().notNull();

export const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" })
  .notNull()
  .default(sql`now()`);

export const updatedAt = timestamp("updated_at", { withTimezone: true, mode: "date" })
  .notNull()
  .default(sql`now()`);

// Money columns: amount stored as bigint minor units; currency separate.
export const amountMinor = (name: string) =>
  customType<{ data: bigint; driverData: string }>({
    dataType: () => "bigint",
    fromDriver: (v) => BigInt(v as string),
    toDriver: (v) => (v as bigint).toString(),
  })(name).notNull();

export const currencyCode = (name = "currency") => varchar(name, { length: 3 }).notNull();

export const ISO_COUNTRY = (name: string) => varchar(name, { length: 2 }).notNull();
export const LOCALE = (name: string) => varchar(name, { length: 10 }).notNull();

// pgvector column for embeddings — dimensionality enforced at insert time so we can
// dual-write across model versions (spec §8.1).
export const vector = (name: string, dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dim})`,
    toDriver: (v) => `[${(v as number[]).join(",")}]`,
    fromDriver: (v) => {
      const s = (v as string).replace(/^\[|\]$/g, "");
      return s ? s.split(",").map(Number) : [];
    },
  })(name);
