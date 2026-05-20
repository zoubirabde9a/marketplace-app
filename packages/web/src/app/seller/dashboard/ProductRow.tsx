// One row of the seller's product list. Pulled out of the dashboard
// page so the unified /seller/products view can reuse the exact same
// layout (image, title/brand, price editor or static price, stock
// toggle or static chip, copy public URL, edit affordance) without
// copy-paste drift.
//
// Server component — composes the existing client primitives
// (PriceEditor, StockToggle, CopyIconButton) but renders no client
// state of its own. The whole row is wrapped in a <Link> to the edit
// page; the inline editors all stopPropagation so their taps don't
// also navigate.
//
// The optional `shopName` slot mirrors OrderRow — surfaces on the
// unified products page (multi-shop sellers need to know which shop a
// listing belongs to) and stays empty on the per-shop dashboard list.

import Link from "next/link";
import { CopyIconButton } from "@/components/CopyButton";
import { SITE_URL } from "@/lib/sitemap";
import { cleanProductTitle, formatPrice } from "@/lib/format";
import { PriceEditor } from "./PriceEditor";
import { StockToggle } from "./StockToggle";

export interface ProductRowData {
  productId: string;
  title: string;
  brand?: string;
  variantCount?: number;
  inStock: boolean;
  priceMinor?: string;
  priceFromMinor?: string;
  priceToMinor?: string;
  currency?: string;
  heroImageUrl: string | null;
}

interface ProductRowProps {
  product: ProductRowData;
  /** Render the owning shop's display name next to the title. Used by
   * the unified products page; single-shop and per-shop dashboard
   * sections leave it undefined. */
  shopName?: string;
}

export function ProductRow({ product: p, shopName }: ProductRowProps): React.JSX.Element {
  const isSingleVariant = p.variantCount === undefined || p.variantCount <= 1;
  return (
    <Link
      href={`/seller/products/${encodeURIComponent(p.productId)}/edit`}
      aria-label={`Modifier ${cleanProductTitle(p.title)}`}
      className="-mx-2 px-2 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 rounded-lg hover:bg-bg/60 active:bg-bg/60 transition"
    >
      <div className="flex items-center gap-3 min-w-0 sm:flex-1">
        {p.heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.heroImageUrl}
            alt=""
            className="w-10 h-10 rounded object-cover border border-line-soft bg-bg shrink-0"
            loading="lazy"
          />
        ) : (
          <span
            aria-hidden
            className="w-10 h-10 rounded border border-line-soft bg-bg-elev shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div dir="auto" className="text-ink truncate">{cleanProductTitle(p.title)}</div>
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-mute">
            {p.brand && <span>{p.brand}</span>}
            {shopName && (
              // Subtle "· shop name" annotation when rendering the
              // unified view. Truncates so a long shop name doesn't
              // push the row controls off the right edge on mobile.
              <span dir="auto" className="truncate max-w-[12rem]" title={shopName}>
                · {shopName}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft pl-[52px] sm:pl-0">
        {p.currency && (p.priceMinor || p.priceFromMinor) && (
          p.priceMinor && isSingleVariant ? (
            <PriceEditor
              productId={p.productId}
              initialPriceMinor={p.priceMinor}
              currency={p.currency}
            />
          ) : (
            <span className="text-ink">
              {p.priceMinor
                ? formatPrice(p.priceMinor, p.currency, "fr-DZ")
                : p.priceToMinor && p.priceToMinor !== p.priceFromMinor
                ? `${formatPrice(p.priceFromMinor!, p.currency, "fr-DZ")} – ${formatPrice(p.priceToMinor, p.currency, "fr-DZ")}`
                : formatPrice(p.priceFromMinor!, p.currency, "fr-DZ")}
            </span>
          )
        )}
        {p.variantCount !== undefined && p.variantCount > 1 && (
          <span className="px-2 py-0.5 rounded-full border border-line text-ink-mute">
            {p.variantCount} variantes
          </span>
        )}
        {isSingleVariant ? (
          <StockToggle productId={p.productId} initialInStock={p.inStock} />
        ) : (
          <span
            className={
              "px-2 py-0.5 rounded-full border " +
              (p.inStock
                ? "border-ok/40 text-ok bg-ok/10"
                : "border-line text-ink-mute")
            }
          >
            {p.inStock ? "en stock" : "rupture de stock"}
          </span>
        )}
        <CopyIconButton
          value={`${SITE_URL}/product/${p.productId}`}
          ariaLabel="Copier le lien public du produit"
        />
        <span aria-hidden className="text-ink-mute">›</span>
      </div>
    </Link>
  );
}
