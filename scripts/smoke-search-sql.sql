\echo === Q: iphn (typo, expecting iPhone hits)
WITH q AS (SELECT websearch_to_tsquery('simple', 'iphn') AS tsq, 'iphn'::text AS qtxt)
SELECT title_sanitized,
       ROUND(word_similarity((SELECT qtxt FROM q), title_sanitized)::numeric, 3) AS w_title,
       ROUND(similarity(title_sanitized, (SELECT qtxt FROM q))::numeric, 3) AS s_title
FROM catalog.products
WHERE word_similarity((SELECT qtxt FROM q), title_sanitized) >= 0.4
   OR word_similarity((SELECT qtxt FROM q), COALESCE(brand,'')) >= 0.4
   OR search_text @@ (SELECT tsq FROM q)
ORDER BY w_title DESC LIMIT 5;

\echo === Q: samsng (typo)
WITH q AS (SELECT websearch_to_tsquery('simple', 'samsng') AS tsq, 'samsng'::text AS qtxt)
SELECT title_sanitized,
       ROUND(word_similarity((SELECT qtxt FROM q), title_sanitized)::numeric, 3) AS w_title
FROM catalog.products
WHERE word_similarity((SELECT qtxt FROM q), title_sanitized) >= 0.4
   OR word_similarity((SELECT qtxt FROM q), COALESCE(brand,'')) >= 0.4
   OR search_text @@ (SELECT tsq FROM q)
ORDER BY w_title DESC LIMIT 5;

\echo === Q: galaxy (exact, FTS path)
WITH q AS (SELECT websearch_to_tsquery('simple', 'galaxy') AS tsq, 'galaxy'::text AS qtxt)
SELECT title_sanitized,
       ROUND(ts_rank_cd(search_text,(SELECT tsq FROM q))::numeric, 3) AS lex,
       ROUND(word_similarity((SELECT qtxt FROM q), title_sanitized)::numeric, 3) AS w_title
FROM catalog.products
WHERE search_text @@ (SELECT tsq FROM q)
   OR word_similarity((SELECT qtxt FROM q), title_sanitized) >= 0.4
   OR word_similarity((SELECT qtxt FROM q), COALESCE(brand,'')) >= 0.4
ORDER BY lex DESC, w_title DESC LIMIT 5;

\echo === Q: ipho (prefix, autocomplete-like)
WITH q AS (SELECT websearch_to_tsquery('simple', 'ipho') AS tsq, 'ipho'::text AS qtxt)
SELECT title_sanitized,
       ROUND(word_similarity((SELECT qtxt FROM q), title_sanitized)::numeric, 3) AS w_title
FROM catalog.products
WHERE word_similarity((SELECT qtxt FROM q), title_sanitized) >= 0.4
   OR word_similarity((SELECT qtxt FROM q), COALESCE(brand,'')) >= 0.4
   OR search_text @@ (SELECT tsq FROM q)
ORDER BY w_title DESC LIMIT 5;

\echo === Q: pizza (still expecting no match)
WITH q AS (SELECT websearch_to_tsquery('simple', 'pizza') AS tsq, 'pizza'::text AS qtxt)
SELECT title_sanitized
FROM catalog.products
WHERE search_text @@ (SELECT tsq FROM q)
   OR word_similarity((SELECT qtxt FROM q), title_sanitized) >= 0.4
   OR word_similarity((SELECT qtxt FROM q), COALESCE(brand,'')) >= 0.4;
