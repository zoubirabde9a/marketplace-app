// Catalog read tools — spec §5.2.
//
// Tools registered here:
//   catalog.search        — hybrid search w/ filters & embeddings
//   catalog.get_product   — fetch a single product by id
//   catalog.compare       — side-by-side comparison of canonical attributes
//   catalog.recommend     — personalized recommendations

import { z } from "zod";
import { catalog } from "@marketplace/domain";
import { McpRegistry, type McpContext } from "../registry.js";
import { captureSnapshot, snapshotWebUrl, webBase } from "./snapshot-helpers.js";

const ProductRefSchema = z.object({
  productId: z.string(),
  webUrl: z.string().url().optional(),
  title: z.array(z.unknown()).or(z.unknown()), // wrapped UntrustedContent
  brand: z.string().optional(),
  priceMinor: z.string().optional(),
  currency: z.string().optional(),
  rating: z.number().optional(),
  ratingCount: z.number().optional(),
  inStock: z.boolean(),
  sellerId: z.string(),
  counterfeitRisk: z.enum(["low", "elevated", "high"]),
});

const SearchResultSchema = z.object({
  hits: z.array(ProductRefSchema.extend({ relevanceScore: z.number() })),
  totalEstimate: z.number().int(),
  cursor: z.string().optional(),
  /** Deep link a human principal can open to see the same filters and results in the web UI. */
  webUrl: z.string().url().optional(),
  /** Frozen snapshot link a human can open to see exactly what the agent saw. Expires after 24h. */
  snapshotUrl: z.string().url().optional(),
  /** When the snapshot was captured (epoch ms). */
  snapshotCreatedAt: z.number().int().optional(),
  /** When the snapshot expires (epoch ms). */
  snapshotExpiresAt: z.number().int().optional(),
});

// Build a /search?... URL mirroring the agent's filters so a human can open it
// and inspect the same view. Only set when MARKETPLACE_WEB_BASE_URL is configured.
function searchWebUrl(input: catalog.SearchQuery): string | undefined {
  const base = webBase();
  if (!base) return undefined;
  const p = new URLSearchParams();
  if (input.query) p.set("q", input.query);
  const f = input.filters;
  if (f) {
    for (const c of f.categoryIds ?? []) p.append("category", c);
    if (f.brand) p.set("brand", f.brand);
    for (const s of f.sellerIds ?? []) p.append("sellerId", s);
    if (f.priceMinMinor !== undefined) p.set("priceMin", String(f.priceMinMinor));
    if (f.priceMaxMinor !== undefined) p.set("priceMax", String(f.priceMaxMinor));
    if (f.currency) p.set("currency", f.currency);
    if (f.shipsTo) p.set("shipsTo", f.shipsTo);
    if (f.minRating !== undefined) p.set("minRating", String(f.minRating));
    if (f.includeOutOfStock) p.set("includeOutOfStock", "true");
    if (f.attributes) {
      for (const [k, v] of Object.entries(f.attributes)) p.append(`attr.${k}`, v);
    }
  }
  if (input.sort && input.sort !== "relevance") p.set("sort", input.sort);
  if (input.limit) p.set("limit", String(input.limit));
  if (input.cursor) p.set("cursor", input.cursor);
  const qs = p.toString();
  return `${base}/search${qs ? `?${qs}` : ""}`;
}

function productWebUrl(productId: string): string | undefined {
  const base = webBase();
  return base ? `${base}/product/${encodeURIComponent(productId)}` : undefined;
}

export interface CatalogReadAdapter {
  search(query: catalog.SearchQuery, ctx: McpContext): Promise<{
    hits: Array<{
      productId: string;
      titleSanitized: string;
      brand?: string;
      priceMinor?: bigint;
      currency?: string;
      rating?: number;
      ratingCount?: number;
      inStock: boolean;
      sellerId: string;
      counterfeitRisk: catalog.CounterfeitRiskT;
      relevanceScore: number;
    }>;
    totalEstimate: number;
    cursor?: string;
  }>;
  getProduct(productId: string, ctx: McpContext): Promise<{
    productId: string;
    titleSanitized: string;
    descriptionSanitized?: string;
    brand?: string;
    attributes: Record<string, string>;
    variants: Array<{ id: string; sku: string; priceMinor: bigint; currency: string; inStock: boolean }>;
    sellerId: string;
    counterfeitRisk: catalog.CounterfeitRiskT;
  } | null>;
  compare(ids: string[], ctx: McpContext): Promise<unknown>;
  recommend(input: catalog.RecommendInput, ctx: McpContext): Promise<unknown>;
}

