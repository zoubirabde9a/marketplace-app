import Link from "next/link";
import type { SearchHit } from "@/lib/api";
import { formatPrice, formatPriceRange, formatRating, formatRelativeTime } from "@/lib/format";
import { CounterfeitBadge } from "./CounterfeitBadge";

export function ProductCard({ hit, eager = false }: { hit: SearchHit; eager?: boolean }) {
  const priceLabel = hit.priceMinor
    ? formatPrice(hit.priceMinor, hit.currency)
    : formatPriceRange(hit.priceFromMinor ?? null, hit.priceToMinor ?? null, hit.currency);

  return (
    <Link
      href={`/product/${encodeURIComponent(hit.productId)}`}
      className="group relative flex flex-col rounded-2xl border border-line-soft bg-bg-soft hover:bg-bg-elev hover:border-line transition-all overflow-hidden shadow-soft animate-fade-up"
    >
      <div className="aspect-[4/3] relative bg-gradient-to-br from-bg-elev to-bg overflow-hidden">
        {hit.heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hit.heroImageUrl}
            alt={hit.heroImage?.altText ?? hit.title.value}
            // Width/height honour the parent's 4:3 aspect-ratio so the
            // browser reserves layout space before the image loads.
            // Without these, every card forces a reflow when its hero
            // arrives — a Cumulative Layout Shift hit that Lighthouse
            // (and Google's Core Web Vitals ranking signal) penalises.
            // The values are intrinsic ratio anchors, not display sizes;
            // the className still stretches the img to fit the parent.
            width={400}
            height={300}
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "auto"}
            decoding="async"
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
              {(hit.brand ?? hit.title.value).trim().charAt(0).toUpperCase() || "·"}
            </span>
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1.5">
          <CounterfeitBadge risk={hit.counterfeitRisk} />
          {!hit.inStock && (
            <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-medium bg-bg/80 text-ink-soft border border-line">
              Out of stock
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
          {hit.title.value}
        </h3>
        {(() => {
          const posted = formatRelativeTime(hit.postedAt ?? null);
          return posted ? (
            <time
              dateTime={hit.postedAt ?? undefined}
              className="text-[11px] text-ink-mute"
            >
              Posted {posted}
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
