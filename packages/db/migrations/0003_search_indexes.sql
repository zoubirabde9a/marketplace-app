-- Stage 1 search upgrade: Postgres full-text + trigram indexes on
-- catalog.products. See ARCHITECTURE.md / SPEC §8.
--
-- Hand-written (not produced by drizzle-kit) because the tsvector generated
-- column is not declared in the drizzle schema. If `pnpm db:generate` ever
-- proposes dropping `search_text` or these indexes, reject that diff.
--
-- Why the `simple` text-search config (no stemming): the catalog is
-- multilingual (French / Arabic / English). Stemming for any single language
-- hurts the others. Trigram indexes carry typo-tolerance and substring fallback.

ALTER TABLE "catalog"."products"
  ADD COLUMN "search_text" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce("title_sanitized", '')), 'A') ||
      setweight(to_tsvector('simple', coalesce("brand", '')), 'B') ||
      setweight(to_tsvector('simple', coalesce("description_sanitized", '')), 'C')
    ) STORED;
--> statement-breakpoint
CREATE INDEX "products_search_text_idx" ON "catalog"."products" USING gin ("search_text");
--> statement-breakpoint
CREATE INDEX "products_title_trgm_idx" ON "catalog"."products" USING gin ("title_sanitized" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "products_brand_trgm_idx" ON "catalog"."products" USING gin ("brand" gin_trgm_ops);
