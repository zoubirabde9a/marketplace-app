import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { sellerProfiles } from "../src/schema/seller.js";

describe("seller_profiles table schema", () => {
  const config = getTableConfig(sellerProfiles);
  const columnsByName = Object.fromEntries(config.columns.map((c) => [c.name, c]));

  it("declares the expected column set", () => {
    const expected = [
      "id",
      "org_id",
      "store_name",
      "store_slug",
      "description",
      "support_email",
      "support_url",
      "phone",
      "whatsapp",
      "website",
      "active",
      "reserve_bps",
      "created_at",
      "updated_at",
    ];
    for (const name of expected) {
      expect(columnsByName[name], `expected column ${name}`).toBeDefined();
    }
  });

  it("makes phone, whatsapp, and website nullable", () => {
    expect(columnsByName.phone!.notNull).toBe(false);
    expect(columnsByName.whatsapp!.notNull).toBe(false);
    expect(columnsByName.website!.notNull).toBe(false);
  });

  it("makes support_email and support_url nullable", () => {
    expect(columnsByName.support_email!.notNull).toBe(false);
    expect(columnsByName.support_url!.notNull).toBe(false);
  });

  it("requires id, org_id, store_name, store_slug", () => {
    expect(columnsByName.id!.notNull).toBe(true);
    expect(columnsByName.org_id!.notNull).toBe(true);
    expect(columnsByName.store_name!.notNull).toBe(true);
    expect(columnsByName.store_slug!.notNull).toBe(true);
  });

  it("places the table in the seller schema", () => {
    expect(config.schema).toBe("seller");
    expect(config.name).toBe("seller_profiles");
  });
});
