-- Listing a seller's products newest-first (the storefront's /v1/products?sellerId=...&sort=newest
-- and the admin "my shop" view) was doing a sequential scan over the entire
-- catalog.products table (~77k rows in production today), filtering by seller_id
-- then sorting by created_at. Cold/contended hits were observed at 7s+.
--
-- The existing (seller_id, sku) unique index can't drive the sort, so add a
-- composite that matches the access pattern exactly: equality on seller_id,
-- range/sort on created_at DESC. Postgres can scan this index in reverse for
-- newest-first listings and stop after LIMIT rows.
CREATE INDEX IF NOT EXISTS products_seller_created_idx
  ON catalog.products (seller_id, created_at DESC);
