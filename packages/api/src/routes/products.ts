// REST surface for /v1/products — spec §5.1.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { catalog } from "@marketplace/domain";
import { NotFoundError, UnauthorizedError } from "@marketplace/shared/errors";
import { requirePrincipal } from "../middleware/auth.js";
import type { SellerRepo } from "../repos/seller.js";
import type { ProductRepo } from "../repos/product.js";
import type { SearchResult } from "../catalog/search.js";
import { searchProducts } from "../catalog/search.js";
import type { StoredMedia, StoredProduct, StoredSeller, StoredVariant } from "../types/store-types.js";

export interface ProductMedia {
  id: string;
  url: string;
  contentType: string;
  byteSize?: number;
  width?: number;
  height?: number;
  altText?: string;
}

export interface ProductReader {
  search(
    query: catalog.SearchQuery & { fuzzy?: boolean },
    ctx: { agentId: string },
  ): Promise<SearchResult>;
  getProduct(productId: string, ctx: { agentId: string }): Promise<{
    productId: string;
    titleSanitized: string;
    descriptionSanitized?: string;
    brand?: string;
    attributes: Record<string, string>;
    variants: Array<{ id: string; sku: string; priceMinor: bigint; currency: string; inStock: boolean }>;
    sellerId: string;
    sellerDisplayName?: string;
    sellerPhone?: string;
    sellerWhatsapp?: string;
    sellerWebsite?: string;
    categoryIds?: string[];
    shipsTo?: string[];
    counterfeitRisk: catalog.CounterfeitRiskT;
    images: ProductMedia[];
    heroMediaId?: string;
  } | null>;
  getProductsByIds(ids: string[]): Promise<Array<Awaited<ReturnType<ProductReader["getProduct"]>>>>;
}

const SearchQueryParamsSchema = z.object({
  q: z.string().max(500).optional(),
  category: z.union([z.string(), z.array(z.string())]).optional().transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  brand: z.string().optional(),
  sellerId: z.union([z.string(), z.array(z.string())]).optional().transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  priceMin: z.coerce.bigint().optional(),
  priceMax: z.coerce.bigint().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  shipsTo: z.string().length(2).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  includeOutOfStock: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
  fuzzy: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "rating"]).default("relevance"),
});

const BatchGetQuerySchema = z.object({
  id: z
    .union([z.string().min(1).max(64), z.array(z.string().min(1).max(64))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .pipe(z.array(z.string()).min(1).max(50)),
});

function extractAttributeFilters(rawQuery: unknown): Record<string, string> | undefined {
  if (!rawQuery || typeof rawQuery !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawQuery as Record<string, unknown>)) {
    if (!k.startsWith("attr.")) continue;
    const key = k.slice("attr.".length);
    if (key.length === 0 || key.length > 64) continue;
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string" && value.length > 0 && value.length <= 200) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const MediaInputSchema = z.object({
  url: z.string().url().max(2048),
  contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i).max(64),
  byteSize: z.number().int().positive().max(50_000_000).optional(),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  altText: z.string().max(500).optional(),
});

const VariantInputSchema = z.object({
  sku: z.string().min(1).max(64),
  priceMinor: z.coerce.bigint(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  inStock: z.boolean().optional(),
});

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const CreateProductSchema = z.object({
  sellerId: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  brand: z.string().max(120).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  categoryIds: z.array(z.string().min(1).max(120)).max(20).optional(),
  shipsTo: z.array(z.string().length(2)).max(250).optional(),
  variants: z
    .array(
      z.object({
        sku: z.string().min(1).max(64),
        priceMinor: z.coerce.bigint(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        inStock: z.boolean().optional(),
      }),
    )
    .min(1),
  media: z.array(MediaInputSchema).max(20).optional(),
  heroMediaIndex: z.number().int().nonnegative().optional(),
});

export async function registerProductWriteRoutes(
  app: FastifyInstance,
  deps: { sellers: SellerRepo; products: ProductRepo },
): Promise<void> {
  await app.register(import("@fastify/multipart"), {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  app.addContentTypeParser(/^image\//, { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/v1/products", async (req, reply) => {
    const principal = requirePrincipal(req);
    const body = CreateProductSchema.parse(req.body);
    const seller = await deps.sellers.get(body.sellerId);
    if (!seller) throw new NotFoundError("seller", body.sellerId);
    if (seller.ownerAgentId !== principal.agentId) {
      throw new UnauthorizedError("not_seller_owner");
    }
    const p = await deps.products.create({
      sellerId: body.sellerId,
      title: body.title,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.brand !== undefined ? { brand: body.brand } : {}),
      ...(body.attributes !== undefined ? { attributes: body.attributes } : {}),
      ...(body.categoryIds !== undefined ? { categoryIds: body.categoryIds } : {}),
      ...(body.shipsTo !== undefined ? { shipsTo: body.shipsTo } : {}),
      variants: body.variants.map((v) => ({
        sku: v.sku,
        priceMinor: v.priceMinor,
        currency: v.currency,
        ...(v.inStock !== undefined ? { inStock: v.inStock } : {}),
      })),
      ...(body.media !== undefined
        ? {
            media: body.media.map((m) => ({
              url: m.url,
              contentType: m.contentType,
              ...(m.byteSize !== undefined ? { byteSize: m.byteSize } : {}),
              ...(m.width !== undefined ? { width: m.width } : {}),
              ...(m.height !== undefined ? { height: m.height } : {}),
              ...(m.altText !== undefined ? { altText: m.altText } : {}),
            })),
          }
        : {}),
      ...(body.heroMediaIndex !== undefined ? { heroMediaIndex: body.heroMediaIndex } : {}),
    });
    void reply.code(201);
    return {
      productId: p.productId,
      sellerId: p.sellerId,
      title: p.titleSanitized,
      brand: p.brand,
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        priceMinor: v.priceMinor.toString(),
        currency: v.currency,
        inStock: v.inStock,
      })),
      images: p.media,
      heroMediaId: p.heroMediaId ?? null,
      createdAt: new Date(p.createdAt).toISOString(),
    };
  });
}

