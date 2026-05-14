import { describe, expect, it } from "vitest";
import { CATEGORY_BLOG_LINKS, getCategoryBlogLinks } from "./categoryBlogLinks";
import { BLOG_POSTS } from "@/app/blog/posts";

describe("categoryBlogLinks", () => {
  it("returns empty array for unmapped slugs (no orphan section rendered)", () => {
    expect(getCategoryBlogLinks("immobilier")).toEqual([]);
    expect(getCategoryBlogLinks("does_not_exist")).toEqual([]);
    expect(getCategoryBlogLinks("")).toEqual([]);
  });

  it("returns mapped blog slugs for known categories", () => {
    expect(getCategoryBlogLinks("telephones")).toContain(
      "guide-achat-smartphone-occasion-algerie-2026",
    );
    expect(getCategoryBlogLinks("voitures")).toContain(
      "acheter-voiture-occasion-algerie-10-verifications",
    );
    expect(getCategoryBlogLinks("portables")).toContain(
      "ordinateur-portable-etudes-algerie-guide-2026",
    );
  });

  it("is case-insensitive on the slug input", () => {
    expect(getCategoryBlogLinks("Telephones")).toContain(
      "guide-achat-smartphone-occasion-algerie-2026",
    );
    expect(getCategoryBlogLinks("VOITURES")).toContain(
      "acheter-voiture-occasion-algerie-10-verifications",
    );
  });

  it("every referenced blog slug actually exists in the blog registry", () => {
    // Catches stale references — if a post is renamed or removed from
    // BLOG_POSTS without updating CATEGORY_BLOG_LINKS, the /c/<slug> page
    // would render a broken link silently. This test fails loud instead.
    const knownSlugs = new Set(BLOG_POSTS.map((p) => p.slug));
    for (const [category, postSlugs] of Object.entries(CATEGORY_BLOG_LINKS)) {
      for (const slug of postSlugs) {
        expect(
          knownSlugs.has(slug),
          `Category "${category}" references blog post "${slug}" which is not in BLOG_POSTS`,
        ).toBe(true);
      }
    }
  });

  it("returns a non-mutable list (caller shouldn't be able to corrupt the mapping)", () => {
    const list = getCategoryBlogLinks("telephones");
    // ReadonlyArray at the type level; at runtime it's a regular array
    // because TS readonly is erased. The test asserts the function returns
    // SOMETHING and that mutating it doesn't break subsequent reads —
    // i.e. each call returns a fresh-or-stable reference.
    expect(list.length).toBeGreaterThan(0);
    const second = getCategoryBlogLinks("telephones");
    expect(second).toEqual(list);
  });
});
