// Repo for the audit.search_queries log. record() is a single fire-and-forget
// INSERT (callers must never await on the hot path); getStats() drives the
// internal /v1/_internal/search-stats endpoint and the operator dashboard.

import { sql } from "drizzle-orm";
import { searchQueries } from "../schema/audit.js";
import type { DbClient } from "../client.js";

export interface SearchLogEntry {
  queryRaw: string;
  queryNormalized: string;
  nResults: number;
  latencyMs: number;
  hasFilters: boolean;
  /** "fr" | "ar" | "en" — best-effort from a regex over the query string. */
  langGuess?: string;
}

export interface SearchStats {
  windowHours: number;
  totalQueries: number;
  distinctQueries: number;
  zeroResultCount: number;
  zeroResultRate: number;
  latencyMs: { p50: number; p95: number; p99: number };
  topZeroResultQueries: Array<{ query: string; hits: number; sampleRaw: string }>;
  topQueries: Array<{ query: string; hits: number; avgResults: number; p95LatencyMs: number }>;
}

export function makeSearchLogRepo(db: DbClient) {
  return {
    async record(entry: SearchLogEntry): Promise<void> {
      await db.insert(searchQueries).values({
        queryRaw: entry.queryRaw,
        queryNormalized: entry.queryNormalized,
        nResults: entry.nResults,
        latencyMs: entry.latencyMs,
        hasFilters: entry.hasFilters,
        langGuess: entry.langGuess ?? null,
      });
    },

    /**
     * Aggregates over the last `windowHours` (default 24) of search traffic.
     * Used by the operator-facing search-stats endpoint to spot regressions
     * and surface synonym candidates from zero-result tail queries.
     *
     * Three round-trips: aggregates, top-zero-result, top-frequent. They could
     * be one CTE but the simpler shape is easier to reason about and the
     * audit.search_queries table is small enough that wall-clock cost is a
     * non-issue.
     */
    async getStats(opts: { windowHours?: number } = {}): Promise<SearchStats> {
      // Bound windowHours at the repo even though the route validator
      // (search-stats.ts) already enforces (0, 720]. Two reasons:
      //   1. Defense in depth — direct in-process callers (operator
      //      scripts, future internal tools) might bypass the route.
      //   2. A 0 / negative window produces `NOW() - '0 hours'` which
      //      equals NOW(), so the WHERE clause `occurred_at >= NOW()`
      //      matches nothing and the function returns silent-zero stats
      //      — easy to mistake for "no search traffic" when really the
      //      window is unusable.
      const rawWindow = opts.windowHours ?? 24;
      const windowHours =
        Number.isFinite(rawWindow) && rawWindow > 0
          ? Math.min(rawWindow, 24 * 30)
          : 24;

      const aggRows = await db.execute<{
        total: number; distinct_count: number; zero_result_count: number;
        p50: number | null; p95: number | null; p99: number | null;
      }>(sql`
        SELECT
          count(*)::int                                        AS total,
          count(DISTINCT query_normalized)::int                AS distinct_count,
          count(*) FILTER (WHERE n_results = 0)::int           AS zero_result_count,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS p99
        FROM "audit"."search_queries"
        WHERE occurred_at >= NOW() - (${windowHours}::int || ' hours')::interval
      `);
      const agg = (aggRows as Array<typeof aggRows extends Array<infer T> ? T : never>)[0] as {
        total: number; distinct_count: number; zero_result_count: number;
        p50: number | null; p95: number | null; p99: number | null;
      } | undefined;

      const zeroRows = await db.execute<{ q: string; hits: number; sample_raw: string }>(sql`
        SELECT
          query_normalized       AS q,
          count(*)::int          AS hits,
          max(query_raw)         AS sample_raw
        FROM "audit"."search_queries"
        WHERE n_results = 0
          AND occurred_at >= NOW() - (${windowHours}::int || ' hours')::interval
        GROUP BY query_normalized
        ORDER BY hits DESC, query_normalized
        LIMIT 10
      `);

      const topRows = await db.execute<{
        q: string; hits: number; avg_results: number; p95_latency: number;
      }>(sql`
        SELECT
          query_normalized                                                  AS q,
          count(*)::int                                                     AS hits,
          avg(n_results)::int                                               AS avg_results,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int     AS p95_latency
        FROM "audit"."search_queries"
        WHERE n_results > 0
          AND occurred_at >= NOW() - (${windowHours}::int || ' hours')::interval
        GROUP BY query_normalized
        ORDER BY hits DESC, query_normalized
        LIMIT 10
      `);

      const total = Number(agg?.total ?? 0);
      const zeroCount = Number(agg?.zero_result_count ?? 0);
      return {
        windowHours,
        totalQueries: total,
        distinctQueries: Number(agg?.distinct_count ?? 0),
        zeroResultCount: zeroCount,
        zeroResultRate: total > 0 ? zeroCount / total : 0,
        latencyMs: {
          p50: Number(agg?.p50 ?? 0),
          p95: Number(agg?.p95 ?? 0),
          p99: Number(agg?.p99 ?? 0),
        },
        topZeroResultQueries: (zeroRows as Array<{ q: string; hits: number; sample_raw: string }>).map((r) => ({
          query: r.q,
          hits: Number(r.hits),
          sampleRaw: r.sample_raw,
        })),
        topQueries: (topRows as Array<{ q: string; hits: number; avg_results: number; p95_latency: number }>).map((r) => ({
          query: r.q,
          hits: Number(r.hits),
          avgResults: Number(r.avg_results),
          p95LatencyMs: Number(r.p95_latency),
        })),
      };
    },
  };
}

export type SearchLogRepo = ReturnType<typeof makeSearchLogRepo>;
