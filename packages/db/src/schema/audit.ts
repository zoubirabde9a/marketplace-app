// Schema: audit — append-only events with hash chaining, mandate vault, agent actions,
// reputation. Spec §4.11, §3.5, §7a.

import { bigserial, boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createdAt, idCol, uuidv7 } from "./_common.js";
import { agents, agentPassports } from "./identity.js";

export const auditSchema = pgSchema("audit");

export const auditEvents = auditSchema.table(
  "audit_events",
  {
    id: idCol(),
    seq: integer("seq").notNull(), // monotonic, partitioned by date
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    actorKind: varchar("actor_kind", { length: 16 }).notNull(),
    actorId: varchar("actor_id", { length: 128 }).notNull(),
    eventKind: varchar("event_kind", { length: 64 }).notNull(),
    subjectKind: varchar("subject_kind", { length: 32 }),
    subjectId: varchar("subject_id", { length: 128 }),
    payload: jsonb("payload").notNull(),
    prevHash: varchar("prev_hash", { length: 128 }), // sha-256 hex of previous event
    selfHash: varchar("self_hash", { length: 128 }).notNull(),
    requestId: varchar("request_id", { length: 64 }),
    ip: varchar("ip", { length: 45 }),
    createdAt,
  },
  (t) => ({
    seqUnique: uniqueIndex("audit_events_seq_unique").on(t.occurredAt, t.seq),
  }),
);

export const auditChainAnchors = auditSchema.table("audit_chain_anchors", {
  id: idCol(),
  windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true, mode: "date" }).notNull(),
  merkleRoot: varchar("merkle_root", { length: 128 }).notNull(),
  externalAnchorRef: text("external_anchor_ref"), // pubchain tx ref if anchored
  createdAt,
});

export const mandateVault = auditSchema.table("mandate_vault", {
  id: idCol(),
  mandateId: uuidv7("mandate_id").notNull().unique(),
  encryptedVdc: text("encrypted_vdc").notNull(), // AES-256-GCM, KMS-managed key
  encryptionKid: varchar("encryption_kid", { length: 64 }).notNull(),
  contentHash: varchar("content_hash", { length: 128 }).notNull(),
  retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "date" }).notNull(),
  redacted: boolean("redacted").notNull().default(false), // GDPR redaction flag
  createdAt,
});

export const mandateReceipts = auditSchema.table("mandate_receipts", {
  id: idCol(),
  mandateId: uuidv7("mandate_id").notNull(),
  receiptVdc: text("receipt_vdc").notNull(),
  contentHash: varchar("content_hash", { length: 128 }).notNull(),
  orderId: uuidv7("order_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const agentActions = auditSchema.table("agent_actions", {
  id: idCol(),
  agentId: uuidv7("agent_id").notNull().references(() => agents.id),
  passportId: uuidv7("passport_id").references(() => agentPassports.id),
  toolName: varchar("tool_name", { length: 96 }).notNull(),
  scope: varchar("scope", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(), // ok|denied|error
  latencyMs: integer("latency_ms").notNull(),
  inputHash: varchar("input_hash", { length: 128 }),
  outputHash: varchar("output_hash", { length: 128 }),
  errorCode: varchar("error_code", { length: 64 }),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const agentReputation = auditSchema.table("agent_reputation", {
  id: idCol(),
  agentId: uuidv7("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }).unique(),
  scoreBps: integer("score_bps").notNull(), // 0..10000 of 1.0 scale
  components: jsonb("components").notNull().$type<{
    settledTxCount: number;
    settledValueMinor: string;
    disputesAgainst: number;
    chargebackRateBps: number;
    refundRateBps: number;
    cancellationRateBps: number;
    counterpartyAvgBps: number;
  }>(),
  insufficientData: boolean("insufficient_data").notNull().default(true),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const reputationExports = auditSchema.table("reputation_exports", {
  id: idCol(),
  agentId: uuidv7("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  vdc: text("vdc").notNull(), // signed VDC
  signature: text("signature").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt,
});

export const counterfeitFindings = auditSchema.table("counterfeit_findings", {
  id: idCol(),
  productId: uuidv7("product_id").notNull(),
  finding: varchar("finding", { length: 16 }).notNull(), // confirmed|cleared|inconclusive
  arbitrationKind: varchar("arbitration_kind", { length: 16 }).notNull(), // brand|marketplace
  evidence: jsonb("evidence").notNull(),
  decidedBy: varchar("decided_by", { length: 128 }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt,
});

export const consentEvents = auditSchema.table("consent_events", {
  id: idCol(),
  principalId: varchar("principal_id", { length: 128 }).notNull(),
  scope: varchar("scope", { length: 64 }).notNull(),
  granted: boolean("granted").notNull(),
  proof: jsonb("proof"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
});

// Idempotency-Key cache: backs the mutating-write replay protection in the
// API edge. Composite primary key on (scope, key); expires_at drives GC.
export const idempotencyKeys = auditSchema.table(
  "idempotency_keys",
  {
    scope: varchar("scope", { length: 200 }).notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 128 }).notNull(),
    status: integer("status").notNull().default(0),
    body: jsonb("body"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt,
  },
  (t) => ({
    pk: uniqueIndex("idempotency_keys_pk").on(t.scope, t.key),
  }),
);

// DPoP JTI replay-protection set. Each entry has a TTL matching the DPoP
// proof's lifetime; we GC opportunistically.
export const dpopJtis = auditSchema.table("dpop_jtis", {
  jti: varchar("jti", { length: 256 }).primaryKey().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt,
});

// Append-only search query log. Drives synonym mining, zero-result alerts, and
// "is search getting worse" SLOs. Stores only the query content + outcome —
// no session/IP/agent identifiers, so it doesn't widen the PII surface.
export const searchQueries = auditSchema.table(
  "search_queries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    queryRaw: text("query_raw").notNull(),
    queryNormalized: text("query_normalized").notNull(),
    langGuess: varchar("lang_guess", { length: 4 }), // fr|ar|en|null
    nResults: integer("n_results").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    hasFilters: boolean("has_filters").notNull().default(false),
    createdAt,
  },
  (t) => ({
    // Hot path 1: list zero-result queries (synonym candidates) over a time window.
    zeroResultsIdx: index("search_queries_zero_results_idx").on(t.nResults, t.occurredAt),
    // Hot path 2: scan recent queries for trends / dashboards.
    occurredIdx: index("search_queries_occurred_idx").on(t.occurredAt),
  }),
);
