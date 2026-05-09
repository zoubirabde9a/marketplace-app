// Seller account creation. Dev/demo HTTP surface.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { seller as sellerDomain } from "@marketplace/domain";
import { NotFoundError, UnauthorizedError } from "@marketplace/shared/errors";
import { requirePrincipal } from "../middleware/auth.js";
import type { SellerRepo, SellerRecord } from "../repos/seller.js";

const CreateSellerSchema = z.object({
  displayName: z.string().min(1).max(120),
  phone: sellerDomain.SellerPhoneSchema.optional(),
  whatsapp: sellerDomain.SellerWhatsappSchema.optional(),
  website: sellerDomain.SellerWebsiteSchema.optional(),
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
    phone: s.phone ?? null,
    whatsapp: s.whatsapp ?? null,
    website: s.website ?? null,
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
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.whatsapp !== undefined ? { whatsapp: body.whatsapp } : {}),
      ...(body.website !== undefined ? { website: body.website } : {}),
    });
    void reply.code(201);
    return {
      sellerId: seller.sellerId,
      displayName: seller.displayName,
      ownerAgentId: seller.ownerAgentId,
      phone: seller.phone ?? null,
      whatsapp: seller.whatsapp ?? null,
      website: seller.website ?? null,
      createdAt: new Date(seller.createdAt).toISOString(),
    };
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

  app.get("/v1/sellers", async (req) => {
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

  app.get<{ Params: { id: string } }>("/v1/sellers/:id", async (req) => {
    const s = await sellers.get(req.params.id);
    if (!s) throw new NotFoundError("seller", req.params.id);
    return shapeSellerPublic(s, await sellers.countProducts(s.sellerId));
  });
}
