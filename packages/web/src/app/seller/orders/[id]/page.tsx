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
import { OrderNoteField } from "./OrderNoteField";

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
      {/* Tighten paper margins. Browser defaults sit around 2.5cm
          which leaves the slip floating in a sea of whitespace and
          eats space for ad-hoc notes. 1cm gives the slip room to
          breathe without the slip itself feeling crowded. A4 since
          that's the standard sheet in Algeria; printers configured
          for Letter still respect the margin and just clip the
          bottom of the slip slightly. */}
      <style>{`@page { margin: 1cm; size: A4 }`}</style>
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

      {/* Stale banner — mirror of the dashboard's stale-actionable
          warning (b552ef5) and the row's "Lent" chip (206a116). A
          seller landing here from elsewhere should see the same
          urgency cue. Fires when paid/fulfilling AND >48h old.
          Print-hidden because the courier never needs to read
          "this took us too long" on the slip. */}
      {(() => {
        // Compute the order's age in hours and decide whether the
        // stale banner fires. Threshold + status set match the
        // dashboard banner (b552ef5) and row chip (206a116) so
        // counts reconcile. The age label uses days once we cross
        // 48 hours so "3 jours" reads at a glance more sharply
        // than "72 heures".
        if (order.status !== "paid" && order.status !== "fulfilling") return null;
        const ageMs = Date.now() - new Date(order.createdAt).getTime();
        if (ageMs <= 48 * 60 * 60_000) return null;
        const ageHours = Math.floor(ageMs / (60 * 60_000));
        const ageDays = Math.floor(ageHours / 24);
        const ageLabel = ageDays >= 2 ? `${ageDays} jours` : `${ageHours} heures`;
        return (
          <div className="mt-6 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn print:hidden flex items-start gap-3">
            <svg
              className="w-5 h-5 shrink-0 mt-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Commande en attente depuis {ageLabel}
              </p>
              <p className="mt-0.5 text-xs text-warn/80">
                Marquez-la en préparation ou expédiée — l’acheteur attend.
              </p>
            </div>
          </div>
        );
      })()}

      <div className="mt-6">
        <PrintableSlip order={order} shopName={owningSeller.displayName} />
      </div>

      {/* Local-only seller note. Lives below the slip and above the
          action bar; hidden on print so the courier never sees the
          internal note. Per-device persistence via localStorage —
          enough for the in-the-moment "I'm on a call, jot it down"
          workflow without needing backend. */}
      <OrderNoteField orderId={order.orderId} />

      {/* Action buttons — hidden on print. Same OrderActions component
          the list uses; here it serves the "I just packed this, mark
          it shipped" workflow without the seller having to scroll
          back to the list. On mobile the bar sticks to the bottom of
          the viewport so the seller doesn't have to scroll past the
          slip to reach the primary state-machine action; on desktop
          it sits in normal flow under the slip. Backdrop blur lets
          the slip text behind it stay vaguely visible without
          fighting for attention.
          The sticky wrapper only renders for statuses that actually
          have an action (paid/fulfilling/shipped — same set as
          OrderActions's actionsFor); other states would float an
          empty bar. */}
      {(["paid", "fulfilling", "shipped"] as const).includes(
        order.status as "paid" | "fulfilling" | "shipped",
      ) ? (
        <div className="mt-6 sticky bottom-0 sm:static z-10 print:hidden">
          <div className="rounded-2xl border border-line-soft bg-bg-soft/95 backdrop-blur p-3 sm:p-4 shadow-lg sm:shadow-none sm:bg-transparent sm:border-0 sm:p-0">
            <OrderActions
              sellerId={owningSeller.sellerId}
              orderId={order.orderId}
              status={order.status as Parameters<typeof OrderActions>[0]["status"]}
            />
          </div>
        </div>
      ) : (
        <div className="mt-6 print:hidden">
          <OrderActions
            sellerId={owningSeller.sellerId}
            orderId={order.orderId}
            status={order.status as Parameters<typeof OrderActions>[0]["status"]}
          />
        </div>
      )}
    </section>
  );
}
