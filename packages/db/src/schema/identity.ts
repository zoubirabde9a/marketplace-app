// Schema: identity — humans, organizations, agents, agent passports, OAuth clients,
// sessions, MFA factors, consents. Spec §3, §4.1.

import { boolean, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createdAt, idCol, updatedAt, uuidv7 } from "./_common.js";

export const identitySchema = pgSchema("identity");

export const users = identitySchema.table(
  "users",
  {
    id: idCol(),
    email: varchar("email", { length: 320 }).notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    displayName: varchar("display_name", { length: 200 }),
    picture: text("picture"),
    googleSub: varchar("google_sub", { length: 64 }),
    locale: varchar("locale", { length: 10 }).notNull().default("en-US"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active | suspended | deleted
    createdAt,
    updatedAt,
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
    googleSubUnique: uniqueIndex("users_google_sub_unique").on(t.googleSub),
  }),
);

export const organizations = identitySchema.table("organizations", {
  id: idCol(),
  name: varchar("name", { length: 200 }).notNull(),
  legalName: varchar("legal_name", { length: 200 }),
  countryCode: varchar("country_code", { length: 2 }).notNull(),
  taxIdEncrypted: text("tax_id_encrypted"),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  kybStatus: varchar("kyb_status", { length: 32 }).notNull().default("not_started"),
  createdAt,
  updatedAt,
});

export const orgMembers = identitySchema.table(
  "org_members",
  {
    id: idCol(),
    orgId: uuidv7("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuidv7("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull(), // owner | admin | operator | finance | support
    createdAt,
  },
  (t) => ({
    uniq: uniqueIndex("org_members_unique").on(t.orgId, t.userId),
  }),
);

export const agents = identitySchema.table("agents", {
  id: idCol(),
  ownerUserId: uuidv7("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  ownerOrgId: uuidv7("owner_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  agentKind: varchar("agent_kind", { length: 16 }).notNull(), // buyer | seller | both
  publicKey: text("public_key").notNull(), // Ed25519, base64
  publicKeyKid: varchar("public_key_kid", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt,
  updatedAt,
});

export const agentPassports = identitySchema.table(
  "agent_passports",
  {
    id: idCol(),
    agentId: uuidv7("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    issuer: varchar("issuer", { length: 256 }).notNull(),
    scopes: jsonb("scopes").notNull().$type<string[]>(),
    spendCaps: jsonb("spend_caps").notNull().$type<{
      perTxMinor?: string;
      perDayMinor?: string;
      perMerchantMinor?: string;
      currency: string;
    }>(),
    allowMerchants: jsonb("allow_merchants").$type<string[]>(),
    denyMerchants: jsonb("deny_merchants").$type<string[]>(),
    allowCategories: jsonb("allow_categories").$type<string[]>(),
    denyCategories: jsonb("deny_categories").$type<string[]>(),
    auditRoot: varchar("audit_root", { length: 128 }),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revocationReason: varchar("revocation_reason", { length: 64 }),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active | revoked | expired
    signature: text("signature").notNull(),
    createdAt,
  },
  (t) => ({
    agentIdx: uniqueIndex("agent_passports_unique_active").on(t.agentId, t.id),
  }),
);

export const oauthClients = identitySchema.table("oauth_clients", {
  id: idCol(),
  clientId: varchar("client_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  ownerUserId: uuidv7("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  ownerOrgId: uuidv7("owner_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  redirectUris: jsonb("redirect_uris").notNull().$type<string[]>(),
  scopes: jsonb("scopes").notNull().$type<string[]>(),
  // Public clients (mobile/native) only — confidential clients use mTLS or private_key_jwt.
  authMethod: varchar("auth_method", { length: 32 }).notNull().default("none"),
  jwksUri: varchar("jwks_uri", { length: 512 }),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt,
  updatedAt,
});

export const sessions = identitySchema.table("sessions", {
  id: idCol(),
  userId: uuidv7("user_id").references(() => users.id, { onDelete: "cascade" }),
  agentId: uuidv7("agent_id").references(() => agents.id, { onDelete: "cascade" }),
  clientId: varchar("client_id", { length: 64 }),
  dpopJkt: varchar("dpop_jkt", { length: 64 }), // SHA-256 of DPoP key thumbprint
  scopes: jsonb("scopes").notNull().$type<string[]>(),
  refreshTokenHash: varchar("refresh_token_hash", { length: 128 }),
  refreshGen: integer("refresh_gen").notNull().default(0),
  ip: varchar("ip", { length: 45 }),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  createdAt,
});

export const mfaFactors = identitySchema.table("mfa_factors", {
  id: idCol(),
  userId: uuidv7("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  factorKind: varchar("factor_kind", { length: 16 }).notNull(), // passkey | totp | recovery
  publicKey: text("public_key"),
  credentialId: text("credential_id"),
  signCounter: integer("sign_counter").notNull().default(0),
  label: varchar("label", { length: 200 }),
  createdAt,
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
});

export const consents = identitySchema.table("consents", {
  id: idCol(),
  principalUserId: uuidv7("principal_user_id").references(() => users.id, { onDelete: "cascade" }),
  principalOrgId: uuidv7("principal_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuidv7("agent_id").references(() => agents.id, { onDelete: "cascade" }),
  scope: varchar("scope", { length: 64 }).notNull(), // e.g. "subscriptions", "marketing"
  granted: boolean("granted").notNull(),
  source: varchar("source", { length: 64 }).notNull(),
  proof: jsonb("proof"), // step-up assertion, mandate ref, etc.
  createdAt,
});
