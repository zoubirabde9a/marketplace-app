// Internal search-stats endpoint. Aggregate-only, no PII. Used by the
// operator to spot zero-result-query trends (synonym candidates) and
// latency regressions without shelling into Postgres.
//
// Auth posture: the path lives under `/v1/_internal/` which is NOT in
// PUBLIC_MATCHERS / SESSION_ONLY / SESSION_OR_PASSPORT (auth.ts), so the
// auth middleware enforces full DPoP+Passport on the request before this
// handler runs. The previous comment claimed "safe to expose without auth"
// — that was aspirational, not what the routing actually does. Even
// aggregate counts are reconnaissance (zero-result-query spikes can
// indicate an attacker probing for SKU enumeration); keep behind auth.

import type { FastifyInstance } from "fastify";
import type { SearchStats } from "@marketplace/db";
import { ValidationError } from "@marketplace/shared/errors";

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
    if (raw !== undefined) {
      // Coerce + validate the window. Previously a non-string / out-of-range
      // value silently fell through to the default — making it hard to tell
      // whether the operator's `?windowHours=` had any effect. Surface the
      // bad input so the operator sees their query failed validation rather
      // than seeing the default-window data with no signal that their
      // override was ignored.
      const s = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]) : String(raw);
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0 || n > 24 * 30) {
        throw new ValidationError([
          {
            path: "windowHours",
            message: `must be a finite number in (0, ${24 * 30}]`,
          },
        ]);
      }
      windowHours = n;
    }
    return deps.searchLog.getStats(windowHours !== undefined ? { windowHours } : {});
  });
}
