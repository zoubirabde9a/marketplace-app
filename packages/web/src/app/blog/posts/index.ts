import { post as guideSmartphone } from "./guide-smartphone-occasion-algerie";
import { post as vendreConseils } from "./vendre-conseils-annonces";
import { post as voitureOccasion } from "./acheter-voiture-occasion-algerie-verifications";
import { post as portableEtudes } from "./ordinateur-portable-etudes-algerie-2026";
import { post as machineACafe } from "./machine-a-cafe-algerie-guide";
import type { BlogPost } from "../types";

export const BLOG_POSTS: ReadonlyArray<BlogPost> = [
  guideSmartphone,
  vendreConseils,
  voitureOccasion,
  portableEtudes,
  machineACafe,
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
