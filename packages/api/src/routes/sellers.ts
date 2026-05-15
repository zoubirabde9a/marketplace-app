// Seller account creation. Dev/demo HTTP surface.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { seller as sellerDomain } from "@marketplace/domain";
import { ConflictError, NotFoundError, UnauthorizedError } from "@marketplace/shared/errors";
import { Iso3166Alpha2Schema } from "@marketplace/shared/country";
import { requirePrincipal } from "../middleware/auth.js";
import { applyPublicReadCacheHeaders } from "./products.js";
import type { SellerRepo, SellerRecord } from "../repos/seller.js";

const CreateSellerSchema = z.object({
  displayName: z.string().min(2).max(120),
  // Phone + country are required at the API layer (best-practice marketplace minimums).
  phone: sellerDomain.SellerPhoneSchema,
  // ISO-validated against the alpha-2 allow-list — the MCP seller.create_account
  // path has used Iso3166Alpha2Schema since pass #3+#7; REST accepted any
  // 2-letter pair (`"XX"`, `"!!"`), creating a drift where the same caller hit
  // different validation surfaces depending on which entrypoint they used.
  countryCode: Iso3166Alpha2Schema,
  whatsapp: sellerDomain.SellerWhatsappSchema.optional(),
  website: sellerDomain.SellerWebsiteSchema.optional(),
  description: z.string().min(20).max(1000).optional(),
  // Bound supportEmail at RFC 5321's 254-char max so a 10 MB payload that
  // happens to satisfy `.email()`'s regex can't slip through. Pre-fix
  // `.email().optional()` validated format but not length; the email
  // surfaces on the storefront and on order-management emails so an
  // attacker submitting an oversize string would bloat both the
  // seller_profiles row and downstream rendering.
  supportEmail: z.string().email().max(254).optional(),
  city: z.string().min(1).max(120).optional(),
});

const UpdateSellerContactSchema = z.object({
  phone: sellerDomain.SellerPhoneSchema.nullable().optional(),
  whatsapp: sellerDomain.SellerWhatsappSchema.nullable().optional(),
  website: sellerDomain.SellerWebsiteSchema.nullable().optional(),
});

const ListSellersQuerySchema = z.object({
  q: z.string().max(120).optional(),
  ownerAgentId: z.string().min(1).max(200).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function shapeSellerPublic(
  s: SellerRecord,
  productCount: number,
  /**
   * Include `ownerAgentId` in the returned shape. Only pass `true` when the
   * caller is authenticated AND is the owner — anonymous callers must not see
   * it (it's an internal identifier that distinguishes "agent-managed" from
   * "real shop", and exposing it makes the `?ownerAgentId=` filter a public
   * enumeration vector).
   */
  includeOwnership = false,
): Record<string, unknown> {
  return {
    sellerId: s.sellerId,
    displayName: s.displayName,
    ...(includeOwnership ? { ownerAgentId: s.ownerAgentId } : {}),
    productCount,
    // Legacy single-value mirrors of the first/primary number. Kept so
    // existing clients keep working; new clients should read `phones`.
    phone: s.phone ?? null,
    whatsapp: s.whatsapp ?? null,
    phones: s.phones.map((p) => ({
      phone: p.phoneE164,
      isWhatsapp: p.isWhatsapp,
      isViber: p.isViber,
      isPrimary: p.isPrimary,
    })),
    website: s.website ?? null,
    description: s.description ?? null,
    supportEmail: s.supportEmail ?? null,
    city: s.city ?? null,
    countryCode: s.countryCode ?? null,
    createdAt: new Date(s.createdAt).toISOString(),
  };
}

export async function registerSellerRoutes(app: FastifyInstance, sellers: SellerRepo): Promise<void> {
  app.post("/v1/sellers", async (req, reply) => {
    const principal = requirePrincipal(req);
    const body = CreateSellerSchema.parse(req.body);
    // Duplicate-store guard. The MCP seller.create_account path has rejected
    // accidental same-name re-creates by the same agent since pass #3; the
    // REST route was silently creating side-by-side duplicates that looked
    // identical to the operator but had different sellerIds. Same check
    // here keeps the two entrypoints aligned.
    const existingDup = await sellers.findOwnedByName(principal.agentId, body.displayName);
    if (existingDup) {
      throw new ConflictError(
        `duplicate_store_name: you already own a store named "${body.displayName}" (sellerId=${existingDup.sellerId})`,
      );
    }
    const seller = await sellers.create({
      displayName: body.displayName,
      ownerAgentId: principal.agentId,
      phone: body.phone,
      countryCode: body.countryCode,
      ...(body.whatsapp !== undefined ? { whatsapp: body.whatsapp } : {}),
      ...(body.website !== undefined ? { website: body.website } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.supportEmail !== undefined ? { supportEmail: body.supportEmail } : {}),
      ...(body.city !== undefined ? { city: body.city } : {}),
    });
    void reply.code(201);
    // The caller just created this seller — they own it, so they see ownership.
    return shapeSellerPublic(seller, 0, true);
  });

  app.patch<{ Params: { id: string } }>("/v1/sellers/:id", async (req) => {
    const principal = requirePrincipal(req);
    const existing = await sellers.get(req.params.id);
    if (!existing) throw new NotFoundError("seller", req.params.id);
    if (existing.ownerAgentId !== principal.agentId) {
      throw new UnauthorizedError("not_seller_owner");
    }
    const body = UpdateSellerContactSchema.parse(req.body);
    const updated = await sellers.updateContact(req.params.id, body);
    if (!updated) throw new NotFoundError("seller", req.params.id);
    // PATCH already verified ownership above; safe to surface ownerAgentId.
    return shapeSellerPublic(updated, await sellers.countProducts(updated.sellerId), true);
  });

  app.get("/v1/sellers", async (req, reply) => {
    // Mirrors /v1/products cache policy. Sellers list is public-readable
    // per agents.json; anonymous reads are edge-cacheable for 60s, auth'd
    // calls stay private. See routes/products.ts for the rationale.
    const agentId = req.principal?.agentId ?? "anonymous";
    applyPublicReadCacheHeaders(reply, agentId);
    const params = ListSellersQuerySchema.parse(req.query);
    const all = await sellers.list();
    let filtered = params.q
      ? all.filter((s) => s.displayName.toLowerCase().includes(params.q!.toLowerCase()))
      : all;
    if (params.ownerAgentId) {
      filtered = filtered.filter((s) => s.ownerAgentId === params.ownerAgentId);
    }
    const offset = params.cursor ?? 0;
    const page = filtered.slice(offset, offset + params.limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < filtered.length;
    const counts = await Promise.all(page.map((s) => sellers.countProducts(s.sellerId)));
    const callerAgentId = req.principal?.agentId;
    return {
      data: page.map((s, i) =>
        shapeSellerPublic(
          s,
          counts[i] ?? 0,
          callerAgentId !== undefined && callerAgentId === s.ownerAgentId,
        ),
      ),
      pagination: {
        cursor: hasMore ? String(nextOffset) : null,
        totalEstimate: filtered.length,
      },
    };
  });

  app.get<{ Params: { id: string } }>("/v1/sellers/:id", async (req, reply) => {
    const agentId = req.principal?.agentId ?? "anonymous";
    applyPublicReadCacheHeaders(reply, agentId);
    const s = await sellers.get(req.params.id);
    if (!s) throw new NotFoundError("seller", req.params.id);
    const callerAgentId = req.principal?.agentId;
    return shapeSellerPublic(
      s,
      await sellers.countProducts(s.sellerId),
      callerAgentId !== undefined && callerAgentId === s.ownerAgentId,
    );
  });
}
