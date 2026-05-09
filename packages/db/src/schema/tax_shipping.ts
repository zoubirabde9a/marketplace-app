// Schema: tax_shipping — tax zones/rates, shipping zones/rates, carriers, customs. Spec §4.10.

import { boolean, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { amountMinor, createdAt, currencyCode, idCol, updatedAt, uuidv7 } from "./_common.js";
import { organizations } from "./identity.js";

export const taxShippingSchema = pgSchema("tax_shipping");

export const taxZones = taxShippingSchema.table("tax_zones", {
  id: idCol(),
  name: varchar("name", { length: 200 }).notNull(),
  countryCode: varchar("country_code", { length: 2 }).notNull(),
  subdivisionCode: varchar("subdivision_code", { length: 8 }),
  postalRanges: jsonb("postal_ranges").$type<Array<[string, string]>>(),
  isMarketplaceFacilitator: boolean("is_marketplace_facilitator").notNull().default(false),
  createdAt,
});

export const taxRates = taxShippingSchema.table(
  "tax_rates",
  {
    id: idCol(),
    zoneId: uuidv7("zone_id").notNull().references(() => taxZones.id, { onDelete: "cascade" }),
    productCategoryKey: varchar("product_category_key", { length: 64 }).notNull().default("default"),
    rateBps: integer("rate_bps").notNull(),
    label: varchar("label", { length: 64 }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    uniq: uniqueIndex("tax_rates_unique").on(t.zoneId, t.productCategoryKey, t.effectiveFrom),
  }),
);

export const shippingZones = taxShippingSchema.table("shipping_zones", {
  id: idCol(),
  sellerOrgId: uuidv7("seller_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  countryCodes: jsonb("country_codes").notNull().$type<string[]>(),
  postalRanges: jsonb("postal_ranges").$type<Array<[string, string]>>(),
  createdAt,
});

export const shippingRates = taxShippingSchema.table("shipping_rates", {
  id: idCol(),
  zoneId: uuidv7("zone_id").notNull().references(() => shippingZones.id, { onDelete: "cascade" }),
  carrier: varchar("carrier", { length: 64 }).notNull(),
  service: varchar("service", { length: 64 }).notNull(),
  flatMinor: amountMinor("flat_minor"),
  perKgMinor: amountMinor("per_kg_minor"),
  freeOverMinor: amountMinor("free_over_minor"),
  currency: currencyCode(),
  estDeliveryDays: integer("est_delivery_days"),
  hazmatAllowed: boolean("hazmat_allowed").notNull().default(false),
  createdAt,
});

export const carriers = taxShippingSchema.table("carriers", {
  id: idCol(),
  carrierKey: varchar("carrier_key", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  apiCredentials: jsonb("api_credentials"), // encrypted at rest
  prohibitedItems: jsonb("prohibited_items").$type<string[]>(),
  active: boolean("active").notNull().default(true),
  createdAt,
});

export const customsDeclarations = taxShippingSchema.table("customs_declarations", {
  id: idCol(),
  shipmentId: uuidv7("shipment_id").notNull(),
  hsCode: varchar("hs_code", { length: 16 }),
  declaredValueMinor: amountMinor("declared_value_minor"),
  currency: currencyCode(),
  contentsCategory: varchar("contents_category", { length: 32 }).notNull(),
  contentsDescription: text("contents_description"),
  exportControlClass: varchar("export_control_class", { length: 32 }),
  countryOfOrigin: varchar("country_of_origin", { length: 2 }),
  createdAt,
});

export const fxRates = taxShippingSchema.table(
  "fx_rates",
  {
    id: idCol(),
    base: varchar("base", { length: 3 }).notNull(),
    quote: varchar("quote", { length: 3 }).notNull(),
    rate: text("rate").notNull(), // numeric stored as string
    asOf: timestamp("as_of", { withTimezone: true, mode: "date" }).notNull(),
    source: varchar("source", { length: 32 }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("fx_rates_unique").on(t.base, t.quote, t.asOf),
  }),
);

export const restrictedItems = taxShippingSchema.table(
  "restricted_items",
  {
    id: idCol(),
    taxonomyKey: varchar("taxonomy_key", { length: 64 }).notNull(),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    subdivisionCode: varchar("subdivision_code", { length: 8 }),
    restrictionKind: varchar("restriction_kind", { length: 32 }).notNull(),
    // prohibited|age_restricted|license_required|carrier_prohibited|export_controlled|hazmat
    minAge: integer("min_age"),
    licenseRequiredOf: varchar("license_required_of", { length: 16 }), // seller|buyer|both
    notes: text("notes"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
    source: varchar("source", { length: 64 }).notNull(),
    registryVersion: varchar("registry_version", { length: 32 }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("restricted_items_unique").on(
      t.taxonomyKey,
      t.countryCode,
      t.subdivisionCode,
      t.restrictionKind,
      t.effectiveFrom,
    ),
  }),
);

export const sanctionedParties = taxShippingSchema.table("sanctioned_parties", {
  id: idCol(),
  list: varchar("list", { length: 32 }).notNull(), // ofac_sdn|uk_ofsi|eu_consolidated|un
  name: varchar("name", { length: 400 }).notNull(),
  aliases: jsonb("aliases").$type<string[]>(),
  countryCode: varchar("country_code", { length: 2 }),
  identifiers: jsonb("identifiers"),
  listedAt: timestamp("listed_at", { withTimezone: true, mode: "date" }).notNull(),
  delistedAt: timestamp("delisted_at", { withTimezone: true, mode: "date" }),
});
