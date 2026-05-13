import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { uuidv7 } from "@marketplace/shared/ids";
import { normalizeAlgerianPhone } from "@marketplace/shared/phone";
import { organizations } from "../schema/identity.js";
import { sellerPhones, sellerProfiles } from "../schema/seller.js";
import { products } from "../schema/catalog.js";
import type { DbClient } from "../client.js";
import { isUuid } from "./_uuid.js";

export interface SellerPhone {
  phoneE164: string;
  isWhatsapp: boolean;
  isViber: boolean;
  isPrimary: boolean;
  position: number;
}

export interface SellerPhoneInput {
  phone: string;
  isWhatsapp?: boolean;
  isViber?: boolean;
  isPrimary?: boolean;
  position?: number;
  source?: string;
}

export interface StoredSeller {
  sellerId: string;
  displayName: string;
  ownerAgentId: string;
  /**
   * Lead contact number in E.164 (+213…). Convenience alias for
   * `phones[0]` (the primary). May be omitted if the seller has no phones.
   */
  phone?: string;
  /** All known phone numbers for this seller, primary first. */
  phones: SellerPhone[];
  whatsapp?: string;
  website?: string;
  description?: string;
  supportEmail?: string;
  city?: string;
  countryCode?: string;
  createdAt: number;
}

type ProfileRow = typeof sellerProfiles.$inferSelect;
type PhoneRow = typeof sellerPhones.$inferSelect;

function shapePhone(row: PhoneRow): SellerPhone {
  return {
    phoneE164: row.phoneE164,
    isWhatsapp: row.isWhatsapp,
    isViber: row.isViber,
    isPrimary: row.isPrimary,
    position: row.position,
  };
}

