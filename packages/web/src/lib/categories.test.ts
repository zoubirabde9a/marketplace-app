import { describe, expect, it } from "vitest";
import { humanizeCategorySlug, FR_CATEGORY } from "./categories";

describe("humanizeCategorySlug", () => {
  it("returns the French label for known top-level Ouedkniss categories", () => {
    expect(humanizeCategorySlug("telephones")).toBe("Téléphones");
    expect(humanizeCategorySlug("vetements_mode")).toBe("Vêtements & Mode");
    expect(humanizeCategorySlug("automobiles_vehicules")).toBe("Automobiles & Véhicules");
    expect(humanizeCategorySlug("electronique_electromenager")).toBe("Électronique & Électroménager");
  });

  it("is case-insensitive on the slug lookup", () => {
    expect(humanizeCategorySlug("TELEPHONES")).toBe("Téléphones");
    expect(humanizeCategorySlug("Vetements_Mode")).toBe("Vêtements & Mode");
  });

  it("falls back to a humanised form for unknown slugs (no Latin diacritics added)", () => {
    expect(humanizeCategorySlug("toys-and-games")).toBe("Toys and games");
    expect(humanizeCategorySlug("home_kitchen")).toBe("Home kitchen");
  });

  it("preserves the leading capital when the slug starts capitalised", () => {
    expect(humanizeCategorySlug("Custom")).toBe("Custom");
  });

  it("FR_CATEGORY contains entries for every slug we exposed on the home page chips", () => {
    // Mirror the chip list rendered on the home page so a missed entry here
    // shows up loudly instead of silently rendering an ASCII slug.
    const homeChips = [
      "telephones",
      "smartphones",
      "informatique",
      "portables",
      "electromenager",
      "mode",
      "maison",
      "vehicules",
    ];
    for (const slug of homeChips) {
      expect(FR_CATEGORY[slug]).toBeDefined();
    }
  });
});
