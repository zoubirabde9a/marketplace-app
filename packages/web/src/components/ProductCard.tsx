import Link from "next/link";
import Image from "next/image";
import type { SearchHit } from "@/lib/api";
import { cleanProductTitle, formatPrice, formatPriceRange, formatRating, formatRelativeTime } from "@/lib/format";
import { CounterfeitBadge } from "./CounterfeitBadge";

// `eager` controls loading=eager (image starts fetching immediately instead
// of waiting for IntersectionObserver). `priority` separately controls
// fetchPriority="high" (the browser allocates more bandwidth to this image
// over other concurrent fetches). They were one prop before iter-23 — but
// LCP measures the SINGLE largest visible element, so only ONE image per
// page benefits from fetchPriority="high"; setting it on 4 cards (the
// pre-iter-23 default for the recent strip on the home page) made the
// browser multiplex bandwidth across 4 high-priority fetches, slowing
// down the actual LCP candidate. Now eager spans the above-fold row
// (loading them in parallel) but priority is reserved for the first
// card only.
export function ProductCard({
  hit,
  eager = false,
  priority = false,
}: {
  hit: SearchHit;
  eager?: boolean;
  priority?: boolean;
}) {
  const priceLabel = hit.priceMinor
    ? formatPrice(hit.priceMinor, hit.currency)
    : formatPriceRange(hit.priceFromMinor ?? null, hit.priceToMinor ?? null, hit.currency);
  const displayTitle = cleanProductTitle(hit.title.value);

  return (
    <Link
      href={`/product/${encodeURIComponent(hit.productId)}`}
      className="group relative flex flex-col rounded-2xl border border-line-soft bg-bg-soft hover:bg-bg-elev hover:border-line transition-all overflow-hidden shadow-soft animate-fade-up"
    >
      <div className="aspect-[4/3] relative bg-gradient-to-br from-bg-elev to-bg overflow-hidden">
        {hit.heroImageUrl ? (
          // next/image: routes the upstream Ouedkniss CDN URL through Next's
          // image optimizer (configured with remotePatterns: { hostname: "**" }
          // in next.config.mjs), which transcodes to AVIF/WebP at request time
          // and serves a responsive srcset. AVIF is typically 2-4x smaller
          // than the JPEG the CDN ships at the same perceptual quality;
          // direct LCP win on product-grid pages where the first row of
          // hero images is the Largest Contentful Paint candidate.
          //
          // sizes maps the grid's CSS breakpoints (Tailwind defaults: sm 640,
          // md 768, lg 1024) so the browser picks the smallest srcset entry
          // that satisfies the rendered card width — avoids fetching the 3x
          // DPR variant on a 1x mobile device.
          //
          // priority={priority} hooks Next's automatic preload + fetchPriority
          // high for the single LCP candidate (first card on home / search).
          // Without it, eager+fetchPriority would be set on the underlying
          // <img>; with it, Next ALSO emits a <link rel="preload" as="image">
          // in <head> so the browser starts the fetch before the parser
          // reaches the body — measurable LCP improvement.
          <Image
            src={hit.heroImageUrl}
            alt={hit.heroImage?.altText ?? displayTitle}
            width={400}
            height={300}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            loading={eager && !priority ? "eager" : undefined}
            priority={priority}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center bg-gradient-to-br from-bg-elev via-bg-soft to-bg"
            aria-hidden
          >
            {/* Brand initial as visual differentiator when the seller hasn't
                supplied an image — beats a wall of identical placeholder
                icons for customers browsing the grid. */}
            <span className="text-3xl font-semibold tracking-tight text-ink-mute select-none">
              {(hit.brand ?? displayTitle).trim().charAt(0).toUpperCase() || "·"}
            </span>
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1.5">
          <CounterfeitBadge risk={hit.counterfeitRisk} />
          {!hit.inStock && (
            <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-medium bg-bg/80 text-ink-soft border border-line">
              Rupture de stock
            </span>
          )}
        </div>
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* h3, not h2: product cards are nested below a page-level H1 (every
            page that renders them — home / slice landings / product detail's
            "More from seller" — has its own H1 already). Bumping these from
            h2 to h3 keeps heading hierarchy clean for crawlers and screen
            readers; before this fix a category landing rendered ~25 h2s
            (footer chip blocks + every product card) which buried the
            page's actual H1 ("Telephones · Teno Store") in the noise. */}
        <h3 dir="auto" className="text-sm font-medium text-ink line-clamp-2 leading-snug untrusted">
          {displayTitle}
        </h3>
        {(() => {
          const posted = formatRelativeTime(hit.postedAt ?? null);
          return posted ? (
            <time
              dateTime={hit.postedAt ?? undefined}
              className="text-[11px] text-ink-mute"
            >
              Publié {posted}
            </time>
          ) : null;
        })()}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="text-base font-semibold text-ink tracking-tight">{priceLabel}</div>
          {hit.rating != null && (
            <div className="text-[11px] text-ink-mute">{formatRating(hit.rating, hit.ratingCount)}</div>
          )}
        </div>
      </div>
    </Link>
  );
}
