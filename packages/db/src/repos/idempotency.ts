// Postgres-backed idempotency-key cache. Same `IdempotencyStore` shape as the
// in-memory variant in @marketplace/api, so the two are drop-in interchangeable.

import { and, eq, lt, sql } from "drizzle-orm";
import { idempotencyKeys } from "../schema/audit.js";
import type { DbClient } from "../client.js";

export interface IdempotencyRecord {
  requestHash: string;
  status: number;
  body: unknown;
}

export function makeIdempotencyStore(db: DbClient) {
  // Opportunistic GC counter — every N reservations, scan and delete expired
  // rows. Cheap (one delete per N requests) and bounded memory.
  let opCounter = 0;
  const GC_EVERY = 64;
  async function gc(): Promise<void> {
    await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
  }
  return {
    async get(key: string, scope: string): Promise<IdempotencyRecord | null> {
      const rows = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      if (r.expiresAt.getTime() < Date.now()) {
        await db
          .delete(idempotencyKeys)
          .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
        return null;
      }
      return { requestHash: r.requestHash, status: r.status, body: r.body };
    },

    async reserve(key: string, scope: string, requestHash: string, ttlSeconds: number): Promise<boolean> {
      if (++opCounter % GC_EVERY === 0) await gc();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      try {
        await db.insert(idempotencyKeys).values({
          scope,
          key,
          requestHash,
          status: 0,
          body: null,
          expiresAt,
        });
        return true;
      } catch {
        // Race or replay — read what's there and accept if same payload.
        const rows = await db
          .select()
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
          .limit(1);
        return !!rows[0] && rows[0].requestHash === requestHash;
      }
    },

    async finalize(key: string, scope: string, status: number, body: unknown): Promise<void> {
      await db
        .update(idempotencyKeys)
        .set({ status, body: body as object | null })
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    },
  };
}