export function registerCatalogReadTools(
  reg: McpRegistry,
  adapter: CatalogReadAdapter,
  snapshots?: catalog.SnapshotStore,
): void {
  reg.register({
    name: "catalog.search",
    description: "Hybrid keyword + semantic search across all listings. Filters by category, price, brand, and ship-to.",
    scope: "catalog:read",
    auditEvent: "catalog.search",
    idempotent: true,
    inputSchema: catalog.SearchQuerySchema,
    outputSchema: SearchResultSchema,
    handler: async (input, ctx) => {
      const r = await adapter.search(input, ctx);
      const sUrl = searchWebUrl(input);
      const body = {
        hits: r.hits.map((h) => {
          const pUrl = productWebUrl(h.productId);
          return {
            productId: h.productId,
            ...(pUrl ? { webUrl: pUrl } : {}),
            title: { role: "untrusted_content", origin: `seller:${h.sellerId}`, value: h.titleSanitized },
            brand: h.brand,
            priceMinor: h.priceMinor?.toString(),
            currency: h.currency,
            rating: h.rating,
            ratingCount: h.ratingCount,
            inStock: h.inStock,
            sellerId: h.sellerId,
            counterfeitRisk: h.counterfeitRisk,
            relevanceScore: h.relevanceScore,
          };
        }),
        totalEstimate: r.totalEstimate,
        ...(r.cursor !== undefined ? { cursor: r.cursor } : {}),
        ...(sUrl ? { webUrl: sUrl } : {}),
      };
      const snap = await captureSnapshot(snapshots, ctx, "search", input, body);
      const snapUrl = snap ? snapshotWebUrl(snap.id) : undefined;
      return {
        ...body,
        ...(snapUrl ? { snapshotUrl: snapUrl, snapshotCreatedAt: snap!.createdAt, snapshotExpiresAt: snap!.expiresAt } : {}),
      };
    },
    errorCatalog: [
      { code: "validation", httpStatus: 400, description: "Query failed schema validation." },
      { code: "rate_limit", httpStatus: 429, description: "Too many search requests for this principal." },
    ],
  });

  reg.register({
    name: "catalog.get_product",
    description: "Fetch a single product by id, including all variants, attributes, and counterfeit risk tier.",
    scope: "catalog:read",
    auditEvent: "catalog.get_product",
    idempotent: true,
    inputSchema: z.object({ productId: z.string() }),
    outputSchema: z.object({
      productId: z.string(),
      webUrl: z.string().url().optional(),
      title: z.unknown(),
      description: z.unknown().optional(),
      brand: z.string().optional(),
      attributes: z.record(z.string(), z.unknown()),
      variants: z.array(z.object({
        id: z.string(),
        sku: z.string(),
        priceMinor: z.string(),
        currency: z.string(),
        inStock: z.boolean(),
      })),
      sellerId: z.string(),
      counterfeitRisk: z.enum(["low", "elevated", "high"]),
      snapshotUrl: z.string().url().optional(),
      snapshotCreatedAt: z.number().int().optional(),
      snapshotExpiresAt: z.number().int().optional(),
    }),
    handler: async (input, ctx) => {
      const p = await adapter.getProduct(input.productId, ctx);
      if (!p) throw new Error(`not_found:${input.productId}`);
      const origin = `seller:${p.sellerId}`;
      const wrap = (v: string) => ({ role: "untrusted_content", origin, value: v });
      const attrs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p.attributes)) attrs[k] = wrap(v);
      const pUrl = productWebUrl(p.productId);
      const body = {
        productId: p.productId,
        ...(pUrl ? { webUrl: pUrl } : {}),
        title: wrap(p.titleSanitized),
        description: p.descriptionSanitized ? wrap(p.descriptionSanitized) : undefined,
        brand: p.brand,
        attributes: attrs,
        variants: p.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          priceMinor: v.priceMinor.toString(),
          currency: v.currency,
          inStock: v.inStock,
        })),
        sellerId: p.sellerId,
        counterfeitRisk: p.counterfeitRisk,
      };
      const snap = await captureSnapshot(snapshots, ctx, "product", input, body);
      const snapUrl = snap ? snapshotWebUrl(snap.id) : undefined;
      return {
        ...body,
        ...(snapUrl ? { snapshotUrl: snapUrl, snapshotCreatedAt: snap!.createdAt, snapshotExpiresAt: snap!.expiresAt } : {}),
      };
    },
  });

  reg.register({
    name: "catalog.compare",
    description: "Compare a small set of products side-by-side on attributes & price.",
    scope: "catalog:read",
    auditEvent: "catalog.compare",
    idempotent: true,
    inputSchema: z.object({ productIds: z.array(z.string()).min(2).max(8) }),
    outputSchema: z.object({
      result: z.unknown(),
      snapshotUrl: z.string().url().optional(),
      snapshotCreatedAt: z.number().int().optional(),
      snapshotExpiresAt: z.number().int().optional(),
    }),
    handler: async (input, ctx) => {
      const result = await adapter.compare(input.productIds, ctx);
      const snap = await captureSnapshot(snapshots, ctx, "compare", input, result);
      const snapUrl = snap ? snapshotWebUrl(snap.id) : undefined;
      return {
        result,
        ...(snapUrl ? { snapshotUrl: snapUrl, snapshotCreatedAt: snap!.createdAt, snapshotExpiresAt: snap!.expiresAt } : {}),
      };
    },
  });

  reg.register({
    name: "catalog.recommend",
    description: "Personalized recommendations from collaborative + content signals; opt-in only.",
    scope: "catalog:read",
    auditEvent: "catalog.recommend",
    idempotent: true,
    inputSchema: catalog.RecommendInputSchema,
    outputSchema: z.object({
      result: z.unknown(),
      snapshotUrl: z.string().url().optional(),
      snapshotCreatedAt: z.number().int().optional(),
      snapshotExpiresAt: z.number().int().optional(),
    }),
    handler: async (input, ctx) => {
      const result = await adapter.recommend(input, ctx);
      const snap = await captureSnapshot(snapshots, ctx, "recommend", input, result);
      const snapUrl = snap ? snapshotWebUrl(snap.id) : undefined;
      return {
        result,
        ...(snapUrl ? { snapshotUrl: snapUrl, snapshotCreatedAt: snap!.createdAt, snapshotExpiresAt: snap!.expiresAt } : {}),
      };
    },
  });
}