function resolveBaseUrl(req: { protocol: string; hostname: string; headers: Record<string, unknown> }): string {
  const fromEnv = process.env.MARKETPLACE_PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = (req.headers.host as string | undefined) ?? `${req.hostname}`;
  return `${req.protocol}://${host}`;
}

function productViewUrl(base: string, productId: string): string {
  return `${base}/v1/products/${productId}`;
}

// Web origin for human-facing snapshot links — same env var the MCP server uses
// so REST and MCP responses produce identical /s/{id} URLs.
function webBase(): string | null {
  const v = process.env.MARKETPLACE_WEB_BASE_URL;
  return v ? v.replace(/\/$/, "") : null;
}

function snapshotWebUrl(id: string): string | undefined {
  const base = webBase();
  return base ? `${base}/s/${id}` : undefined;
}

async function captureRestSnapshot(
  store: catalog.SnapshotStore | undefined,
  kind: catalog.SnapshotKind,
  agentId: string,
  input: unknown,
  output: unknown,
): Promise<{ snapshotUrl: string; snapshotCreatedAt: number; snapshotExpiresAt: number } | undefined> {
  if (!store) return undefined;
  const url = snapshotWebUrl("placeholder");
  if (!url) return undefined;
  const id = catalog.newSnapshotId();
  const createdAt = Date.now();
  const expiresAt = createdAt + catalog.SNAPSHOT_TTL_MS;
  await store.put({
    id,
    kind,
    input,
    output,
    ...(agentId !== "anonymous" ? { agentId } : {}),
    createdAt,
    expiresAt,
  });
  return { snapshotUrl: snapshotWebUrl(id)!, snapshotCreatedAt: createdAt, snapshotExpiresAt: expiresAt };
}

