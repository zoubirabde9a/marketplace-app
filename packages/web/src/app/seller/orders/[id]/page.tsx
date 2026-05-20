// Printable order detail / packing slip. Sellers preparing parcels for
// delivery print this page, fold it inside the box, and hand the whole
// thing to the courier. The screen rendering uses the same dashboard
// chrome (so the seller knows where they are); the print stylesheet
// (via Tailwind's `print:` variant) hides nav, action buttons, and the
// copy-icon buttons to leave a clean black-on-white slip.
//
// No dedicated /v1/orders/:id endpoint exists; sellers can only list
// orders for their own shops via /v1/sellers/:sellerId/orders. We
// re-use that — fetch all sellers' orders in parallel, find the one
// matching the URL param, render or 404. For typical sellers this is
// one round-trip; even a multi-shop seller is fast (Promise.all).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import {
  listMySellers,
  listSellerOrders,
  type SellerOrder,
  type SellerRecord,
} from "@/lib/api";
import { cleanProductTitle, formatPrice } from "@/lib/format";
import { OrderActions } from "../../dashboard/OrderActions";
import { OrderProgress } from "../../dashboard/OrderProgress";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Détail de la commande",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrderDetailPage({ params }: PageProps): Promise<React.JSX.Element> {
  const session = await getCurrentUser();
  if (!session) redirect("/seller");
  const { id } = await params;
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const sellers: SellerRecord[] = sellersResp.data;
  if (sellers.length === 0) redirect("/seller/dashboard");

  // Cross-shop lookup — no /v1/orders/:id endpoint exists, so we scan
  // every shop the seller owns. allSettled keeps a failing shop from
  // 500-ing the whole detail page; the order is only "found" if a
  // fulfilled response contains it.
  const results = await Promise.allSettled(
    sellers.map((s) => listSellerOrders(s.sellerId, session.jwt)),
  );
  let order: SellerOrder | null = null;
  let owningSeller: SellerRecord | null = null;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status !== "fulfilled") continue;
    const match = r.value.data.find((o) => o.orderId === id);
    if (match) {
      order = match;
      owningSeller = sellers[i]!;
      break;
    }
  }
  if (!order || !owningSeller) notFound();

  return (
    <section
      // print:max-w-none drops the centered max-width on paper so the
      // slip uses the full page width; everything else just goes onto
      // the page in a natural top-down flow.
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-3xl mx-auto print:max-w-none print:pt-0 print:pb-0"
      lang="fr"
    >
      {/* Header — hidden on print. Back link + page title + print
          trigger button. The print button is a small client component
          that calls window.print(). */}
      <header className="flex items-start justify-between gap-4 print:hidden flex-wrap">
        <div className="min-w-0">
          <Link
            href="/seller/orders"
            className="text-sm text-ink-mute hover:text-ink active:text-ink transition"
          >
            ← Toutes les commandes
          </Link>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">
            Commande{" "}
            <span dir="ltr" className="font-mono">#{order.publicNumber}</span>
          </h1>
        </div>
        <PrintButton />
      </header>

      {/* The printable slip itself. The card chrome (rounded, border)
          carries over to print as a thin black frame — gives the
          courier a single visual unit to look at on the page. */}
      <article className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-5 sm:p-8 print:bg-white print:text-black print:border-black/30 print:rounded-none print:p-6">
        {/* Top strip: shop name on the left (origin of the package),
            print-only date stamp on the right (so the courier knows
            when it was prepared). On screen, the date already lives in
            the order metadata; printing it again is redundant noise. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-ink-mute print:text-black/50">
              Boutique
            </p>
            <p
              dir="auto"
              className="text-lg font-medium text-ink print:text-black"
            >
              {owningSeller.displayName}
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

        {/* Customer block — the courier reads this. Tel + WhatsApp
            links are hidden on print (no clickable URL on paper); the
            number is rendered as plain text inside the same block. */}
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
            <p dir="ltr" className="mt-0.5 font-mono text-sm text-ink-soft print:text-black">
              {order.customer.phone}
            </p>
            {order.customer.region && (
              <p
                dir="auto"
                className="mt-0.5 text-sm text-ink-soft print:text-black"
              >
                Wilaya : <span className="text-ink print:text-black">{order.customer.region}</span>
              </p>
            )}
          </div>
        )}

        {/* Line items — what the seller has to physically pack. Same
            qty-badge + title pattern as the dashboard row, but bigger
            and with more whitespace because this is the focus of the
            printed page. */}
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
                  <p
                    dir="auto"
                    className="text-ink untrusted truncate print:text-black print:[&::before]:hidden"
                  >
                    {l.title ? cleanProductTitle(l.title) : (l.sku ?? l.variantId)}
                  </p>
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

        {/* Total block — the seller and courier both verify against
            this. Rendered as a big right-aligned number on print. */}
        <div className="mt-6 pt-4 border-t border-line-soft flex items-baseline justify-between print:border-black/30">
          <span className="text-[10px] uppercase tracking-widest text-ink-mute print:text-black/50">
            Total
          </span>
          <span className="text-2xl font-semibold tabular-nums text-ink print:text-black">
            {formatPrice(order.subtotalMinor, order.currency, "fr-DZ")}
          </span>
        </div>
      </article>

      {/* Action buttons — hidden on print. Same OrderActions component
          the list uses; here it serves the "I just packed this, mark
          it shipped" workflow without the seller having to scroll back
          to the list. */}
      <div className="mt-6 print:hidden">
        <OrderActions
          sellerId={owningSeller.sellerId}
          orderId={order.orderId}
          status={order.status as Parameters<typeof OrderActions>[0]["status"]}
        />
      </div>
    </section>
  );
}
