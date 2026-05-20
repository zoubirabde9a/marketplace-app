// Single order row used by both the per-shop list on /seller/dashboard
// and the cross-shop unified list on /seller/orders. Server component —
// no client interactivity here; the OrderActions child component handles
// state transitions and the StockToggle pattern doesn't apply.
//
// Pulled out of the dashboard page so the unified orders page can reuse
// the exact same layout (line items, customer block, call/WhatsApp,
// status stepper, action buttons, total) without copy-paste drift.
//
// The optional `shopName` slot is rendered next to the order number when
// the caller is the unified view — the seller needs to know which shop
// the order belongs to when they're looking at a mixed stream.

import type { SellerOrder } from "@/lib/api";
import { cleanProductTitle, formatPrice, formatRelativeTime } from "@/lib/format";
import { OrderActions } from "./OrderActions";
import { OrderProgress } from "./OrderProgress";

interface OrderRowProps {
  order: SellerOrder;
  sellerId: string;
  /** Show the owning shop's display name next to the order number.
   *  Used by the unified /seller/orders page. */
  shopName?: string;
}

export function OrderRow({ order: o, sellerId, shopName }: OrderRowProps): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span dir="ltr" className="font-mono text-sm text-ink">#{o.publicNumber}</span>
          {shopName && (
            <span
              dir="auto"
              className="text-xs text-ink-soft truncate max-w-[10rem]"
              title={shopName}
            >
              · {shopName}
            </span>
          )}
          <span
            className="text-xs text-ink-mute tabular-nums"
            title={new Date(o.createdAt).toLocaleString("fr-DZ")}
          >
            {formatRelativeTime(o.createdAt) ?? new Date(o.createdAt).toLocaleString("fr-DZ")}
          </span>
          <OrderProgress status={o.status} />
        </div>
        {o.customer && (
          <div className="mt-1 text-sm text-ink-soft">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span dir="auto" className="text-ink untrusted">{o.customer.name}</span>
              {o.customer.region && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-ink-soft"
                  aria-label={`Wilaya : ${o.customer.region}`}
                >
                  <span aria-hidden>📍</span>
                  <span dir="auto">{o.customer.region}</span>
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <a
                href={`tel:${o.customer.phone}`}
                dir="ltr"
                className="inline-flex items-center gap-1 px-3 h-11 sm:h-7 rounded-full bg-bg-elev border border-line-soft font-mono text-xs hover:text-accent hover:border-accent/40 active:text-accent active:border-accent/40 transition"
                aria-label={`Appeler ${o.customer.name} au ${o.customer.phone}`}
              >
                {o.customer.phone}
              </a>
              <a
                href={`https://wa.me/${o.customer.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
                  `Bonjour ${o.customer.name}, je vous contacte au sujet de votre commande #${o.publicNumber} sur Teno Store.`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Discuter avec ${o.customer.name} sur WhatsApp au sujet de la commande ${o.publicNumber}`}
                className="inline-flex items-center gap-1 px-3 h-11 sm:h-7 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 hover:bg-emerald-500/20 active:bg-emerald-500/25 transition"
              >
                WhatsApp
              </a>
            </div>
          </div>
        )}
        <ul className="mt-2 text-xs text-ink-mute space-y-1">
          {o.lines.map((l) => (
            <li key={l.variantId} className="flex items-center gap-2 min-w-0">
              {l.heroImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.heroImageUrl}
                  alt=""
                  className="w-8 h-8 rounded object-cover border border-line-soft bg-bg shrink-0"
                  loading="lazy"
                />
              ) : (
                <span
                  aria-hidden
                  className="w-8 h-8 rounded border border-line-soft bg-bg-elev shrink-0"
                />
              )}
              <span
                aria-label={`Quantité ${l.qty}`}
                className="shrink-0 inline-flex items-center justify-center min-w-[1.75rem] px-1.5 h-5 rounded-full border border-line text-ink-soft bg-bg/60 font-medium tabular-nums"
              >
                ×{l.qty}
              </span>
              <span className="min-w-0 flex-1 flex flex-col">
                <span dir="auto" className="truncate untrusted">
                  {l.title ? cleanProductTitle(l.title) : (l.sku ?? l.variantId)}
                </span>
                {l.title && l.sku && (
                  <span className="font-mono text-[10px] text-ink-mute truncate">{l.sku}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <OrderActions
          sellerId={sellerId}
          orderId={o.orderId}
          status={o.status as Parameters<typeof OrderActions>[0]["status"]}
        />
      </div>
      <dl className="text-right shrink-0">
        <dt className="text-[10px] uppercase tracking-widest text-ink-mute">Total</dt>
        <dd className="text-sm font-medium tabular-nums">
          {formatPrice(o.subtotalMinor, o.currency, "fr-DZ")}
        </dd>
      </dl>
    </div>
  );
}
