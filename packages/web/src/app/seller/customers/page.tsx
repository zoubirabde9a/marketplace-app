// Aggregated customers view — every unique buyer the seller has shipped
// to, deduped by phone, with their lifetime order count, total spend
// (dominant currency), wilaya, and last-order time. Built entirely off
// the orders the dashboard / unified view already fetches; no new
// endpoint needed. Sellers managing relationships ("who's my best
// customer, when did Yacine last order?") get the answer here without
// having to scroll through order history.

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
import { CopyIconButton } from "@/components/CopyButton";
import { formatPrice, formatRelativeTime } from "@/lib/format";
import { AutoRefresh } from "../orders/AutoRefresh";
import { LastRefreshed } from "../orders/LastRefreshed";
import { OfflineIndicator } from "../orders/OfflineIndicator";
import { CustomersSearch } from "./CustomersSearch";
import { CustomersSortToggle, type CustomersSort } from "./CustomersSortToggle";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Clients",
  robots: { index: false, follow: false },
};

interface CustomerAggregate {
  phone: string;
  /** Customer name from the most recent order — buyers occasionally
   *  update their delivery name across orders; the latest one is the
   *  closest to truth. */
  name: string;
  region: string;
  orderCount: number;
  revenueByCcy: Record<string, bigint>;
  lastOrderAt: string;
  firstOrderAt: string;
}

