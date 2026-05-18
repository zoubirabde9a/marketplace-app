// Image-URL helpers. Ouedkniss CDN URLs come back from the API at /400/ size
// (cdn[N].ouedkniss.com/400/medias/...) — fine for visible <img> in product
// grids and detail galleries, but below crawler/share-card minimums:
//   - Facebook / LinkedIn / X (summary_large_image) want 1200×630.
//   - Google Image Search prefers higher-resolution image:loc entries.
//   - Schema.org Product image is treated as a quality signal.
// The CDN supports a /1200/ variant on the same path. Swap the size segment
// for crawler-facing surfaces (sitemap, OG, JSON-LD); leave it untouched for
// visible <img> tags where weight matters.
//
// Used by: lib/sitemap.ts, app/product/[id]/page.tsx, app/page.tsx,
//          app/search/page.tsx. Keep this the single source of truth so
//          the size choice stays consistent across SEO surfaces.

const PATTERN = /^(https?:\/\/cdn\d*\.ouedkniss\.com)\/\d{2,4}(\/medias\/)/;

export function upscaleOuedknissForCrawler(url: string): string {
  return url.replace(PATTERN, "$1/1200$2");
}