/** Best-effort language tag for the search log. Cheap regex; refine from logs later. */
function detectLang(q: string): string | undefined {
  if (q.length === 0) return undefined;
  if (/[؀-ۿ]/.test(q)) return "ar"; // Arabic block
  if (/[àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/.test(q)) return "fr";
  return undefined; // unknown — could be French sans accents, English, transliteration, etc.
}

export interface SearchLogSink {
  record: (entry: {
    queryRaw: string;
    queryNormalized: string;
    nResults: number;
    latencyMs: number;
    hasFilters: boolean;
    langGuess?: string;
  }) => Promise<void>;
}

export async function registerProductRoutes(
  app: FastifyInstance,
  reader: ProductReader,
  snapshots?: catalog.SnapshotStore,
  searchLog?: SearchLogSink,
): Promise<void> {
  app.get("/v1/products", async (req) => {
    const agentId = req.principal?.agentId ?? "anonymous";
    const params = SearchQueryParamsSchema.parse(req.query);
    const attributes = extractAttributeFilters(req.query);
    const query: catalog.SearchQuery & { fuzzy?: boolean } = {
      query: params.q ?? "",
      filters: {
        ...(params.category ? { categoryIds: params.category } : {}),
        ...(params.sellerId ? { sellerIds: params.sellerId } : {}),
        ...(params.brand ? { brand: params.brand } : {}),
        ...(attributes ? { attributes } : {}),
        ...(params.priceMin !== undefined ? { priceMinMinor: params.priceMin } : {}),
        ...(params.priceMax !== undefined ? { priceMaxMinor: params.priceMax } : {}),
        ...(params.currency ? { currency: params.currency } : {}),
        ...(params.shipsTo ? { shipsTo: params.shipsTo } : {}),
        ...(params.minRating !== undefined ? { minRating: params.minRating } : {}),
        includeOutOfStock: params.includeOutOfStock ?? false,
      },
      sort: params.sort,
      limit: params.limit,
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.fuzzy !== undefined ? { fuzzy: params.fuzzy } : {}),
      embeddingsMode: "hybrid",
    };
    const t0 = Date.now();
    const r = await reader.search(query, { agentId });
    const latencyMs = Date.now() - t0;

    // Fire-and-forget search log. We log only when the user typed a query
    // string (q non-empty) — that's the data that drives synonym mining and
    // zero-result alerts. Empty browse traffic is uninteresting and noisy.
    // Errors are logged at warn but never bubble up — search must not break
    // on a logging failure.
    const rawQ = (params.q ?? "").trim();
    if (searchLog && rawQ.length > 0) {
      const hasFilters =
        params.brand !== undefined ||
        (params.sellerId && params.sellerId.length > 0) ||
        (params.category && params.category.length > 0) ||
        params.priceMin !== undefined ||
        params.priceMax !== undefined ||
        params.currency !== undefined ||
        params.shipsTo !== undefined ||
        params.minRating !== undefined ||
        (attributes && Object.keys(attributes).length > 0);
      const entry = {
        queryRaw: rawQ,
        queryNormalized: rawQ.toLowerCase(),
        nResults: r.totalEstimate,
        latencyMs,
        hasFilters: !!hasFilters,
        ...(detectLang(rawQ) ? { langGuess: detectLang(rawQ)! } : {}),
      };
      void searchLog.record(entry).catch((err) => {
        req.log.warn({ err, query: rawQ }, "search_log_write_failed");
      });
    }

    const base = resolveBaseUrl(req as unknown as { protocol: string; hostname: string; headers: Record<string, unknown> });
    const body = {
      data: r.hits.map((h) => ({
        productId: h.productId,
        viewUrl: productViewUrl(base, h.productId),
        title: { role: "untrusted_content", origin: `seller:${h.sellerId}`, value: h.titleSanitized },
        brand: h.brand,
        priceMinor: h.priceMinor?.toString(),
        priceFromMinor: h.priceFromMinor?.toString(),
        priceToMinor: h.priceToMinor?.toString(),
        variantCount: h.variantCount,
        currency: h.currency,
        rating: h.rating,
        ratingCount: h.ratingCount,
        inStock: h.inStock,
        sellerId: h.sellerId,
        sellerDisplayName: h.sellerDisplayName ?? null,
        categoryIds: h.categoryIds ?? [],
        counterfeitRisk: h.counterfeitRisk,
        relevanceScore: h.relevanceScore,
        heroImageUrl: h.heroImage?.url ?? null,
        heroImage: h.heroImage ?? null,
        imageCount: h.imageCount,
        postedAt: h.postedAt ?? null,
      })),
      pagination: { cursor: r.cursor ?? null, totalEstimate: r.totalEstimate },
      facets: {
        brands: r.facets.brands,
        currencies: r.facets.currencies,
        sellers: r.facets.sellers,
        categories: r.facets.categories,
        priceRanges: r.facets.priceRanges.map((pr) => ({
          currency: pr.currency,
          minMinor: pr.minMinor.toString(),
          maxMinor: pr.maxMinor.toString(),
        })),
      },
    };
    const snap = await captureRestSnapshot(snapshots, "search", agentId, { query, limit: params.limit, sort: params.sort, cursor: params.cursor }, body);
    return snap ? { ...body, ...snap } : body;
  });

  app.get<{ Params: { id: string } }>("/v1/products/:id", async (req) => {
    const agentId = req.principal?.agentId ?? "anonymous";
    const p = await reader.getProduct(req.params.id, { agentId });
    if (!p) throw new NotFoundError("product", req.params.id);
    const base = resolveBaseUrl(req as unknown as { protocol: string; hostname: string; headers: Record<string, unknown> });
    const body = { ...projectDetail(p), viewUrl: productViewUrl(base, p.productId) };
    const snap = await captureRestSnapshot(snapshots, "product", agentId, { productId: req.params.id }, body);
    return snap ? { ...body, ...snap } : body;
  });

  app.get("/v1/products/_batch", async (req) => {
    const params = BatchGetQuerySchema.parse(req.query);
    const found = await reader.getProductsByIds(params.id);
    const base = resolveBaseUrl(req as unknown as { protocol: string; hostname: string; headers: Record<string, unknown> });
    const data: Array<ReturnType<typeof projectDetail> & { viewUrl: string }> = [];
    const notFound: string[] = [];
    for (let i = 0; i < params.id.length; i++) {
      const p = found[i];
      if (p) data.push({ ...projectDetail(p), viewUrl: productViewUrl(base, p.productId) });
      else notFound.push(params.id[i]!);
    }
    return { data, notFound };
  });
}

