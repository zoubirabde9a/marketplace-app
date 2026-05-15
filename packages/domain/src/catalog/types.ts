import { z } from "zod";
import { Iso3166Alpha2Schema } from "@marketplace/shared/country";

export const ProductKind = z.enum(["physical", "digital", "service", "subscription"]);
export type ProductKindT = z.infer<typeof ProductKind>;

export const CounterfeitRisk = z.enum(["low", "elevated", "high"]);
export type CounterfeitRiskT = z.infer<typeof CounterfeitRisk>;

export const ConfidenceTier = z.enum(["exact", "high", "medium"]);
export type ConfidenceTierT = z.infer<typeof ConfidenceTier>;

export const SearchQuerySchema = z.object({
  // Allow empty string for browse-mode callers (no text query, just filters
  // or pure listing). Previously `min(1)` rejected MCP `catalog.search`
  // requests that just wanted to page through the catalog by `sort=newest`
  // — the REST `/v1/products` route handles this fine but MCP callers were
  // forced to invent a placeholder query. The 500-char cap stays.
  query: z.string().max(500).default(""),
  filters: z
    .object({
      categoryIds: z.array(z.string().max(120)).max(20).optional(),
      sellerIds: z.array(z.string().max(64)).max(20).optional(),
      // Non-negative bound — same family as the REST search-query schema
      // (pass #71). A negative price filter matches every product (no
      // variant has a negative price), so the filter is a silent no-op
      // — fail at the gate so a caller debugging "my filter isn't doing
      // anything" sees a clear validation error instead.
      priceMinMinor: z.bigint().nonnegative().optional(),
      priceMaxMinor: z.bigint().nonnegative().optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      // Match the REST surface's bound (pass #71). 120 char cap matches
      // the brand max applied to product writes (pass #48).
      brand: z.string().max(120).optional(),
      // Cap attribute-filter count so a runaway caller can't build an
      // O(filters × products) filter map. Same MAX_ATTR_FILTERS=32 as
      // pass #73 on the REST side.
      attributes: z.record(z.string().max(64), z.string().max(200)).optional()
        .refine(
          (v) => !v || Object.keys(v).length <= 32,
          { message: "at most 32 attribute filters" },
        )
        // Reject prototype-pollution-prone filter keys (matches the
        // write-side and projection-side defenses, passes #162–#164).
        // Even though the catalog filter's `f.attributes[k]` lookup is
        // string→string and not function-call, surfacing `__proto__` as
        // a filter key in audit logs / search-query telemetry is a
        // hand-rolled probe signal worth refusing outright.
        .refine(
          (v) => !v || Object.keys(v).every((k) =>
            k !== "__proto__" && k !== "prototype" && k !== "constructor",
          ),
          { message: "forbidden attribute key" },
        ),
      // ISO 3166-1 alpha-2 — same allow-list every other surface uses
      // (pass #7, #44, #48, #51, #71, MCP equivalents). Last surface in
      // the platform still accepting any 2-letter pair.
      shipsTo: Iso3166Alpha2Schema.optional(),
      minRating: z.number().min(0).max(5).optional(),
      includeOutOfStock: z.boolean().default(false),
    })
    .optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "recently_added", "rating"]).default("relevance"),
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  embeddingsMode: z.enum(["off", "hybrid", "vector_only"]).default("hybrid"),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const RecommendInputSchema = z.object({
  context: z.object({
    // Cap each list at 50 — pre-fix a malicious caller could pass 100K
    // seed IDs and force the recommender to materialise that many
    // products before computing collaborative signals. 50 is generous
    // for any real "based on these recent views" use case.
    seedProductIds: z.array(z.string().max(64)).max(50).optional(),
    cartItems: z.array(z.string().max(64)).max(50).optional(),
    purchaseHistoryIds: z.array(z.string().max(64)).max(50).optional(),
    naturalLanguage: z.string().max(500).optional(),
  }),
  shipsTo: Iso3166Alpha2Schema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type RecommendInput = z.infer<typeof RecommendInputSchema>;
