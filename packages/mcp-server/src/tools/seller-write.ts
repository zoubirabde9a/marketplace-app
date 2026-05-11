// Seller / product write tools — MCP surface that mirrors POST /v1/sellers and
// POST /v1/products. Lets an MCP client (e.g. Claude Code) onboard a seller and
// publish listings without dropping out to raw HTTP.
//
// The handlers take the same repo interfaces the REST routes use, so we go
// through the same validation and storage code path. Ownership is bound to the
// calling principal's agentId.

import { z } from "zod";
import { NotFoundError, UnauthorizedError } from "@marketplace/shared/errors";
import type { McpRegistry } from "../registry.js";

export interface SellerWriteAdapter {
  sellers: {
    create(input: {
      displayName: string;
      ownerAgentId: string;
      phone?: string;
      whatsapp?: string;
      website?: string;
    }): Promise<{
      sellerId: string;
      displayName: string;
      ownerAgentId: string;
      phone?: string;
      whatsapp?: string;
      website?: string;
      createdAt: number;
    }>;
    get(sellerId: string): Promise<{ sellerId: string; ownerAgentId: string } | undefined>;
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

const CreateSellerInput = z.object({
  displayName: z.string().min(1).max(120),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  website: z.string().url().optional(),
});

const CreateSellerOutput = z.object({
  sellerId: z.string(),
  displayName: z.string(),
  ownerAgentId: z.string(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  website: z.string().nullable(),
  createdAt: z.string(),
});

const VariantInput = z.object({
  sku: z.string().min(1).max(64),
  priceMinor: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
  currency: z.string().regex(/^[A-Z]{3}$/),
  inStock: z.boolean().optional(),
});

const MediaInput = z.object({
  url: z.string().url().max(2048),
  contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i).max(64),
  byteSize: z.number().int().positive().max(50_000_000).optional(),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  altText: z.string().max(500).optional(),
});

const CreateProductInput = z.object({
  sellerId: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  brand: z.string().max(120).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  categoryIds: z.array(z.string().min(1).max(120)).max(20).optional(),
  shipsTo: z.array(z.string().length(2)).max(250).optional(),
  variants: z.array(VariantInput).min(1),
  media: z.array(MediaInput).max(20).optional(),
  heroMediaIndex: z.number().int().nonnegative().optional(),
});

const CreateProductOutput = z.object({
  productId: z.string(),
  sellerId: z.string(),
  title: z.string(),
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
  createdAt: z.string(),
});

export function registerSellerWriteTools(reg: McpRegistry, deps: SellerWriteAdapter): void {
  reg.register({
    name: "seller.create_account",
    description:
      "Create a seller (store) owned by the calling agent. Returns the new seller record. The caller agent becomes the sole owner — only that agent can later edit the seller or publish products under it.",
    scope: "seller:write",
    auditEvent: "seller.create_account",
    idempotent: false,
    inputSchema: CreateSellerInput,
    outputSchema: CreateSellerOutput,
    handler: async (input, ctx) => {
      const created = await deps.sellers.create({
        displayName: input.displayName,
        ownerAgentId: ctx.agentId,
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.whatsapp !== undefined ? { whatsapp: input.whatsapp } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
      });
      return {
        sellerId: created.sellerId,
        displayName: created.displayName,
        ownerAgentId: created.ownerAgentId,
        phone: created.phone ?? null,
        whatsapp: created.whatsapp ?? null,
        website: created.website ?? null,
        createdAt: new Date(created.createdAt).toISOString(),
      };
    },
  });

  reg.register({
    name: "product.create_listing",
    description:
      "Publish a product under a seller you own. At least one variant (sku + priceMinor + currency) is required. Returns the new productId and variant ids. Fails if the seller is not owned by the calling agent.",
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
      return {
        productId: p.productId,
        sellerId: p.sellerId,
        title: p.titleSanitized,
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
    },
  });
}
