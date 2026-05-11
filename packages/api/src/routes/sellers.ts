// Seller account creation. Dev/demo HTTP surface.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { seller as sellerDomain } from "@marketplace/domain";
import { NotFoundError, UnauthorizedError } from "@marketplace/shared/errors";
import { requirePrincipal } from "../middleware/auth.js";
import { applyPublicReadCacheHeaders } from "./products.js";
import type { SellerRepo, SellerRecord } from "../repos/seller.js";

const CreateSellerSchema = z.object({
  displayName: z.string().min(2).max(120),
  // Phone + country are required at the API layer (best-practice marketplace minimums).
  phone: sellerDomain.SellerPhoneSchema,
  countryCode: z.string().length(2).transform((v) => v.toUpperCase()),
  whatsapp: sellerDomain.SellerWhatsappSchema.optional(),
  website: sellerDomain.SellerWebsiteSchema.optional(),
  description: z.string().min(20).max(1000).optional(),
  supportEmail: z.string().email().optional(),
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

function shapeSellerPublic(s: SellerRecord, productCount: number): Record<string, unknown> {
  return {
    sellerId: s.sellerId,
    displayName: s.displayName,
    ownerAgentId: s.ownerAgentId,
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
    return shapeSellerPublic(seller, 0);
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
    return shapeSellerPublic(updated, await sellers.countProducts(updated.sellerId));
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
    return {
      data: page.map((s, i) => shapeSellerPublic(s, counts[i] ?? 0)),
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
    return shapeSellerPublic(s, await sellers.countProducts(s.sellerId));
  });
}
