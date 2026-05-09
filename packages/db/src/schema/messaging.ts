// Schema: messaging — threads, messages, notifications, webhooks, A2A dialogues. Spec §4.7.

import { boolean, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createdAt, idCol, updatedAt, uuidv7 } from "./_common.js";
import { organizations, users, agents } from "./identity.js";

export const messagingSchema = pgSchema("messaging");

export const threads = messagingSchema.table("threads", {
  id: idCol(),
  subjectKind: varchar("subject_kind", { length: 32 }).notNull(), // order|listing|dispute|general
  subjectId: uuidv7("subject_id"),
  participantUserIds: jsonb("participant_user_ids").$type<string[]>(),
  participantAgentIds: jsonb("participant_agent_ids").$type<string[]>(),
  participantOrgIds: jsonb("participant_org_ids").$type<string[]>(),
  status: varchar("status", { length: 16 }).notNull().default("open"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date" }),
  createdAt,
});

export const messages = messagingSchema.table("messages", {
  id: idCol(),
  threadId: uuidv7("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  senderKind: varchar("sender_kind", { length: 16 }).notNull(), // human|agent|system
  senderId: varchar("sender_id", { length: 128 }).notNull(),
  bodyRaw: text("body_raw").notNull(),
  bodySanitized: text("body_sanitized").notNull(),
  attachments: jsonb("attachments"),
  authorKind: varchar("author_kind", { length: 16 }).notNull().default("human"),
  redacted: boolean("redacted").notNull().default(false),
  createdAt,
});

export const notifications = messagingSchema.table("notifications", {
  id: idCol(),
  recipientUserId: uuidv7("recipient_user_id").references(() => users.id, { onDelete: "cascade" }),
  recipientAgentId: uuidv7("recipient_agent_id").references(() => agents.id, { onDelete: "cascade" }),
  channel: varchar("channel", { length: 16 }).notNull(), // email|push|webhook|inbox
  topic: varchar("topic", { length: 64 }).notNull(),
  payload: jsonb("payload").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: "date" }),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  lastError: text("last_error"),
  createdAt,
});

export const webhooksOutbound = messagingSchema.table("webhooks_outbound", {
  id: idCol(),
  ownerOrgId: uuidv7("owner_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  endpointUrl: text("endpoint_url").notNull(),
  topics: jsonb("topics").notNull().$type<string[]>(),
  signingSecret: text("signing_secret").notNull(),
  publicKeyKid: varchar("public_key_kid", { length: 64 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt,
  updatedAt,
});

export const webhookDeliveries = messagingSchema.table("webhook_deliveries", {
  id: idCol(),
  webhookId: uuidv7("webhook_id").notNull().references(() => webhooksOutbound.id, { onDelete: "cascade" }),
  topic: varchar("topic", { length: 64 }).notNull(),
  payload: jsonb("payload").notNull(),
  signature: text("signature").notNull(),
  idempotencyToken: varchar("idempotency_token", { length: 128 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }),
  responseStatus: integer("response_status"),
  responseBodySnippet: text("response_body_snippet"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
  createdAt,
});

export const agentDialogues = messagingSchema.table(
  "agent_dialogues",
  {
    id: idCol(),
    skill: varchar("skill", { length: 64 }).notNull(),
    fromAgentId: uuidv7("from_agent_id").notNull().references(() => agents.id),
    toAgentId: uuidv7("to_agent_id").notNull().references(() => agents.id),
    transcript: jsonb("transcript").notNull().$type<Array<{ role: string; content: unknown; at: string }>>(),
    transcriptHash: varchar("transcript_hash", { length: 128 }).notNull(),
    outcome: varchar("outcome", { length: 32 }), // accepted|rejected|expired|cancelled
    relatedOrderId: uuidv7("related_order_id"),
    relatedMandateId: uuidv7("related_mandate_id"),
    createdAt,
    updatedAt,
  },
  (t) => ({
    hashUnique: uniqueIndex("agent_dialogues_hash_unique").on(t.transcriptHash),
  }),
);
