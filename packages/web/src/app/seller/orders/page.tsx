// Unified cross-shop orders view. The dashboard at /seller/dashboard nests
// orders inside each shop card, which is fine for the common single-shop
// seller but doesn't scale to "show me everything I owe shipping on right
// now" across multiple shops. This page fans out, flattens, sorts by
// recency, and reuses the existing OrderRow + filter + date-bucket
// primitives so the seller's mental model stays consistent across the two
// surfaces.
//
// Server-rendered; force-dynamic because order state changes don't go
// through any cache invalidation we control today.

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
import { OrderRow } from "../dashboard/OrderRow";
import { OrdersSearch } from "./OrdersSearch";
import { OrdersStats } from "./OrdersStats";
import { OrdersStatusTabs, type StatusTab } from "./OrdersStatusTabs";
import { TabTitleBadge } from "./TabTitleBadge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Toutes les commandes",
  robots: { index: false, follow: false },
};

const ACTIONABLE_STATUSES: ReadonlySet<string> = new Set(["paid", "fulfilling", "disputed"]);

// Cross-shop annotation. Each order keeps a reference back to its owning
// shop so the row component can label it and OrderActions can submit the
// transition against the right seller ID.
interface UnifiedOrder {
  order: SellerOrder;
  sellerId: string;
  shopName: string;
}

function bucketUnifiedByDate(
  orders: ReadonlyArray<UnifiedOrder>,
  now: Date,
): Array<{ label: string; orders: UnifiedOrder[]; anyActionable: boolean }> {
  // Same calendar-bucket logic as the dashboard's bucketOrdersByDate but
  // operating on UnifiedOrder. Kept locally to avoid an export/import
  // dance for a 30-line helper that's only useful here and on the
  // dashboard.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const startOfYesterday = startOfToday - DAY;
  const startOfWeek = startOfToday - 6 * DAY;
  const groups: Record<"today" | "yesterday" | "week" | "older", UnifiedOrder[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };
  for (const u of orders) {
    const t = new Date(u.order.createdAt).getTime();
    if (Number.isNaN(t)) {
      groups.older.push(u);
      continue;
    }
    if (t >= startOfToday) groups.today.push(u);
    else if (t >= startOfYesterday) groups.yesterday.push(u);
    else if (t >= startOfWeek) groups.week.push(u);
    else groups.older.push(u);
  }
  const LABELS = {
    today: "Aujourd’hui",
    yesterday: "Hier",
    week: "Cette semaine",
    older: "Plus anciennes",
  } as const;
  const out: Array<{ label: string; orders: UnifiedOrder[]; anyActionable: boolean }> = [];
  for (const key of ["today", "yesterday", "week", "older"] as const) {
    if (groups[key].length === 0) continue;
    out.push({
      label: LABELS[key],
      orders: groups[key],
      anyActionable: groups[key].some((u) => ACTIONABLE_STATUSES.has(u.order.status)),
    });
  }
  return out;
}

