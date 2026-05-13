-- Make catalog.products.seller_id and catalog.media.seller_id nullable so
-- scraper-seeded listings can be ingested without a synthetic owning org.
--
-- Background: prior to 2026-05-12 every scraped Ouedkniss listing got a
-- deterministic synthetic seller_profiles row (storeSlug = "okk-store-<id>" or
-- "okk-user-<id>") so the seller_id FK could be satisfied. Operator decision:
-- treat scraped listings as catalog-only reference data — no owning seller,
-- and therefore not purchasable. Add-to-cart, buy-now, MCP cart.add_item and
-- the HTTP cart endpoints all refuse to resolve a variant whose product has
-- seller_id IS NULL.
--
-- Schema effect: drop the NOT NULL constraint on both columns. The FK with
-- ON DELETE CASCADE stays in place — if a real seller ever takes ownership of
-- one of these rows later, the FK continues to enforce referential integrity.
-- The unique index products_seller_sku_unique still works (Postgres treats
-- multiple NULL values as distinct in unique indexes), and the scraper SKU
-- already embeds the product-id tail so collisions are impossible regardless.

ALTER TABLE catalog.products  ALTER COLUMN seller_id DROP NOT NULL;
ALTER TABLE catalog.media     ALTER COLUMN seller_id DROP NOT NULL;
