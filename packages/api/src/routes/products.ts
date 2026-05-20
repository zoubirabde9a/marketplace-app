// REST surface for /v1/products — spec §5.1.

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { catalog } from "@marketplace/domain";
import { NotFoundError, UnauthorizedError } from "@marketplace/shared/errors";
import { Iso3166Alpha2Schema } from "@marketplace/shared/country";
import { createLogger } from "@marketplace/shared/logger";
import {
  sanitizeUntrustedString,
  FIELD_LIMITS,
  safeOrigin,
  isForbiddenAttrKey,
} from "@marketplace/shared/untrusted";

const log = createLogger("api-products");
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
  // Bound per-element length AND the array fan-out at the gate. Pre-fix a
  // caller could spam `?category=a&category=b…` ad infinitum, each entry
  // any length, and the downstream filter would scan all products against
  // the full set — O(filters × products) per request. 20 mirrors the
  // catalog domain SearchQuerySchema (catalog/types.ts) so REST and MCP
  // search surfaces accept the same shape.
  category: z
    .union([z.string().max(120), z.array(z.string().max(120)).max(20)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  categoryId: z
    .union([z.string().max(120), z.array(z.string().max(120)).max(20)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  brand: z.string().max(120).optional(),
  sellerId: z
    .union([z.string().max(120), z.array(z.string().max(120)).max(20)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  // Non-negative bigint. A negative `priceMin` would match every product
  // (nobody has a negative-priced variant) so the filter is effectively
  // a no-op — but the no-op is silent, so a caller debugging "why are
  // none of my products filtered out" wouldn't know they typo'd the
  // value. Fail at the gate.
  priceMin: z.coerce.bigint().nonnegative().optional(),
  priceMax: z.coerce.bigint().nonnegative().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  // ISO 3166-1 alpha-2 validated. The cart restriction gate (pass #7),
  // checkout schemas (pass #51), seller writes (passes #44/#48), and the
  // MCP equivalents all validate against the same allow-list — but the
  // search-param parser was left accepting any 2-letter pair, the last
  // drift point in the chain. A caller passing `?shipsTo=XX` previously
  // got back zero results with no error signal.
  shipsTo: Iso3166Alpha2Schema.optional(),
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
    // Cap the inner array at 50 (mirrors the pipe-output max below). The
    // pipe still enforces it after dedup, but capping here avoids
    // building a 10000-entry array just to reject it after — and the
    // error message points at the array form rather than the dedup
    // output.
    id: z
      .union([z.string().min(1).max(64), z.array(z.string().min(1).max(64)).max(50)])
      .transform((v) => (Array.isArray(v) ? v : [v]))
      .optional(),
    ids: z.string().min(1).max(2048).optional(),
  })
  .transform((q) => {
    const fromIds = q.ids ? q.ids.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : [];
    // De-duplicate (preserving first-seen order). Without this, a request
    // like `?id=A&id=A` would produce two identical entries in `data`, and
    // a missing id duplicated would appear twice in `notFound` — surprising
    // to agents that diff input ↔ output IDs to decide which to retry.
    // Also bounds the DB getProductsByIds cost at exactly the number of
    // distinct ids the caller actually meant.
    const combined = [...(q.id ?? []), ...fromIds];
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const id of combined) {
      if (!seen.has(id)) {
        seen.add(id);
        deduped.push(id);
      }
    }
    return { id: deduped };
  })
  .pipe(z.object({ id: z.array(z.string().min(1).max(64)).min(1).max(50) }));

// Hard cap on `attr.*` filters per query. A caller spamming
// `?attr.a=1&attr.b=2&...&attr.zz=99` would otherwise build an unbounded
// filter map that the downstream catalog filter walks per-product —
// O(filters × products) work per request. 32 covers any realistic
// faceted-search use; anything past is either a typo / probe / DoS.
const MAX_ATTR_FILTERS = 32;

function extractAttributeFilters(rawQuery: unknown): Record<string, string> | undefined {
  if (!rawQuery || typeof rawQuery !== "object") return undefined;
  // Use a null-prototype map. The key is derived from URL params
  // (`?attr.<KEY>=value`), so a caller submitting `?attr.__proto__=evil`
  // would otherwise land `out.__proto__ = "evil"` on a regular `{}`, and
  // downstream filter logic doing `attrs[key]` lookups or iterating
  // `Object.entries(attrs)` would surface the dangerous key in catalog
  // filter / response. Skip the prototype-pollution-prone names entirely.
  // Same defense as the catalog sanitiser / product repo (passes #162/#163).
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [k, v] of Object.entries(rawQuery as Record<string, unknown>)) {
    if (!k.startsWith("attr.")) continue;
    const key = k.slice("attr.".length);
    if (key.length === 0 || key.length > 64) continue;
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string" && value.length > 0 && value.length <= 200) {
      out[key] = value;
      if (Object.keys(out).length >= MAX_ATTR_FILTERS) break;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const MediaInputSchema = z.object({
  // Zod's `.url()` accepts any WHATWG-valid URL including `javascript:`,
  // `data:`, `file:`, `vbscript:` — all of which are XSS / local-disclosure
  // vectors when an `<img src>` on the storefront ends up rendering them.
  // Allow-list: absolute http(s) URLs, OR same-origin `/v1/media/<filename>`
  // paths produced by our own POST /v1/media upload endpoint (the seller
  // dashboard flow). Same-origin paths are safe — they can only resolve to
  // our own media handler and the filename grammar is enforced server-side.
  url: z
    .string()
    .max(2048)
    .refine(
      (u) => /^https?:\/\/\S+$/i.test(u) || /^\/v1\/media\/[a-z0-9][a-z0-9.-]*$/i.test(u),
      { message: "media_url_scheme_not_allowed" },
    ),
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

// Shared price-minor schema for product variants: strictly positive bigint.
// A 0/negative price slipped past the previous `z.coerce.bigint()` and would
// either render as "Free" on the storefront (zero) or — for a single-line
// cart with a negative variant — drive the cart subtotal negative. Catch at
// the boundary, matching the cart-domain `addLine` guard from pass #11.
const PositivePriceMinor = z
  .coerce.bigint()
  .refine((v) => v > 0n, { message: "must be > 0" });

// `shipsTo` is an array of ISO 3166-1 alpha-2 country codes. The cart-side
// restricted-items gate validates the same way (pass #7); REST product writes
// used to accept any 2-letter string ("XX", "!!"), creating a drift where a
// seller could mark a listing as shipping to a country the buyer-side gate
// would never recognise.
const ShipsToSchema = z.array(Iso3166Alpha2Schema).max(250);

// Bound the attribute map at the gate. Pre-fix `z.record(z.string(),
// z.string())` accepted any number of attributes with any key/value
// length — a single malicious POST could ship 10 MB of attribute data
// that the sanitiser would then iterate. 32 attributes mirrors
// MAX_ATTR_FILTERS on the search side (catalog/types.ts pass #87) so
// the write-side ceiling matches the read-side filter ceiling. Key and
// value caps mirror the MCP seller.preview_listing tool (pass #89) and
// the FIELD_LIMITS.productAttribute used by the sanitiser.
const AttributesSchema = z
  .record(z.string().max(64), z.string().max(1024))
  .refine((v) => Object.keys(v).length <= 32, { message: "at_most_32_attributes" });

const CreateProductSchema = z.object({
  sellerId: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  brand: z.string().max(120).optional(),
  attributes: AttributesSchema.optional(),
  categoryIds: z.array(z.string().min(1).max(120)).max(20).optional(),
  shipsTo: ShipsToSchema.optional(),
  // Cap variants per listing. A real product has at most a few dozen SKU
  // variants (size × color matrices); 200 leaves headroom while bounding
  // the create-product write transaction. Matches the MCP seller-write
  // gate (pass #102) so REST and MCP enforce the same ceiling.
  variants: z
    .array(
      z.object({
        sku: z.string().min(1).max(64),
        priceMinor: PositivePriceMinor,
        currency: z.string().regex(/^[A-Z]{3}$/),
        inStock: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
  // Media is required at creation. The catalog filter (catalog/filter.ts)
  // hides any product without media from every browse surface, so allowing
  // a media-less create produces an instantly-invisible listing — including
  // from the seller's own dashboard. The constraint here matches that read
  // invariant. See deploy/CHANGELOG.md 2026-05-13.
  media: z.array(MediaInputSchema).min(1).max(20),
  heroMediaIndex: z.number().int().nonnegative().optional(),
}).refine(
  // Out-of-bounds heroMediaIndex would silently fall back to media[0] in the
  // repo — the agent sees a "success" but the wrong image is hero. Reject early
  // with a clear error so the caller fixes the index.
  (d) => d.heroMediaIndex === undefined || d.heroMediaIndex < d.media.length,
  { path: ["heroMediaIndex"], message: "heroMediaIndex must be < media.length" },
);

const UpdateProductSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  attributes: AttributesSchema.optional(),
  categoryIds: z.array(z.string().min(1).max(120)).max(20).optional(),
  // Mirror the CreateProductSchema validation — same ISO country code list +
  // same positive-only variant prices + same variant-array cap. Without
  // this, the create-time guards could be bypassed via a follow-up PATCH.
  shipsTo: ShipsToSchema.optional(),
  variants: z
    .array(
      z.object({
        sku: z.string().min(1).max(64),
        priceMinor: PositivePriceMinor,
        currency: z.string().regex(/^[A-Z]{3}$/),
        inStock: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200)
    .optional(),
});

// Where uploaded media bytes live on disk inside the api container.
// The compose file bind-mounts /var/lib/marketplace/media → /data/media so
// the volume survives container recreate. Override with $MARKETPLACE_MEDIA_DIR
// in tests / non-prod envs (the var also lets the directory move without a
// code change if we ever migrate to a different mount point).
function mediaDir(): string {
  return process.env.MARKETPLACE_MEDIA_DIR ?? "/data/media";
}

// Public URL path under which uploaded files are served. The api also serves
// them (GET /v1/media/:filename below) so Caddy proxies them through and
// Cloudflare can edge-cache by URL. The filename includes the content hash
// of the bytes, so we can serve with `immutable` cache-control.
const MEDIA_URL_PREFIX = "/v1/media";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function extForContentType(ct: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
  };
  return map[ct.toLowerCase()] ?? ".bin";
}

/**
 * Returns true when the bytes' magic-byte signature matches the kind the
 * caller declared (`png`, `jpeg`, `webp`, `gif`, `avif`). Defends against
 * the "claim image/png, upload arbitrary bytes" pattern — the multipart
 * `mimetype` field comes from the client and is fully forgeable.
 */
function detectedKindMatches(buf: Buffer, claimedKind: string): boolean {
  if (buf.length < 12) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return claimedKind === "png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return claimedKind === "jpeg";
  }
  // GIF87a / GIF89a: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return claimedKind === "gif";
  }
  // RIFF....WEBP — 4-byte "RIFF" + 4-byte size + 4-byte "WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return claimedKind === "webp";
  }
  // AVIF/HEIF brand box: bytes 4..7 = "ftyp"; bytes 8..11 indicate the brand.
  // The comment used to claim "we accept any of these when caller claimed
  // avif" but the code only verified the `ftyp` atom and returned true for
  // ANY brand — so an attacker could upload an MP4/MOV/3GP (also `ftyp`-
  // prefixed but with brand `isom`/`mp42`/`qt  `), declare it as image/avif,
  // and have it land at `/v1/media/<hash>.avif` served with
  // `content-type: image/avif`. Browsers won't render the video as an image
  // but the bytes now sit on a teno-store-trusted URL — useful for malware
  // delivery / phishing redirects. Now actually check the brand bytes
  // against the HEIF-image-family allow-list.
  if (
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
  ) {
    if (claimedKind !== "avif") return false;
    const brand = buf.subarray(8, 12).toString("ascii");
    return brand === "avif" || brand === "avis"
      || brand === "mif1" || brand === "msf1"
      || brand === "heic" || brand === "heix";
  }
  return false;
}

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

  // ── POST /v1/media ─────────────────────────────────────────────────────
  // Single-image upload. Multipart form-data with field name "file". Writes
  // bytes to {mediaDir}/<contentHash>.<ext> (content-addressed, so re-uploading
  // the same image is a no-op deduplication) and returns the canonical URL.
  // Idempotency-key not required (the content hash IS the idempotency key —
  // exempted in server.ts).
  app.post("/v1/media", async (req, reply) => {
    requirePrincipal(req);
    const part = await req.file();
    if (!part) {
      void reply.code(400);
      return { error: "missing_file", detail: "Expected a multipart file part named 'file'." };
    }
    const ct = (part.mimetype ?? "").toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(ct)) {
      void reply.code(415);
      return { error: "unsupported_media_type", detail: `Content-Type ${ct || "(none)"} not allowed.` };
    }
    const buf = await part.toBuffer();
    if (buf.length === 0) {
      void reply.code(400);
      return { error: "empty_file" };
    }
    if (buf.length > MAX_UPLOAD_BYTES) {
      void reply.code(413);
      return { error: "file_too_large", detail: `Max ${MAX_UPLOAD_BYTES} bytes.` };
    }
    // Magic-byte validation: the multipart `mimetype` is caller-supplied and
    // trivially spoofable. Without this check an attacker could declare
    // `image/png` and upload HTML / JS / arbitrary bytes; the file would
    // land on our domain at /v1/media/<hash>.png and we'd serve it back
    // with `content-type: image/png` (derived from the extension). Browsers
    // mostly honour the content-type, but the file is now hosted at a
    // teno-store-trusted URL — useful for phishing payloads, malicious
    // browser-side injection on legacy clients, and side-channels that
    // expect "this URL is a real image". Reject before write.
    const claimedKind = ct.replace(/^image\//, "");
    if (!detectedKindMatches(buf, claimedKind)) {
      void reply.code(415);
      return {
        error: "content_type_mismatch",
        detail: `Bytes do not match declared content-type ${ct}.`,
      };
    }
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
    const filename = `${hash}${extForContentType(ct)}`;
    const dir = mediaDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, filename);
    // Content-addressed: skip the write if the file already exists.
    let exists = false;
    try {
      await stat(path);
      exists = true;
    } catch {
      // ENOENT — fall through to write.
    }
    if (!exists) {
      await writeFile(path, buf);
    }
    void reply.code(201);
    return {
      url: `${MEDIA_URL_PREFIX}/${filename}`,
      contentType: ct,
      byteSize: buf.length,
    };
  });

  // ── GET /v1/media/:filename ────────────────────────────────────────────
  // Static-file passthrough so the api is the canonical origin for image
  // bytes (Caddy proxies and Cloudflare edge-caches by URL). Filenames are
  // content-addressed, so `immutable` is safe — the bytes for a given name
  // will never change.
  app.get("/v1/media/:filename", async (req, reply) => {
    const { filename } = req.params as { filename: string };
    // Defence against path-traversal: only accept [a-z0-9.-]+ filenames, and
    // resolve against the media dir to verify the resolved path stays inside.
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(filename)) {
      void reply.code(400);
      return { error: "bad_filename" };
    }
    const dir = resolve(mediaDir());
    const path = resolve(join(dir, filename));
    if (!path.startsWith(dir + "/") && path !== dir) {
      void reply.code(400);
      return { error: "bad_filename" };
    }
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(path);
    } catch {
      void reply.code(404);
      return { error: "not_found" };
    }
    if (!info.isFile()) {
      void reply.code(404);
      return { error: "not_found" };
    }
    const ext = extname(filename).toLowerCase();
    const ctByExt: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".avif": "image/avif",
    };
    void reply.header("content-type", ctByExt[ext] ?? "application/octet-stream");
    void reply.header("content-length", String(info.size));
    // Filenames are content-hashed, so the bytes can never change for a
    // given URL. Long-cache + immutable is safe. Public so CF / Caddy can
    // cache and serve repeat requests without hitting origin.
    void reply.header("cache-control", "public, max-age=31536000, immutable");
    // Defense-in-depth against MIME-sniffing-based content-type override.
    // The POST path validates magic bytes so the stored content matches the
    // declared type, but `nosniff` blocks browsers from second-guessing the
    // content-type we send — a legacy bytes file pre-dating the magic-byte
    // check, or a future content-type the validator doesn't recognise,
    // can't be sniffed into HTML/JS execution on the rendering side.
    void reply.header("x-content-type-options", "nosniff");
    return reply.send(createReadStream(path));
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

  // ── PATCH /v1/products/:id ─────────────────────────────────────────────
  // Field update for an existing product. Owner-authed. Media adds/removes
  // go through the dedicated /media subroutes below so a typo in this body
  // can't accidentally orphan image rows.
  app.patch("/v1/products/:id", async (req, reply) => {
    const principal = requirePrincipal(req);
    const { id } = req.params as { id: string };
    const body = UpdateProductSchema.parse(req.body);
    const existing = await deps.products.loadOne(id);
    if (!existing) throw new NotFoundError("product", id);
    if (existing.sellerId === null) throw new UnauthorizedError("orphan_product_not_editable");
    const seller = await deps.sellers.get(existing.sellerId);
    if (!seller) throw new NotFoundError("seller", existing.sellerId);
    if (seller.ownerAgentId !== principal.agentId) {
      throw new UnauthorizedError("not_seller_owner");
    }
    const patch: Parameters<ProductRepo["update"]>[1] = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.brand !== undefined) patch.brand = body.brand;
    if (body.attributes !== undefined) patch.attributes = body.attributes;
    if (body.categoryIds !== undefined) patch.categoryIds = body.categoryIds;
    if (body.shipsTo !== undefined) patch.shipsTo = body.shipsTo;
    if (body.variants !== undefined) {
      patch.variants = body.variants.map((v) => ({
        sku: v.sku,
        priceMinor: v.priceMinor,
        currency: v.currency,
        ...(v.inStock !== undefined ? { inStock: v.inStock } : {}),
      }));
    }
    const updated = await deps.products.update(id, patch);
    if (!updated) throw new NotFoundError("product", id);
    void reply.code(200);
    return {
      productId: updated.productId,
      sellerId: updated.sellerId,
      title: updated.titleSanitized,
      brand: updated.brand,
      variants: updated.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        priceMinor: v.priceMinor.toString(),
        currency: v.currency,
        inStock: v.inStock,
      })),
      images: updated.media,
      heroMediaId: updated.heroMediaId ?? null,
      updatedAt: new Date().toISOString(),
    };
  });

  // ── POST /v1/products/:id/media ────────────────────────────────────────
  // Attach an already-uploaded media URL (from POST /v1/media) to a product.
  // Owner-authed. Returns the updated product including the new media row.
  app.post("/v1/products/:id/media", async (req, reply) => {
    const principal = requirePrincipal(req);
    const { id } = req.params as { id: string };
    const body = MediaInputSchema.parse(req.body);
    const existing = await deps.products.loadOne(id);
    if (!existing) throw new NotFoundError("product", id);
    if (existing.sellerId === null) throw new UnauthorizedError("orphan_product_not_editable");
    const seller = await deps.sellers.get(existing.sellerId);
    if (!seller || seller.ownerAgentId !== principal.agentId) {
      throw new UnauthorizedError("not_seller_owner");
    }
    // Fast pre-check; the actual cap is enforced atomically inside
    // `addMedia` (db/repos/product.ts pass #157) to close the race where
    // two concurrent POSTs each saw length=19 and both inserted.
    if (existing.media.length >= 20) {
      void reply.code(409);
      return { error: "media_limit", detail: "A product can hold at most 20 images." };
    }
    const added = await deps.products.addMedia(id, {
      url: body.url,
      contentType: body.contentType,
      ...(body.byteSize !== undefined ? { byteSize: body.byteSize } : {}),
      ...(body.width !== undefined ? { width: body.width } : {}),
      ...(body.height !== undefined ? { height: body.height } : {}),
      ...(body.altText !== undefined ? { altText: body.altText } : {}),
    });
    if (added === "media_cap_exceeded") {
      // Race lost — another concurrent POST landed first and the cap is
      // now hit. Same 409 the pre-check returns.
      void reply.code(409);
      return { error: "media_limit", detail: "A product can hold at most 20 images." };
    }
    if (added === undefined) {
      // Product was removed between the outer loadOne and the inner
      // transaction. Surface 404 instead of a misleading 201 with an
      // empty body. (Product deletion isn't surfaced via the API today,
      // but the repo path can still produce this case for in-process
      // races and future surfaces.)
      throw new NotFoundError("product", id);
    }
    void reply.code(201);
    return added;
  });

  // ── DELETE /v1/products/:id/media/:mediaId ─────────────────────────────
  // Detach an image. Refuses to delete the last image on a product so the
  // catalog-filter invariant (media.length >= 1 for visible products) holds.
  app.delete("/v1/products/:id/media/:mediaId", async (req, reply) => {
    const principal = requirePrincipal(req);
    const { id, mediaId } = req.params as { id: string; mediaId: string };
    const existing = await deps.products.loadOne(id);
    if (!existing) throw new NotFoundError("product", id);
    if (existing.sellerId === null) throw new UnauthorizedError("orphan_product_not_editable");
    const seller = await deps.sellers.get(existing.sellerId);
    if (!seller || seller.ownerAgentId !== principal.agentId) {
      throw new UnauthorizedError("not_seller_owner");
    }
    // The "refuse to delete the last image" invariant is now enforced
    // atomically inside `removeMedia` (db/repos/product.ts pass #156) so
    // two concurrent DELETEs on distinct mediaIds can't both pass a
    // pre-check, both commit, and leave the product with zero media.
    // Keep this fast pre-check as a cheap "no" path: it avoids the
    // transaction overhead when the answer is obvious, while the
    // atomic check inside the repo handles the race.
    if (existing.media.length <= 1) {
      void reply.code(409);
      return {
        error: "last_image",
        detail: "Refusing to delete the only image on this product. Upload a replacement first, then delete this one.",
      };
    }
    const result = await deps.products.removeMedia(id, mediaId);
    if (result === "not_found") {
      void reply.code(404);
      return { error: "not_found", detail: "Image is not on this product." };
    }
    if (result === "last_image") {
      // Race lost — another concurrent DELETE landed first and now this
      // is the last image. Same 409 the pre-check returns.
      void reply.code(409);
      return {
        error: "last_image",
        detail: "Refusing to delete the only image on this product. Upload a replacement first, then delete this one.",
      };
    }
    void reply.code(204);
    return "";
  });

  // ── DELETE /v1/products/:id ────────────────────────────────────────────
  // Soft-delete a product (flips its status to "removed"). Owner-authed.
  // Hard DELETE is intentionally not used — order_items.variant_id has no
  // ON DELETE CASCADE, so purging a previously-ordered product would
  // violate the FK constraint AND erase order history. Soft-delete takes
  // the product out of every search/browse surface (every read filters
  // status='active') while preserving referential integrity.
  app.delete<{ Params: { id: string } }>("/v1/products/:id", async (req, reply) => {
    const principal = requirePrincipal(req);
    const { id } = req.params;
    const result = await deps.products.softDelete(id, principal.agentId);
    if (result === "not_found") {
      void reply.code(404);
      return { error: "not_found", detail: `product ${id} not found` };
    }
    if (result === "not_owned") {
      throw new UnauthorizedError("not_seller_owner");
    }
    // "already_removed" → idempotent 204 (the caller's intent is satisfied).
    void reply.code(204);
    return "";
  });
}