export default async function SellerOrdersPage(): Promise<React.JSX.Element> {
  const session = await getCurrentUser();
  if (!session) redirect("/seller");
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const sellers: SellerRecord[] = sellersResp.data;

  if (sellers.length === 0) {
    // Edge case — a seller account exists (otherwise the seller dashboard
    // would have redirected to /seller) but has no shops. Punt back to
    // the dashboard which has the create-shop UI.
    redirect("/seller/dashboard");
  }

  // Fan-out fetch. allSettled keeps a single failing shop from blanking
  // the whole list — its rows just won't show.
  const results = await Promise.allSettled(
    sellers.map((s) => listSellerOrders(s.sellerId, session.jwt)),
  );
  const orders: UnifiedOrder[] = [];
  let anyFetchFailed = false;
  results.forEach((res, i) => {
    const s = sellers[i]!;
    if (res.status === "fulfilled") {
      for (const o of res.value.data) {
        orders.push({ order: o, sellerId: s.sellerId, shopName: s.displayName });
      }
    } else {
      anyFetchFailed = true;
    }
  });

  // Sort newest first. Stable when timestamps tie (orderId as tiebreaker).
  orders.sort((a, b) => {
    const cmp = new Date(b.order.createdAt).getTime() - new Date(a.order.createdAt).getTime();
    if (cmp !== 0) return cmp;
    return a.order.orderId.localeCompare(b.order.orderId);
  });

  const actionableCount = orders.filter((u) =>
    ACTIONABLE_STATUSES.has(u.order.status),
  ).length;
  // Per-tab counts for the status filter strip. "closed" combines
  // cancelled + refunded since both share a single "Annulées" tab.
  const tabCounts: Record<StatusTab, number> = {
    all: orders.length,
    actionable: actionableCount,
    shipped: orders.filter((u) => u.order.status === "shipped").length,
    delivered: orders.filter((u) => u.order.status === "delivered").length,
    closed: orders.filter(
      (u) => u.order.status === "cancelled" || u.order.status === "refunded",
    ).length,
  };

  const buckets = bucketUnifiedByDate(orders, new Date());
  // Show shop name on each row only when the seller owns more than one
  // shop. For single-shop sellers it would be redundant noise.
  const showShopName = sellers.length > 1;

  return (
    <section
      aria-labelledby="orders-heading"
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-5xl mx-auto"
      lang="fr"
    >
      <TabTitleBadge count={actionableCount} />
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 id="orders-heading" className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Toutes les commandes
          </h1>
          <p className="mt-2 text-xs text-ink-mute">
            <span className="text-ink-soft tabular-nums">{orders.length}</span>{" "}
            commande{orders.length === 1 ? "" : "s"}
            {sellers.length > 1 && (
              <>
                {" "}sur <span className="text-ink-soft tabular-nums">{sellers.length}</span> boutiques
              </>
            )}
            {actionableCount > 0 && (
              <>
                {" "}·{" "}
                <span className="text-accent tabular-nums">{actionableCount}</span> à traiter
              </>
            )}
          </p>
        </div>
        <Link
          href="/seller/dashboard"
          className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
        >
          ← Tableau de bord
        </Link>
      </header>

      {orders.length > 0 && (
        <OrdersStats orders={orders} actionableCount={actionableCount} now={new Date()} />
      )}

      {anyFetchFailed && (
        <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Certaines boutiques n’ont pas pu être chargées. La liste ci-dessous
          peut être incomplète.
        </p>
      )}

      <div className="mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
        {orders.length === 0 ? (
          <p className="text-sm text-ink-mute">
            Aucune commande pour le moment. Dès qu’un acheteur commande l’un
            de vos produits, la commande apparaît ici.
          </p>
        ) : (
          <OrdersSearch totalCount={orders.length}>
          <OrdersStatusTabs counts={tabCounts} totalCount={orders.length}>
            <ul className="divide-y divide-line-soft">
              {buckets.flatMap((bucket) => [
                <li
                  key={`h-${bucket.label}`}
                  role="presentation"
                  data-actionable={bucket.anyActionable ? "true" : "false"}
                  data-search-heading={bucket.label}
                  data-status-set={Array.from(
                    new Set(bucket.orders.map((u) => u.order.status)),
                  ).join(" ")}
                  className="pt-4 pb-1 text-[10px] uppercase tracking-widest text-ink-mute first:pt-1"
                >
                  {bucket.label}
                  <span className="ml-2 normal-case tracking-normal text-ink-mute">
                    ({bucket.orders.length})
                  </span>
                </li>,
                ...bucket.orders.map((u) => (
                  <li
                    key={u.order.orderId}
                    data-actionable={ACTIONABLE_STATUSES.has(u.order.status) ? "true" : "false"}
                    data-status={u.order.status}
                    data-bucket={bucket.label}
                    data-search={[
                      u.order.publicNumber,
                      u.order.customer?.name ?? "",
                      u.shopName,
                    ]
                      .join(" ")
                      .toLowerCase()}
                    className="py-3 flex items-start justify-between gap-4"
                  >
                    <OrderRow
                      order={u.order}
                      sellerId={u.sellerId}
                      shopName={showShopName ? u.shopName : undefined}
                    />
                  </li>
                )),
              ])}
            </ul>
          </OrdersStatusTabs>
          </OrdersSearch>
        )}
      </div>
    </section>
  );
}
