import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("manifest()", () => {
  const m = manifest();

  it("declares name, short_name, and start_url so mobile install offers a sensible app", () => {
    expect(m.name).toBe("Teno Store");
    expect(m.short_name).toBe("Teno");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("ships at least one icon source the OS can use for the home screen", () => {
    expect(Array.isArray(m.icons)).toBe(true);
    expect((m.icons ?? []).length).toBeGreaterThanOrEqual(1);
    // SVG icon must be present so any density looks crisp; PNG apple-icon is
    // the iOS-specific fallback.
    expect((m.icons ?? []).some((i) => i.type === "image/svg+xml")).toBe(true);
  });

  it("matches the dark theme used elsewhere on the site", () => {
    expect(m.theme_color).toBe("#0a0a0a");
    expect(m.background_color).toBe("#0a0a0a");
  });

  it("declares the shopping category and lang for app-store / Android categorization", () => {
    expect(m.categories).toContain("shopping");
    // iter-24: switched to French primary so the manifest matches the
    // <html lang="fr"> declaration and the rest of the site's locale.
    expect(m.lang).toBe("fr");
  });
});
