// Seller / product write tools — MCP surface that mirrors POST /v1/sellers and
// POST /v1/products. Lets an MCP client (e.g. Claude Code) onboard a seller and
// publish listings without dropping out to raw HTTP.
//
// The handlers take the same repo interfaces the REST routes use, so we go
// through the same validation and storage code path. Ownership is bound to the
// calling principal's agentId.

import { z } from "zod";
import { NotFoundError, UnauthorizedError, ValidationError } from "@marketplace/shared/errors";
import type { catalog } from "@marketplace/domain";
import type { McpRegistry } from "../registry.js";
import { captureSnapshot, snapshotWebUrl, webBase } from "./snapshot-helpers.js";

function storeWebUrl(sellerId: string): string | undefined {
  const base = webBase();
  return base ? `${base}/store/${encodeURIComponent(sellerId)}` : undefined;
}

function productWebUrl(productId: string): string | undefined {
  const base = webBase();
  return base ? `${base}/product/${encodeURIComponent(productId)}` : undefined;
}

export interface SellerWriteAdapter {
  sellers: {
    create(input: {
      displayName: string;
      ownerAgentId: string;
      phones?: Array<{
        phone: string;
        isWhatsapp?: boolean;
        isViber?: boolean;
        isPrimary?: boolean;
        position?: number;
        source?: string;
      }>;
      /** @deprecated — single-phone shorthand. Pass `phones` for multi-line shops. */
      phone?: string;
      /** @deprecated — pass a phone with `isWhatsapp: true` via `phones`. */
      whatsapp?: string;
      website?: string;
      description?: string;
      supportEmail?: string;
      city?: string;
      countryCode?: string;
    }): Promise<{
      sellerId: string;
      displayName: string;
      ownerAgentId: string;
      phone?: string;
      whatsapp?: string;
      phones: Array<{ phoneE164: string; isWhatsapp: boolean; isViber: boolean; isPrimary: boolean; position: number }>;
      website?: string;
      description?: string;
      supportEmail?: string;
      city?: string;
      countryCode?: string;
      createdAt: number;
    }>;
    get(sellerId: string): Promise<{ sellerId: string; ownerAgentId: string } | undefined>;
    /**
     * Optional. Case-insensitive existence check for a seller already owned by
     * `ownerAgentId` with the same `displayName`. When implemented, the
     * create handler uses it to reject duplicates; when omitted, the check is
     * skipped and create proceeds (in-memory test adapters don't need it).
     */
    findOwnedByName?(ownerAgentId: string, displayName: string): Promise<{ sellerId: string } | undefined>;
  };
  products: {
    create(input: {
      sellerId: string;
      title: string;
      description?: string;
      brand?: string;
      attributes?: Record<string, string>;
      categoryIds?: string[];
      shipsTo?: string[];
      variants: Array<{ sku: string; priceMinor: bigint; currency: string; inStock?: boolean }>;
      media?: Array<{
        url: string;
        contentType: string;
        byteSize?: number;
        width?: number;
        height?: number;
        altText?: string;
      }>;
      heroMediaIndex?: number;
    }): Promise<{
      productId: string;
      sellerId: string;
      titleSanitized: string;
      brand?: string;
      variants: Array<{ id: string; sku: string; priceMinor: bigint; currency: string; inStock: boolean }>;
      media: Array<{ id: string; url: string }>;
      heroMediaId?: string;
      createdAt: number;
    }>;
  };
}

const SellerPhoneInputSchema = z.object({
  phone: z.string().min(5).max(32),
  isWhatsapp: z.boolean().optional(),
  isViber: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
});

// ISO 3166-1 alpha-2 country codes. Frozen at write time; if a future country
// is added internationally update this set rather than relaxing validation.
// Lookup is O(1); the 249-entry list adds ~2KB to the bundle and is fine.
const ISO_3166_1_ALPHA2 = new Set([
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS",
  "BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN",
  "CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE",
  "EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF",
  "GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM",
  "HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM",
  "JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC",
  "LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK",
  "ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA",
  "NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG",
  "PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS",
  "ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO",
  "TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI",
  "VN","VU","WF","WS","YE","YT","ZA","ZM","ZW",
]);

