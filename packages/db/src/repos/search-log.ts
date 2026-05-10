// Repo for the audit.search_queries log. Single fire-and-forget INSERT —
// callers should never await this on the hot path of a search response.

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
  };
}

export type SearchLogRepo = ReturnType<typeof makeSearchLogRepo>;
