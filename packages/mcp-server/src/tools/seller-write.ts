// Seller / product write tools — MCP surface that mirrors POST /v1/sellers and
// POST /v1/products. Lets an MCP client (e.g. Claude Code) onboard a seller and
// publish listings without dropping out to raw HTTP.
//
// The handlers take the same repo interfaces the REST routes use, so we go
// through the same validation and storage code path. Ownership is bound to the
// calling principal's agentId.

import { z } from "zod";
import { NotFoundError, UnauthorizedError, ValidationError } from "@marketplace/shared/errors";
import { ISO_3166_1_ALPHA2, Iso3166Alpha2Schema } from "@marketplace/shared/country";
import {
  FIELD_LIMITS,
  sanitizeUntrustedString,
  safeOrigin,
} from "@marketplace/shared/untrusted";
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
    /**
     * Optional. List sellers owned by `ownerAgentId`, ordered by creation time
     * (newest first). When implemented, `seller.list_mine` exposes it so an
     * agent can rediscover shops it owns across sessions. When omitted, the
     * tool returns a `not_implemented` error so the agent can tell the operator
     * the platform doesn't support discovery yet.
     */
    listOwnedBy?(ownerAgentId: string, opts?: { limit?: number }): Promise<Array<{
      sellerId: string;
      displayName: string;
      countryCode?: string;
      city?: string;
      createdAt: number;
    }>>;
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
    /**
     * Optional. Look up the owning agent + seller for a product so the MCP
     * update tool can do an ownership check without leaking existence to
     * unauthorized callers. When omitted, `product.update_listing` returns
     * `not_implemented` so the agent can tell the operator the platform
     * doesn't expose updates yet.
     */
    getOwner?(productId: string): Promise<{ sellerId: string; ownerAgentId: string } | undefined>;
    /**
     * Optional. Patch an existing product's fields. Variants is a FULL
     * replacement (the repo diffs by sku and applies adds/updates/removes
     * within a transaction); the rest are partial — undefined leaves the
     * field alone, null clears nullable fields (description/brand).
     */
    /**
     * Optional. Soft-delete a product owned by the calling agent. Returns
     * one of: "removed" (just took it down), "already_removed" (idempotent
     * replay), "not_found" (no such product), or "not_owned" (the caller's
     * agent identity doesn't own the product's seller). When omitted,
     * `product.delete_listing` returns `not_implemented`.
     */
    softDelete?(productId: string, callerAgentId: string): Promise<"removed" | "not_found" | "not_owned" | "already_removed">;
    /**
     * Optional. Attach an already-fetchable image URL to a product. The
     * catalog stores URLs only, not bytes — the operator must host the
     * image somewhere publicly reachable. Returns the new media row or
     * `media_cap_exceeded` when the product already has the maximum number
     * of images.
     */
    addMedia?(productId: string, input: {
      url: string;
      contentType: string;
      byteSize?: number;
      width?: number;
      height?: number;
      altText?: string;
    }): Promise<{ id: string; url: string } | "media_cap_exceeded" | undefined>;
    /**
     * Optional. Remove one media row from a product. Returns `last_image`
     * when the product would have zero images left after removal — the
     * platform refuses that because listings without images convert badly.
     */
    removeMedia?(productId: string, mediaId: string): Promise<"removed" | "not_found" | "last_image">;
    update?(productId: string, patch: {
      title?: string;
      description?: string | null;
      brand?: string | null;
      categoryIds?: string[];
      shipsTo?: string[];
      attributes?: Record<string, string>;
      variants?: Array<{ sku: string; priceMinor: bigint; currency: string; inStock?: boolean }>;
    }): Promise<{
      productId: string;
      sellerId: string;
      titleSanitized: string;
      variants: Array<{ id: string; sku: string; priceMinor: bigint; currency: string; inStock: boolean }>;
    } | undefined>;
  };
}

