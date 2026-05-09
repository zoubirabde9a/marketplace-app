// Schema: cart — carts, items, saved-for-later, wishlists. Spec §4.4.

import { integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { amountMinor, createdAt, currencyCode, idCol, updatedAt, uuidv7 } from "./_common.js";
import { organizations, users, agents } from "./identity.js";
import { productVariants } from "./catalog.js";

export const cartSchema = pgSchema("cart");

export const carts = cartSchema.table("carts", {
  id: idCol(),
  ownerUserId: uuidv7("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  ownerOrgId: uuidv7("owner_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  ownerAgentId: uuidv7("owner_agent_id").references(() => agents.id, { onDelete: "cascade" }),
  ownerKind: varchar("owner_kind", { length: 16 }).notNull().default("anonymous"), // user|anonymous
  mandateId: varchar("mandate_id", { length: 128 }), // AP2 cart mandate ref
  currency: currencyCode(),
  status: varchar("status", { length: 16 }).notNull().default("open"), // open|locked|abandoned|converted
  shippingAddress: jsonb("shipping_address"),
  billingAddress: jsonb("billing_address"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  notes: text("notes"),
  createdAt,
  updatedAt,
});

export const cartItems = cartSchema.table(
  "cart_items",
  {
    id: idCol(),
    cartId: uuidv7("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuidv7("variant_id").notNull().references(() => productVariants.id),
    sellerId: uuidv7("seller_id").notNull().references(() => organizations.id),
    qty: integer("qty").notNull(),
    unitPriceMinor: amountMinor("unit_price_minor"),
    listPriceMinor: amountMinor("list_price_minor"),
    negotiatedQuoteId: uuidv7("negotiated_quote_id"),
    options: jsonb("options").$type<Record<string, unknown>>(),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("cart_items_unique").on(t.cartId, t.variantId),
  }),
);

export const savedForLater = cartSchema.table("saved_for_later", {
  id: idCol(),
  cartId: uuidv7("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
  variantId: uuidv7("variant_id").notNull().references(() => productVariants.id),
  qty: integer("qty").notNull().default(1),
  createdAt,
});

export const wishlists = cartSchema.table("wishlists", {
  id: idCol(),
  ownerUserId: uuidv7("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  ownerAgentId: uuidv7("owner_agent_id").references(() => agents.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  visibility: varchar("visibility", { length: 16 }).notNull().default("private"), // private|public|shared
  shareToken: varchar("share_token", { length: 64 }),
  createdAt,
  updatedAt,
});

export const wishlistItems = cartSchema.table(
  "wishlist_items",
  {
    id: idCol(),
    wishlistId: uuidv7("wishlist_id").notNull().references(() => wishlists.id, { onDelete: "cascade" }),
    variantId: uuidv7("variant_id").notNull().references(() => productVariants.id),
    notes: text("notes"),
    createdAt,
  },
  (t) => ({
    uniq: uniqueIndex("wishlist_items_unique").on(t.wishlistId, t.variantId),
  }),
);
