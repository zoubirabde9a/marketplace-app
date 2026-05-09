import Link from "next/link";
import type { SearchHit } from "@/lib/api";
import { formatPrice, formatPriceRange, formatRating, formatRelativeTime } from "@/lib/format";
import { CounterfeitBadge } from "./CounterfeitBadge";

export function ProductCard({ hit }: { hit: SearchHit }) {
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
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-bg-elev via-bg-soft to-bg">
            <svg className="w-10 h-10 text-ink-mute opacity-40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
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
        <h3 className="text-sm font-medium text-ink line-clamp-2 leading-snug untrusted">
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