const SellerPhoneInputSchema = z.object({
  phone: z.string().min(5).max(32),
  isWhatsapp: z.boolean().optional(),
  isViber: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  // Bound position. The phones array is already capped at 10 (line 131)
  // so any sensible position is ≤10. Pre-fix `Number.MAX_SAFE_INTEGER`
  // was accepted; the listPhones order-by `asc(position)` would then sort
  // legitimate phones BEHIND any junk-position one — the seller's primary
  // phone would surface at the bottom of the list, breaking the
  // "primary first" UX invariant. Cap at 1000.
  position: z.number().int().nonnegative().max(1000).optional(),
});

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
    // Same scheme-allowlist defense as MediaInput (pass #88) — `z.string().url()`
    // alone accepts `javascript:`/`data:`/`file:` URLs that become XSS sinks
    // when the storefront renders the seller's website as a clickable
    // `<a href>`. Also bound length to 2048 chars (same as media URL).
    website: z
      .string()
      .url()
      .max(2048)
      .refine((u) => /^https?:\/\//i.test(u), { message: "website_scheme_not_allowed" })
      .optional(),
    /** Short store bio shown on the storefront. */
    description: z.string().min(20).max(1000).optional(),
    // Same RFC 5321 max as the REST CreateSellerSchema (sellers.ts pass #161).
    supportEmail: z.string().email().max(254).optional(),
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
    // Zod's `.url()` accepts any WHATWG-valid URL including `javascript:`,
    // `data:`, `file:`. Catalog media URLs flow into the storefront's
    // `<img src>` attribute and any LLM-rendered product card — non-http(s)
    // schemes are XSS / local-disclosure / phishing-payload-hosting
    // vectors. Same allow-list defense as the REST `MediaInputSchema`
    // (pass #73) and the messaging-attachment fix (pass #37).
    url: z
      .string()
      .url()
      .max(2048)
      .refine((u) => /^https?:\/\//i.test(u), { message: "media_url_scheme_not_allowed" }),
    contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i).max(64).optional(),
    byteSize: z.number().int().positive().max(50_000_000).optional(),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    altText: z.string().max(500).optional(),
  })
  .transform((m) => ({ ...m, contentType: m.contentType ?? inferImageContentType(m.url) }));

