// Schema: catalog — products, variants, listings, canonical products, attributes,
// inventory, price lists, bundles, digital assets, embeddings. Spec §4.2, §8.2.

import { boolean, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { amountMinor, createdAt, currencyCode, idCol, updatedAt, uuidv7, vector } from "./_common.js";
import { organizations } from "./identity.js";

export const catalogSchema = pgSchema("catalog");

export const categories = catalogSchema.table("categories", {
  id: idCol(),
  parentId: uuidv7("parent_id"),
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  taxonomyPath: text("taxonomy_path").notNull(), // materialized path: "/electronics/audio/headphones"
  createdAt,
  updatedAt,
});

export const canonicalProducts = catalogSchema.table(
  "canonical_products",
  {
    id: idCol(),
    title: varchar("title", { length: 200 }).notNull(),
    brand: varchar("brand", { length: 200 }),
    gtin14: varchar("gtin14", { length: 14 }),
    mpn: varchar("mpn", { length: 200 }),
    categoryId: uuidv7("category_id").references(() => categories.id),
    attributes: jsonb("attributes").notNull().default({}).$type<Record<string, unknown>>(),
    heroMediaId: uuidv7("hero_media_id"),
    createdAt,
    updatedAt,
  },
  (t) => ({
    gtinIdx: index("canonical_products_gtin_idx").on(t.gtin14, t.brand),
    mpnIdx: index("canonical_products_mpn_idx").on(t.mpn, t.brand),
  }),
);

export const products = catalogSchema.table(
  "products",
  {
    id: idCol(),
    // Nullable since 2026-05-12: scraper-seeded listings carry seller_id=NULL
    // ("unowned reference listings"). Cart/checkout paths refuse to resolve a
    // variant whose product has no seller, so these rows are catalog-only and
    // cannot be bought. See seed-from-scraped.ts and repos/cart.ts → resolveLine.
    sellerId: uuidv7("seller_id").references(() => organizations.id, { onDelete: "cascade" }),
    canonicalId: uuidv7("canonical_id").references(() => canonicalProducts.id, { onDelete: "set null" }),
    canonicalConfidence: varchar("canonical_confidence", { length: 16 }), // exact|high|medium|null
    sku: varchar("sku", { length: 200 }).notNull(),
    titleRaw: text("title_raw").notNull(), // original seller-supplied
    titleSanitized: text("title_sanitized").notNull(), // post-§8a.1
    descriptionRaw: text("description_raw"),
    descriptionSanitized: text("description_sanitized"),
    brand: varchar("brand", { length: 200 }),
    gtin14: varchar("gtin14", { length: 14 }),
    mpn: varchar("mpn", { length: 200 }),
    categoryId: uuidv7("category_id").references(() => categories.id),
    attributes: jsonb("attributes").notNull().default({}).$type<Record<string, unknown>>(),
    productKind: varchar("product_kind", { length: 16 }).notNull().default("physical"), // physical|digital|service|subscription
    isHazmat: boolean("is_hazmat").notNull().default(false),
    isAgeRestricted: boolean("is_age_restricted").notNull().default(false),
    minAge: integer("min_age"),
    exportControlClass: varchar("export_control_class", { length: 32 }),
    counterfeitRisk: varchar("counterfeit_risk", { length: 16 }).notNull().default("low"), // low|elevated|high
    moderationStatus: varchar("moderation_status", { length: 16 }).notNull().default("pending"), // pending|approved|suppressed
    status: varchar("status", { length: 16 }).notNull().default("draft"), // draft|active|paused|removed
    categoryIds: jsonb("category_ids").$type<string[]>(),
    shipsTo: jsonb("ships_to").$type<string[]>(),
    heroMediaId: uuidv7("hero_media_id"),
    createdAt,
    updatedAt,
  },
  (t) => ({
    sellerSkuUnique: uniqueIndex("products_seller_sku_unique").on(t.sellerId, t.sku),
    canonicalIdx: index("products_canonical_idx").on(t.canonicalId),
    categoryIdx: index("products_category_idx").on(t.categoryId),
  }),
);

// NOTE: migration 0003 adds a `search_text` tsvector generated column on
// catalog.products plus GIN indexes (`products_search_text_idx`,
// `products_title_trgm_idx`, `products_brand_trgm_idx`). They are intentionally
// not declared here — drizzle-orm has no first-class tsvector + generated-
// column support that round-trips cleanly. If `pnpm db:generate` proposes
// dropping any of those, reject the diff. See repos/product.ts → searchIds.

export const productVariants = catalogSchema.table(
  "product_variants",
  {
    id: idCol(),
    productId: uuidv7("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    sku: varchar("sku", { length: 200 }).notNull(),
    options: jsonb("options").notNull().$type<Record<string, string>>(), // size:"M", color:"red"
    priceMinor: amountMinor("price_minor"),
    currency: currencyCode(),
    salePriceMinor: amountMinor("sale_price_minor"),
    floorPriceMinor: amountMinor("floor_price_minor"), // §7b — encrypted-at-rest in real impl
    weightGrams: integer("weight_grams"),
    dimensionsCm: jsonb("dimensions_cm").$type<{ l: number; w: number; h: number }>(),
    inStock: boolean("in_stock").notNull().default(true),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt,
    updatedAt,
  },
  (t) => ({
    skuUnique: uniqueIndex("product_variants_sku_unique").on(t.productId, t.sku),
  }),
);

export const productVersions = catalogSchema.table(
  "product_versions",
  {
    id: idCol(),
    productId: uuidv7("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    versionUnique: uniqueIndex("product_versions_unique").on(t.productId, t.version),
  }),
);

export const media = catalogSchema.table("media", {
  id: idCol(),
  // Nullable since 2026-05-12: mirrors catalog.products.seller_id — media rows
  // attached to unowned scraper listings have no owning org.
  sellerId: uuidv7("seller_id").references(() => organizations.id, { onDelete: "cascade" }),
  productId: uuidv7("product_id").references(() => products.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  contentType: varchar("content_type", { length: 64 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  perceptualHash: varchar("perceptual_hash", { length: 64 }),
  altText: text("alt_text"),
  width: integer("width"),
  height: integer("height"),
  createdAt,
});

export const inventoryLocations = catalogSchema.table("inventory_locations", {
  id: idCol(),
  sellerId: uuidv7("seller_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  countryCode: varchar("country_code", { length: 2 }).notNull(),
  postalCode: varchar("postal_code", { length: 20 }),
  createdAt,
});

export const inventoryLevels = catalogSchema.table(
  "inventory_levels",
  {
    id: idCol(),
    variantId: uuidv7("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    locationId: uuidv7("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "cascade" }),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    safetyStock: integer("safety_stock").notNull().default(0),
    backorderable: boolean("backorderable").notNull().default(false),
    lowStockThreshold: integer("low_stock_threshold"),
    updatedAt,
  },
  (t) => ({
    uniq: uniqueIndex("inventory_levels_unique").on(t.variantId, t.locationId),
  }),
);

export const priceLists = catalogSchema.table("price_lists", {
  id: idCol(),
  sellerId: uuidv7("seller_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  currency: currencyCode(),
  customerSegment: varchar("customer_segment", { length: 64 }),
  effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
  effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
  createdAt,
});

export const priceListEntries = catalogSchema.table(
  "price_list_entries",
  {
    id: idCol(),
    priceListId: uuidv7("price_list_id").notNull().references(() => priceLists.id, { onDelete: "cascade" }),
    variantId: uuidv7("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    minQty: integer("min_qty").notNull().default(1),
    priceMinor: amountMinor("price_minor"),
  },
  (t) => ({
    uniq: uniqueIndex("price_list_entries_unique").on(t.priceListId, t.variantId, t.minQty),
  }),
);

export const bundles = catalogSchema.table("bundles", {
  id: idCol(),
  sellerId: uuidv7("seller_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  bundleSku: varchar("bundle_sku", { length: 200 }).notNull(),
  priceMinor: amountMinor("price_minor"),
  currency: currencyCode(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt,
  updatedAt,
});

export const bundleItems = catalogSchema.table("bundle_items", {
  id: idCol(),
  bundleId: uuidv7("bundle_id").notNull().references(() => bundles.id, { onDelete: "cascade" }),
  variantId: uuidv7("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
  qty: integer("qty").notNull().default(1),
});

export const digitalAssets = catalogSchema.table("digital_assets", {
  id: idCol(),
  productId: uuidv7("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  storageUri: text("storage_uri").notNull(),
  contentType: varchar("content_type", { length: 64 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  licenseTerms: text("license_terms"),
  drmKind: varchar("drm_kind", { length: 32 }),
  createdAt,
});

// Embedding-model registry — spec §8.1
export const embeddingModels = catalogSchema.table(
  "embedding_models",
  {
    id: idCol(),
    modelKey: varchar("model_key", { length: 64 }).notNull(), // e.g. "text-embed-3"
    modelVersion: varchar("model_version", { length: 32 }).notNull(),
    dimensions: integer("dimensions").notNull(),
    role: varchar("role", { length: 16 }).notNull().default("inactive"), // current|next|inactive
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    uniq: uniqueIndex("embedding_models_unique").on(t.modelKey, t.modelVersion),
  }),
);

// Vectors are partitioned by (model_key, model_version). Default is 768; alter as needed.
export const productEmbeddings = catalogSchema.table(
  "product_embeddings",
  {
    productId: uuidv7("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    modelKey: varchar("model_key", { length: 64 }).notNull(),
    modelVersion: varchar("model_version", { length: 32 }).notNull(),
    embedding: vector("embedding", 768),
    createdAt,
  },
  (t) => ({
    pk: uniqueIndex("product_embeddings_pk").on(t.productId, t.modelKey, t.modelVersion),
  }),
);

// SKU canonicalization — listings roll up into canonical_products. spec §8.2
export const listingCanonicalSuggestions = catalogSchema.table("listing_canonical_suggestions", {
  id: idCol(),
  productId: uuidv7("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  candidateCanonicalId: uuidv7("candidate_canonical_id").notNull().references(() => canonicalProducts.id, { onDelete: "cascade" }),
  confidence: varchar("confidence", { length: 16 }).notNull(),
  matchMethod: varchar("match_method", { length: 32 }).notNull(), // gtin|mpn|fuzzy_title|embedding
  acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "date" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt,
});
