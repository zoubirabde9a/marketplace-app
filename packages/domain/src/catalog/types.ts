import { z } from "zod";

export const ProductKind = z.enum(["physical", "digital", "service", "subscription"]);
export type ProductKindT = z.infer<typeof ProductKind>;

export const CounterfeitRisk = z.enum(["low", "elevated", "high"]);
export type CounterfeitRiskT = z.infer<typeof CounterfeitRisk>;

export const ConfidenceTier = z.enum(["exact", "high", "medium"]);
export type ConfidenceTierT = z.infer<typeof ConfidenceTier>;

export const SearchQuerySchema = z.object({
  query: z.string().min(1).max(500),
  filters: z
    .object({
      categoryIds: z.array(z.string()).optional(),
      sellerIds: z.array(z.string()).optional(),
      priceMinMinor: z.bigint().optional(),
      priceMaxMinor: z.bigint().optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      brand: z.string().optional(),
      attributes: z.record(z.string(), z.string()).optional(),
      shipsTo: z.string().length(2).optional(),
      minRating: z.number().min(0).max(5).optional(),
      includeOutOfStock: z.boolean().default(false),
    })
    .optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "recently_added", "rating"]).default("relevance"),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  embeddingsMode: z.enum(["off", "hybrid", "vector_only"]).default("hybrid"),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const RecommendInputSchema = z.object({
  context: z.object({
    seedProductIds: z.array(z.string()).optional(),
    cartItems: z.array(z.string()).optional(),
    purchaseHistoryIds: z.array(z.string()).optional(),
    naturalLanguage: z.string().max(500).optional(),
  }),
  shipsTo: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type RecommendInput = z.infer<typeof RecommendInputSchema>;
