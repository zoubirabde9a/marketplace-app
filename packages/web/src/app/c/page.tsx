// Bare /c — anyone typing just "/c" lands on a useful destination instead
// of a 404. 308 (permanent) so Google consolidates any external link to /c
// onto /search (the catalog tool). The category-specific pages all live at
// /c/<slug> and are reached via internal nav, sitemap, and search-engine
// links — this route is purely for typed-URL recovery.

import { permanentRedirect } from "next/navigation";

export default function CategoriesIndex(): never {
  permanentRedirect("/search");
}