function shape(row: ProfileRow, phones: SellerPhone[], countryCode?: string | null): StoredSeller {
  const primary = phones.find((p) => p.isPrimary) ?? phones[0];
  const whatsapp = phones.find((p) => p.isWhatsapp);
  return {
    sellerId: row.orgId,
    displayName: row.storeName,
    ownerAgentId: row.ownerAgentId,
    phones,
    ...(primary ? { phone: primary.phoneE164 } : {}),
    ...(whatsapp ? { whatsapp: whatsapp.phoneE164 } : {}),
    ...(row.website ? { website: row.website } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.supportEmail ? { supportEmail: row.supportEmail } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(countryCode ? { countryCode } : {}),
    createdAt: row.createdAt.getTime(),
  };
}

export function makeSellerRepo(db: DbClient) {
  async function listPhones(sellerId: string): Promise<SellerPhone[]> {
    const rows = await db
      .select()
      .from(sellerPhones)
      .where(eq(sellerPhones.sellerId, sellerId))
      .orderBy(desc(sellerPhones.isPrimary), asc(sellerPhones.position), asc(sellerPhones.createdAt));
    return rows.map(shapePhone);
  }

  async function phonesForSellers(sellerIds: string[]): Promise<Map<string, SellerPhone[]>> {
    const result = new Map<string, SellerPhone[]>();
    if (sellerIds.length === 0) return result;
    // Drizzle's `inArray` would be cleaner; this stays simple and lets us
    // keep the file dependency-free of additional imports.
    const rows = await db
      .select()
      .from(sellerPhones)
      .orderBy(desc(sellerPhones.isPrimary), asc(sellerPhones.position), asc(sellerPhones.createdAt));
    const wanted = new Set(sellerIds);
    for (const row of rows) {
      if (!wanted.has(row.sellerId)) continue;
      const list = result.get(row.sellerId) ?? [];
      list.push(shapePhone(row));
      result.set(row.sellerId, list);
    }
    return result;
  }

  return {
    async create(input: {
      displayName: string;
      ownerAgentId: string;
      phones?: SellerPhoneInput[];
      /** @deprecated single-phone field — pass via `phones` instead. Kept so existing callers still work. */
      phone?: string;
      /** @deprecated — passing a whatsapp number now sets is_whatsapp=true on its row in `phones`. */
      whatsapp?: string;
      website?: string;
      description?: string;
      supportEmail?: string;
      city?: string;
      /** ISO 3166-1 alpha-2. Defaults to DZ (this marketplace's primary country) so legacy callers don't break. */
      countryCode?: string;
    }): Promise<StoredSeller> {
      const orgId = uuidv7();
      const profileId = uuidv7();
      const country = (input.countryCode ?? "DZ").toUpperCase();
      const slug = `seller-${orgId.slice(-12)}`;

      // Build the normalized phone list. We accept both the new shape
      // (`phones: [...]`) and the legacy single `phone`/`whatsapp` fields.
      // The legacy ones become a single entry with is_whatsapp inferred from
      // whether a whatsapp was passed (the old seeder always copied phone
      // into whatsapp for shops, so this preserves that intent).
      const rawPhones: SellerPhoneInput[] = input.phones ? [...input.phones] : [];
      if (rawPhones.length === 0 && input.phone) {
        rawPhones.push({
          phone: input.phone,
          isWhatsapp: Boolean(input.whatsapp),
          isPrimary: true,
          source: "legacy-create",
        });
      }
      const seen = new Set<string>();
      const phoneRows = rawPhones
        .map((p, i) => {
          const e164 = normalizeAlgerianPhone(p.phone);
          if (!e164 || seen.has(e164)) return null;
          seen.add(e164);
          return {
            id: uuidv7(),
            sellerId: orgId,
            phoneE164: e164,
            isWhatsapp: p.isWhatsapp ?? false,
            isViber: p.isViber ?? false,
            isPrimary: p.isPrimary ?? false,
            position: p.position ?? i,
            source: p.source ?? "manual",
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      // Exactly one primary. If the caller marked multiple, keep the first;
      // if none, promote position 0.
      let primaryAssigned = false;
      for (const r of phoneRows) {
        if (r.isPrimary && !primaryAssigned) {
          primaryAssigned = true;
        } else if (r.isPrimary) {
          r.isPrimary = false;
        }
      }
      if (!primaryAssigned && phoneRows[0]) phoneRows[0].isPrimary = true;

      return db.transaction(async (tx) => {
        await tx.insert(organizations).values({
          id: orgId,
          name: input.displayName,
          legalName: input.displayName,
          countryCode: country,
          status: "active",
        });
        const primary = phoneRows.find((p) => p.isPrimary);
        const wa = phoneRows.find((p) => p.isWhatsapp);
        const [row] = await tx
          .insert(sellerProfiles)
          .values({
            id: profileId,
            orgId,
            ownerAgentId: input.ownerAgentId,
            storeName: input.displayName,
            storeSlug: slug,
            // Mirror primary + first-whatsapp into the legacy columns so older
            // readers that still hit seller_profiles.phone keep working.
            phone: primary?.phoneE164 ?? null,
            whatsapp: wa?.phoneE164 ?? null,
            website: input.website ?? null,
            description: input.description ?? null,
            supportEmail: input.supportEmail ?? null,
            city: input.city ?? null,
            active: true,
          })
          .returning();
        if (phoneRows.length > 0) {
          await tx.insert(sellerPhones).values(phoneRows);
        }
        const phones = phoneRows
          .map((r) => ({
            phoneE164: r.phoneE164,
            isWhatsapp: r.isWhatsapp,
            isViber: r.isViber,
            isPrimary: r.isPrimary,
            position: r.position,
          }))
          .sort((a, b) => (a.isPrimary === b.isPrimary ? a.position - b.position : a.isPrimary ? -1 : 1));
        return shape(row!, phones, country);
      });
    },

    /**
     * Replace the full set of phones for a seller. Pass an empty array to
     * delete all phones. Inputs are normalized to E.164 and deduplicated.
     * Used by the scraper to keep contact info in sync with Ouedkniss.
     */
    async replacePhones(sellerId: string, phones: SellerPhoneInput[]): Promise<SellerPhone[]> {
      if (!isUuid(sellerId)) return [];
      const seen = new Set<string>();
      const rows = phones
        .map((p, i) => {
          const e164 = normalizeAlgerianPhone(p.phone);
          if (!e164 || seen.has(e164)) return null;
          seen.add(e164);
          return {
            id: uuidv7(),
            sellerId,
            phoneE164: e164,
            isWhatsapp: p.isWhatsapp ?? false,
            isViber: p.isViber ?? false,
            isPrimary: p.isPrimary ?? false,
            position: p.position ?? i,
            source: p.source ?? "manual",
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      let primaryAssigned = false;
      for (const r of rows) {
        if (r.isPrimary && !primaryAssigned) primaryAssigned = true;
        else if (r.isPrimary) r.isPrimary = false;
      }
      if (!primaryAssigned && rows[0]) rows[0].isPrimary = true;

      await db.transaction(async (tx) => {
        await tx.delete(sellerPhones).where(eq(sellerPhones.sellerId, sellerId));
        if (rows.length > 0) await tx.insert(sellerPhones).values(rows);
        const primary = rows.find((r) => r.isPrimary);
        const wa = rows.find((r) => r.isWhatsapp);
        await tx
          .update(sellerProfiles)
          .set({
            phone: primary?.phoneE164 ?? null,
            whatsapp: wa?.phoneE164 ?? null,
            updatedAt: new Date(),
          })
          .where(eq(sellerProfiles.orgId, sellerId));
      });
      return listPhones(sellerId);
    },

    async listPhones(sellerId: string): Promise<SellerPhone[]> {
      if (!isUuid(sellerId)) return [];
      return listPhones(sellerId);
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
      // Phone/whatsapp updates keep the legacy single-value columns AND the
      // seller_phones table in sync. The legacy columns stay populated so
      // anything still reading from seller_profiles directly keeps working.
      if (patch.phone !== undefined) {
        const e164 = patch.phone === null ? null : normalizeAlgerianPhone(patch.phone) ?? patch.phone;
        updates.phone = e164;
      }
      if (patch.whatsapp !== undefined) {
        const e164 =
          patch.whatsapp === null ? null : normalizeAlgerianPhone(patch.whatsapp) ?? patch.whatsapp;
        updates.whatsapp = e164;
      }
      if (patch.website !== undefined) updates.website = patch.website === null ? null : patch.website;

      const [row] = await db
        .update(sellerProfiles)
        .set(updates)
        .where(eq(sellerProfiles.orgId, sellerId))
        .returning();
      if (!row) return undefined;

      // Mirror the patch into seller_phones for the simple cases. If the
      // patch sets a phone to null, clear the matching seller_phones row.
      // If it sets a non-null value, upsert it as the primary. WhatsApp
      // updates flip is_whatsapp on the matching row (or insert a new row
      // if the number doesn't yet exist).
      await db.transaction(async (tx) => {
        if (patch.phone !== undefined) {
          if (patch.phone === null) {
            await tx
              .update(sellerPhones)
              .set({ isPrimary: false })
              .where(and(eq(sellerPhones.sellerId, sellerId), eq(sellerPhones.isPrimary, true)));
          } else {
            const e164 = normalizeAlgerianPhone(patch.phone);
            if (e164) {
              await tx
                .update(sellerPhones)
                .set({ isPrimary: false })
                .where(eq(sellerPhones.sellerId, sellerId));
              const existing = await tx
                .select()
                .from(sellerPhones)
                .where(and(eq(sellerPhones.sellerId, sellerId), eq(sellerPhones.phoneE164, e164)))
                .limit(1);
              if (existing[0]) {
                await tx
                  .update(sellerPhones)
                  .set({ isPrimary: true, updatedAt: new Date() })
                  .where(eq(sellerPhones.id, existing[0].id));
              } else {
                await tx.insert(sellerPhones).values({
                  id: uuidv7(),
                  sellerId,
                  phoneE164: e164,
                  isWhatsapp: false,
                  isViber: false,
                  isPrimary: true,
                  position: 0,
                  source: "update-contact",
                });
              }
            }
          }
        }
        if (patch.whatsapp !== undefined && patch.whatsapp !== null) {
          const e164 = normalizeAlgerianPhone(patch.whatsapp);
          if (e164) {
            const existing = await tx
              .select()
              .from(sellerPhones)
              .where(and(eq(sellerPhones.sellerId, sellerId), eq(sellerPhones.phoneE164, e164)))
              .limit(1);
            if (existing[0]) {
              await tx
                .update(sellerPhones)
                .set({ isWhatsapp: true, updatedAt: new Date() })
                .where(eq(sellerPhones.id, existing[0].id));
            } else {
              await tx.insert(sellerPhones).values({
                id: uuidv7(),
                sellerId,
                phoneE164: e164,
                isWhatsapp: true,
                isViber: false,
                isPrimary: false,
                position: 999,
                source: "update-contact",
              });
            }
          }
        }
      });
      const phones = await listPhones(sellerId);
      return shape(row, phones);
    },

    async get(sellerId: string): Promise<StoredSeller | undefined> {
      if (!isUuid(sellerId)) return undefined;
      const rows = await db
        .select({ profile: sellerProfiles, countryCode: organizations.countryCode })
        .from(sellerProfiles)
        .leftJoin(organizations, eq(organizations.id, sellerProfiles.orgId))
        .where(eq(sellerProfiles.orgId, sellerId))
        .limit(1);
      if (!rows[0]) return undefined;
      const phones = await listPhones(sellerId);
      return shape(rows[0].profile, phones, rows[0].countryCode);
    },

    async list(): Promise<StoredSeller[]> {
      const rows = await db
        .select({ profile: sellerProfiles, countryCode: organizations.countryCode })
        .from(sellerProfiles)
        .leftJoin(organizations, eq(organizations.id, sellerProfiles.orgId))
        .orderBy(sellerProfiles.createdAt);
      const ids = rows.map((r) => r.profile.orgId);
      const phoneMap = await phonesForSellers(ids);
      return rows.map((r) => shape(r.profile, phoneMap.get(r.profile.orgId) ?? [], r.countryCode));
    },

    // Case-insensitive lookup of a seller already owned by the same agent
    // with the same display name. Used by seller.create_account to reject
    // accidental duplicates ("SOP Loop Test Store" twice under one agent).
    // No unique index yet: this is a write-time soft check until the schema
    // gets a (owner_agent_id, lower(display_name)) constraint.
    async findOwnedByName(
      ownerAgentId: string,
      displayName: string,
    ): Promise<{ sellerId: string } | undefined> {
      const trimmed = displayName.trim();
      if (trimmed.length === 0) return undefined;
      const rows = await db
        .select({ id: sellerProfiles.orgId })
        .from(sellerProfiles)
        .where(
          and(
            eq(sellerProfiles.ownerAgentId, ownerAgentId),
            sql`lower(${sellerProfiles.storeName}) = lower(${trimmed})`,
          ),
        )
        .limit(1);
      return rows[0] ? { sellerId: rows[0].id } : undefined;
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
