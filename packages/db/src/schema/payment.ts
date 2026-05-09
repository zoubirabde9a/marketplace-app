// Schema: payment — intents, mandates (AP2), methods, transactions, refunds, payouts,
// disputes, escrow, double-entry ledger. Spec §4.6, §7.

import { boolean, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { amountMinor, createdAt, currencyCode, idCol, updatedAt, uuidv7 } from "./_common.js";
import { organizations, users, agents, agentPassports } from "./identity.js";

export const paymentSchema = pgSchema("payment");

// AP2 mandate hot table — see spec §3.5.
export const mandates = paymentSchema.table(
  "mandates",
  {
    id: idCol(),
    mandateKind: varchar("mandate_kind", { length: 16 }).notNull(), // intent|cart|payment|recurring_intent
    parentMandateId: uuidv7("parent_mandate_id"),
    principalUserId: uuidv7("principal_user_id").references(() => users.id),
    principalOrgId: uuidv7("principal_org_id").references(() => organizations.id),
    agentId: uuidv7("agent_id").references(() => agents.id),
    passportId: uuidv7("passport_id").references(() => agentPassports.id),
    contentHash: varchar("content_hash", { length: 128 }).notNull().unique(), // sha-256 hex
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    // Indexed denormalized fields for fast lookup; full VDC lives in audit.mandate_vault
    spendCapMinor: amountMinor("spend_cap_minor"),
    currency: currencyCode(),
    constraints: jsonb("constraints").$type<{
      merchants?: string[];
      categories?: string[];
      skus?: string[];
      maxItems?: number;
      jurisdictions?: string[];
      stepUpProof?: { tier: number; webauthn?: string };
    }>(),
    recurrence: jsonb("recurrence").$type<{
      interval: "day" | "week" | "month" | "year";
      intervalCount: number;
      maxPerPeriodMinor: string;
      endAfter?: number;
      totalCapMinor?: string;
      delegateTo?: string;
    }>(),
    createdAt,
  },
  (t) => ({
    principalIdx: uniqueIndex("mandates_principal_idx").on(t.principalUserId, t.id),
  }),
);

export const paymentIntents = paymentSchema.table("payment_intents", {
  id: idCol(),
  cartId: uuidv7("cart_id"),
  orderId: uuidv7("order_id"),
  cartMandateId: uuidv7("cart_mandate_id").references(() => mandates.id),
  paymentMandateId: uuidv7("payment_mandate_id").references(() => mandates.id),
  buyerUserId: uuidv7("buyer_user_id").references(() => users.id),
  buyerAgentId: uuidv7("buyer_agent_id").references(() => agents.id),
  amountMinor: amountMinor("amount_minor"),
  currency: currencyCode(),
  status: varchar("status", { length: 32 }).notNull().default("requires_confirmation"),
  provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
  providerIntentId: varchar("provider_intent_id", { length: 200 }),
  clientSecret: varchar("client_secret", { length: 256 }),
  idempotencyKey: varchar("idempotency_key", { length: 128 }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  createdAt,
  updatedAt,
});

export const paymentMethods = paymentSchema.table("payment_methods", {
  id: idCol(),
  ownerUserId: uuidv7("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  ownerOrgId: uuidv7("owner_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull(),
  providerMethodId: varchar("provider_method_id", { length: 200 }).notNull(),
  methodKind: varchar("method_kind", { length: 32 }).notNull(), // card|bank|wallet|virtual_card|stablecoin
  last4: varchar("last4", { length: 8 }),
  brand: varchar("brand", { length: 32 }),
  expiresMonth: integer("expires_month"),
  expiresYear: integer("expires_year"),
  isDefault: boolean("is_default").notNull().default(false),
  isSingleUse: boolean("is_single_use").notNull().default(false),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt,
});

export const transactions = paymentSchema.table("transactions", {
  id: idCol(),
  intentId: uuidv7("intent_id").references(() => paymentIntents.id),
  orderId: uuidv7("order_id"),
  txKind: varchar("tx_kind", { length: 16 }).notNull(), // charge|refund|payout|adjustment|chargeback
  amountMinor: amountMinor("amount_minor"),
  currency: currencyCode(),
  provider: varchar("provider", { length: 32 }).notNull(),
  providerTxId: varchar("provider_tx_id", { length: 200 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  rawProviderEvent: jsonb("raw_provider_event"),
  createdAt,
});

export const refunds = paymentSchema.table("refunds", {
  id: idCol(),
  orderId: uuidv7("order_id").notNull(),
  returnId: uuidv7("return_id"),
  amountMinor: amountMinor("amount_minor"),
  currency: currencyCode(),
  routingMethod: varchar("routing_method", { length: 32 }).notNull(),
  // original_source|wallet|manual_payout|credit_note_vdc
  routingProviderRef: varchar("routing_provider_ref", { length: 200 }),
  reason: varchar("reason", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  initiatedBy: varchar("initiated_by", { length: 128 }),
  metadata: jsonb("metadata"),
  createdAt,
  updatedAt,
});

export const payouts = paymentSchema.table("payouts", {
  id: idCol(),
  payoutAccountId: uuidv7("payout_account_id").notNull(),
  orgId: uuidv7("org_id").notNull().references(() => organizations.id),
  amountMinor: amountMinor("amount_minor"),
  currency: currencyCode(),
  provider: varchar("provider", { length: 32 }).notNull(),
  providerPayoutId: varchar("provider_payout_id", { length: 200 }),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: "date" }),
  paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
  holdReason: varchar("hold_reason", { length: 200 }),
  periodStart: timestamp("period_start", { withTimezone: true, mode: "date" }),
  periodEnd: timestamp("period_end", { withTimezone: true, mode: "date" }),
  createdAt,
});

export const disputes = paymentSchema.table("disputes", {
  id: idCol(),
  orderId: uuidv7("order_id").notNull(),
  openedByUserId: uuidv7("opened_by_user_id").references(() => users.id),
  openedByAgentId: uuidv7("opened_by_agent_id").references(() => agents.id),
  reason: varchar("reason", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  // open|seller_responded|escalated|resolved_buyer|resolved_seller|withdrawn
  amountClaimedMinor: amountMinor("amount_claimed_minor"),
  currency: currencyCode(),
  evidence: jsonb("evidence"),
  resolution: jsonb("resolution"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  slaDueAt: timestamp("sla_due_at", { withTimezone: true, mode: "date" }),
  createdAt,
  updatedAt,
});

export const chargebacks = paymentSchema.table("chargebacks", {
  id: idCol(),
  orderId: uuidv7("order_id").notNull(),
  providerCaseId: varchar("provider_case_id", { length: 200 }).notNull(),
  reasonCode: varchar("reason_code", { length: 32 }).notNull(),
  amountMinor: amountMinor("amount_minor"),
  currency: currencyCode(),
  status: varchar("status", { length: 32 }).notNull(),
  evidenceDueAt: timestamp("evidence_due_at", { withTimezone: true, mode: "date" }),
  evidenceSubmittedAt: timestamp("evidence_submitted_at", { withTimezone: true, mode: "date" }),
  createdAt,
});

export const escrowHolds = paymentSchema.table("escrow_holds", {
  id: idCol(),
  orderId: uuidv7("order_id").notNull(),
  sellerOrgId: uuidv7("seller_org_id").notNull().references(() => organizations.id),
  amountMinor: amountMinor("amount_minor"),
  currency: currencyCode(),
  reason: varchar("reason", { length: 64 }).notNull(),
  releaseAt: timestamp("release_at", { withTimezone: true, mode: "date" }),
  releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" }),
  status: varchar("status", { length: 32 }).notNull().default("held"),
  createdAt,
});

export const walletBalances = paymentSchema.table("wallet_balances", {
  id: idCol(),
  ownerUserId: uuidv7("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  ownerOrgId: uuidv7("owner_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  currency: currencyCode(),
  availableMinor: amountMinor("available_minor"),
  pendingMinor: amountMinor("pending_minor"),
  updatedAt,
});

// Double-entry ledger — spec §7.3
export const ledgerAccounts = paymentSchema.table(
  "ledger_accounts",
  {
    id: idCol(),
    accountKind: varchar("account_kind", { length: 32 }).notNull(),
    // platform_revenue|tax_payable|seller_payable|buyer_wallet|stripe_clearing|charity|tip
    ownerOrgId: uuidv7("owner_org_id").references(() => organizations.id),
    ownerUserId: uuidv7("owner_user_id").references(() => users.id),
    currency: currencyCode(),
    normalSide: varchar("normal_side", { length: 8 }).notNull(), // debit|credit
    description: text("description"),
    createdAt,
  },
  (t) => ({
    uniq: uniqueIndex("ledger_accounts_unique").on(t.accountKind, t.ownerOrgId, t.ownerUserId, t.currency),
  }),
);

export const ledgerEntries = paymentSchema.table("ledger_entries", {
  id: idCol(),
  txGroupId: uuidv7("tx_group_id").notNull(), // groups all legs of a single business transaction
  accountId: uuidv7("account_id").notNull().references(() => ledgerAccounts.id),
  side: varchar("side", { length: 8 }).notNull(), // debit|credit
  amountMinor: amountMinor("amount_minor"),
  currency: currencyCode(),
  orderId: uuidv7("order_id"),
  legType: varchar("leg_type", { length: 32 }).notNull(),
  // gross_charge|seller_split|marketplace_fee|tax_remit|affiliate|tip|charity|fx|refund|payout
  externalRef: varchar("external_ref", { length: 200 }),
  postedAt: timestamp("posted_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const sagaExecutions = paymentSchema.table("saga_executions", {
  id: idCol(),
  sagaKind: varchar("saga_kind", { length: 64 }).notNull(),
  orderId: uuidv7("order_id"),
  state: jsonb("state").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"), // pending|running|compensating|completed|failed
  step: varchar("step", { length: 64 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }),
  createdAt,
  updatedAt,
});
