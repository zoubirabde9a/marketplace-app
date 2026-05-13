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

// Some scraped Ouedkniss listings carry their brand twice at the start of the
// title ("Honor Honor 400 pro", "VIVO VIVO Y19s") because the original seller
// typed the brand once and the platform also prefixed it once. 257 catalog
// rows in this state today (live probe 2026-05-12). We strip the leading
// duplicate at display time so buyers see a clean title — the underlying
// `title_sanitized` stays as-is so any historical analysis or audit retains
// the seller's original wording.
export function stripDuplicateBrandPrefix(title: string, brand: string | undefined): string {
  if (!brand) return title;
  const b = brand.trim();
  if (b.length === 0) return title;
  // Case-insensitive, brand followed by whitespace, then same brand and a word
  // boundary so we don't eat a real noun that happens to start the same way.
  const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}\\s+(?=${escaped}(?:\\s|$))`, "i");
  return title.replace(re, "");
}

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
    query: catalog.SearchQuery & { fuzzy?: boolean; noFacets?: boolean },
    ctx: { agentId: string },
  ): Promise<SearchResult>;
  getProduct(productId: string, ctx: { agentId: string }): Promise<{
    productId: string;
    titleSanitized: string;
    descriptionSanitized?: string;
    brand?: string;
    attributes: Record<string, string>;
    variants: Array<{ id: string; sku: string; priceMinor: bigint; currency: string; inStock: boolean }>;
    /** null for unowned reference listings — not purchasable. */
    sellerId: string | null;
    sellerDisplayName?: string;
    sellerPhone?: string;
    sellerWhatsapp?: string;
    /** All phone numbers for the seller, primary first; empty when none. */
    sellerPhones?: Array<{ phone: string; isWhatsapp: boolean; isViber: boolean; isPrimary: boolean }>;
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
  // Accept both `category` (web/sitemap canonical) and `categoryId` (matches
  // the field name in product responses, so agents reading a result back and
  // re-querying by `categoryIds[0]` "just work" instead of getting silent
  // empty filters). Either or both can be present; values are merged.
  category: z.union([z.string(), z.array(z.string())]).optional().transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  categoryId: z.union([z.string(), z.array(z.string())]).optional().transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
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
  // Opt-out for callers that don't render facet sidebars (home page "recent
  // listings" strip, internal recommendation strips, agent integrations only
  // wanting hits). Lets the API skip the catalog-wide loadAll when there's
  // also no q/sellerId — at 77k products that was the main source of 11s+
  // cold home-page TTFB spikes measured 2026-05-12.
  noFacets: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "recently_added", "rating"]).default("relevance"),
});

// Accept either repeated `?id=A&id=B` (the canonical form documented in tests)
// or the more conventional `?ids=A,B,C` (CSV). Agents intuit the latter first;
// supporting both means the error message they hit when they get it wrong is
// itself only reached by a real mistake, not a guessing-the-param-name miss.
const BatchGetQuerySchema = z
  .object({
    id: z
      .union([z.string().min(1).max(64), z.array(z.string().min(1).max(64))])
      .transform((v) => (Array.isArray(v) ? v : [v]))
      .optional(),
    ids: z.string().min(1).max(2048).optional(),
  })
  .transform((q) => {
    const fromIds = q.ids ? q.ids.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : [];
    const combined = [...(q.id ?? []), ...fromIds];
    return { id: combined };
  })
  .pipe(z.object({ id: z.array(z.string().min(1).max(64)).min(1).max(50) }));

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

// Set public-read cache policy on a reply based on the calling principal.
// Anonymous reads: edge-cacheable for 60s + SWR 300s. Authenticated calls:
// private no-store so per-agent snapshot audit trails stay fresh.
// Always sets Vary: Authorization — without it, CDNs can serve a cached
// anonymous response to an authenticated agent, breaking the snapshot
// audit. Vary keys the cache entry by presence/value of Authorization,
// so anon ↔ auth never share an entry.
export function applyPublicReadCacheHeaders(
  reply: { header: (name: string, value: string) => unknown },
  agentId: string,
): void {
  if (agentId === "anonymous") {
    void reply.header("cache-control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
  } else {
    void reply.header("cache-control", "private, no-store");
  }
  void reply.header("vary", "Authorization");
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
  app.get("/v1/products", async (req, reply) => {
    const agentId = req.principal?.agentId ?? "anonymous";
    // Public reads (no principal) get an edge-cacheable response so
    // Cloudflare can serve repeated crawler / agent / catalog-browser
    // hits without slamming origin. Authenticated callers get
    // private/no-store so each call writes a fresh per-agent snapshot
    // for audit trail (anonymous snapshots have no agentId attribution
    // and are functionally a verifiable response copy — safe to share
    // across the 60s cache window). Matches the agents.json
    // 'data_freshness: products: 5 min cache' commitment with headroom.
    applyPublicReadCacheHeaders(reply, agentId);
    const params = SearchQueryParamsSchema.parse(req.query);
    const attributes = extractAttributeFilters(req.query);
    const query: catalog.SearchQuery & { fuzzy?: boolean; noFacets?: boolean } = {
      query: params.q ?? "",
      filters: {
        ...((params.category || params.categoryId)
          ? { categoryIds: [...(params.category ?? []), ...(params.categoryId ?? [])] }
          : {}),
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
      ...(params.noFacets ? { noFacets: true } : {}),
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
    // Skip Schema.org SearchAction template placeholders ("{search_term_string}",
    // "{query}", etc.) that crawlers send while probing the search endpoint.
    // They show up as zero-result queries in the log and pollute synonym
    // mining. Measured 2026-05-11: 12 such queries in the last 7 days.
    const isSchemaTemplate = /^\{[^}]+\}\\?$/.test(rawQ);
    if (searchLog && rawQ.length > 0 && !isSchemaTemplate) {
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
        title: { role: "untrusted_content", origin: `seller:${h.sellerId}`, value: stripDuplicateBrandPrefix(h.titleSanitized, h.brand) },
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
        // Surface ingestion time as a separate signal so the web sitemap
        // can emit a recent <lastmod> on URLs that came from old-dated
        // source listings — see updatedAt comment in catalog/search.ts.
        updatedAt: h.updatedAt ?? null,
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

  app.get<{ Params: { id: string } }>("/v1/products/:id", async (req, reply) => {
    const agentId = req.principal?.agentId ?? "anonymous";
    // Same caching policy as the list endpoint: anonymous reads are
    // edge-cacheable (60s + SWR), authenticated calls bypass the CDN
    // so each agent's per-request snapshot is preserved.
    applyPublicReadCacheHeaders(reply, agentId);
    const p = await reader.getProduct(req.params.id, { agentId });
    if (!p) throw new NotFoundError("product", req.params.id);
    const base = resolveBaseUrl(req as unknown as { protocol: string; hostname: string; headers: Record<string, unknown> });
    const body = { ...projectDetail(p), viewUrl: productViewUrl(base, p.productId) };
    const snap = await captureRestSnapshot(snapshots, "product", agentId, { productId: req.params.id }, body);
    return snap ? { ...body, ...snap } : body;
  });

  app.get("/v1/products/_batch", async (req, reply) => {
    const agentId = req.principal?.agentId ?? "anonymous";
    applyPublicReadCacheHeaders(reply, agentId);
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
    title: wrap(stripDuplicateBrandPrefix(p.titleSanitized, p.brand)),
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
    sellerPhones: p.sellerPhones ?? [],
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
  loadSellers?: () => Promise<Map<string, StoredSeller>>;
  loadOne: (id: string) => Promise<StoredProduct | undefined>;
  getProductsByIds: (ids: string[]) => Promise<Array<StoredProduct | null>>;
  searchIds?: (q: string, limit?: number) => Promise<Array<{ id: string; score: number }>>;
  idsBySeller?: (sellerId: string, limit?: number) => Promise<string[]>;
  idsByCategory?: (slug: string, limit?: number) => Promise<string[]>;
  recentIds?: (limit?: number) => Promise<string[]>;
}): ProductReader {
  // Browse-path stale-while-revalidate cache. Empty-query browse pulls every
  // product+variant+media row, hydrates them, JS-filters/sorts/computes
  // facets — order of ~700 row reads on prod just to render a 10-listing
  // page. Caching the hydrated result drops cached browses to microseconds.
  //
  // Two-window SWR (added 2026-05-12). Hard-TTL bumped to 300s earlier still
  // meant one visitor per 5min ate the full 7–10s loadAll on the edge of
  // expiry. Now:
  //   - 0..STALE: cached value served, no work
  //   - STALE..HARD: cached value served, ONE background refresh kicked off
  //   - >HARD: synchronous reload (cold start or background refresh failed)
  // Result: 99.9% of browse hits stay sub-millisecond regardless of when in
  // the cache cycle they land. Only the very first request after a restart
  // pays the loadAll cost. agents.json "products: 5 min cache" contract still
  // honoured — STALE = 300s, data is at most 300s old when served.
  const BROWSE_STALE_MS = 300_000;
  const BROWSE_HARD_MS = 1_500_000; // 25min — refusing to serve data older than this
  type BrowseValue = { products: StoredProduct[]; sellers: Map<string, StoredSeller> };
  let browseCache: { value: BrowseValue; refreshedAt: number } | null = null;
  let browseRefreshInFlight: Promise<BrowseValue> | null = null;
  async function refreshBrowseCache(): Promise<BrowseValue> {
    const fresh = await repo.loadAll();
    browseCache = { value: fresh, refreshedAt: Date.now() };
    return fresh;
  }
  async function loadAllCached(): Promise<BrowseValue> {
    const now = Date.now();
    const age = browseCache ? now - browseCache.refreshedAt : Infinity;
    if (browseCache && age < BROWSE_STALE_MS) return browseCache.value;
    if (browseCache && age < BROWSE_HARD_MS) {
      // Stale-but-usable. Serve immediately, refresh in the background. If a
      // refresh is already in flight, don't queue another (the racing call
      // would just overwrite).
      if (!browseRefreshInFlight) {
        browseRefreshInFlight = refreshBrowseCache()
          .catch(() => browseCache?.value ?? ({ products: [], sellers: new Map() } as BrowseValue))
          .finally(() => { browseRefreshInFlight = null; });
      }
      return browseCache.value;
    }
    // Hard miss (cold boot or stale beyond HARD): wait synchronously. Dedupe
    // concurrent waiters onto the same in-flight load.
    if (!browseRefreshInFlight) {
      browseRefreshInFlight = refreshBrowseCache().finally(() => { browseRefreshInFlight = null; });
    }
    return browseRefreshInFlight;
  }

  // Sellers map cache. getProduct() / getProductsByIds() call repo.loadSellers()
  // on every single request, and loadSellers does SELECT * FROM seller_profiles
  // + SELECT * FROM seller_phones each time (no LIMIT). Live measurement: this
  // pushed warm product-detail TTFB to a steady 380–555ms — there was no warm
  // path at all, every request paid the full sellers scan. 60s tracks how
  // often seller profile data actually changes (almost never via UI; the
  // scraper loop refreshes contact info opportunistically), and a 60s stale
  // window on a phone number / display name is invisible to buyers.
  const SELLERS_TTL_MS = 60_000;
  let sellersCache: { value: Map<string, StoredSeller>; expiresAt: number } | null = null;
  async function loadSellersCached(): Promise<Map<string, StoredSeller>> {
    const now = Date.now();
    if (sellersCache && sellersCache.expiresAt > now) return sellersCache.value;
    if (!repo.loadSellers) {
      // Legacy repo without a sellers-only path; fall back to loadAll.
      return (await repo.loadAll()).sellers;
    }
    const fresh = await repo.loadSellers();
    sellersCache = { value: fresh, expiresAt: now + SELLERS_TTL_MS };
    return fresh;
  }
  function projectOne(p: StoredProduct, sellers: Map<string, StoredSeller>) {
    const seller = p.sellerId ? sellers.get(p.sellerId) : undefined;
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
      ...(seller && seller.phones.length > 0
        ? {
            sellerPhones: seller.phones.map((ph) => ({
              phone: ph.phoneE164,
              isWhatsapp: ph.isWhatsapp,
              isViber: ph.isViber,
              isPrimary: ph.isPrimary,
            })),
          }
        : {}),
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
      const q = query.query?.trim() ?? "";
      // Fast path: when there's a query and the repo can shortlist via SQL
      // (FTS + pg_trgm, migration 0003), skip loadAll entirely and only
      // hydrate the candidates we actually need plus the small sellers map.
      // Cuts per-search DB cost dramatically — at 77k live products a typical
      // query matching <50 candidates trades ~200k row reads (loadAll:
      // products+variants+media) for ~150 (candidates only). The browse path
      // below still pays the loadAll cost; see anomalies report [5].
      if (q.length > 0 && repo.searchIds && repo.loadSellers) {
        const ranked = await repo.searchIds(q);
        if (ranked.length === 0) {
          const sellers = await loadSellersCached();
          return searchProducts([], sellers, query, new Map());
        }
        const ids = ranked.map((r) => r.id);
        const [productsResult, sellers] = await Promise.all([
          repo.getProductsByIds(ids),
          loadSellersCached(),
        ]);
        const scoreMap = new Map(ranked.map((r) => [r.id, r.score]));
        const candidates = productsResult.filter((p): p is StoredProduct => p !== null);
        return searchProducts(candidates, sellers, query, scoreMap);
      }
      // Storefront fast path: no query, one sellerId filter, and the repo
      // supports an indexed lookup. Pulls just that seller's product rows
      // instead of forcing a catalog-wide loadAll() (~77k rows in prod). The
      // wider browse path below loads everything because empty-query callers
      // also want facet coverage across the full catalog — a storefront
      // doesn't (it scopes facets to one seller anyway).
      const sellerIds = query.filters?.sellerIds ?? [];
      if (
        repo.idsBySeller &&
        repo.loadSellers &&
        sellerIds.length === 1 &&
        sellerIds[0] !== undefined
      ) {
        const ids = await repo.idsBySeller(sellerIds[0], query.limit ?? 60);
        if (ids.length === 0) {
          const sellers = await loadSellersCached();
          return searchProducts([], sellers, query);
        }
        const [productsResult, sellers] = await Promise.all([
          repo.getProductsByIds(ids),
          loadSellersCached(),
        ]);
        const candidates = productsResult.filter((p): p is StoredProduct => p !== null);
        return searchProducts(candidates, sellers, query);
      }
      // Category fast path: no query, exactly one category filter, no other
      // narrowing. Mirrors the storefront idsBySeller path — pulls just the
      // matching product rows via the GIN index on category_ids (migration
      // 0010, jsonb_path_ops) instead of paying for catalog-wide loadAll().
      // pg_stat_user_indexes 2026-05-12 showed products_category_ids_gin at
      // 0 scans because no SQL path was using it; this branch is that path.
      // Two-category combinations and category+brand combos still go through
      // the in-memory pipeline because faceting across them is JS-side.
      const categoryIds = query.filters?.categoryIds ?? [];
      if (
        repo.idsByCategory &&
        repo.loadSellers &&
        categoryIds.length === 1 &&
        categoryIds[0] !== undefined &&
        sellerIds.length === 0 &&
        !query.filters?.brand
      ) {
        const ids = await repo.idsByCategory(categoryIds[0], query.limit ?? 60);
        if (ids.length === 0) {
          const sellers = await loadSellersCached();
          return searchProducts([], sellers, query);
        }
        const [productsResult, sellers] = await Promise.all([
          repo.getProductsByIds(ids),
          loadSellersCached(),
        ]);
        const candidates = productsResult.filter((p): p is StoredProduct => p !== null);
        return searchProducts(candidates, sellers, query);
      }
      // Recent-listings fast path: caller explicitly opted out of facets,
      // wants sort=newest, no q, no filter narrowing. Home page "recent
      // listings" strip is the dominant caller — see anomaly [42]. Pulls just
      // the N newest product rows via an indexed SQL query instead of paying
      // for the full catalog hydration. Facets returned are empty by
      // construction since the caller said it didn't need them.
      const wantNewestNoFilters =
        query.noFacets === true &&
        query.sort === "newest" &&
        sellerIds.length === 0 &&
        !query.filters?.brand &&
        !query.filters?.categoryIds?.length &&
        !query.filters?.priceMinMinor &&
        !query.filters?.priceMaxMinor &&
        !query.filters?.currency &&
        !query.filters?.shipsTo &&
        !query.filters?.minRating &&
        !query.filters?.attributes;
      if (wantNewestNoFilters && repo.recentIds && repo.loadSellers) {
        const ids = await repo.recentIds(query.limit ?? 25);
        if (ids.length === 0) {
          const sellers = await loadSellersCached();
          return searchProducts([], sellers, query);
        }
        const [productsResult, sellers] = await Promise.all([
          repo.getProductsByIds(ids),
          loadSellersCached(),
        ]);
        const candidates = productsResult.filter((p): p is StoredProduct => p !== null);
        return searchProducts(candidates, sellers, query);
      }
      // Browse path (no query): loadAll via the SWR cache. Empty-query callers
      // want to see the whole catalog's facet space, not a SQL-shortlisted
      // subset.
      const { products, sellers } = await loadAllCached();
      return searchProducts(products, sellers, query);
    },
    async getProduct(id) {
      const p = await repo.loadOne(id);
      if (!p) return null;
      // Use loadSellersCached() instead of loadAll() — we only need the sellers
      // map for projectOne, not the 77k+ product catalog. Live measurement
      // 2026-05-12: uncached loadSellers ran on every request and held warm
      // detail TTFB at 380–555ms (no warm path at all). The cached path drops
      // that to ~5ms once the 60s seller cache is hot.
      const sellers = await loadSellersCached();
      return projectOne(p, sellers);
    },
    async getProductsByIds(ids) {
      const found = await repo.getProductsByIds(ids);
      const sellers = await loadSellersCached();
      return found.map((p) => (p ? projectOne(p, sellers) : null));
    },
  };
}
