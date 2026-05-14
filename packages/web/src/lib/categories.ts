// French display labels for Ouedkniss category slugs. Slugs in URL paths
// are stored unaccented for ergonomics (telephones, electromenager,
// automobiles_vehicules); without this map, SERP titles and JSON-LD
// `category` fields render as ASCII English-coded strings ('Automobiles
// vehicules') on a lang=fr document.
//
// Compound underscore-joined slugs are the highest-volume top-level
// Ouedkniss categories — verified by /v1/products facet counts on
// 2026-05-11: automobiles_vehicules (676), electronique_electromenager
// (641), vetements_mode (618), sante_beaute (533).
//
// Used by app/search/page.tsx (SERP + visible H1) and
// app/product/[id]/page.tsx (JSON-LD `category` field) — keep this
// the single source of truth.

export const FR_CATEGORY: Record<string, string> = {
  automobiles_vehicules: "Automobiles & Véhicules",
  electronique_electromenager: "Électronique & Électroménager",
  vetements_mode: "Vêtements & Mode",
  sante_beaute: "Santé & Beauté",
  telephones: "Téléphones",
  smartphones: "Smartphones",
  informatique: "Informatique",
  ordinateurs: "Ordinateurs",
  portables: "Ordinateurs portables",
  peripheriques: "Périphériques",
  ecrans: "Écrans",
  electromenager: "Électroménager",
  mode: "Mode",
  femme: "Mode femme",
  homme: "Mode homme",
  accessoires: "Accessoires",
  traditionnel: "Mode traditionnelle",
  maison: "Maison & Déco",
  decoration: "Décoration",
  salon: "Salon",
  vehicules: "Véhicules",
  voitures: "Voitures",
  motos: "Motos",
  immobilier: "Immobilier",
  jeux: "Jeux & Loisirs",
  bebe: "Bébé & Enfants",
  sport: "Sport & Loisirs",
  services: "Services",
  emploi: "Emploi",
};

export function humanizeCategorySlug(slug: string): string {
  const k = slug.toLowerCase();
  if (FR_CATEGORY[k]) return FR_CATEGORY[k];
  const h = slug.replace(/[-_]/g, " ");
  return `${h.charAt(0).toUpperCase()}${h.slice(1)}`;
}

// Short editorial slug → API category slug(s) used by the catalog.products
// schema. Ouedkniss returns compound underscore-joined top-level categories
// (electronique_electromenager, vetements_mode, automobiles_vehicules), but
// the home-page chips and a few editorial landings link to short slugs
// (electromenager, mode, vehicules, smartphones, portables) for ergonomics
// and head-term SEO. Pre-2026-05-13 those /c/<slug> pages 200'd but
// rendered zero products because the API filter `category=<short-slug>`
// matched nothing — bait-and-switch UX. Map each short slug to the set
// of underscored API slugs it should aggregate.
const CATEGORY_ALIASES: Record<string, string[]> = {
  // Editorial slugs that map onto a single Ouedkniss compound category
  // we actually tag products with. The /c/<alias> landing keeps its
  // unique French prose / FAQ / JSON-LD but resolves the product strip
  // against the parent aisle (e.g. /c/mode shows vetements_mode listings).
  electromenager: ["electronique_electromenager"],
  decoration: ["electronique_electromenager"],
  salon: ["electronique_electromenager"],
  maison: ["electronique_electromenager"],
  mode: ["vetements_mode"],
  femme: ["vetements_mode"],
  homme: ["vetements_mode"],
  accessoires: ["vetements_mode"],
  traditionnel: ["vetements_mode"],
  bebe: ["vetements_mode"],
  sport: ["vetements_mode"],
  vehicules: ["automobiles_vehicules", "vehicules", "voitures"],
  voitures: ["automobiles_vehicules", "voitures"],
  motos: ["automobiles_vehicules"],
  // Smartphones are a subset of `telephones`; we don't currently split
  // them in the catalog so we treat the chip as the broader phone aisle.
  smartphones: ["telephones"],
  portables: ["informatique"],
  ordinateurs: ["informatique"],
  ecrans: ["informatique"],
  peripheriques: ["informatique"],
  jeux: ["informatique"],
};

export function resolveCategorySlugs(slug: string): string[] {
  return CATEGORY_ALIASES[slug.toLowerCase()] ?? [slug];
}
