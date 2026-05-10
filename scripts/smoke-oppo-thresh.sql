\echo === oppo @ threshold 0.4 (current prod) — false positives expected
WITH q AS (SELECT websearch_to_tsquery('simple','oppo') AS tsq, 'oppo'::text AS qtxt)
SELECT title_sanitized,
       ROUND(word_similarity((SELECT qtxt FROM q), title_sanitized)::numeric,3) AS w
FROM catalog.products
WHERE search_text @@ (SELECT tsq FROM q)
   OR word_similarity((SELECT qtxt FROM q), title_sanitized) >= 0.4
   OR word_similarity((SELECT qtxt FROM q), COALESCE(brand,'')) >= 0.4
ORDER BY w DESC LIMIT 20;

\echo === oppo @ threshold 0.5 — false positives should be gone
WITH q AS (SELECT websearch_to_tsquery('simple','oppo') AS tsq, 'oppo'::text AS qtxt)
SELECT title_sanitized,
       ROUND(word_similarity((SELECT qtxt FROM q), title_sanitized)::numeric,3) AS w
FROM catalog.products
WHERE search_text @@ (SELECT tsq FROM q)
   OR word_similarity((SELECT qtxt FROM q), title_sanitized) >= 0.5
   OR word_similarity((SELECT qtxt FROM q), COALESCE(brand,'')) >= 0.5
ORDER BY w DESC LIMIT 20;

\echo === iphn @ 0.5 — verify real typo still passes
WITH q AS (SELECT websearch_to_tsquery('simple','iphn') AS tsq, 'iphn'::text AS qtxt)
SELECT title_sanitized,
       ROUND(word_similarity((SELECT qtxt FROM q), title_sanitized)::numeric,3) AS w
FROM catalog.products
WHERE search_text @@ (SELECT tsq FROM q)
   OR word_similarity((SELECT qtxt FROM q), title_sanitized) >= 0.5
   OR word_similarity((SELECT qtxt FROM q), COALESCE(brand,'')) >= 0.5
ORDER BY w DESC LIMIT 5;

\echo === samsng @ 0.5
WITH q AS (SELECT websearch_to_tsquery('simple','samsng') AS tsq, 'samsng'::text AS qtxt)
SELECT title_sanitized,
       ROUND(word_similarity((SELECT qtxt FROM q), title_sanitized)::numeric,3) AS w
FROM catalog.products
WHERE search_text @@ (SELECT tsq FROM q)
   OR word_similarity((SELECT qtxt FROM q), title_sanitized) >= 0.5
   OR word_similarity((SELECT qtxt FROM q), COALESCE(brand,'')) >= 0.5
ORDER BY w DESC LIMIT 5;

\echo === count check: how many rows did 0.4 admit vs 0.5 for q=oppo
WITH q AS (SELECT 'oppo'::text AS qtxt, websearch_to_tsquery('simple','oppo') AS tsq)
SELECT
  (SELECT count(*) FROM catalog.products p WHERE p.search_text @@ (SELECT tsq FROM q) OR word_similarity((SELECT qtxt FROM q), p.title_sanitized) >= 0.4 OR word_similarity((SELECT qtxt FROM q), COALESCE(p.brand,'')) >= 0.4) AS at_0_4,
  (SELECT count(*) FROM catalog.products p WHERE p.search_text @@ (SELECT tsq FROM q) OR word_similarity((SELECT qtxt FROM q), p.title_sanitized) >= 0.5 OR word_similarity((SELECT qtxt FROM q), COALESCE(p.brand,'')) >= 0.5) AS at_0_5;
