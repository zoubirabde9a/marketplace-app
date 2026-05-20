// Bulk packing-slip print. A seller doing morning prep on N paid +
// fulfilling orders should print all N slips with one print dialog —
// not open each order in turn. This page stacks one PrintableSlip per
// actionable order, with print:break-after-page so each lands on its
// own sheet of paper.
//
// Reaches via the "Imprimer les bons" header link on /seller/orders.
// Defaults to the "actionable" set (paid / fulfilling / disputed) —
// the orders the seller is most likely doing physical work on right
// now. A future iteration could accept ?status=… to print a different
// slice; today's batch workflow is the priority.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import {
  listMySellers,
  listSellerOrders,
  type SellerOrder,
  type SellerRecord,
} from "@/lib/api";
import { PrintableSlip } from "../[id]/PrintableSlip";
import { PrintButton } from "../[id]/PrintButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Imprimer les bons",
  robots: { index: false, follow: false },
};

// Same set as the À-traiter chips elsewhere — keeps the print batch
// in sync with what the seller sees flagged on the dashboard and the
// unified orders page.
const ACTIONABLE_STATUSES: ReadonlySet<string> = new Set([
  "paid",
  "fulfilling",
  "disputed",
]);

export default async function BulkPrintPage(): Promise<React.JSX.Element> {
  const session = await getCurrentUser();
  if (!session) redirect("/seller");
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const sellers: SellerRecord[] = sellersResp.data;
  if (sellers.length === 0) redirect("/seller/dashboard");

  const results = await Promise.allSettled(
    sellers.map((s) => listSellerOrders(s.sellerId, session.jwt)),
  );
  const slips: Array<{ order: SellerOrder; shopName: string }> = [];
  let anyFetchFailed = false;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const o of r.value.data) {
        if (ACTIONABLE_STATUSES.has(o.status)) {
          slips.push({ order: o, shopName: sellers[i]!.displayName });
        }
      }
    } else {
      anyFetchFailed = true;
    }
  });

  // Sort oldest-first so the print stack matches typical FIFO prep
  // order — courier picks up the top sheet first, that's the oldest
  // order the seller still owes shipping on.
  slips.sort((a, b) => {
    const cmp =
      new Date(a.order.createdAt).getTime() - new Date(b.order.createdAt).getTime();
    if (cmp !== 0) return cmp;
    return a.order.orderId.localeCompare(b.order.orderId);
  });

  return (
    <section
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-3xl mx-auto print:max-w-none print:pt-0 print:pb-0"
      lang="fr"
    >
      <header className="flex items-start justify-between gap-4 print:hidden flex-wrap">
        <div className="min-w-0">
          <Link
            href="/seller/orders"
            className="text-sm text-ink-mute hover:text-ink active:text-ink transition"
          >
            ← Toutes les commandes
          </Link>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">
            Imprimer les bons{" "}
            <span className="text-ink-soft tabular-nums">({slips.length})</span>
          </h1>
          <p className="mt-2 text-xs text-ink-mute">
            Commandes à traiter — un bon par page, triées de la plus ancienne
            à la plus récente.
          </p>
        </div>
        {slips.length > 0 && <PrintButton />}
      </header>

      {anyFetchFailed && (
        <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn print:hidden">
          Certaines boutiques n’ont pas pu être chargées. La pile ci-dessous
          peut être incomplète.
        </p>
      )}

      {slips.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-6 text-sm text-ink-soft print:hidden">
          <p>Aucune commande à traiter pour le moment.</p>
          <Link
            href="/seller/orders"
            className="mt-3 inline-flex text-accent underline-offset-2 hover:underline active:underline text-sm"
          >
            Retour aux commandes
          </Link>
        </div>
      ) : (
        // On screen we render a vertical stack with breathing room
        // between slips so the seller can scroll-preview before
        // printing. On paper each slip gets break-after-page so the
        // next slip lands on a fresh sheet.
        <div className="mt-6 space-y-6 print:space-y-0">
          {slips.map((s, i) => (
            <PrintableSlip
              key={s.order.orderId}
              order={s.order}
              shopName={s.shopName}
              // No page break after the last slip — would emit a
              // blank trailing page on some browsers (Chromium
              // notably).
              breakAfter={i < slips.length - 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}