const CreateSellerInput = z
  .object({
    displayName: z.string().min(2).max(120),
    /** Required — ISO 3166-1 alpha-2 country code (e.g. "DZ"). Drives shipping origin + currency hints. */
    countryCode: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase())
      .refine((v) => ISO_3166_1_ALPHA2.has(v), { message: "must be an ISO 3166-1 alpha-2 country code" }),
    /**
     * Single-line shop shorthand. For multi-line shops with separate sales / support /
     * after-sales numbers, pass `phones[]` instead. At least one of `phone` or `phones` is required.
     */
    phone: z.string().min(5).max(32).optional(),
    /** Full phone list with per-number flags (whatsapp, viber, primary). Preferred for multi-line shops. */
    phones: z.array(SellerPhoneInputSchema).min(1).max(10).optional(),
    /** Shorthand for "the primary number is also on WhatsApp". Ignored when `phones[]` is provided. */
    whatsapp: z.string().min(5).max(32).optional(),
    website: z.string().url().optional(),
    /** Short store bio shown on the storefront. */
    description: z.string().min(20).max(1000).optional(),
    supportEmail: z.string().email().optional(),
    city: z.string().min(1).max(120).optional(),
  })
  .refine((d) => Boolean(d.phone) || (Array.isArray(d.phones) && d.phones.length > 0), {
    message: "at least one phone is required: pass `phone` (single number) or `phones[]` (multi-line shop)",
    path: ["phone"],
  });

const SellerPhoneOutputSchema = z.object({
  phone: z.string(),
  isWhatsapp: z.boolean(),
  isViber: z.boolean(),
  isPrimary: z.boolean(),
});

const CreateSellerOutput = z.object({
  sellerId: z.string(),
  displayName: z.string(),
  ownerAgentId: z.string(),
  /** Convenience alias for the primary number. */
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  /** Full normalized phone list (E.164), primary first. */
  phones: z.array(SellerPhoneOutputSchema),
  website: z.string().nullable(),
  description: z.string().nullable(),
  supportEmail: z.string().nullable(),
  city: z.string().nullable(),
  countryCode: z.string().nullable(),
  createdAt: z.string(),
  /** Permanent public storefront URL (no expiry). Where buyers browse this seller's listings. */
  storeUrl: z.string().url().optional(),
  /** Frozen snapshot link a human can open to see exactly what was created. Expires after 24h. */
  snapshotUrl: z.string().url().optional(),
  snapshotCreatedAt: z.number().int().optional(),
  snapshotExpiresAt: z.number().int().optional(),
});

const VariantInput = z.object({
  sku: z.string().min(1).max(64),
  priceMinor: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
  currency: z.string().regex(/^[A-Z]{3}$/),
  inStock: z.boolean().optional(),
});

// Media accepts a URL-only shorthand. If contentType is omitted we infer it
// from the URL extension; that means an agent can pass `{ url: "https://…/x.jpg" }`
// without having to fetch the resource just to learn its mime type.
function inferImageContentType(url: string): string {
  const m = url.toLowerCase().match(/\.(jpe?g|png|webp|gif|avif|svg)(?:\?.*)?$/);
  if (!m) return "image/jpeg";
  const ext = m[1] === "jpg" ? "jpeg" : m[1];
  return ext === "svg" ? "image/svg+xml" : `image/${ext}`;
}

const MediaInput = z
  .object({
    url: z.string().url().max(2048),
    contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i).max(64).optional(),
    byteSize: z.number().int().positive().max(50_000_000).optional(),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    altText: z.string().max(500).optional(),
  })
  .transform((m) => ({ ...m, contentType: m.contentType ?? inferImageContentType(m.url) }));

const CreateProductInput = z.object({
  sellerId: z.string().min(1),
  title: z.string().min(3).max(300),
  /** Required — listings with no description damage buyer trust and search recall. */
  description: z.string().min(30).max(5000),
  brand: z.string().max(120).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  categoryIds: z.array(z.string().min(1).max(120)).max(20).optional(),
  shipsTo: z.array(z.string().length(2)).max(250).optional(),
  variants: z.array(VariantInput).min(1),
  /** Required — at least one publicly fetchable image URL. Listings without images convert poorly and harm storefront quality. */
  media: z.array(MediaInput).min(1).max(20),
  heroMediaIndex: z.number().int().nonnegative().optional(),
});

const CreateProductOutput = z.object({
  productId: z.string(),
  sellerId: z.string(),
  title: z.string(),
  description: z.string(),
  brand: z.string().optional(),
  variants: z.array(
    z.object({
      id: z.string(),
      sku: z.string(),
      priceMinor: z.string(),
      currency: z.string(),
      inStock: z.boolean(),
    }),
  ),
  media: z.array(z.object({ id: z.string(), url: z.string() })),
  heroMediaId: z.string().nullable(),
  /** Permanent public product page (no expiry). Where buyers see this listing. */
  productUrl: z.string().url().optional(),
  /** Permanent public storefront URL for the owning seller. */
  storeUrl: z.string().url().optional(),
  createdAt: z.string(),
  /** Frozen snapshot link a human can open to see exactly what was created. Expires after 24h. */
  snapshotUrl: z.string().url().optional(),
  snapshotCreatedAt: z.number().int().optional(),
  snapshotExpiresAt: z.number().int().optional(),
});