const CreateProductInput = z.object({
  // Bound sellerId at the gate. Same cap as the REST CreateProductSchema
  // (pass #109) — UUIDs / slug ids are ≤200 chars in this platform.
  sellerId: z.string().min(1).max(200),
  title: z.string().min(3).max(300),
  /** Required — listings with no description damage buyer trust and search recall. */
  description: z.string().min(30).max(5000),
  brand: z.string().max(120).optional(),
  // Bound the attribute map at the gate. Same caps as the REST
  // AttributesSchema (pass #109) — 32 entries × 64-char keys × 1024-char
  // values. Pre-fix `z.record(z.string(), z.string()).optional()` accepted
  // unbounded attribute maps, letting a single MCP call ship 10 MB of
  // attribute data that the catalog write transaction then walked.
  attributes: z
    .record(z.string().max(64), z.string().max(1024))
    .refine((v) => Object.keys(v).length <= 32, { message: "at_most_32_attributes" })
    .optional(),
  categoryIds: z.array(z.string().min(1).max(120)).max(20).optional(),
  // Use the canonical ISO 3166-1 alpha-2 allow-list. Pre-fix
  // `z.string().length(2)` accepted any 2-char pair ("XX", emoji, etc.),
  // and downstream the search-side ship-to filter would never match,
  // making the listing invisible to legitimate buyers in those regions.
  // Same drift fix as buyer.ts pass #96.
  shipsTo: z.array(Iso3166Alpha2Schema).max(250).optional(),
  // Cap variants per listing. A real product has at most a few dozen
  // SKU variants (size × color matrices); 200 leaves headroom while
  // bounding the create-product write transaction.
  variants: z.array(VariantInput).min(1).max(200),
  /** Required — at least one publicly fetchable image URL. Listings without images convert poorly and harm storefront quality. */
  media: z.array(MediaInput).min(1).max(20),
  heroMediaIndex: z.number().int().nonnegative().optional(),
}).refine(
  // Out-of-bounds heroMediaIndex would silently fall back to media[0] in the
  // repo — the agent sees a "success" but the wrong image is hero. Reject early
  // with a clear error so the caller fixes the index.
  (d) => d.heroMediaIndex === undefined || d.heroMediaIndex < d.media.length,
  { path: ["heroMediaIndex"], message: "heroMediaIndex must be < media.length" },
);

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
      "IMPORTANT — ownership model the human operator must understand BEFORE you call this:",
      "  • Sellers created here are owned by the AGENT identity, not by any web-login user account.",
      "  • If the human operator already has a teno-store.com account and is expecting the new shop to appear",
      "    under their website 'My stores' / 'My products' view, this tool WILL NOT do that — there is no",
      "    agent↔user linking flow in the MCP surface today. The shop will exist, be publicly browsable at",
      "    `storeUrl`, and be manageable via MCP tools, but it will be invisible inside their web login.",
      "  • You SHOULD confirm with the operator which of these they want before calling:",
      "      (a) a brand-new agent-owned shop (what this tool does), OR",
      "      (b) publishing under a shop they already own in the web UI — in which case they need to create",
      "          the shop themselves in the web UI and (today) cannot proxy that through this MCP.",
      "  • Always echo `storeUrl` and `sellerId` back to the operator so they can find the shop later.",
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
            { path: "displayName", message: `duplicate_store_name: you already own a store named "${input.displayName}" (sellerId=${existing.sellerId}). Use that sellerId for product.create_listing, or call seller.list_mine to see all shops you own.` },
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
    name: "seller.list_mine",
    description: [
      "List the sellers (shops) owned by the calling agent identity, newest first. Use this at the start",
      "of a session to rediscover shops the agent created in previous sessions — there is no other way",
      "to enumerate them, because `seller.get` requires a sellerId you already know.",
      "",
      "Returns sellerId, displayName, countryCode, city, createdAt, and a public `storeUrl` for each.",
      "If the platform doesn't have a discovery index wired up, the call returns `not_implemented` and",
      "the agent should tell the operator they need to remember the sellerId/storeUrl from the original",
      "`seller.create_account` response.",
    ].join("\n"),
    scope: "seller:write",
    auditEvent: "seller.list_mine",
    idempotent: true,
    inputSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
    }),
    outputSchema: z.object({
      data: z.array(z.object({
        sellerId: z.string(),
        displayName: z.string(),
        countryCode: z.string().nullable(),
        city: z.string().nullable(),
        createdAt: z.string(),
        storeUrl: z.string().url().optional(),
      })),
    }),
    handler: async (input, ctx) => {
      if (!deps.sellers.listOwnedBy) {
        throw new ValidationError([
          { path: "_", message: "not_implemented:seller_discovery_unsupported" },
        ]);
      }
      const rows = await deps.sellers.listOwnedBy(ctx.agentId, input.limit !== undefined ? { limit: input.limit } : undefined);
      return {
        data: rows.map((r) => {
          const sUrl = storeWebUrl(r.sellerId);
          return {
            sellerId: r.sellerId,
            displayName: r.displayName,
            countryCode: r.countryCode ?? null,
            city: r.city ?? null,
            createdAt: new Date(r.createdAt).toISOString(),
            ...(sUrl ? { storeUrl: sUrl } : {}),
          };
        }),
      };
    },
  });

  reg.register({
    name: "product.add_media",
    description: [
      "Attach a publicly-fetchable image URL to a product you own. The catalog stores URLs only, not",
      "bytes — the URL must stay reachable forever (don't pass localhost paths, signed S3 links that",
      "expire, or images behind a login wall). The first image attached to an imageless product also",
      "becomes the hero.",
      "",
      "Use this to swap a product photo: `add_media` the new image, then `remove_media` the old one",
      "(in that order — removing the last image before adding the replacement is rejected as",
      "`last_image`).",
      "",
      "Output `result`: `added` (success, body includes the new media id + url) or `media_cap_exceeded`",
      "(product already has the max allowed images — remove one before adding another). Tell the",
      "operator the cap; the agent should not retry blindly.",
    ].join("\n"),
    scope: "seller:product:write",
    auditEvent: "product.add_media",
    idempotent: false,
    inputSchema: z.object({
      productId: z.string().min(1).max(200),
      url: z.string().url().max(2048).refine((u) => /^https?:\/\//i.test(u), { message: "media_url_scheme_not_allowed" }),
      contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i).max(64).optional(),
      byteSize: z.number().int().positive().max(50_000_000).optional(),
      width: z.number().int().positive().max(20_000).optional(),
      height: z.number().int().positive().max(20_000).optional(),
      altText: z.string().max(500).optional(),
    }),
    outputSchema: z.object({
      productId: z.string(),
      result: z.enum(["added", "media_cap_exceeded", "not_found", "not_owned"]),
      mediaId: z.string().optional(),
      url: z.string().url().optional(),
    }),
    handler: async (input, ctx) => {
      if (!deps.products.getOwner || !deps.products.addMedia) {
        throw new ValidationError([{ path: "_", message: "not_implemented:product_media_unsupported" }]);
      }
      const owner = await deps.products.getOwner(input.productId);
      if (!owner) return { productId: input.productId, result: "not_found" as const };
      if (owner.ownerAgentId !== ctx.agentId) {
        return { productId: input.productId, result: "not_owned" as const };
      }
      const contentType = input.contentType ?? inferImageContentType(input.url);
      const res = await deps.products.addMedia(input.productId, {
        url: input.url,
        contentType,
        ...(input.byteSize !== undefined ? { byteSize: input.byteSize } : {}),
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
        ...(input.altText !== undefined ? { altText: input.altText } : {}),
      });
      if (res === "media_cap_exceeded") {
        return { productId: input.productId, result: "media_cap_exceeded" as const };
      }
      if (!res) return { productId: input.productId, result: "not_found" as const };
      return { productId: input.productId, result: "added" as const, mediaId: res.id, url: res.url };
    },
  });

  reg.register({
    name: "product.remove_media",
    description: [
      "Remove one image from a product you own. The platform rejects removal when it would leave the",
      "product with zero images — listings without images convert badly. To swap a photo, `add_media`",
      "the replacement first, then `remove_media` the old one.",
      "",
      "Output `result`: `removed` (success), `last_image` (refused — add a replacement first),",
      "`not_found` (product or mediaId doesn't exist), or `not_owned` (the agent doesn't own this",
      "product's seller). The agent should explain the outcome to the operator rather than retry.",
    ].join("\n"),
    scope: "seller:product:write",
    auditEvent: "product.remove_media",
    idempotent: false,
    inputSchema: z.object({
      productId: z.string().min(1).max(200),
      mediaId: z.string().min(1).max(200),
    }),
    outputSchema: z.object({
      productId: z.string(),
      mediaId: z.string(),
      result: z.enum(["removed", "last_image", "not_found", "not_owned"]),
    }),
    handler: async (input, ctx) => {
      if (!deps.products.getOwner || !deps.products.removeMedia) {
        throw new ValidationError([{ path: "_", message: "not_implemented:product_media_unsupported" }]);
      }
      const owner = await deps.products.getOwner(input.productId);
      if (!owner) return { productId: input.productId, mediaId: input.mediaId, result: "not_found" as const };
      if (owner.ownerAgentId !== ctx.agentId) {
        return { productId: input.productId, mediaId: input.mediaId, result: "not_owned" as const };
      }
      const result = await deps.products.removeMedia(input.productId, input.mediaId);
      return { productId: input.productId, mediaId: input.mediaId, result };
    },
  });

  reg.register({
    name: "product.delete_listing",
    description: [
      "Soft-delete a product you own. Flips the product's status to `removed` — it disappears from",
      "search, catalog browse, the storefront, and `seller.list_orders` for new orders. Existing orders",
      "that already reference the product are preserved (the platform keeps order history immutable).",
      "",
      "Why soft-delete (not hard-delete): a hard DELETE would either violate the FK from order_items to",
      "the variant or destroy order history. Soft-delete preserves the audit trail and is filtered out",
      "of every public-read query, which is what the operator actually wants.",
      "",
      "Idempotent — re-deleting the same product returns `already_removed` rather than failing. Tell the",
      "operator the listing is down regardless of which result came back.",
      "",
      "Result outcomes the agent should explain rather than retry blindly:",
      "  • `removed` — success, listing is down. Tell the operator and remove it from any local UI.",
      "  • `already_removed` — idempotent replay; same outcome as `removed`.",
      "  • `not_found` — productId doesn't exist (or was malformed). Ask the operator to confirm the id.",
      "  • `not_owned` — the calling agent isn't the seller's owner OR the product is an unowned scraper-",
      "    seeded reference listing. Tell the operator we can't take down listings we don't own.",
    ].join("\n"),
    scope: "seller:product:write",
    auditEvent: "product.delete_listing",
    idempotent: true,
    inputSchema: z.object({
      productId: z.string().min(1).max(200),
    }),
    outputSchema: z.object({
      productId: z.string(),
      result: z.enum(["removed", "already_removed", "not_found", "not_owned"]),
    }),
    handler: async (input, ctx) => {
      if (!deps.products.softDelete) {
        throw new ValidationError([
          { path: "_", message: "not_implemented:product_delete_unsupported" },
        ]);
      }
      const result = await deps.products.softDelete(input.productId, ctx.agentId);
      return { productId: input.productId, result };
    },
  });

  reg.register({
    name: "product.update_listing",
    description: [
      "Update an existing product you own. Fails if the product is owned by a different agent. Use this",
      "to flip a variant in/out of stock, correct a price, fix a typo, or refresh the description — the",
      "MCP equivalent of the seller dashboard's edit screen.",
      "",
      "Partial-update semantics: each top-level field is independent. `undefined` leaves the field alone;",
      "`null` clears `description` or `brand`. `variants` is a FULL REPLACEMENT — the server diffs by sku",
      "and applies adds/updates/removes inside one transaction. To toggle stock on a single variant of a",
      "multi-variant product you MUST first fetch the existing variants (via `catalog.get_product`),",
      "mutate the one entry, and pass the whole array back; otherwise the omitted variants get deleted.",
      "",
      "Pricing footgun: `priceMinor` is in the smallest currency unit (×100 for cent-subdivided",
      "currencies — same rule as `product.create_listing`). Always read the converted price back to the",
      "operator before calling.",
      "",
      "Limitations to disclose to the operator:",
      "  • Media is edited via the dedicated `product.add_media` / `product.remove_media` tools — this",
      "    tool only touches text + variants, not images.",
      "  • If the product is currently in a buyer's cart, in-flight changes (price drop, out-of-stock)",
      "    take effect at the next read; orders already placed are immutable.",
    ].join("\n"),
    scope: "seller:product:write",
    auditEvent: "product.update_listing",
    idempotent: false,
    inputSchema: z.object({
      productId: z.string().min(1).max(200),
      title: z.string().min(3).max(300).optional(),
      description: z.string().min(30).max(5000).nullable().optional(),
      brand: z.string().max(120).nullable().optional(),
      attributes: z
        .record(z.string().max(64), z.string().max(1024))
        .refine((v) => Object.keys(v).length <= 32, { message: "at_most_32_attributes" })
        .optional(),
      categoryIds: z.array(z.string().min(1).max(120)).max(20).optional(),
      shipsTo: z.array(Iso3166Alpha2Schema).max(250).optional(),
      variants: z.array(VariantInput).min(1).max(200).optional(),
    }).refine(
      (d) =>
        d.title !== undefined ||
        d.description !== undefined ||
        d.brand !== undefined ||
        d.attributes !== undefined ||
        d.categoryIds !== undefined ||
        d.shipsTo !== undefined ||
        d.variants !== undefined,
      { message: "at_least_one_field_to_update" },
    ),
    outputSchema: z.object({
      productId: z.string(),
      sellerId: z.string(),
      title: z.string(),
      variants: z.array(z.object({
        id: z.string(),
        sku: z.string(),
        priceMinor: z.string(),
        currency: z.string(),
        inStock: z.boolean(),
      })),
      productUrl: z.string().url().optional(),
      storeUrl: z.string().url().optional(),
    }),
    handler: async (input, ctx) => {
      if (!deps.products.getOwner || !deps.products.update) {
        throw new ValidationError([
          { path: "_", message: "not_implemented:product_update_unsupported" },
        ]);
      }
      const owner = await deps.products.getOwner(input.productId);
      if (!owner) throw new NotFoundError("product", input.productId);
      if (owner.ownerAgentId !== ctx.agentId) {
        throw new UnauthorizedError("not_seller_owner");
      }
      const patch: Parameters<NonNullable<typeof deps.products.update>>[1] = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.brand !== undefined) patch.brand = input.brand;
      if (input.attributes !== undefined) patch.attributes = input.attributes;
      if (input.categoryIds !== undefined) patch.categoryIds = input.categoryIds;
      if (input.shipsTo !== undefined) patch.shipsTo = input.shipsTo;
      if (input.variants !== undefined) {
        patch.variants = input.variants.map((v) => ({
          sku: v.sku,
          priceMinor: v.priceMinor,
          currency: v.currency,
          ...(v.inStock !== undefined ? { inStock: v.inStock } : {}),
        }));
      }
      const updated = await deps.products.update(input.productId, patch);
      if (!updated) throw new NotFoundError("product", input.productId);
      const pUrl = productWebUrl(updated.productId);
      const sUrl = storeWebUrl(updated.sellerId);
      return {
        productId: updated.productId,
        sellerId: updated.sellerId,
        title: updated.titleSanitized,
        variants: updated.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          priceMinor: v.priceMinor.toString(),
          currency: v.currency,
          inStock: v.inStock,
        })),
        ...(pUrl ? { productUrl: pUrl } : {}),
        ...(sUrl ? { storeUrl: sUrl } : {}),
      };
    },
  });

  reg.register({
    name: "product.create_listing",
    description: [
      "Publish a product under a seller you own. Fails if the seller is not owned by the calling agent.",
      "",
      "IMPORTANT — ownership model the human operator must understand BEFORE you call this:",
      "  • `sellerId` must reference a seller this AGENT identity owns (typically one created via",
      "    `seller.create_account` in this or a prior MCP session under the same agent identity).",
      "  • The published listing will be visible to BUYERS at `productUrl` and inside the agent-owned shop,",
      "    but it will NOT appear in the human operator's web-login 'My products' view — the MCP has no",
      "    way today to publish under a shop the operator created in the web UI.",
      "  • If the operator asks 'why isn't my product showing up on the website?' — they are looking at",
      "    their web-account products page, but the MCP-created listing lives in an agent-owned shop.",
      "    Direct them to `storeUrl` / `productUrl` from this tool's response.",
      "",
      "Before invoking this tool the agent SHOULD gather these fields from the human user, not invent them:",
      "  - title: human-readable product name",
      "  - description: at least 30 characters explaining what the product is — REQUIRED",
      "  - variants: at least one SKU with priceMinor (in the smallest currency unit) + ISO-4217 currency.",
      "      `priceMinor` is the price MULTIPLIED BY 100 for currencies with cent subdivisions (USD, EUR,",
      "      DZD, MAD, …). Off-by-100 pricing is the most common — and most damaging — seller mistake on this",
      "      MCP. ALWAYS read the converted price back to the operator before calling, e.g. 'I'm about to",
      "      list this at 742.30 DZD (priceMinor=74230) — confirm?'. Worked examples:",
      "         • 750 DZD       → priceMinor: 75000   (currency: \"DZD\")",
      "         • 9.99 USD      → priceMinor: 999     (currency: \"USD\")",
      "         • 12 500 DZD    → priceMinor: 1250000 (currency: \"DZD\")",
      "      Zero-decimal currencies (JPY, KRW, IQD's effective practice, etc.) use priceMinor = the integer",
      "      price as-is. When in doubt, ask the operator to confirm the converted number.",
      "  - media: at least one publicly-fetchable image URL — REQUIRED. The catalog stores URLs only, not bytes; the URL must be reachable for the storefront to render the listing.",
      "  - brand / categoryIds / shipsTo / attributes: optional but improve discoverability",
      "",
      "Listings without descriptions or images convert poorly and harm storefront trust; the schema enforces both minimums.",
      "",
      "Recommended dry-run: when the title / description / attributes come from the human operator (i.e. anything",
      "you didn't generate yourself from a known-good source), call `seller.preview_listing` FIRST with the same",
      "text. It returns a suspicion score and routing decision (auto_publish / moderation_queue / review_block).",
      "If routing is `review_block`, do NOT call this tool — fix the input with the operator and re-preview.",
      "If routing is `moderation_queue`, warn the operator that the listing will be held for human review",
      "before going live, so they don't expect it on the storefront immediately.",
      "",
      "After publish — the rest of the lifecycle is exposed in the MCP, no web UI needed:",
      "  • `catalog.get_product` — confirm the listing went live and the fields look right.",
      "  • `product.update_listing` — edit title/description/brand/attributes/categories/variants. Use",
      "    this to flip stock, correct a price, or refresh the copy.",
      "  • `product.add_media` / `product.remove_media` — swap product photos (add first, then remove;",
      "    removing the last image is rejected).",
      "  • `product.delete_listing` — soft-delete (idempotent; listing disappears from search and",
      "    storefront but order history is preserved).",
      "Always save `productId` and `sellerId` from this response so the agent can call those tools",
      "later without re-discovering the ids.",
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
        // Run the description through the same sanitiser the repo applies
        // at write time. The adapter doesn't return the sanitised version
        // on the create-listing surface today, and echoing the RAW
        // `input.description` would re-introduce any injection patterns
        // the seller submitted into the snapshot + every downstream LLM
        // consumer reading the response. Same defense as title (which is
        // already `p.titleSanitized`).
        description: sanitizeUntrustedString(input.description, {
          maxLength: FIELD_LIMITS.productDescription,
          origin: safeOrigin("seller", p.sellerId),
        }),
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
