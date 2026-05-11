// Schema: seller — profiles, KYB, payout accounts, policies, metrics. Spec §4.3.

import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createdAt, idCol, updatedAt, uuidv7 } from "./_common.js";
import { organizations } from "./identity.js";

export const sellerSchema = pgSchema("seller");

export const sellerProfiles = sellerSchema.table("seller_profiles", {
  id: idCol(),
  orgId: uuidv7("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  ownerAgentId: varchar("owner_agent_id", { length: 200 }).notNull(),
  storeName: varchar("store_name", { length: 200 }).notNull(),
  storeSlug: varchar("store_slug", { length: 200 }).notNull().unique(),
  description: text("description"),
  supportEmail: varchar("support_email", { length: 320 }),
  supportUrl: varchar("support_url", { length: 512 }),
  phone: varchar("phone", { length: 32 }),
  whatsapp: varchar("whatsapp", { length: 32 }),
  website: varchar("website", { length: 512 }),
  city: varchar("city", { length: 120 }),
  active: boolean("active").notNull().default(false),
  reserveBps: integer("reserve_bps").notNull().default(0), // payout holdback bps for new sellers
  createdAt,
  updatedAt,
});

// Multiple contact phones per seller. Replaces the single `phone` / `whatsapp`
// columns on seller_profiles (kept for now for compatibility). Each row is one
// phone number in canonical E.164 form (+213…); `is_whatsapp` / `is_viber`
// reflect what Ouedkniss publishes per-number, `is_primary` marks the lead
// contact (enforced unique-per-seller via a partial unique index below),
// `position` preserves the order Ouedkniss returned them in, and `source`
// records where we got the number (e.g. 'ouedkniss-store', 'manual').
export const sellerPhones = sellerSchema.table(
  "seller_phones",
  {
    id: idCol(),
    sellerId: uuidv7("seller_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
    isWhatsapp: boolean("is_whatsapp").notNull().default(false),
    isViber: boolean("is_viber").notNull().default(false),
    isPrimary: boolean("is_primary").notNull().default(false),
    position: integer("position").notNull().default(0),
    source: varchar("source", { length: 32 }).notNull().default("manual"),
    createdAt,
    updatedAt,
  },
  (t) => ({
    sellerPhoneUnique: uniqueIndex("seller_phones_seller_phone_unique").on(t.sellerId, t.phoneE164),
    sellerPrimaryUnique: uniqueIndex("seller_phones_primary_unique")
      .on(t.sellerId)
      .where(sql`${t.isPrimary}`),
  }),
);

export const kybRecords = sellerSchema.table("kyb_records", {
  id: idCol(),
  orgId: uuidv7("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull(), // stripe_connect | persona | manual
  providerRef: varchar("provider_ref", { length: 200 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(), // pending|approved|rejected|review
  evidence: jsonb("evidence"),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
  createdAt,
  updatedAt,
});

export const payoutAccounts = sellerSchema.table("payout_accounts", {
  id: idCol(),
  orgId: uuidv7("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull(),
  providerAccountId: varchar("provider_account_id", { length: 200 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  countryCode: varchar("country_code", { length: 2 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt,
  updatedAt,
});

export const sellerPolicies = sellerSchema.table("seller_policies", {
  id: idCol(),
  orgId: uuidv7("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  returnsWindowDays: integer("returns_window_days").notNull().default(30),
  restockingFeeBps: integer("restocking_fee_bps").notNull().default(0),
  shippingSlaHours: integer("shipping_sla_hours").notNull().default(48),
  warrantyMonths: integer("warranty_months"),
  acceptsReturns: boolean("accepts_returns").notNull().default(true),
  policiesText: jsonb("policies_text").$type<Record<string, string>>(), // localized
  updatedAt,
});

export const sellerMetrics = sellerSchema.table("seller_metrics", {
  id: idCol(),
  orgId: uuidv7("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  ordersCount30d: integer("orders_count_30d").notNull().default(0),
  cancellationRate30dBps: integer("cancellation_rate_30d_bps").notNull().default(0),
  refundRate30dBps: integer("refund_rate_30d_bps").notNull().default(0),
  disputeRate30dBps: integer("dispute_rate_30d_bps").notNull().default(0),
  avgShipHours30d: integer("avg_ship_hours_30d"),
  ratingAvgBps: integer("rating_avg_bps"), // basis points of 5-star scale
  ratingCount: integer("rating_count").notNull().default(0),
  updatedAt,
});

export const brandRegistry = sellerSchema.table("brand_registry", {
  id: idCol(),
  brand: varchar("brand", { length: 200 }).notNull().unique(),
  ownerOrgId: uuidv7("owner_org_id").references(() => organizations.id, { onDelete: "set null" }),
  authorizedSellers: jsonb("authorized_sellers").$type<string[]>(),
  authoritativeAttributes: jsonb("authoritative_attributes").$type<Record<string, unknown>>(),
  status: varchar("status", { length: 16 }).notNull().default("verified"),
  createdAt,
  updatedAt,
});
