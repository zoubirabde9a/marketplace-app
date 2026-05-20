// Printable packing slip — the article block used by both the single-
// order detail page (/seller/orders/[id]) and the bulk-print page
// (/seller/orders/print). Pulled out so both surfaces render the same
// slip layout without copy-paste drift; the bulk page just stacks a
// list of these with print:break-after-page in between.
//
// Server component. The print-only date stamp is rendered with a fixed
// dateString prop instead of a fresh Date() so the bulk page can
// stamp every slip with the same timestamp (the printing time, not the
// time each slip was rendered — they'd vary by microseconds otherwise
// in the SSR pass and that's noise).

import Link from "next/link";
import type { SellerOrder } from "@/lib/api";
import { cleanProductTitle, formatPrice } from "@/lib/format";
import { OrderProgress } from "../../dashboard/OrderProgress";

interface PrintableSlipProps {
  order: SellerOrder;
  shopName: string;
  /**
   * When true, the article forces a page break after itself on print
   * so the next slip starts on a fresh page. Used by the bulk-print
   * page; the single-order detail page leaves it false.
   */
  breakAfter?: boolean;
}

export function PrintableSlip({
  order,
  shopName,
  breakAfter = false,
}: PrintableSlipProps): React.JSX.Element {
  return (
    <article
      className={
        "rounded-2xl border border-line-soft bg-bg-soft/60 p-5 sm:p-8 " +
        "print:bg-white print:text-black print:border-black/30 print:rounded-none print:p-6 " +
        (breakAfter ? "print:break-after-page" : "")
      }
    >
      {/* Top strip: shop name + order number on the left; status on
          the right. Mirrors the single-order detail page so the bulk
          print produces identical-looking slips. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-ink-mute print:text-black/50">
            Boutique
          </p>
          <p dir="auto" className="text-lg font-medium text-ink print:text-black">
            {shopName}
          </p>
          <p
            dir="ltr"
            className="mt-1 font-mono text-sm text-ink-soft print:text-black"
          >
            Commande #{order.publicNumber}
          </p>
          {/* Creation date — useful both for the seller looking at
              the slip on screen ("how old is this?") and for the
              courier holding the paper ("when was this ordered?"
              gives them context if there's a delivery dispute).
              Locale-formatted in fr-DZ to match the rest of the
              French chrome. */}
          <p className="mt-0.5 text-xs text-ink-mute tabular-nums print:text-black/70">
            Passée le{" "}
            {new Date(order.createdAt).toLocaleDateString("fr-DZ", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-ink-mute print:text-black/50">
            Statut
          </p>
          <div className="mt-1">
            <OrderProgress status={order.status} />
          </div>
        </div>
      </div>

      {order.customer && (
        <div className="mt-6 pt-4 border-t border-line-soft print:border-black/30">
          <p className="text-[10px] uppercase tracking-widest text-ink-mute print:text-black/50">
            Destinataire
          </p>
          <p
            dir="auto"
            className="mt-1 text-lg font-medium text-ink untrusted print:text-black print:[&::before]:hidden"
          >
            {order.customer.name}
          </p>
          <p
            dir="ltr"
            className="mt-0.5 font-mono text-sm text-ink-soft print:text-black"
          >
            {order.customer.phone}
          </p>
          {order.customer.region && (
            <p dir="auto" className="mt-0.5 text-sm text-ink-soft print:text-black">
              Wilaya :{" "}
              <span className="text-ink print:text-black">{order.customer.region}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-line-soft print:border-black/30">
        <p className="text-[10px] uppercase tracking-widest text-ink-mute print:text-black/50">
          Articles ({order.lines.length})
        </p>
        <ul className="mt-2 space-y-2">
          {order.lines.map((l) => (
            <li key={l.variantId} className="flex items-start gap-3">
              <span
                aria-label={`Quantité ${l.qty}`}
                className="shrink-0 inline-flex items-center justify-center min-w-[2rem] px-2 h-7 rounded-md border border-line text-ink bg-bg/60 font-semibold tabular-nums print:bg-white print:text-black print:border-black/40"
              >
                ×{l.qty}
              </span>
              <div className="min-w-0 flex-1">
                {/* Title links to the public PDP when the line still
                    references a live product — handy when the seller
                    is fielding a buyer question ("can I get this in
                    blue?") and wants to look at what the buyer saw.
                    Falls back to plain text when productId is null
                    (orphaned line / product since removed). Underline
                    only on screen; on paper the URL is invisible. */}
                {l.productId && l.title ? (
                  <Link
                    href={`/product/${encodeURIComponent(l.productId)}`}
                    target="_blank"
                    rel="noopener"
                    dir="auto"
                    className="text-ink untrusted truncate hover:text-accent active:text-accent transition block print:text-black print:[&::before]:hidden"
                  >
                    {cleanProductTitle(l.title)}
                  </Link>
                ) : (
                  <p
                    dir="auto"
                    className="text-ink untrusted truncate print:text-black print:[&::before]:hidden"
                  >
                    {l.title ? cleanProductTitle(l.title) : (l.sku ?? l.variantId)}
                  </p>
                )}
                {l.sku && (
                  <p className="font-mono text-[11px] text-ink-mute print:text-black/60">
                    SKU {l.sku}
                  </p>
                )}
              </div>
              <p className="text-sm text-ink-soft tabular-nums shrink-0 print:text-black">
                {formatPrice(l.unitPriceMinor, order.currency, "fr-DZ")}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 pt-4 border-t border-line-soft flex items-baseline justify-between print:border-black/30">
        <span className="text-[10px] uppercase tracking-widest text-ink-mute print:text-black/50">
          Total
        </span>
        <span className="text-2xl font-semibold tabular-nums text-ink print:text-black">
          {formatPrice(order.subtotalMinor, order.currency, "fr-DZ")}
        </span>
      </div>
    </article>
  );
}
