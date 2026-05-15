import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "@marketplace/shared/ids";
import { normalizeAlgerianPhone } from "@marketplace/shared/phone";
import { sanitizeUntrustedString, safeOrigin } from "@marketplace/shared/untrusted";
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
  // Resolve the legacy `phone` field by EXPLICIT primary only. The previous
  // `?? phones[0]` fallback defeated `updateContact({ phone: null })` —
  // clearing the primary flag left phones[0] picking up the next-in-line
  // entry, so the seller's PATCH to remove their phone surfaced as a
  // different number on the next read. Treat "no isPrimary row" as "no
  // surfaced legacy phone"; the full `phones[]` array is always available
  // to callers that need to see every number regardless of flag state.
  const primary = phones.find((p) => p.isPrimary);
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
    // Push the seller-id filter into SQL via `inArray`. The previous version
    // pulled EVERY phone row from the table and filtered in JS — a quiet
    // O(total_phones × queries) cost on what should be a bounded
    // `O(input_ids × avg_phones_per_seller)` lookup. At ~14k sellers with a
    // handful of phones each, every listSellers call was scanning ~30k
    // rows to materialize phones for one page of results. The earlier
    // comment claimed avoiding the import kept things simple — but the
    // function lives alongside other Drizzle uses and an `inArray` import
    // is one identifier added to the existing import line.
    const rows = await db
      .select()
      .from(sellerPhones)
      .where(inArray(sellerPhones.sellerId, sellerIds))
      .orderBy(desc(sellerPhones.isPrimary), asc(sellerPhones.position), asc(sellerPhones.createdAt));
    for (const row of rows) {
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
      // Sanitise seller-supplied free text at the write boundary. `displayName`
      // and `description` flow onto every storefront card and into product
      // pages — both surfaces are candidates for LLM-rendered summarisation
      // (catalog Q&A, product recommendations). A seller writing `<system>` /
      // "ignore previous instructions" into their store name would otherwise
      // inject any downstream LLM that reads the catalog. Mirrors the order
      // / dispute / customer scrubs (passes #90 / #91 / #97 / #105) and the
      // product write-time sanitisation already done in repos/product.ts.
      const origin = safeOrigin("seller", input.ownerAgentId);
      const displayName = sanitizeUntrustedString(input.displayName, { maxLength: 120, origin });
      const description = input.description !== undefined
        ? sanitizeUntrustedString(input.description, { maxLength: 1000, origin })
        : undefined;

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
          name: displayName,
          legalName: displayName,
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
            storeName: displayName,
            storeSlug: slug,
            // Mirror primary + first-whatsapp into the legacy columns so older
            // readers that still hit seller_profiles.phone keep working.
            phone: primary?.phoneE164 ?? null,
            whatsapp: wa?.phoneE164 ?? null,
            website: input.website ?? null,
            description: description ?? null,
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
      // seller_phones table in sync. Reject inputs that the phone normaliser
      // doesn't recognise — the previous code fell back to the RAW string
      // for the legacy column when normalize returned undefined, so the
      // legacy `seller_profiles.phone` would land with a junk value while
      // the new `seller_phones` table got NOTHING (the side-syncing block
      // below silently no-ops when `e164` is undefined). That left every
      // seller in an inconsistent state per-row, with the legacy column
      // showing the typo and the new column missing it.
      if (patch.phone !== undefined) {
        if (patch.phone === null) {
          updates.phone = null;
        } else {
          const e164 = normalizeAlgerianPhone(patch.phone);
          if (!e164) return undefined; // refuse the whole patch — caller will surface a 400
          updates.phone = e164;
        }
      }
      if (patch.whatsapp !== undefined) {
        if (patch.whatsapp === null) {
          updates.whatsapp = null;
        } else {
          const e164 = normalizeAlgerianPhone(patch.whatsapp);
          if (!e164) return undefined;
          updates.whatsapp = e164;
        }
      }
      if (patch.website !== undefined) updates.website = patch.website === null ? null : patch.website;

      // Wrap the legacy-column update AND the seller_phones sync in a
      // SINGLE transaction so they commit-or-rollback together. The
      // previous shape ran the legacy update outside any transaction and
      // started a NEW transaction for the phones table — if the phones
      // transaction failed, the legacy column was already committed with
      // a stale value, leaving the two columns disagreeing.
      const out = await db.transaction(async (tx) => {
        const [row] = await tx
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
        if (patch.whatsapp !== undefined) {
          if (patch.whatsapp === null) {
            // Clearing whatsapp must also flip `is_whatsapp` off on every
            // seller_phones row for this seller — pre-fix only the legacy
            // `seller_profiles.whatsapp` column was nulled, while the
            // phones row retained `is_whatsapp = true`, and the `shape()`
            // function resolves `whatsapp` from `phones.find(p =>
            // p.isWhatsapp)`. Result: PATCH to clear whatsapp succeeded
            // but the next read still surfaced the cleared number.
            await tx
              .update(sellerPhones)
              .set({ isWhatsapp: false, updatedAt: new Date() })
              .where(and(eq(sellerPhones.sellerId, sellerId), eq(sellerPhones.isWhatsapp, true)));
          } else {
            const e164 = normalizeAlgerianPhone(patch.whatsapp);
            if (e164) {
              // Clear any other rows' is_whatsapp first so only this one
              // ends up marked — otherwise a previous whatsapp would
              // co-exist with the new one and `shape()` could pick either.
              await tx
                .update(sellerPhones)
                .set({ isWhatsapp: false, updatedAt: new Date() })
                .where(and(eq(sellerPhones.sellerId, sellerId), eq(sellerPhones.isWhatsapp, true)));
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
        }
        return row;
      });
      if (!out) return undefined;
      const phones = await listPhones(sellerId);
      return shape(out, phones);
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
      // Hard cap on the result set. Pre-fix this returned every seller with
      // no upper bound — at 1000+ sellers the response gets large and each
      // row triggers a phone-lookup join (`phonesForSellers`). The route
      // /v1/sellers filters/paginates in memory after this call, so the
      // filter only sees this prefix; this is imperfect (a search query
      // matching a seller past row 5000 would miss) but bounds the memory
      // and CPU cost while a proper DB-level filter+paginate is wired in.
      // 5000 covers any realistic dev/staging seller count; production
      // catalogue currently has ~50 sellers (2026-05-15).
      const rows = await db
        .select({ profile: sellerProfiles, countryCode: organizations.countryCode })
        .from(sellerProfiles)
        .leftJoin(organizations, eq(organizations.id, sellerProfiles.orgId))
        .orderBy(sellerProfiles.createdAt)
        .limit(5000);
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
      // Match the active-only filter every public-read product surface
      // applies (loadAll / loadOneActive / getProductsByIds / searchIds /
      // idsBySeller / recentIds / idsByCategory — passes #84 / #134 / #135).
      // countProducts is surfaced on /v1/sellers and /v1/sellers/:id which
      // are public-read endpoints. Pre-fix a seller card said "10
      // products" while the storefront only showed 7 active ones — buyers
      // hit the store, saw fewer than promised, lost trust. Drafts and
      // removed listings shouldn't pad the public-facing count.
      const rows = await db
        .select({ n: count() })
        .from(products)
        .where(and(eq(products.sellerId, sellerId), eq(products.status, "active")));
      return Number(rows[0]?.n ?? 0);
    },
  };
}
