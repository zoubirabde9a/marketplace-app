-- The original (b-tree) products_category_idx covers the legacy
-- catalog.products.category_id uuid FK, which is NULL for every one of the
-- ~77k live rows (and the catalog.categories table is empty in production).
-- The b-tree therefore covers nothing useful and just adds write overhead.
--
-- Real category data is stored in the products.category_ids jsonb array, which
-- has no index — every "category=telephones" filter pays a seq scan + jsonb
-- containment check across the entire products table. Add a GIN index using
-- jsonb_path_ops so containment queries like
--   category_ids @> '["telephones"]'::jsonb
-- can be index-driven. jsonb_path_ops is smaller and faster than the default
-- jsonb_ops for pure containment workloads, which is what category filters
-- are.
--
-- Operator note: in production, run these CONCURRENTLY to avoid blocking
-- writes during the rebuild. See deploy/CHANGELOG.md for the apply
-- procedure. Drizzle doesn't emit CONCURRENTLY itself, hence the explicit
-- comment for the operator.

DROP INDEX IF EXISTS catalog.products_category_idx;

CREATE INDEX IF NOT EXISTS products_category_ids_gin
  ON catalog.products USING gin (category_ids jsonb_path_ops);