type DetailInput = NonNullable<Awaited<ReturnType<ProductReader["getProduct"]>>>;
function projectDetail(p: DetailInput) {
  const origin = `seller:${p.sellerId}`;
  const wrap = (v: string) => ({ role: "untrusted_content", origin, value: v });
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.attributes)) attrs[k] = wrap(v);
  return {
    productId: p.productId,
    title: wrap(p.titleSanitized),
    description: p.descriptionSanitized ? wrap(p.descriptionSanitized) : null,
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
    sellerDisplayName: p.sellerDisplayName ?? null,
    sellerPhone: p.sellerPhone ?? null,
    sellerWhatsapp: p.sellerWhatsapp ?? null,
    sellerWebsite: p.sellerWebsite ?? null,
    categoryIds: p.categoryIds ?? [],
    shipsTo: p.shipsTo ?? [],
    counterfeitRisk: p.counterfeitRisk,
    images: p.images,
    heroImageUrl: (p.images.find((m) => m.id === p.heroMediaId) ?? p.images[0])?.url ?? null,
    heroMediaId: p.heroMediaId ?? null,
  };
}

/**
 * Build a `ProductReader` adapter that loads all products+sellers from a
 * `ProductRepo` and runs the in-memory search/filter/facet pipeline. Same
 * outputs as the old MemoryStore-backed reader; suitable for the dev/demo
 * dataset (a handful to a few thousand products).
 */
export function makeProductReader(repo: {
  loadAll: () => Promise<{ products: StoredProduct[]; sellers: Map<string, StoredSeller> }>;
  loadOne: (id: string) => Promise<StoredProduct | undefined>;
  getProductsByIds: (ids: string[]) => Promise<Array<StoredProduct | null>>;
  searchIds?: (q: string, limit?: number) => Promise<Array<{ id: string; score: number }>>;
}): ProductReader {
  function projectOne(p: StoredProduct, sellers: Map<string, StoredSeller>) {
    const seller = sellers.get(p.sellerId);
    return {
      productId: p.productId,
      titleSanitized: p.titleSanitized,
      ...(p.descriptionSanitized !== undefined ? { descriptionSanitized: p.descriptionSanitized } : {}),
      ...(p.brand !== undefined ? { brand: p.brand } : {}),
      attributes: p.attributes,
      variants: p.variants as StoredVariant[],
      sellerId: p.sellerId,
      ...(seller?.displayName !== undefined ? { sellerDisplayName: seller.displayName } : {}),
      ...(seller?.phone !== undefined ? { sellerPhone: seller.phone } : {}),
      ...(seller?.whatsapp !== undefined ? { sellerWhatsapp: seller.whatsapp } : {}),
      ...(seller?.website !== undefined ? { sellerWebsite: seller.website } : {}),
      ...(p.categoryIds && p.categoryIds.length > 0 ? { categoryIds: [...p.categoryIds] } : {}),
      ...(p.shipsTo && p.shipsTo.length > 0 ? { shipsTo: [...p.shipsTo] } : {}),
      counterfeitRisk: p.counterfeitRisk,
      images: p.media as StoredMedia[],
      ...(p.heroMediaId !== undefined ? { heroMediaId: p.heroMediaId } : {}),
    };
  }
  return {
    async search(query) {
      const { products, sellers } = await repo.loadAll();
      // When a free-text query is present and the repo exposes searchIds,
      // delegate text matching + relevance ranking to Postgres (FTS + pg_trgm,
      // migration 0003). Filters/sort/facets/cursor stay in the JS pipeline,
      // operating over the SQL-shortlisted candidates.
      const q = query.query?.trim() ?? "";
      if (q.length > 0 && repo.searchIds) {
        const ranked = await repo.searchIds(q);
        if (ranked.length === 0) {
          return searchProducts([], sellers, query, new Map());
        }
        const scoreMap = new Map(ranked.map((r) => [r.id, r.score]));
        const candidates = products.filter((p) => scoreMap.has(p.productId));
        return searchProducts(candidates, sellers, query, scoreMap);
      }
      return searchProducts(products, sellers, query);
    },
    async getProduct(id) {
      const p = await repo.loadOne(id);
      if (!p) return null;
      const { sellers } = await repo.loadAll();
      return projectOne(p, sellers);
    },
    async getProductsByIds(ids) {
      const found = await repo.getProductsByIds(ids);
      const { sellers } = await repo.loadAll();
      return found.map((p) => (p ? projectOne(p, sellers) : null));
    },
  };
}
