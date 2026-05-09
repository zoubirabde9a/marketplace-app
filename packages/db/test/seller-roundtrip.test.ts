import { describe, it } from "vitest";

// In-memory round-trip integration test: SKIPPED.
//
// The seller_profiles table is defined under `pgSchema("seller")` and uses
// Postgres-only column kinds (uuid via customType, jsonb, timestamptz with
// `now()` defaults). drizzle-orm/better-sqlite3 cannot drive a pg-core schema
// — the SQL it generates references the `seller` schema and the `uuid`/`jsonb`
// types, which SQLite rejects. Re-defining the table under sqlite-core to
// "test" the round-trip would not exercise the production schema, so we skip
// rather than ship a misleading green test. The real round-trip is covered by
// migration tests against a Postgres database in the api/integration suite.

describe.skip("seller_profiles round-trip (better-sqlite3 + drizzle)", () => {
  it("inserts and reads a row", () => {
    // Intentionally empty — see file-level comment for rationale.
  });
});
