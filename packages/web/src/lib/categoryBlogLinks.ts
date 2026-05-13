// Maps category slugs to relevant blog-post slugs for the "Articles à lire"
// cross-link section on /c/[slug]. Bidirectional with the inline /c/ links
// inside blog posts — Google rewards dense internal linking between
// semantically related indexable URLs (concentrates topical authority on
// both pages, helps crawlers establish topic clusters).
//
// Single source of truth for "which guide pairs with which category". Keep
// per-category lists short (1–3) so the section reads curated, not spammy.

export const CATEGORY_BLOG_LINKS: Record<string, ReadonlyArray<string>> = {
  // Smartphone buyer guide pairs with every phone-adjacent slug.
  telephones: ["guide-achat-smartphone-occasion-algerie-2026"],
  smartphones: ["guide-achat-smartphone-occasion-algerie-2026"],

  // Laptop / student guide pairs with all computing slugs.
  informatique: ["ordinateur-portable-etudes-algerie-guide-2026"],
  ordinateurs: ["ordinateur-portable-etudes-algerie-guide-2026"],
  portables: ["ordinateur-portable-etudes-algerie-guide-2026"],

  // Vehicle inspection checklist for vehicle slugs.
  automobiles_vehicules: ["acheter-voiture-occasion-algerie-10-verifications"],
  voitures: ["acheter-voiture-occasion-algerie-10-verifications"],
  vehicules: ["acheter-voiture-occasion-algerie-10-verifications"],
};

export function getCategoryBlogLinks(slug: string): ReadonlyArray<string> {
  return CATEGORY_BLOG_LINKS[slug.toLowerCase()] ?? [];
}
