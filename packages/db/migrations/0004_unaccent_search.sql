-- Diacritics-insensitive search. Algerian customers commonly type Latin
-- without accents ("refrigerateur" instead of "réfrigérateur", "ecran"
-- instead of "écran"); the original 0003 indexes split those into different
-- tsvector tokens so accent-stripped queries returned 0.
--
-- Two pieces:
--   1. f_unaccent(text) — IMMUTABLE wrapper around unaccent. Stock unaccent()
--      is STABLE (it loads its dictionary lazily and the search_path-resolved
--      single-arg form isn't immutable enough for GENERATED columns or
--      expression indexes), so we wrap the explicit two-arg form.
--   2. Recreate search_text on top of f_unaccent, plus the trigram indexes
--      on f_unaccent(title) / f_unaccent(brand) so word_similarity also
--      sees the unaccented form.
--
-- Hand-written; not produced by drizzle-kit. Same caveat as 0003 — reject any
-- future db:generate diff that proposes dropping these.

CREATE OR REPLACE FUNCTION public.f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
--> statement-breakpoint
ALTER TABLE "catalog"."products" DROP COLUMN "search_text";
--> statement-breakpoint
ALTER TABLE "catalog"."products"
  ADD COLUMN "search_text" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', public.f_unaccent(coalesce("title_sanitized", ''))), 'A') ||
      setweight(to_tsvector('simple', public.f_unaccent(coalesce("brand", ''))), 'B') ||
      setweight(to_tsvector('simple', public.f_unaccent(coalesce("description_sanitized", ''))), 'C')
    ) STORED;
--> statement-breakpoint
CREATE INDEX "products_search_text_idx" ON "catalog"."products" USING gin ("search_text");
--> statement-breakpoint
DROP INDEX "catalog"."products_title_trgm_idx";
--> statement-breakpoint
DROP INDEX "catalog"."products_brand_trgm_idx";
--> statement-breakpoint
CREATE INDEX "products_title_trgm_idx" ON "catalog"."products" USING gin (public.f_unaccent("title_sanitized") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "products_brand_trgm_idx" ON "catalog"."products" USING gin (public.f_unaccent(coalesce("brand", '')) gin_trgm_ops);
