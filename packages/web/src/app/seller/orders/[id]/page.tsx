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
import { OrderActions } from "../../dashboard/OrderActions";
import { PrintButton } from "./PrintButton";
import { PrintableSlip } from "./PrintableSlip";

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

      <div className="mt-6">
        <PrintableSlip order={order} shopName={owningSeller.displayName} />
      </div>

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
