-- catalog.media has ~372k rows in production and the ONLY index is the primary
-- key on `id`. Every product-detail lookup (the storefront's /product/[id] and
-- the API's /v1/products/<id>) filters media by product_id, which Postgres
-- resolves with a parallel sequential scan over the whole table.
--
-- Live EXPLAIN ANALYZE measured one such lookup at 158ms (3 workers × ~124k
-- rows each, 123898 rows removed by filter per worker, all to find 5 hits).
-- pg_stat_user_tables snapshot at the time of writing showed:
--   catalog.media:  371,699 rows  ·  238,991 seq scans  ·  27 idx scans
-- — a ~99.99% miss rate against the only available index. The product-detail
-- endpoint's steady-state TTFB (~320ms warm after the iter-4 sellers cache)
-- has this seq scan as the dominant remaining cost.
--
-- Add a plain b-tree on product_id. Equality lookup, low cardinality per key
-- (~4 media per product average), perfect b-tree case. No GIN/jsonb needed.
--
-- Operator note: rebuild on prod with CONCURRENTLY to avoid taking a write
-- lock during the build — same pattern as 0009/0010. The schema doesn't
-- require it (FK already exists), but the index alone delivers the perf
-- win without restructuring.

CREATE INDEX IF NOT EXISTS media_product_id_idx
  ON catalog.media (product_id);