function resolveBaseUrl(req: { protocol: string; hostname: string; headers: Record<string, unknown> }): string {
  const fromEnv = process.env.MARKETPLACE_PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // Use `req.hostname` (not the raw `Host` header) so trustProxy=true in
  // server.ts properly mediates X-Forwarded-Host. Reading the header
  // directly bypassed that gate — an attacker reaching the origin could
  // poison Host and steer the URLs we return back into product responses
  // toward their domain. Same fix already applied in well-known.ts
  // (discovery doc) and auth.ts (DPoP htu binding).
  return `${req.protocol}://${req.hostname}`;
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
  // Snapshots are observational — losing one breaks the audit trail for
  // that call, not the call itself. A snapshot-store outage (Redis down,
  // disk full) must NOT take down search / get-product / by-ids on the
  // REST surface. Log + return undefined so the route response just
  // omits the snapshot link. Same fix already applied to the MCP-side
  // captureSnapshot in pass #8; this is its REST-side sibling, uncovered
  // because the function lives in a different file.
  try {
    await store.put({
      id,
      kind,
      input,
      output,
      ...(agentId !== "anonymous" ? { agentId } : {}),
      createdAt,
      expiresAt,
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), kind, agentId },
      "rest_snapshot_capture_failed",
    );
    return undefined;
  }
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
        // Combine the two equivalent input forms (`?category=…&categoryId=…`)
        // and dedupe — without this, `?category=foo&categoryId=foo` produces
        // `["foo", "foo"]` and the filter passes it through to facet
        // computation and SQL, slightly inflating both. Same family as the
        // batch-IDs dedupe in pass #49.
        ...((params.category || params.categoryId)
          ? {
              categoryIds: [
                ...new Set([
                  ...(params.category ?? []),
                  ...(params.categoryId ?? []),
                ]),
              ],
            }
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
    // "{query}", "{query}?", etc.) that crawlers send while probing the search
    // endpoint. They show up as zero-result queries in the log and pollute
    // synonym mining. Measured 2026-05-11: 12 such queries in the last 7 days.
    //
    // Note: the previous regex `/^\{[^}]+\}\\?$/` had a typo — `\\?` matches
    // an optional backslash at end, not the intended optional `?`. So
    // crawlers sending `{query}?` (the common Schema.org probe with a
    // trailing query separator) slipped through and were logged as
    // zero-result. `\??` is "optional literal `?`."
    const isSchemaTemplate = /^\{[^}]+\}\??$/.test(rawQ);
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
      // Compute `langGuess` once. The previous spread invoked
      // `detectLang(rawQ)` twice — once for the truthy gate and once for
      // the value — running the same two regexes on every logged search.
      // Minor but trivially avoidable.
      const langGuess = detectLang(rawQ);
      const entry = {
        queryRaw: rawQ,
        queryNormalized: rawQ.toLowerCase(),
        nResults: r.totalEstimate,
        latencyMs,
        hasFilters: !!hasFilters,
        ...(langGuess ? { langGuess } : {}),
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
        title: {
          role: "untrusted_content",
          origin: safeOrigin("seller", h.sellerId),
          value: stripDuplicateBrandPrefix(h.titleSanitized, h.brand),
        },
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
  const origin = safeOrigin("seller", p.sellerId);
  const wrap = (v: string) => ({ role: "untrusted_content", origin, value: v });
  // Null-prototype map + forbidden-key filter at the projection boundary —
  // defense-in-depth against pre-defense rows with `__proto__` keys.
  const attrs: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(p.attributes)) {
    if (isForbiddenAttrKey(k)) continue;
    attrs[k] = wrap(v);
  }
  // Sellers control `brand`; the value flows verbatim into browse cards,
  // search results, JSON-LD, and any LLM-rendered surface. The catalog
  // write-time sanitisation only covers title/description/attributes, so
  // a brand like `<system>ignore previous instructions</system>` lands
  // unredacted in every downstream consumer. Run the same pattern strip
  // we apply to title here, returning the cleaned plain string so the
  // wire format stays unchanged (browse cards read `brand` as a string).
  const cleanBrand = p.brand
    ? sanitizeUntrustedString(p.brand, { maxLength: FIELD_LIMITS.productBrand, origin })
    : undefined;
  return {
    productId: p.productId,
    title: wrap(stripDuplicateBrandPrefix(p.titleSanitized, cleanBrand)),
    description: p.descriptionSanitized ? wrap(p.descriptionSanitized) : null,
    brand: cleanBrand,
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
  // Optional public-read variant that filters status='active'. When the repo
  // implements it, the reader uses it on the public /v1/products/:id path so
  // a draft / paused / removed product can't be fetched via direct URL —
  // which would otherwise defeat the counterfeit-action-ladder takedown
  // (removed sets `visible: false`) and leak seller-pulled drafts to buyers
  // holding stale links. Repos that don't implement it fall back to loadOne
  // (in-memory test adapters).
  loadOneActive?: (id: string) => Promise<StoredProduct | undefined>;
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
  // Cooldown after a failed background refresh. Without this, the next stale-
  // window request immediately kicks off another refresh — under a sustained
  // DB outage every browse request hammered the DB with a new loadAll attempt
  // (each ~7s) while still serving stale. 30s of "serve stale, don't retry"
  // matches typical infra-recovery times without pinning the cache forever.
  const BROWSE_FAILURE_COOLDOWN_MS = 30_000;
  type BrowseValue = { products: StoredProduct[]; sellers: Map<string, StoredSeller> };
  let browseCache: { value: BrowseValue; refreshedAt: number } | null = null;
  let browseRefreshInFlight: Promise<BrowseValue> | null = null;
  let browseRefreshCooldownUntil = 0;
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
      // would just overwrite). Also skip if we're inside the failure cooldown
      // — repeatedly kicking off refreshes against a down DB hurts more than
      // it helps; serve stale instead.
      if (!browseRefreshInFlight && now >= browseRefreshCooldownUntil) {
        browseRefreshInFlight = refreshBrowseCache()
          .catch(() => {
            // Refresh failed (DB outage, network blip). Don't overwrite
            // browseCache.value — the stale value is still our best answer.
            // Set a cooldown so the next stale request doesn't immediately
            // retry. Returning the stale value keeps the in-flight promise's
            // catch happy.
            browseRefreshCooldownUntil = Date.now() + BROWSE_FAILURE_COOLDOWN_MS;
            return browseCache?.value ?? ({ products: [], sellers: new Map() } as BrowseValue);
          })
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
      //
      // Cursor-pagination caveat: the fast path pulls only `query.limit` IDs,
      // so a request with a cursor pointing past those would return an empty
      // page even though the seller has more products. Fall through to the
      // wide browse path when a cursor is present so pagination math has
      // access to the full sorted set. Storefront page-1 (no cursor) — the
      // dominant case by far — keeps the fast-path benefit.
      const sellerIds = query.filters?.sellerIds ?? [];
      if (
        repo.idsBySeller &&
        repo.loadSellers &&
        sellerIds.length === 1 &&
        sellerIds[0] !== undefined &&
        !query.cursor
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
        !query.filters?.brand &&
        // Same cursor-pagination caveat as the seller fast path above: the
        // category fast path pulls only `query.limit` IDs, so a cursor
        // pointing past them would return empty. Fall through to the wide
        // browse path when paginating.
        !query.cursor
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
        !query.filters?.attributes &&
        // Same cursor caveat as the seller / category fast paths: the
        // recentIds fast path pulls only `query.limit` rows, so any
        // cursor-paginated request would land on an empty page. Caller
        // pagination falls through to the wide browse path.
        !query.cursor;
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
      // Use the active-only variant when available so non-active listings
      // (draft / paused / removed) 404 on direct fetch — matches the
      // browse-side status filter from loadAll. Falls back to loadOne for
      // in-memory test adapters.
      const p = await (repo.loadOneActive ? repo.loadOneActive(id) : repo.loadOne(id));
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
