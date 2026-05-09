import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { media, products } from "../src/schema/catalog.js";

describe("products table schema", () => {
  const config = getTableConfig(products);
  const columnsByName = Object.fromEntries(config.columns.map((c) => [c.name, c]));

  it("includes the seller-supplied content fields and hero media reference", () => {
    expect(columnsByName.id).toBeDefined();
    expect(columnsByName.seller_id).toBeDefined();
    expect(columnsByName.sku).toBeDefined();
    expect(columnsByName.title_raw).toBeDefined();
    expect(columnsByName.title_sanitized).toBeDefined();
    expect(columnsByName.description_raw).toBeDefined();
    expect(columnsByName.description_sanitized).toBeDefined();
    expect(columnsByName.canonical_id).toBeDefined();
    expect(columnsByName.brand).toBeDefined();
    expect(columnsByName.gtin14).toBeDefined();
    expect(columnsByName.counterfeit_risk).toBeDefined();
    expect(columnsByName.moderation_status).toBeDefined();
    expect(columnsByName.status).toBeDefined();
  });

  it("requires id, seller_id, sku, sanitized title", () => {
    expect(columnsByName.id!.notNull).toBe(true);
    expect(columnsByName.seller_id!.notNull).toBe(true);
    expect(columnsByName.sku!.notNull).toBe(true);
    expect(columnsByName.title_raw!.notNull).toBe(true);
    expect(columnsByName.title_sanitized!.notNull).toBe(true);
  });

  it("places the table in the catalog schema", () => {
    expect(config.schema).toBe("catalog");
    expect(config.name).toBe("products");
  });
});

describe("media table schema", () => {
  const config = getTableConfig(media);
  const columnsByName = Object.fromEntries(config.columns.map((c) => [c.name, c]));

  it("includes url, content_type, width, height", () => {
    expect(columnsByName.url).toBeDefined();
    expect(columnsByName.content_type).toBeDefined();
    expect(columnsByName.width).toBeDefined();
    expect(columnsByName.height).toBeDefined();
  });

  it("requires url and content_type but lets width/height be nullable", () => {
    expect(columnsByName.url!.notNull).toBe(true);
    expect(columnsByName.content_type!.notNull).toBe(true);
    expect(columnsByName.width!.notNull).toBe(false);
    expect(columnsByName.height!.notNull).toBe(false);
  });

  it("places the table in the catalog schema", () => {
    expect(config.schema).toBe("catalog");
    expect(config.name).toBe("media");
  });
});
