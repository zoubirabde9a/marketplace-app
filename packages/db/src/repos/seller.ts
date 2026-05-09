import { count, eq } from "drizzle-orm";
import { uuidv7 } from "@marketplace/shared/ids";
import { organizations } from "../schema/identity.js";
import { sellerProfiles } from "../schema/seller.js";
import { products } from "../schema/catalog.js";
import type { DbClient } from "../client.js";
import { isUuid } from "./_uuid.js";

export interface StoredSeller {
  sellerId: string;
  displayName: string;
  ownerAgentId: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
  createdAt: number;
}

type ProfileRow = typeof sellerProfiles.$inferSelect;

function shape(row: ProfileRow): StoredSeller {
  return {
    sellerId: row.orgId,
    displayName: row.storeName,
    ownerAgentId: row.ownerAgentId,
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.whatsapp ? { whatsapp: row.whatsapp } : {}),
    ...(row.website ? { website: row.website } : {}),
    createdAt: row.createdAt.getTime(),
  };
}

export function makeSellerRepo(db: DbClient) {
  return {
    async create(input: {
      displayName: string;
      ownerAgentId: string;
      phone?: string;
      whatsapp?: string;
      website?: string;
    }): Promise<StoredSeller> {
      const orgId = uuidv7();
      const profileId = uuidv7();
      // Slug must be globally unique. UUIDv7 is time-ordered so adjacent
      // calls share a long timestamp prefix; using the random tail (last 12
      // chars) gives ~48 bits of entropy per slug.
      const slug = `seller-${orgId.slice(-12)}`;
      return db.transaction(async (tx) => {
        await tx.insert(organizations).values({
          id: orgId,
          name: input.displayName,
          legalName: input.displayName,
          countryCode: "US",
          status: "active",
        });
        const [row] = await tx
          .insert(sellerProfiles)
          .values({
            id: profileId,
            orgId,
            ownerAgentId: input.ownerAgentId,
            storeName: input.displayName,
            storeSlug: slug,
            phone: input.phone ?? null,
            whatsapp: input.whatsapp ?? null,
            website: input.website ?? null,
            active: true,
          })
          .returning();
        return shape(row!);
      });
    },

    async updateContact(
      sellerId: string,
      patch: {
        phone?: string | null | undefined;
        whatsapp?: string | null | undefined;
        website?: string | null | undefined;
      },
    ): Promise<StoredSeller | undefined> {
      if (!isUuid(sellerId)) return undefined;
      const updates: Partial<ProfileRow> = { updatedAt: new Date() };
      if (patch.phone !== undefined) updates.phone = patch.phone === null ? null : patch.phone;
      if (patch.whatsapp !== undefined) updates.whatsapp = patch.whatsapp === null ? null : patch.whatsapp;
      if (patch.website !== undefined) updates.website = patch.website === null ? null : patch.website;
      const [row] = await db
        .update(sellerProfiles)
        .set(updates)
        .where(eq(sellerProfiles.orgId, sellerId))
        .returning();
      return row ? shape(row) : undefined;
    },

    async get(sellerId: string): Promise<StoredSeller | undefined> {
      if (!isUuid(sellerId)) return undefined;
      const rows = await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, sellerId)).limit(1);
      return rows[0] ? shape(rows[0]) : undefined;
    },

    async list(): Promise<StoredSeller[]> {
      const rows = await db.select().from(sellerProfiles).orderBy(sellerProfiles.createdAt);
      return rows.map(shape);
    },

    async countProducts(sellerId: string): Promise<number> {
      if (!isUuid(sellerId)) return 0;
      const rows = await db
        .select({ n: count() })
        .from(products)
        .where(eq(products.sellerId, sellerId));
      return Number(rows[0]?.n ?? 0);
    },
  };
}
