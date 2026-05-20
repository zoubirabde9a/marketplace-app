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

import Link from "next/link";
import type { SellerOrder } from "@/lib/api";
import { cleanProductTitle, formatPrice, formatRelativeTime } from "@/lib/format";
import { CopyIconButton } from "@/components/CopyButton";
import { OrderActions } from "./OrderActions";
import { OrderProgress } from "./OrderProgress";

interface OrderRowProps {
  order: SellerOrder;
  sellerId: string;
  /** Show the owning shop's display name next to the order number.
   *  Used by the unified /seller/orders page. */
  shopName?: string;
  /** Total number of orders this customer has placed (count of the
   *  same phone across the seller's history). When >= 2 the row
   *  shows a "client habitué" chip — small but persistent signal so
   *  the seller knows to prioritize the relationship. The caller
   *  computes this once over the full dataset; the row only renders.
   */
  customerOrderCount?: number;
  /** Mark the row as "fresh" — typically computed by the page as
   *  "createdAt within the last 10 minutes from now". Pairs with the
   *  auto-refresh polling: when a new order lands via router.refresh()
   *  the seller sees a "Nouveau" chip on it, drawing the eye without
   *  needing to scan the whole list.
   */
  isNew?: boolean;
  /** Mark the row as "stale" — paid/fulfilling and unactioned >48h.
   *  Mirror of the dashboard's stale-actionable warning banner
   *  (b552ef5); same threshold so the count in the banner equals
   *  the count of chips in the list. Renders a small warn-tinted
   *  chip drawing the eye to laggers the seller should clear first.
   */
  isStale?: boolean;
}

export function OrderRow({
  order: o,
  sellerId,
  shopName,
  customerOrderCount,
  isNew,
  isStale,
}: OrderRowProps): React.JSX.Element {
  const isRepeat = (customerOrderCount ?? 0) >= 2;
  return (
    <div className="min-w-0 flex-1 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/seller/orders/${encodeURIComponent(o.orderId)}`}
            dir="ltr"
            className="font-mono text-sm text-ink hover:text-accent active:text-accent transition"
            aria-label={`Voir le détail de la commande ${o.publicNumber}`}
          >
            #{o.publicNumber}
          </Link>
          <CopyIconButton
            value={o.publicNumber}
            ariaLabel={`Copier le numéro de commande ${o.publicNumber}`}
          />
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
          {isNew && (
            // Small pulse-dot chip drawn the eye to just-arrived rows.
            // bg-accent dot subtly animates so it stands out in a list
            // of similar-looking rows. Auto-fades the moment the order
            // crosses the freshness threshold on the next refresh.
            <span
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-accent/15 border border-accent/40 text-accent"
              aria-label="Nouvelle commande"
            >
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Nouveau
            </span>
          )}
          {isStale && (
            // Stale-actionable: warn-tinted chip on rows the
            // dashboard banner is counting. Mutually exclusive in
            // practice with "Nouveau" (10min vs 48h windows can't
            // overlap) but rendered independently so they wouldn't
            // collide even if they did.
            <span
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-warn/15 border border-warn/40 text-warn"
              aria-label="En attente depuis plus de 48 heures"
              title="En attente depuis plus de 48 heures — pensez à marquer en préparation ou expédiée"
            >
              <span aria-hidden>⏳</span>
              Lent
            </span>
          )}
          <OrderProgress status={o.status} />
        </div>
        {o.customer && (
          <div className="mt-1 text-sm text-ink-soft">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span dir="auto" className="text-ink untrusted">{o.customer.name}</span>
              {isRepeat && o.customer && (
                // Deep-links to /seller/orders pre-filtered by this
                // customer's phone, so the seller sees the buyer's
                // full history in one tap. OrdersSearch reads ?q from
                // the URL and pre-fills its input.
                <Link
                  href={`/seller/orders?q=${encodeURIComponent(o.customer.phone)}`}
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent hover:bg-accent/15 active:bg-accent/20 transition"
                  aria-label={`Voir l’historique du client (${customerOrderCount} commandes)`}
                  title={`Voir l’historique du client — ${customerOrderCount} commandes`}
                >
                  <span aria-hidden>★</span>
                  Client habitué
                </Link>
              )}
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
              <CopyIconButton
                value={o.customer.phone}
                ariaLabel={`Copier le numéro de téléphone ${o.customer.phone}`}
              />
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
        <ul data-rich-only="true" className="mt-2 text-xs text-ink-mute space-y-1">
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
