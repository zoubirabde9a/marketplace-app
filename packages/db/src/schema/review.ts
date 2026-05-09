// Schema: review — reviews, ratings, responses, signals. Spec §4.8, §8a.2.

import { boolean, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createdAt, idCol, updatedAt, uuidv7 } from "./_common.js";
import { products } from "./catalog.js";
import { users, agents } from "./identity.js";

export const reviewSchema = pgSchema("review");

export const reviews = reviewSchema.table(
  "reviews",
  {
    id: idCol(),
    productId: uuidv7("product_id").references(() => products.id, { onDelete: "cascade" }),
    canonicalProductId: uuidv7("canonical_product_id"),
    orderItemId: uuidv7("order_item_id").notNull(),
    reviewerUserId: uuidv7("reviewer_user_id").references(() => users.id),
    reviewerAgentId: uuidv7("reviewer_agent_id").references(() => agents.id),
    authorKind: varchar("author_kind", { length: 16 }).notNull(), // human|agent
    rating: integer("rating").notNull(), // 1..5
    titleSanitized: text("title_sanitized"),
    bodySanitized: text("body_sanitized").notNull(),
    bodyRaw: text("body_raw").notNull(),
    verifiedPurchase: boolean("verified_purchase").notNull().default(false),
    outcome: varchar("outcome", { length: 16 }), // returned|kept
    moderationStatus: varchar("moderation_status", { length: 16 }).notNull().default("visible"),
    // visible|excluded_from_avg|suppressed
    suppressionReason: varchar("suppression_reason", { length: 64 }),
    suspicionScore: integer("suspicion_score").notNull().default(0),
    helpfulCount: integer("helpful_count").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => ({
    uniqOrderItem: uniqueIndex("reviews_order_item_unique").on(t.orderItemId, t.reviewerUserId, t.reviewerAgentId),
  }),
);

export const reviewResponses = reviewSchema.table("review_responses", {
  id: idCol(),
  reviewId: uuidv7("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  responderOrgId: uuidv7("responder_org_id").notNull(),
  bodySanitized: text("body_sanitized").notNull(),
  bodyRaw: text("body_raw").notNull(),
  createdAt,
});

export const reviewSignals = reviewSchema.table("review_signals", {
  id: idCol(),
  reviewId: uuidv7("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  signal: varchar("signal", { length: 64 }).notNull(),
  // burst|linguistic_cluster|reviewer_history|incentive|wash_trade|honeypot_canary
  weight: integer("weight").notNull(),
  evidence: jsonb("evidence"),
  detectedAt: timestamp("detected_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const reviewAppeals = reviewSchema.table("review_appeals", {
  id: idCol(),
  reviewId: uuidv7("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  filedByKind: varchar("filed_by_kind", { length: 16 }).notNull(), // reviewer|seller
  filedById: varchar("filed_by_id", { length: 128 }).notNull(),
  argument: text("argument"),
  status: varchar("status", { length: 16 }).notNull().default("open"), // open|upheld|overturned
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
  decidedBy: varchar("decided_by", { length: 128 }),
  createdAt,
});
