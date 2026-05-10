// Internal search-stats endpoint. Aggregate-only, no PII; safe to expose
// without auth. Used by the operator to spot zero-result-query trends
// (synonym candidates) and latency regressions without shelling into Postgres.

import type { FastifyInstance } from "fastify";
import type { SearchStats } from "@marketplace/db";

export interface SearchStatsDeps {
  /** From repos.searchLog. May be undefined in unit tests; route is then 503. */
  searchLog: { getStats: (opts?: { windowHours?: number }) => Promise<SearchStats> } | undefined;
}

export async function registerSearchStatsRoutes(
  app: FastifyInstance,
  deps: SearchStatsDeps,
): Promise<void> {
  app.get("/v1/_internal/search-stats", async (req, reply) => {
    if (!deps.searchLog) {
      void reply.code(503);
      return { error: "search-log not wired" };
    }
    const raw = (req.query as Record<string, unknown> | undefined)?.windowHours;
    let windowHours: number | undefined = undefined;
    if (typeof raw === "string") {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && n <= 24 * 30) windowHours = n;
    }
    return deps.searchLog.getStats(windowHours !== undefined ? { windowHours } : {});
  });
}