interface SellerCustomersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SellerCustomersPage({
  searchParams,
}: SellerCustomersPageProps): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const sortParam = typeof sp.sort === "string" ? sp.sort : "recent";
  const sortBy: CustomersSort =
    sortParam === "spend" || sortParam === "orders" ? sortParam : "recent";

  const session = await getCurrentUser();
  if (!session) redirect("/seller");
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const sellers: SellerRecord[] = sellersResp.data;
  if (sellers.length === 0) redirect("/seller/dashboard");

  const results = await Promise.allSettled(
    sellers.map((s) => listSellerOrders(s.sellerId, session.jwt)),
  );
  // Aggregate by phone — same dedup key the repeat-customer chips use
  // elsewhere, so this view's count of customers reconciles with the
  // chip on each row.
  const byPhone = new Map<string, CustomerAggregate>();
  let anyFetchFailed = false;
  results.forEach((r) => {
    if (r.status !== "fulfilled") {
      anyFetchFailed = true;
      return;
    }
    for (const o of r.value.data as SellerOrder[]) {
      if (!o.customer) continue;
      const phone = o.customer.phone;
      const existing = byPhone.get(phone);
      if (existing) {
        existing.orderCount++;
        if (o.createdAt > existing.lastOrderAt) {
          existing.lastOrderAt = o.createdAt;
          existing.name = o.customer.name;
          existing.region = o.customer.region;
        }
        if (o.createdAt < existing.firstOrderAt) {
          existing.firstOrderAt = o.createdAt;
        }
        try {
          existing.revenueByCcy[o.currency] =
            (existing.revenueByCcy[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
        } catch {
          /* skip unparseable subtotal */
        }
      } else {
        const agg: CustomerAggregate = {
          phone,
          name: o.customer.name,
          region: o.customer.region,
          orderCount: 1,
          revenueByCcy: {},
          lastOrderAt: o.createdAt,
          firstOrderAt: o.createdAt,
        };
        try {
          agg.revenueByCcy[o.currency] = BigInt(o.subtotalMinor);
        } catch {
          /* skip */
        }
        byPhone.set(phone, agg);
      }
    }
  });
  // Aggregate metrics surfaced as a small strip above the list:
  // total unique customers, total lifetime revenue (dominant
  // currency), average orders per customer. Computed off the same
  // aggregation we built for rows so the numbers reconcile exactly.
  let totalOrders = 0;
  const totalRevenueByCcy: Record<string, bigint> = {};
  for (const c of byPhone.values()) {
    totalOrders += c.orderCount;
    for (const [ccy, amount] of Object.entries(c.revenueByCcy)) {
      totalRevenueByCcy[ccy] = (totalRevenueByCcy[ccy] ?? 0n) + amount;
    }
  }
  const totalTopCcy = Object.entries(totalRevenueByCcy).sort(
    (a, b) => Number(b[1] - a[1]),
  )[0];
  const totalRevenueLabel = totalTopCcy
    ? formatPrice(totalTopCcy[1].toString(), totalTopCcy[0], "fr-DZ")
    : null;
  // Round to one decimal so 2.45 → 2,5 reads cleanly. Locale-aware
  // separator via toLocaleString.
  const avgOrdersPerCustomer =
    byPhone.size > 0
      ? (totalOrders / byPhone.size).toLocaleString("fr-DZ", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      : null;

  const customers = Array.from(byPhone.values()).sort((a, b) => {
    if (sortBy === "orders") {
      // Most loyal first; tie-break by recent-activity so frequent
      // buyers don't get re-ordered randomly when their counts tie.
      const cmp = b.orderCount - a.orderCount;
      if (cmp !== 0) return cmp;
      return b.lastOrderAt.localeCompare(a.lastOrderAt);
    }
    if (sortBy === "spend") {
      // Biggest spenders first. Compare via the dominant-currency
      // amount per side — for the dashboard's single-currency
      // marketplace (DZD) this is just the only currency; mixed-
      // currency sellers compare apples-to-apples within whichever
      // currency dominates each customer.
      const aTop = Object.entries(a.revenueByCcy).sort(
        (x, y) => Number(y[1] - x[1]),
      )[0]?.[1] ?? 0n;
      const bTop = Object.entries(b.revenueByCcy).sort(
        (x, y) => Number(y[1] - x[1]),
      )[0]?.[1] ?? 0n;
      if (bTop !== aTop) return bTop > aTop ? 1 : -1;
      return b.lastOrderAt.localeCompare(a.lastOrderAt);
    }
    // Default: newest-last-order first — "who just bought from me?".
    return b.lastOrderAt.localeCompare(a.lastOrderAt);
  });

  return (
    <section
      aria-labelledby="customers-heading"
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-5xl mx-auto"
      lang="fr"
    >
      <AutoRefresh />
      <OfflineIndicator />
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 id="customers-heading" className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Clients
          </h1>
          <p className="mt-2 text-xs text-ink-mute">
            <span className="text-ink-soft tabular-nums">{customers.length}</span>{" "}
            client{customers.length === 1 ? "" : "s"} unique
            {customers.length === 1 ? "" : "s"}
          </p>
          {customers.length > 0 && (
            <div className="mt-2">
              <LastRefreshed renderedAt={new Date().toISOString()} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {customers.length > 0 && (
            <a
              href="/seller/customers/export"
              download
              className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center gap-2 rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
              title="Exporter la liste des clients en CSV"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v14m0 0l-5-5m5 5l5-5M5 21h14" />
              </svg>
              Exporter
            </a>
          )}
          <Link
            href="/seller/dashboard"
            className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
          >
            ← Tableau de bord
          </Link>
        </div>
      </header>

      {customers.length > 0 && (
        // Aggregate strip — surfaces the "how big is my customer
        // base?" answer without making the seller do the math down
        // the list. Hidden when the seller has zero customers.
        <dl
          aria-label="Indicateurs clients"
          className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3"
        >
          <div className="rounded-2xl border border-line-soft bg-bg-soft/60 px-4 py-3">
            <dt className="text-[10px] uppercase tracking-widest text-ink-mute">
              Clients
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {customers.length}
            </dd>
          </div>
          {totalRevenueLabel && (
            <div className="rounded-2xl border border-line-soft bg-bg-soft/60 px-4 py-3">
              <dt className="text-[10px] uppercase tracking-widest text-ink-mute">
                Revenu total
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                {totalRevenueLabel}
              </dd>
            </div>
          )}
          {avgOrdersPerCustomer && (
            <div className="rounded-2xl border border-line-soft bg-bg-soft/60 px-4 py-3">
              <dt className="text-[10px] uppercase tracking-widest text-ink-mute">
                Commandes par client
              </dt>
              <dd
                title="Moyenne des commandes par client (lifetime)"
                className="mt-1 text-2xl font-semibold tabular-nums text-ink"
              >
                {avgOrdersPerCustomer}
              </dd>
            </div>
          )}
        </dl>
      )}

      {anyFetchFailed && (
        <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Certaines boutiques n’ont pas pu être chargées. La liste ci-dessous
          peut être incomplète.
        </p>
      )}

      <div className="mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
        {customers.length === 0 ? (
          <p className="text-sm text-ink-mute">
            Aucun client pour le moment. Une fois qu’un acheteur passe commande,
            il apparaît dans cette liste.
          </p>
        ) : (
          <CustomersSearch totalCount={customers.length}>
          <CustomersSortToggle />
          <ul className="divide-y divide-line-soft">
            {customers.map((c) => {
              const topCcy = Object.entries(c.revenueByCcy).sort(
                (a, b) => Number(b[1] - a[1]),
              )[0];
              const revenue = topCcy
                ? formatPrice(topCcy[1].toString(), topCcy[0], "fr-DZ")
                : null;
              return (
                <li
                  key={c.phone}
                  data-search={`${c.name} ${c.phone} ${c.region ?? ""}`.toLowerCase()}
                  className="py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      {/* Name links to the customer's full order
                          history with the seller — same pattern as
                          the order row's name link (2745960). */}
                      <Link
                        href={`/seller/orders?q=${encodeURIComponent(c.phone)}`}
                        dir="auto"
                        className="text-base font-medium text-ink untrusted hover:text-accent active:text-accent transition"
                      >
                        {c.name}
                      </Link>
                      {c.orderCount >= 2 && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent"
                          aria-label={`${c.orderCount} commandes`}
                        >
                          <span aria-hidden>★</span>
                          {c.orderCount} commande{c.orderCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                      <a
                        href={`tel:${c.phone}`}
                        dir="ltr"
                        className="inline-flex items-center gap-1 font-mono hover:text-accent active:text-accent transition"
                        aria-label={`Appeler ${c.name}`}
                      >
                        {c.phone}
                      </a>
                      <CopyIconButton
                        value={c.phone}
                        ariaLabel="Copier le numéro de téléphone"
                      />
                      <a
                        // Generic friendly opener, no order context
                        // here (the customers page is for cross-
                        // order outreach: loyalty, new arrival
                        // pings, follow-ups). Matches the order
                        // surfaces' pre-fill pattern so the seller
                        // doesn't have to type a salutation from
                        // scratch.
                        href={`https://wa.me/${c.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
                          `Bonjour ${c.name}, je vous contacte depuis Teno Store. `,
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 hover:bg-emerald-500/20 active:bg-emerald-500/25 transition"
                        aria-label={`Discuter avec ${c.name} sur WhatsApp`}
                      >
                        WhatsApp
                      </a>
                      {c.region && (
                        <span
                          className="inline-flex items-center gap-1"
                          aria-label={`Wilaya : ${c.region}`}
                        >
                          <span aria-hidden>📍</span>
                          <span dir="auto">{c.region}</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-mute tabular-nums">
                      Dernière commande{" "}
                      <span
                        className="text-ink-soft"
                        title={new Date(c.lastOrderAt).toLocaleString("fr-DZ")}
                      >
                        {formatRelativeTime(c.lastOrderAt) ??
                          new Date(c.lastOrderAt).toLocaleString("fr-DZ")}
                      </span>
                    </p>
                  </div>
                  {revenue && (
                    <dl className="text-right shrink-0">
                      <dt className="text-[10px] uppercase tracking-widest text-ink-mute">
                        Total dépensé
                      </dt>
                      <dd className="text-sm font-medium tabular-nums text-ink">
                        {revenue}
                      </dd>
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
          </CustomersSearch>
        )}
      </div>
    </section>
  );
}
