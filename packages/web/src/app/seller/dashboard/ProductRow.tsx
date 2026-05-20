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
  // Compose a one-line share message: title, price (when known), URL.
  // wa.me opens WhatsApp's contact picker with the text pre-filled —
  // beats the seller copying the link, typing the title, typing the
  // price, then pasting the link into each conversation.
  const publicUrl = `${SITE_URL}/product/${p.productId}`;
  const titleClean = cleanProductTitle(p.title);
  const priceForShare =
    p.priceMinor && p.currency
      ? formatPrice(p.priceMinor, p.currency, "fr-DZ")
      : p.priceFromMinor && p.currency
      ? `à partir de ${formatPrice(p.priceFromMinor, p.currency, "fr-DZ")}`
      : null;
  const shareText = [titleClean, priceForShare, publicUrl].filter(Boolean).join(" — ");
  const waShareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  return (
    <Link
      href={`/seller/products/${encodeURIComponent(p.productId)}/edit`}
      aria-label={`Modifier ${cleanProductTitle(p.title)}`}
      className={
        "-mx-2 px-2 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 rounded-lg hover:bg-bg/60 active:bg-bg/60 transition " +
        // Out-of-stock listings can't be bought — fade them back so
        // the seller's eye lands on the actively-selling rows first.
        // Not display:none because the seller still needs to see
        // them (to flip stock back on, share the link in a
        // pre-order conversation, edit, etc.); just less visual
        // weight. Children stay full-opacity on hover so the row
        // doesn't feel broken when the seller is reading it.
        (p.inStock ? "" : "opacity-60 hover:opacity-100")
      }
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
          // Empty image is a real merchandising problem — listings
          // without photos consistently underperform. Render a
          // warn-tinted camera icon instead of a blank square so the
          // gap is visible in the row scan. Row is already a click-
          // to-edit link, so no extra affordance needed; the seller
          // taps the row to fix it.
          <span
            aria-label="Photo manquante"
            title="Photo manquante — ajoutez une image pour mieux vendre"
            className="w-10 h-10 rounded border border-warn/40 bg-warn/10 text-warn shrink-0 inline-flex items-center justify-center"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 7a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
              />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
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
          value={publicUrl}
          ariaLabel="Copier le lien public du produit"
        />
        {/* Open the storefront PDP in a new tab — useful when the
            seller wants to verify exactly what the buyer sees (image
            order, copy, price, related items) without leaving the
            dashboard. stopPropagation so this doesn't also trigger
            the parent row's edit-page navigation. */}
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Voir l’annonce en ligne"
          title="Voir l’annonce en ligne"
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-ink-mute hover:text-accent hover:bg-bg-elev active:text-accent active:bg-bg-elev transition shrink-0"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 4h6v6m0-6L10 14M9 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4" />
          </svg>
        </a>
        {/* WhatsApp share — opens wa.me with a pre-filled message
            (title, price, link). The contact picker that opens lets
            the seller blast it across multiple chats in one go.
            stopPropagation so this doesn't also trigger the parent
            row's edit-page navigation. */}
        <a
          href={waShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Partager sur WhatsApp"
          title="Partager sur WhatsApp"
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-ink-mute hover:text-emerald-400 hover:bg-emerald-500/10 active:text-emerald-400 active:bg-emerald-500/15 transition shrink-0"
        >
          {/* Speech-bubble silhouette — recognizable as messaging
              without taking on WhatsApp's brand asset. */}
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </a>
        <span aria-hidden className="text-ink-mute">›</span>
      </div>
    </Link>
  );
}
