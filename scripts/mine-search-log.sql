\echo === counts ===
SELECT
  count(*)                                  AS total_queries,
  count(*) FILTER (WHERE n_results = 0)     AS zero_result,
  count(DISTINCT query_normalized)          AS distinct_queries
FROM audit.search_queries;

\echo === most-recent 25 queries ===
SELECT to_char(occurred_at, 'HH24:MI:SS') AS at, query_raw, n_results, latency_ms, lang_guess
FROM audit.search_queries
ORDER BY occurred_at DESC
LIMIT 25;

\echo === zero-result queries grouped by normalized form (synonym candidates) ===
SELECT
  query_normalized,
  count(*) AS hits,
  max(query_raw) AS sample_raw,
  max(lang_guess) AS lang
FROM audit.search_queries
WHERE n_results = 0
GROUP BY query_normalized
ORDER BY hits DESC, query_normalized
LIMIT 25;

\echo === slow queries (latency > 500ms) ===
SELECT to_char(occurred_at, 'HH24:MI:SS') AS at, query_raw, n_results, latency_ms
FROM audit.search_queries
WHERE latency_ms > 500
ORDER BY latency_ms DESC
LIMIT 10;

\echo === popular high-result queries (engagement proxy) ===
SELECT
  query_normalized,
  count(*) AS hits,
  avg(n_results)::int AS avg_results,
  avg(latency_ms)::int AS avg_latency
FROM audit.search_queries
WHERE n_results > 0
GROUP BY query_normalized
HAVING count(*) > 1
ORDER BY hits DESC, query_normalized
LIMIT 15;
