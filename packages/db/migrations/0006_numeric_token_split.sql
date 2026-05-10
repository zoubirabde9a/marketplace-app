-- Numeric/unit token splitting. The `simple` tsvector config tokenizes by
-- whitespace+punctuation only, so "256GB" / "256gb" / "256 GB" / "256 gb"
-- end up as different tokens — search recall on storage- and battery-heavy
-- queries (the ones DZ users care about most) is much worse than it should
-- be. Standard fix in e-commerce search: split at digit↔letter boundaries
-- so "256GB" tokenizes as "256 gb", matching all four spelling variants.
--
-- f_normalize_search() = f_unaccent + digit/letter boundary split. Replaces
-- f_unaccent in both the generated tsvector column and the trigram indexes.
-- Same drop+recreate dance as 0004 — Postgres backfills STORED columns
-- automatically, sub-second on our catalog size.
--
-- Hand-written. Reject any future db:generate diff that proposes dropping
-- search_text or these indexes.

CREATE OR REPLACE FUNCTION public.f_normalize_search(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$
    SELECT regexp_replace(
      regexp_replace(public.f_unaccent($1), '([0-9])([a-zA-Z])', '\1 \2', 'g'),
      '([a-zA-Z])([0-9])', '\1 \2', 'g'
    )
  $$;
--> statement-breakpoint
ALTER TABLE "catalog"."products" DROP COLUMN "search_text";
--> statement-breakpoint
ALTER TABLE "catalog"."products"
  ADD COLUMN "search_text" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', public.f_normalize_search(coalesce("title_sanitized", ''))), 'A') ||
      setweight(to_tsvector('simple', public.f_normalize_search(coalesce("brand", ''))), 'B') ||
      setweight(to_tsvector('simple', public.f_normalize_search(coalesce("description_sanitized", ''))), 'C')
    ) STORED;
--> statement-breakpoint
CREATE INDEX "products_search_text_idx" ON "catalog"."products" USING gin ("search_text");
--> statement-breakpoint
DROP INDEX "catalog"."products_title_trgm_idx";
--> statement-breakpoint
DROP INDEX "catalog"."products_brand_trgm_idx";
--> statement-breakpoint
CREATE INDEX "products_title_trgm_idx" ON "catalog"."products" USING gin (public.f_normalize_search("title_sanitized") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "products_brand_trgm_idx" ON "catalog"."products" USING gin (public.f_normalize_search(coalesce("brand", '')) gin_trgm_ops);