export function registerSellerWriteTools(
  reg: McpRegistry,
  deps: SellerWriteAdapter,
  snapshots?: catalog.SnapshotStore,
): void {
  reg.register({
    name: "seller.create_account",
    description: [
      "Create a seller (store) owned by the calling agent. The caller agent becomes the sole owner.",
      "",
      "Before invoking this tool the agent SHOULD gather these fields from the human user, not invent them:",
      "  - displayName: the store name as the operator wants buyers to see it",
      "  - countryCode: ISO 3166-1 alpha-2 (e.g. DZ for Algeria) — REQUIRED",
      "  - at least one phone number — REQUIRED. Two equivalent shapes:",
      "      a) `phone: \"+213…\"` (+ optional `whatsapp: \"+213…\"`) — single-line shop shorthand",
      "      b) `phones: [{phone, isWhatsapp?, isViber?, isPrimary?, position?}, …]` — multi-line shop",
      "         (recommended when the operator has separate sales / support / after-sales lines).",
      "         All numbers are normalized to E.164 (+213XXXXXXXXX) server-side; pass them in any common form.",
      "  - city: free-text locality (optional but strongly encouraged for buyer trust)",
      "  - website / supportEmail / description (store bio): optional",
      "",
      "Listings without a reachable phone + country are poor-quality on a real marketplace; the schema enforces both.",
    ].join("\n"),
    scope: "seller:write",
    auditEvent: "seller.create_account",
    idempotent: false,
    inputSchema: CreateSellerInput,
    outputSchema: CreateSellerOutput,
    handler: async (input, ctx) => {
      // Normalize the two phone-input shapes into the canonical `phones[]` the
      // repo expects. Single-`phone` form synthesises a one-entry list with
      // is_primary=true and is_whatsapp inferred from whether `whatsapp` was
      // also passed (matching the legacy seeder's behaviour for shops).
      const phones =
        input.phones && input.phones.length > 0
          ? input.phones.map((p, i) => ({
              phone: p.phone,
              ...(p.isWhatsapp !== undefined ? { isWhatsapp: p.isWhatsapp } : {}),
              ...(p.isViber !== undefined ? { isViber: p.isViber } : {}),
              ...(p.isPrimary !== undefined ? { isPrimary: p.isPrimary } : { isPrimary: i === 0 }),
              ...(p.position !== undefined ? { position: p.position } : { position: i }),
              source: "mcp",
            }))
          : input.phone
            ? [
                {
                  phone: input.phone,
                  isWhatsapp: Boolean(input.whatsapp),
                  isPrimary: true,
                  position: 0,
                  source: "mcp",
                },
              ]
            : [];

      if (deps.sellers.findOwnedByName) {
        const existing = await deps.sellers.findOwnedByName(ctx.agentId, input.displayName);
        if (existing) {
          throw new ValidationError([
            { path: "displayName", message: `duplicate_store_name: you already own a store named "${input.displayName}" (sellerId=${existing.sellerId})` },
          ]);
        }
      }
      const created = await deps.sellers.create({
        displayName: input.displayName,
        ownerAgentId: ctx.agentId,
        phones,
        countryCode: input.countryCode,
        ...(input.website !== undefined ? { website: input.website } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.supportEmail !== undefined ? { supportEmail: input.supportEmail } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
      });
      const body = {
        sellerId: created.sellerId,
        displayName: created.displayName,
        ownerAgentId: created.ownerAgentId,
        phone: created.phone ?? null,
        whatsapp: created.whatsapp ?? null,
        phones: created.phones.map((p) => ({
          phone: p.phoneE164,
          isWhatsapp: p.isWhatsapp,
          isViber: p.isViber,
          isPrimary: p.isPrimary,
        })),
        website: created.website ?? null,
        description: created.description ?? null,
        supportEmail: created.supportEmail ?? null,
        city: created.city ?? null,
        countryCode: created.countryCode ?? null,
        createdAt: new Date(created.createdAt).toISOString(),
      };
      const snap = await captureSnapshot(snapshots, ctx, "seller_create", input, body);
      const snapUrl = snap ? snapshotWebUrl(snap.id) : undefined;
      const sUrl = storeWebUrl(created.sellerId);
      return {
        ...body,
        ...(sUrl ? { storeUrl: sUrl } : {}),
        ...(snapUrl
          ? { snapshotUrl: snapUrl, snapshotCreatedAt: snap!.createdAt, snapshotExpiresAt: snap!.expiresAt }
          : {}),
      };
    },
  });

  reg.register({
    name: "product.create_listing",
    description: [
      "Publish a product under a seller you own. Fails if the seller is not owned by the calling agent.",
      "",
      "Before invoking this tool the agent SHOULD gather these fields from the human user, not invent them:",
      "  - title: human-readable product name",
      "  - description: at least 30 characters explaining what the product is — REQUIRED",
      "  - variants: at least one SKU with priceMinor (in the smallest currency unit, e.g. cents) + ISO-4217 currency",
      "  - media: at least one publicly-fetchable image URL — REQUIRED. The catalog stores URLs only, not bytes; the URL must be reachable for the storefront to render the listing.",
      "  - brand / categoryIds / shipsTo / attributes: optional but improve discoverability",
      "",
      "Listings without descriptions or images convert poorly and harm storefront trust; the schema enforces both minimums.",
    ].join("\n"),
    scope: "seller:product:write",
    auditEvent: "product.create_listing",
    idempotent: false,
    inputSchema: CreateProductInput,
    outputSchema: CreateProductOutput,
    handler: async (input, ctx) => {
      const seller = await deps.sellers.get(input.sellerId);
      if (!seller) throw new NotFoundError("seller", input.sellerId);
      if (seller.ownerAgentId !== ctx.agentId) {
        throw new UnauthorizedError("not_seller_owner");
      }
      const p = await deps.products.create({
        sellerId: input.sellerId,
        title: input.title,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.brand !== undefined ? { brand: input.brand } : {}),
        ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
        ...(input.categoryIds !== undefined ? { categoryIds: input.categoryIds } : {}),
        ...(input.shipsTo !== undefined ? { shipsTo: input.shipsTo } : {}),
        variants: input.variants.map((v) => ({
          sku: v.sku,
          priceMinor: v.priceMinor,
          currency: v.currency,
          ...(v.inStock !== undefined ? { inStock: v.inStock } : {}),
        })),
        ...(input.media !== undefined
          ? {
              media: input.media.map((m) => ({
                url: m.url,
                contentType: m.contentType,
                ...(m.byteSize !== undefined ? { byteSize: m.byteSize } : {}),
                ...(m.width !== undefined ? { width: m.width } : {}),
                ...(m.height !== undefined ? { height: m.height } : {}),
                ...(m.altText !== undefined ? { altText: m.altText } : {}),
              })),
            }
          : {}),
        ...(input.heroMediaIndex !== undefined ? { heroMediaIndex: input.heroMediaIndex } : {}),
      });
      const body = {
        productId: p.productId,
        sellerId: p.sellerId,
        title: p.titleSanitized,
        // Description echoes the agent-provided input. The repo doesn't return
        // the sanitised version on the create-listing surface today, but the
        // snapshot wants to show buyers what was published; the input is the
        // same string modulo trim, so this is the most faithful representation.
        description: input.description,
        ...(p.brand !== undefined ? { brand: p.brand } : {}),
        variants: p.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          priceMinor: v.priceMinor.toString(),
          currency: v.currency,
          inStock: v.inStock,
        })),
        media: p.media.map((m) => ({ id: m.id, url: m.url })),
        heroMediaId: p.heroMediaId ?? null,
        createdAt: new Date(p.createdAt).toISOString(),
      };
      // Normalise BigInt fields before snapshotting — input.variants[].priceMinor is a BigInt
      // after Zod transform, and the Redis snapshot store JSON.stringify's the payload.
      const snapshotInput = {
        ...input,
        variants: input.variants.map((v) => ({ ...v, priceMinor: v.priceMinor.toString() })),
      };
      const snap = await captureSnapshot(snapshots, ctx, "product_create", snapshotInput, body);
      const snapUrl = snap ? snapshotWebUrl(snap.id) : undefined;
      const pUrl = productWebUrl(p.productId);
      const sUrl = storeWebUrl(p.sellerId);
      return {
        ...body,
        ...(pUrl ? { productUrl: pUrl } : {}),
        ...(sUrl ? { storeUrl: sUrl } : {}),
        ...(snapUrl
          ? { snapshotUrl: snapUrl, snapshotCreatedAt: snap!.createdAt, snapshotExpiresAt: snap!.expiresAt }
          : {}),
      };
    },
  });
}
