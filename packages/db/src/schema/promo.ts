// Schema: promo — coupons, promotions, loyalty, referrals, affiliates. Spec §4.9.

import { boolean, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { amountMinor, createdAt, currencyCode, idCol, updatedAt, uuidv7 } from "./_common.js";
import { organizations, users, agents } from "./identity.js";

export const promoSchema = pgSchema("promo");

export const promotions = promoSchema.table("promotions", {
  id: idCol(),
  sellerOrgId: uuidv7("seller_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  promoKind: varchar("promo_kind", { length: 32 }).notNull(),
  // percent_off|amount_off|bogo|tiered|free_shipping|bundle|loyalty_multiplier
  conditions: jsonb("conditions").notNull(),
  benefits: jsonb("benefits").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
  maxRedemptions: integer("max_redemptions"),
  redeemedCount: integer("redeemed_count").notNull().default(0),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt,
  updatedAt,
});

export const coupons = promoSchema.table(
  "coupons",
  {
    id: idCol(),
    promotionId: uuidv7("promotion_id").notNull().references(() => promotions.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    maxUsesPerPrincipal: integer("max_uses_per_principal").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt,
  },
  (t) => ({
    codeUnique: uniqueIndex("coupons_code_unique").on(t.code),
  }),
);

export const couponRedemptions = promoSchema.table("coupon_redemptions", {
  id: idCol(),
  couponId: uuidv7("coupon_id").notNull().references(() => coupons.id, { onDelete: "cascade" }),
  orderId: uuidv7("order_id").notNull(),
  principalUserId: uuidv7("principal_user_id"),
  principalAgentId: uuidv7("principal_agent_id"),
  amountSavedMinor: amountMinor("amount_saved_minor"),
  currency: currencyCode(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const loyaltyAccounts = promoSchema.table("loyalty_accounts", {
  id: idCol(),
  ownerUserId: uuidv7("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  ownerAgentId: uuidv7("owner_agent_id").references(() => agents.id, { onDelete: "cascade" }),
  programKey: varchar("program_key", { length: 64 }).notNull(),
  pointsBalance: integer("points_balance").notNull().default(0),
  tier: varchar("tier", { length: 32 }).notNull().default("standard"),
  createdAt,
  updatedAt,
});

export const loyaltyLedger = promoSchema.table("loyalty_ledger", {
  id: idCol(),
  accountId: uuidv7("account_id").notNull().references(() => loyaltyAccounts.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  reason: varchar("reason", { length: 64 }).notNull(),
  reference: jsonb("reference"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const referrals = promoSchema.table("referrals", {
  id: idCol(),
  referrerUserId: uuidv7("referrer_user_id").references(() => users.id),
  referrerAgentId: uuidv7("referrer_agent_id").references(() => agents.id),
  inviteCode: varchar("invite_code", { length: 32 }).notNull().unique(),
  referredUserId: uuidv7("referred_user_id").references(() => users.id),
  rewardKind: varchar("reward_kind", { length: 32 }).notNull(),
  rewardValue: integer("reward_value").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true, mode: "date" }),
  createdAt,
});

export const affiliatePartners = promoSchema.table("affiliate_partners", {
  id: idCol(),
  orgId: uuidv7("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  trackingCode: varchar("tracking_code", { length: 64 }).notNull().unique(),
  commissionBps: integer("commission_bps").notNull(),
  cookieWindowDays: integer("cookie_window_days").notNull().default(30),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt,
});

export const giftCards = promoSchema.table(
  "gift_cards",
  {
    id: idCol(),
    code: varchar("code", { length: 64 }).notNull().unique(),
    initialMinor: amountMinor("initial_minor"),
    balanceMinor: amountMinor("balance_minor"),
    currency: currencyCode(),
    issuedToUserId: uuidv7("issued_to_user_id").references(() => users.id),
    issuedToAgentId: uuidv7("issued_to_agent_id").references(() => agents.id),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt,
  },
);
