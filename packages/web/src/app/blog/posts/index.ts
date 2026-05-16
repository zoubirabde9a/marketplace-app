import { post as guideSmartphone } from "./guide-smartphone-occasion-algerie";
import { post as vendreConseils } from "./vendre-conseils-annonces";
import { post as voitureOccasion } from "./acheter-voiture-occasion-algerie-verifications";
import { post as portableEtudes } from "./ordinateur-portable-etudes-algerie-2026";
import { post as machineACafe } from "./machine-a-cafe-algerie-guide";
import { post as electromenager } from "./electromenager-algerie-guide";
import { post as sansArnaque } from "./acheter-en-ligne-algerie-sans-arnaque";
import { post as payerEnLigne } from "./payer-en-ligne-algerie-2026";
import { post as livraisonGuide } from "./livraison-algerie-services-colis-2026";
import { post as climatiseur } from "./climatiseur-algerie-guide-2026";
import { post as televiseur } from "./televiseur-algerie-guide-2026";
import { post as modeMarques } from "./mode-vetements-algerie-guide-2026";
import { post as vendreDemarrer } from "./vendre-en-ligne-algerie-demarrer-2026";
import { post as refrigerateur } from "./refrigerateur-algerie-guide-2026";
import { post as laveLinge } from "./lave-linge-algerie-guide-2026";
import type { BlogPost } from "../types";

export const BLOG_POSTS: ReadonlyArray<BlogPost> = [
  guideSmartphone,
  vendreConseils,
  voitureOccasion,
  portableEtudes,
  machineACafe,
  electromenager,
  sansArnaque,
  payerEnLigne,
  livraisonGuide,
  climatiseur,
  televiseur,
  modeMarques,
  vendreDemarrer,
  refrigerateur,
  laveLinge,
]
  .slice()
  .sort((a, b) => b.datePublished.localeCompare(a.datePublished));

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

export function getAdjacentPosts(slug: string): { prev: BlogPost | null; next: BlogPost | null } {
  const idx = BLOG_POSTS.findIndex((p) => p.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? BLOG_POSTS[idx - 1]! : null,
    next: idx < BLOG_POSTS.length - 1 ? BLOG_POSTS[idx + 1]! : null,
  };
}
