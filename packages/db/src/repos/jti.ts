// Postgres-backed DPoP JTI replay-protection set. `seen(jti, expiresAtMs)`
// returns true on replay, false on first sight. Atomic via INSERT ... ON
// CONFLICT DO NOTHING so concurrent requests with the same jti can't both win.

import { lt } from "drizzle-orm";
import { dpopJtis } from "../schema/audit.js";
import type { DbClient } from "../client.js";

export function makeJtiStore(db: DbClient) {
  let opCounter = 0;
  const GC_EVERY = 256;
  async function gc(): Promise<void> {
    await db.delete(dpopJtis).where(lt(dpopJtis.expiresAt, new Date()));
  }
  return {
    async seen(jti: string, expiresAtMs: number): Promise<boolean> {
      if (++opCounter % GC_EVERY === 0) await gc();
      // Use the typed Drizzle insert so postgres-js knows how to serialize the
      // Date for the timestamptz column. The earlier raw-template `db.execute`
      // passed `Date` to postgres-js as an opaque arg and the driver crashed
      // with "string argument must be of type string or Buffer" on Bind.
      const result = await db
        .insert(dpopJtis)
        .values({ jti, expiresAt: new Date(expiresAtMs) })
        .onConflictDoNothing()
        .returning({ jti: dpopJtis.jti });
      return result.length === 0;
    },
  };
}
