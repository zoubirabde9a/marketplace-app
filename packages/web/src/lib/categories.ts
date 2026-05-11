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
