// Schema: order — orders, items, status history, fulfillments, shipments, returns, RMAs. Spec §4.5.

import { integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { amountMinor, createdAt, currencyCode, idCol, updatedAt, uuidv7 } from "./_common.js";
import { organizations, users, agents } from "./identity.js";
import { productVariants } from "./catalog.js";

export const orderSchema = pgSchema("order");

export const orders = orderSchema.table(
  "orders",
  {
    id: idCol(),
    publicNumber: varchar("public_number", { length: 32 }).notNull().unique(), // human-friendly
    buyerUserId: uuidv7("buyer_user_id").references(() => users.id),
    buyerAgentId: uuidv7("buyer_agent_id").references(() => agents.id),
    buyerOrgId: uuidv7("buyer_org_id").references(() => organizations.id),
    cartId: uuidv7("cart_id"),
    mandateId: varchar("mandate_id", { length: 128 }),
    paymentMandateId: varchar("payment_mandate_id", { length: 128 }),
    paymentIntentId: uuidv7("payment_intent_id"),
    currency: currencyCode(),
    subtotalMinor: amountMinor("subtotal_minor"),
    discountMinor: amountMinor("discount_minor"),
    shippingMinor: amountMinor("shipping_minor"),
    taxMinor: amountMinor("tax_minor"),
    tipMinor: amountMinor("tip_minor"),
    totalMinor: amountMinor("total_minor"),
    status: varchar("status", { length: 32 }).notNull().default("created"),
    // created|authorized|paid|fulfilling|shipped|delivered|cancelled|refunded|disputed
    placedAt: timestamp("placed_at", { withTimezone: true, mode: "date" }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    accessToken: varchar("access_token", { length: 128 }),
    ownerKind: varchar("owner_kind", { length: 16 }).notNull().default("anonymous"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    metadata: jsonb("metadata"),
    createdAt,
    updatedAt,
  },
  (t) => ({
    idemUnique: uniqueIndex("orders_idempotency_unique").on(t.idempotencyKey, t.buyerAgentId, t.buyerUserId),
  }),
);

export const orderItems = orderSchema.table("order_items", {
  id: idCol(),
  orderId: uuidv7("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  variantId: uuidv7("variant_id").notNull().references(() => productVariants.id),
  sellerId: uuidv7("seller_id").notNull().references(() => organizations.id),
  qty: integer("qty").notNull(),
  unitPriceMinor: amountMinor("unit_price_minor"),
  taxMinor: amountMinor("tax_minor"),
  shippingMinor: amountMinor("shipping_minor"),
  discountMinor: amountMinor("discount_minor"),
  productSnapshot: jsonb("product_snapshot").notNull(),
  fulfillmentStatus: varchar("fulfillment_status", { length: 32 }).notNull().default("unfulfilled"),
});

export const orderStatusHistory = orderSchema.table("order_status_history", {
  id: idCol(),
  orderId: uuidv7("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  fromStatus: varchar("from_status", { length: 32 }),
  toStatus: varchar("to_status", { length: 32 }).notNull(),
  reason: varchar("reason", { length: 200 }),
  actorKind: varchar("actor_kind", { length: 16 }).notNull(), // human|agent|system
  actorId: varchar("actor_id", { length: 128 }),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const fulfillments = orderSchema.table("fulfillments", {
  id: idCol(),
  orderId: uuidv7("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  sellerId: uuidv7("seller_id").notNull().references(() => organizations.id),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  shippedAt: timestamp("shipped_at", { withTimezone: true, mode: "date" }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
  createdAt,
  updatedAt,
});

export const shipments = orderSchema.table("shipments", {
  id: idCol(),
  fulfillmentId: uuidv7("fulfillment_id").notNull().references(() => fulfillments.id, { onDelete: "cascade" }),
  carrier: varchar("carrier", { length: 64 }).notNull(),
  service: varchar("service", { length: 64 }),
  trackingNumber: varchar("tracking_number", { length: 128 }),
  trackingUrl: text("tracking_url"),
  weightGrams: integer("weight_grams"),
  shippingLabelUrl: text("shipping_label_url"),
  customsDeclaration: jsonb("customs_declaration"),
  status: varchar("status", { length: 32 }).notNull().default("label_purchased"),
  createdAt,
  updatedAt,
});

export const returns = orderSchema.table("returns", {
  id: idCol(),
  orderId: uuidv7("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  rmaCode: varchar("rma_code", { length: 32 }).notNull().unique(),
  reason: varchar("reason", { length: 64 }).notNull(),
  reasonDetail: text("reason_detail"),
  status: varchar("status", { length: 32 }).notNull().default("requested"),
  // requested|approved|received|inspecting|refunded|denied
  refundMinor: amountMinor("refund_minor"),
  restockingFeeMinor: amountMinor("restocking_fee_minor"),
  returnLabelUrl: text("return_label_url"),
  requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  createdAt,
  updatedAt,
});

export const returnItems = orderSchema.table("return_items", {
  id: idCol(),
  returnId: uuidv7("return_id").notNull().references(() => returns.id, { onDelete: "cascade" }),
  orderItemId: uuidv7("order_item_id").notNull().references(() => orderItems.id),
  qty: integer("qty").notNull(),
  condition: varchar("condition", { length: 32 }), // new|used|damaged|missing
  inspectionNotes: text("inspection_notes"),
});

export const subscriptions = orderSchema.table("subscriptions", {
  id: idCol(),
  buyerUserId: uuidv7("buyer_user_id").references(() => users.id),
  buyerAgentId: uuidv7("buyer_agent_id").references(() => agents.id),
  parentMandateId: varchar("parent_mandate_id", { length: 128 }).notNull(), // recurring intent mandate
  variantId: uuidv7("variant_id").notNull().references(() => productVariants.id),
  qty: integer("qty").notNull(),
  intervalKind: varchar("interval_kind", { length: 16 }).notNull(), // day|week|month|year
  intervalCount: integer("interval_count").notNull().default(1),
  nextRenewalAt: timestamp("next_renewal_at", { withTimezone: true, mode: "date" }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"), // active|paused|cancelled|expired
  totalCapMinor: amountMinor("total_cap_minor"),
  consumedMinor: amountMinor("consumed_minor"),
  endAfterCycles: integer("end_after_cycles"),
  cyclesCompleted: integer("cycles_completed").notNull().default(0),
  retryCount: integer("retry_count").notNull().default(0),
  pausedReason: varchar("paused_reason", { length: 64 }),
  mandateRefreshDueAt: timestamp("mandate_refresh_due_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt,
  updatedAt,
});
