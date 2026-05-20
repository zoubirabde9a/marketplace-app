import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import {
  listMySellers,
  listProductsBySeller,
  listSellerOrders,
  type SellerOrder,
  type SellerRecord,
} from "@/lib/api";
import { cleanProductTitle, formatPrice } from "@/lib/format";
import { CreateSellerForm } from "./CreateSellerForm";
import { LogoutButton } from "./LogoutButton";
import { OrdersListFilter } from "./OrdersListFilter";
import { ProductsListFilter } from "./ProductsListFilter";
import { ProductsStockFilter, type StockTab } from "./ProductsStockFilter";
import { OrderRow } from "./OrderRow";
import { ProductRow } from "./ProductRow";
import { GetStartedChecklist } from "./GetStartedChecklist";
import { ClearLocalNotesButton } from "./ClearLocalNotesButton";
import { AutoRefresh } from "../orders/AutoRefresh";
import { LastRefreshed } from "../orders/LastRefreshed";
import { OfflineIndicator } from "../orders/OfflineIndicator";
import { CopyIconButton } from "@/components/CopyButton";
import { SITE_URL } from "@/lib/sitemap";

// Status set that the seller still owes the buyer some action on. Mirrors
// the actionableCount calculation below so the filter chip's count and the
// per-row `data-actionable` attribute can't drift apart.
const ACTIONABLE_STATUSES: ReadonlySet<string> = new Set(["paid", "fulfilling", "disputed"]);

// How recently an order must have been created to render the "Nouveau"
// chip. 10 minutes balances "long enough that auto-refresh ticks
// usually catch the order while it's still flagged" with "short enough
// that the chip doesn't linger across a seller's coffee break and stop
// meaning fresh".
const NEW_ORDER_WINDOW_MS = 10 * 60_000;

// Mirror of STALE_AFTER_MS used by the dashboard's banner so the
// banner count and the chip count can't drift. Stale = paid /
// fulfilling AND > 48h old.
const STALE_AFTER_MS_ROW = 48 * 60 * 60_000;
const STALE_ROW_STATUSES: ReadonlySet<string> = new Set(["paid", "fulfilling"]);

// Group orders by calendar bucket relative to `now`. Returns the buckets in
// chronological display order (newest first), with empty buckets dropped so
// the dashboard never renders a "Hier" heading above zero rows. `anyActionable`
// is precomputed per bucket so the rendered heading can carry a data-actionable
// attribute and be hidden together with its rows when the "À traiter" filter
// is on — that way headings don't strand above empty groups after filtering.
function bucketOrdersByDate(
  orders: ReadonlyArray<SellerOrder>,
  now: Date,
): Array<{ label: string; orders: SellerOrder[]; anyActionable: boolean }> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY_MS = 86_400_000;
  const startOfYesterday = startOfToday - DAY_MS;
  // "Cette semaine" = rolling 7-day window ending today; inclusive of today
  // and yesterday, so the actual lower bound is 6 days before today.
  const startOfWeek = startOfToday - 6 * DAY_MS;
  const groups: Record<"today" | "yesterday" | "week" | "older", SellerOrder[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };
  for (const o of orders) {
    const t = new Date(o.createdAt).getTime();
    if (Number.isNaN(t)) {
      groups.older.push(o);
      continue;
    }
    if (t >= startOfToday) groups.today.push(o);
    else if (t >= startOfYesterday) groups.yesterday.push(o);
    else if (t >= startOfWeek) groups.week.push(o);
    else groups.older.push(o);
  }
  const LABELS: Record<keyof typeof groups, string> = {
    today: "Aujourd’hui",
    yesterday: "Hier",
    week: "Cette semaine",
    older: "Plus anciennes",
  };
  const out: Array<{ label: string; orders: SellerOrder[]; anyActionable: boolean }> = [];
  for (const key of ["today", "yesterday", "week", "older"] as const) {
    const list = groups[key];
    if (list.length === 0) continue;
    out.push({
      label: LABELS[key],
      orders: list,
      anyActionable: list.some((o) => ACTIONABLE_STATUSES.has(o.status)),
    });
  }
  return out;
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // French chrome to match the buyer money path (cart/checkout/order),
  // the buyer-facing /seller/products/new and og:locale=fr_DZ.
  title: "Tableau de bord vendeur",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/seller");

  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const sellers = sellersResp.data;

  // Fan out the orders fetch at the page level so we can (a) aggregate
  // an actionable count across every shop for the header badge and (b)
  // hand each SellerSection its preloaded result instead of refetching.
  // Same shape for products — adds an out-of-stock badge on the
  // "Tous les produits" header link without each SellerSection
  // double-fetching its own list. Both fan-outs run in parallel
  // (Promise.all over the two Promise.allSettled calls) so wall-clock
  // stays the slowest fetch, not the sum.
  const [ordersResults, productsResults] = await Promise.all([
    Promise.allSettled(sellers.map((s) => listSellerOrders(s.sellerId, session.jwt))),
    Promise.allSettled(sellers.map((s) => listProductsBySeller(s.sellerId, session.jwt))),
  ]);
  const ordersBySellerId = new Map<
    string,
    { orders: SellerOrder[]; error: string | null }
  >();
  // Aggregate out-of-stock count for the "Tous les produits"
  // header badge. The per-shop map isn't built yet — SellerSection
  // still fetches its own products list for now (lifting that too
  // is a larger refactor); we just compute the count here.
  let aggregateOutOfStockCount = 0;
  productsResults.forEach((r) => {
    if (r.status === "fulfilled") {
      aggregateOutOfStockCount += r.value.data.filter((h) => !h.inStock).length;
    }
  });

  // Total unique customers across every shop. Same dedup-by-phone
  // logic as /seller/customers — the badge count below reconciles
  // with what the seller will see on that page.
  const aggregateCustomerPhones = new Set<string>();
  ordersResults.forEach((r) => {
    if (r.status !== "fulfilled") return;
    for (const o of r.value.data) {
      if (o.customer) aggregateCustomerPhones.add(o.customer.phone);
    }
  });
  const aggregateCustomerCount = aggregateCustomerPhones.size;

  let aggregateActionableCount = 0;
  ordersResults.forEach((r, i) => {
    const s = sellers[i]!;
    if (r.status === "fulfilled") {
      const list = r.value.data;
      ordersBySellerId.set(s.sellerId, { orders: list, error: null });
      aggregateActionableCount += list.filter((o) =>
        ACTIONABLE_STATUSES.has(o.status),
      ).length;
    } else {
      ordersBySellerId.set(s.sellerId, {
        orders: [],
        error: (r.reason as Error).message,
      });
    }
  });

  // "Aujourd'hui" aggregate strip — count + revenue for orders
  // created today, across every shop. Computed off the same orders
  // we already fanned out above. Renders between header and the
  // sellers list; gives the seller the "how's today going so far?"
  // signal without bouncing to /seller/orders for the full stats
  // banner. Hidden when there are no orders at all to report on
  // (new sellers shouldn't see a zero strip).
  const now = new Date();
  const startOfTodayMs = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const TODAY_REVENUE_STATUSES: ReadonlySet<string> = new Set([
    "paid",
    "fulfilling",
    "shipped",
    "delivered",
  ]);
  let todayOrderCount = 0;
  const todayRevenueByCcy: Record<string, bigint> = {};
  ordersResults.forEach((r) => {
    if (r.status !== "fulfilled") return;
    for (const o of r.value.data) {
      const t = new Date(o.createdAt).getTime();
      if (Number.isNaN(t) || t < startOfTodayMs) continue;
      todayOrderCount++;
      if (TODAY_REVENUE_STATUSES.has(o.status)) {
        try {
          todayRevenueByCcy[o.currency] =
            (todayRevenueByCcy[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
        } catch {
          // skip unparseable subtotal
        }
      }
    }
  });
  const todayTopCcy = Object.entries(todayRevenueByCcy).sort(
    (a, b) => Number(b[1] - a[1]),
  )[0];
  const todayRevenueLabel = todayTopCcy
    ? formatPrice(todayTopCcy[1].toString(), todayTopCcy[0], "fr-DZ")
    : null;

  // Stale-actionable detection: orders that landed in paid /
  // fulfilling > 48h ago and the seller hasn't moved them along. A
  // backlog of 5 newly-paid orders is normal; a paid order sitting
  // there for two days means a buyer is waiting and the seller is
  // probably losing them. Surface a warn banner so the seller can't
  // miss it in the daily scroll. 48h is conservative — typical
  // marketplace SLA is 24h-acknowledge, this gives one full
  // business day of slack before flagging.
  const STALE_AFTER_MS = 48 * 60 * 60_000;
  const STALE_STATUSES: ReadonlySet<string> = new Set(["paid", "fulfilling"]);
  let staleActionableCount = 0;
  // Track the OLDEST stale order's age (in ms) so the banner can
  // surface "the worst one is X days old" — different sense of
  // urgency than just "N orders are stale".
  let oldestStaleMs = 0;
  ordersResults.forEach((r) => {
    if (r.status !== "fulfilled") return;
    for (const o of r.value.data) {
      if (!STALE_STATUSES.has(o.status)) continue;
      const t = new Date(o.createdAt).getTime();
      if (Number.isNaN(t)) continue;
      const ageMs = Date.now() - t;
      if (ageMs > STALE_AFTER_MS) {
        staleActionableCount++;
        if (ageMs > oldestStaleMs) oldestStaleMs = ageMs;
      }
    }
  });

  return (
    <section aria-labelledby="dashboard-heading" className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-5xl mx-auto" lang="fr">
      {/* Same 60s polling pattern as /seller/orders: aggregate
          actionable badge, per-shop counts, stock chips, and inline
          editors' baseline values all stay fresh without manual F5.
          Pauses when tab is hidden or any input has focus (the
          price/stock editors live inline on rows). */}
      <AutoRefresh />
      <OfflineIndicator />
      {/* flex-wrap so the heading + identity block and the action
          buttons stack on narrow viewports instead of overflowing.
          The buttons cluster also wraps internally (own flex-wrap)
          so individual pills can flow to a second/third row when
          they all don't fit. */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 id="dashboard-heading" className="text-2xl sm:text-3xl font-semibold tracking-tight break-words">Tableau de bord vendeur</h1>
          {/* Signed-in identity — quick "yes, this is my account" check
              for sellers on shared computers or multiple Google accounts.
              Subtle (text-xs, ink-mute) so it doesn't compete with the
              heading. */}
          {/* break-words wraps at word boundaries (good for the display
              name); the inner email span keeps break-all for emails that
              are one unbroken long string. Shop count surfaces upfront
              for multi-shop sellers who scroll a long dashboard. */}
          <p className="mt-2 text-xs text-ink-mute break-words">
            {sellers.length > 1 && (
              <>
                <span className="text-ink-soft tabular-nums">{sellers.length}</span> boutiques ·{" "}
              </>
            )}
            Connecté en tant que{" "}
            {session.user.displayName ? (
              <>
                <span dir="auto" className="text-ink-soft">{session.user.displayName}</span>{" "}
                <span dir="ltr" className="text-ink-mute break-all">({session.user.email})</span>
              </>
            ) : (
              <span dir="ltr" className="text-ink-soft break-all">{session.user.email}</span>
            )}
          </p>
          {sellers.length > 0 && (
            <div className="mt-2">
              <LastRefreshed renderedAt={new Date().toISOString()} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          {/* Cross-shop unified orders view. Hidden for sellers with
              no shops yet — the link target redirects back here in
              that case but showing it would be a dead-end loop. */}
          {sellers.length > 0 && (
            // Unified product view — symmetric with "Toutes les
            // commandes". Lands on /seller/products which collapses
            // every shop's inventory into one searchable list.
            <Link
              href="/seller/products"
              className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center gap-2 rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
            >
              Tous les produits
              {aggregateOutOfStockCount > 0 && (
                // Out-of-stock pill — warn-tinted to differentiate
                // from the accent-tinted actionable orders badge.
                // Catches "something I should fix in inventory"
                // without expanding any shop.
                <span
                  className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-warn/15 border border-warn/40 text-warn text-[11px] font-semibold tabular-nums"
                  aria-label={`${aggregateOutOfStockCount} produit${aggregateOutOfStockCount === 1 ? "" : "s"} en rupture`}
                  title="Produits en rupture de stock"
                >
                  {aggregateOutOfStockCount}
                </span>
              )}
            </Link>
          )}
          {sellers.length > 0 && (
            <Link
              href="/seller/customers"
              className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center gap-2 rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
            >
              Clients
              {aggregateCustomerCount > 0 && (
                // Neutral-tinted count — relationship metric, not
                // an action prompt; bg-bg-elev keeps the visual
                // weight lower than the accent/warn pills on the
                // siblings.
                <span
                  className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-bg-elev border border-line text-ink-soft text-[11px] font-semibold tabular-nums"
                  aria-label={`${aggregateCustomerCount} client${aggregateCustomerCount === 1 ? "" : "s"} unique${aggregateCustomerCount === 1 ? "" : "s"}`}
                  title="Nombre de clients uniques"
                >
                  {aggregateCustomerCount}
                </span>
              )}
            </Link>
          )}
          {sellers.length > 0 && (
            // <a> not <Link> — the export route returns text/csv with
            // a Content-Disposition: attachment header; Next's Link
            // would prefetch and never trigger the browser's download
            // dialog. Same shape as the orders CSV link.
            <a
              href="/seller/products/export"
              download
              className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center gap-2 rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
              title="Exporter tous les produits en CSV"
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
          {sellers.length > 0 && (
            <Link
              href="/seller/orders"
              className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center gap-2 rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
            >
              Toutes les commandes
              {/* Aggregate à-traiter badge across every shop, mirrored
                  from the per-shop chips inside each SellerSection so
                  the seller catches "there's work waiting" without
                  expanding cards. Hidden when there's nothing to act
                  on — an empty pill is just noise. */}
              {aggregateActionableCount > 0 && (
                <span
                  className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-accent text-bg text-[11px] font-semibold tabular-nums"
                  aria-label={`${aggregateActionableCount} commande${aggregateActionableCount === 1 ? "" : "s"} à traiter`}
                >
                  {aggregateActionableCount}
                </span>
              )}
            </Link>
          )}
          <LogoutButton />
        </div>
      </header>

      {/* Stale-actionable warning — paid/fulfilling orders sitting
          unactioned for more than 48 hours. Surfaces above today's
          summary because a stuck order is more urgent than a fresh
          one. Links into /seller/orders pre-filtered to À traiter
          so one tap brings the seller to the offending rows. */}
      {staleActionableCount > 0 && (
        // Land with ?sort=oldest so the seller's first scroll is the
        // worst offenders, not the freshest. Combined with the À
        // traiter tab default, the stale rows surface at the top of
        // the list immediately — natural FIFO triage for the
        // backlog cleanup workflow.
        <Link
          href="/seller/orders?sort=oldest"
          className="mt-6 flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn hover:bg-warn/15 active:bg-warn/20 transition"
        >
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
            {(() => {
              // Headline phrasing: when there's exactly one stale
              // order, show its precise age ("depuis 3 jours").
              // When there's a backlog, surface the oldest one's
              // age ("dont la plus ancienne depuis X jours") so
              // the seller can gauge severity beyond just count.
              const hours = Math.floor(oldestStaleMs / (60 * 60_000));
              const days = Math.floor(hours / 24);
              const ageLabel = days >= 2 ? `${days} jours` : `${hours} heures`;
              if (staleActionableCount === 1) {
                return (
                  <p className="text-sm font-medium">
                    1 commande en attente depuis {ageLabel}
                  </p>
                );
              }
              return (
                <p className="text-sm font-medium">
                  {staleActionableCount} commandes en attente, dont la plus
                  ancienne depuis {ageLabel}
                </p>
              );
            })()}
            <p className="mt-0.5 text-xs text-warn/80">
              Marquez-{staleActionableCount === 1 ? "la" : "les"} en préparation
              ou expédiée{staleActionableCount === 1 ? "" : "s"} — les acheteurs
              attendent. <span className="underline">Voir les commandes</span>
            </p>
          </div>
        </Link>
      )}

      {/* "Aujourd'hui" aggregate strip. Renders only when the seller
          has at least one shop AND there's at least one order today
          across all shops — quiet days hide the strip entirely
          rather than showing a depressing "0 commandes aujourd'hui"
          line. */}
      {sellers.length > 0 && todayOrderCount > 0 && (
        <p className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span className="text-[10px] uppercase tracking-widest text-ink-mute">
            Aujourd’hui
          </span>
          {/* Today's order count links to the unified orders page
              for full consistency with the à-traiter link below.
              Both metrics that imply "look at orders" are
              one-tap. */}
          <Link
            href="/seller/orders"
            className="text-ink hover:text-accent active:text-accent transition"
          >
            <span className="font-medium tabular-nums">{todayOrderCount}</span>{" "}
            commande{todayOrderCount === 1 ? "" : "s"}
          </Link>
          {todayRevenueLabel && (
            <span>
              ·{" "}
              <span className="text-ink font-medium tabular-nums">{todayRevenueLabel}</span>
            </span>
          )}
          {aggregateActionableCount > 0 && (
            <span>
              ·{" "}
              {/* The actionable count is the highest-value action
                  in the Aujourd'hui strip — make it a one-tap jump
                  to the unified orders list (where the seller's
                  "À traiter" tab will isolate exactly these). */}
              <Link
                href="/seller/orders"
                className="text-accent font-medium hover:underline active:underline transition"
              >
                <span className="tabular-nums">{aggregateActionableCount}</span>{" "}
                à traiter
              </Link>
            </span>
          )}
        </p>
      )}

      {sellers.length === 0 ? (
        <section aria-labelledby="create-seller-heading" className="mt-10 rounded-2xl border border-line-soft bg-bg-soft/60 p-8">
          <h2 id="create-seller-heading" className="text-xl font-medium">Créez votre boutique</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Vous n’avez pas encore de boutique. Indiquez un nom pour commencer — vous pourrez ajouter les coordonnées et les produits ensuite.
          </p>
          <div className="mt-6">
            <CreateSellerForm />
          </div>
        </section>
      ) : (
        <div className="mt-10 space-y-10">
          {sellers.map((s, i) => (
            <SellerSection
              key={s.sellerId}
              seller={s}
              sessionJwt={session.jwt}
              // Multi-shop sellers see every shop in a collapsible
              // disclosure: the first stays open, the rest fold to a
              // single summary row so the page is scannable at a
              // glance. Single-shop sellers (the common case) skip the
              // disclosure entirely and render as before.
              collapsible={sellers.length > 1}
              defaultOpen={i === 0}
              preloadedOrders={ordersBySellerId.get(s.sellerId)}
            />
          ))}
        </div>
      )}

      {/* Support escape-hatch — sellers stuck on something (image won't
          upload, can't find a feature, want to delete a product) have
          had no point of contact from inside the dashboard. One link,
          pre-filled subject, no chrome. `<footer>` so it lands as a
          proper landmark in the page outline. */}
      <footer className="mt-10 pt-6 border-t border-line-soft text-xs text-ink-mute text-center space-y-2">
        <p>
          Besoin d’aide ?{" "}
          <a
            href={`mailto:mahlledz@gmail.com?subject=${encodeURIComponent("Aide vendeur")}&body=${encodeURIComponent(
              "Bonjour,\n\nJ'ai besoin d'aide concernant :\n\n",
            )}`}
            className="text-accent hover:underline active:underline"
          >
            contactez-nous
          </a>
          .
        </p>
        {/* Local-notes cleanup. Only appears when the device has at
            least one saved note — hidden otherwise so the footer
            stays minimal for first-time and quiet sellers. */}
        <ClearLocalNotesButton />
      </footer>
    </section>
  );
}

async function SellerSection({
  seller,
  sessionJwt,
  collapsible = false,
  defaultOpen = true,
  preloadedOrders,
}: {
  seller: SellerRecord;
  sessionJwt: string;
  /** Wrap the article in a <details> disclosure. Set true when the
   * seller owns more than one shop so the dashboard stays scannable. */
  collapsible?: boolean;
  /** When `collapsible` is true, render the disclosure expanded
   * initially. The first shop in the list gets this; subsequent shops
   * default closed. */
  defaultOpen?: boolean;
  /** Pre-fetched orders for this shop. The page-level fan-out already
   * hit listSellerOrders to compute the aggregate actionable badge;
   * we pass the result down so SellerSection doesn't refetch. When
   * omitted the section falls back to its own fetch (kept for now so
   * SellerSection stays standalone-callable). */
  preloadedOrders?: { orders: SellerOrder[]; error: string | null };
}) {
  let products: {
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
  }[] = [];
  let productsError: string | null = null;
  let orders: SellerOrder[] = [];
  let ordersError: string | null = null;
  // Products is always per-section. Orders comes from the page-level
  // fan-out when available; the fallback fetch keeps SellerSection
  // self-contained when called outside the dashboard page.
  const productsRes = await Promise.allSettled([
    listProductsBySeller(seller.sellerId, sessionJwt),
  ]).then((r) => r[0]!);
  if (productsRes.status === "fulfilled") {
    products = productsRes.value.data.map((h) => ({
      productId: h.productId,
      title: h.title.value,
      brand: h.brand,
      variantCount: h.variantCount,
      inStock: h.inStock,
      priceMinor: h.priceMinor,
      priceFromMinor: h.priceFromMinor,
      priceToMinor: h.priceToMinor,
      currency: h.currency,
      heroImageUrl: h.heroImageUrl,
    }));
  } else {
    productsError = (productsRes.reason as Error).message;
  }
  if (preloadedOrders) {
    orders = preloadedOrders.orders;
    ordersError = preloadedOrders.error;
  } else {
    try {
      orders = (await listSellerOrders(seller.sellerId, sessionJwt)).data;
    } catch (e) {
      ordersError = (e as Error).message;
    }
  }

  // Glance metrics row: total orders, total revenue across orders, product
  // count. Revenue is summed across whichever currency is most common in the
  // order list — virtually always DZD for this marketplace; mixed-currency
  // sellers just see the dominant currency total.
  // "À traiter" = orders the seller still owes the buyer some action on.
  // - paid: payment captured, seller must prepare/ship
  // - fulfilling: seller marked as in-prep, still owes shipment
  // - disputed: seller must respond
  // Excludes shipped/delivered/cancelled/refunded (closed) and
  // created/authorized (pre-payment, no seller action yet).
  const actionableCount = orders.filter((o) => ACTIONABLE_STATUSES.has(o.status)).length;
  // Stale-actionable count scoped to this shop — same threshold as
  // the dashboard banner (b552ef5), used to add a small "X lent"
  // chip on the multi-shop collapsed disclosure summary so a
  // seller with several shops can see at a glance which shop is
  // carrying the laggers without expanding each card.
  const shopStaleCount = orders.filter(
    (o) =>
      STALE_ROW_STATUSES.has(o.status) &&
      Date.now() - new Date(o.createdAt).getTime() > STALE_AFTER_MS_ROW,
  ).length;
  // Repeat-customer detection within this shop's order history.
  // Same logic as the unified /seller/orders page but scoped to one
  // seller — a buyer who orders twice from this same shop earns the
  // "client habitué" chip on every row of theirs.
  const customerOrderCounts = new Map<string, number>();
  for (const o of orders) {
    const phone = o.customer?.phone;
    if (!phone) continue;
    customerOrderCounts.set(phone, (customerOrderCounts.get(phone) ?? 0) + 1);
  }

  const revenueByCcy = orders.reduce<Record<string, bigint>>((acc, o) => {
    try {
      acc[o.currency] = (acc[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
    } catch {
      // Skip lines we can't parse rather than failing the whole render.
    }
    return acc;
  }, {});
  const topCcy = Object.entries(revenueByCcy).sort((a, b) => Number(b[1] - a[1]))[0];

  // Top-selling products by units across all the shop's orders.
  // Aggregates line-item quantities by productId — quantity-weighted
  // not just order-count, so a single-order × 5 ranks above five
  // orders × 1. Keyed on productId so the same product with
  // different per-order titles (typos, renames) collapses. Skipped
  // entirely when no orders carry productId yet (early-shop state).
  const productSalesByProductId = new Map<
    string,
    { title: string; qty: number }
  >();
  for (const o of orders) {
    for (const l of o.lines) {
      if (!l.productId || !l.title) continue;
      const existing = productSalesByProductId.get(l.productId);
      if (existing) {
        existing.qty += l.qty;
      } else {
        productSalesByProductId.set(l.productId, { title: l.title, qty: l.qty });
      }
    }
  }
  const topSellingProducts = Array.from(productSalesByProductId.entries())
    .map(([productId, v]) => ({ productId, title: v.title, qty: v.qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 3);

  // Each shop is a self-contained unit — `<article>` is the right
  // semantic element. aria-labelledby points at the H2 so screen readers
  // announce "Article: <shop name>" when entering the card.
  const headingId = `shop-heading-${seller.sellerId}`;
  const article = (
    <article aria-labelledby={headingId} className="rounded-2xl border border-line-soft bg-bg-soft/60">
      <header className="p-4 sm:p-6 border-b border-line-soft flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0 sm:flex-1">
          <h2 id={headingId} dir="auto" className="text-xl font-medium tracking-tight break-words">{seller.displayName}</h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
            <span>
              <span className="text-ink font-medium">{products.length}</span> produit{products.length === 1 ? "" : "s"}
            </span>
            <span>
              <span className="text-ink font-medium">{orders.length}</span> commande{orders.length === 1 ? "" : "s"}
            </span>
            {actionableCount > 0 && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent"
                aria-label={`${actionableCount} commande${actionableCount === 1 ? "" : "s"} à traiter`}
              >
                <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="font-medium tabular-nums">{actionableCount}</span> à traiter
              </span>
            )}
            {topCcy && (
              <span>
                Total :{" "}
                <span className="text-ink font-medium tabular-nums">
                  {formatPrice(topCcy[1].toString(), topCcy[0], "fr-DZ")}
                </span>
              </span>
            )}
          </div>
          {/* Top-selling products line — shows what's actually
              moving so the seller can lean into restocking the
              winners. Quantity-weighted; renders as a separator-
              joined list under the metric chips when there's at
              least one tracked sale. */}
          {topSellingProducts.length > 0 && (
            <p className="mt-1.5 text-xs text-ink-mute">
              <span className="text-[10px] uppercase tracking-widest mr-1">
                Top
              </span>
              {topSellingProducts.map((p, i) => (
                <span key={p.productId}>
                  {i > 0 && <span className="mx-1.5 text-ink-mute">·</span>}
                  <Link
                    href={`/seller/products/${encodeURIComponent(p.productId)}/edit`}
                    dir="auto"
                    className="text-ink-soft hover:text-accent active:text-accent transition"
                  >
                    {cleanProductTitle(p.title)}
                  </Link>
                  <span className="ml-1 text-ink-mute tabular-nums">×{p.qty}</span>
                </span>
              ))}
            </p>
          )}
          <ContactSummary seller={seller} />
        </div>
        {/* Primary action ("Nouveau produit") leads — most prominent in
            both reading and tab order. Secondary actions follow. */}
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
          <Link
            href={`/seller/products/new?sellerId=${encodeURIComponent(seller.sellerId)}`}
            className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition"
          >
            Nouveau produit
          </Link>
          {/* Opens in a new tab so the seller can flip back to the
              dashboard without losing context — they typically check the
              storefront, then return to make changes. */}
          <Link
            href={`/store/${encodeURIComponent(seller.sellerId)}`}
            target="_blank"
            rel="noopener"
            className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
          >
            Voir la boutique <span aria-hidden>↗</span>
          </Link>
          <Link
            href={`/seller/contact?sellerId=${encodeURIComponent(seller.sellerId)}`}
            className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
          >
            Modifier les coordonnées
          </Link>
        </div>
      </header>
      <section aria-labelledby={`${headingId}-orders`} className="p-4 sm:p-6 border-b border-line-soft">
        <h3 id={`${headingId}-orders`} className="text-sm font-medium text-ink-soft mb-3">
          {orders.length === 1 ? "Commande" : "Commandes"} ({orders.length})
        </h3>
        {ordersError ? (
          <p className="text-sm text-bad">Impossible de charger les commandes.</p>
        ) : orders.length === 0 ? (
          products.length === 0 ? (
            // Empty shop — orders impossible until a product exists.
            // The GetStartedChecklist below already drives that next
            // step; here we just say "nothing's possible yet".
            <p className="text-sm text-ink-mute">
              Aucune commande possible tant que la boutique est vide —
              ajoutez un premier produit ci-dessous pour ouvrir aux acheteurs.
            </p>
          ) : (
            // Shop is stocked but no orders yet. Same share-the-store
            // nudge the unified /seller/orders empty state shows
            // (iteration 41), scoped to this shop. The seller's next
            // useful action when waiting on first orders is to
            // promote the shop link, not wait silently.
            <div className="space-y-3">
              <p className="text-sm text-ink-soft">
                Aucune commande pour le moment. Partagez le lien de cette
                boutique avec vos contacts pour ramener vos premiers
                acheteurs.
              </p>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line-soft bg-bg/40 px-3 py-2">
                <a
                  href={`${SITE_URL}/store/${seller.sellerId}`}
                  target="_blank"
                  rel="noopener"
                  dir="ltr"
                  className="font-mono text-xs text-ink-soft hover:text-accent active:text-accent transition truncate min-w-0 flex-1"
                >
                  {`${SITE_URL}/store/${seller.sellerId}`}
                </a>
                <CopyIconButton
                  value={`${SITE_URL}/store/${seller.sellerId}`}
                  ariaLabel="Copier le lien de la boutique"
                />
              </div>
            </div>
          )
        ) : (
          <OrdersListFilter actionableCount={actionableCount} totalCount={orders.length}>
          <ul className="divide-y divide-line-soft">
            {bucketOrdersByDate(orders, new Date()).flatMap((bucket) => [
              // role="presentation" tells screen readers to skip the
              // visual bucket label — each order row already contains
              // its own relative time ("il y a 2 heures") so the
              // heading is purely a sighted-user grouping cue.
              <li
                key={`h-${bucket.label}`}
                role="presentation"
                data-actionable={bucket.anyActionable ? "true" : "false"}
                className="pt-4 pb-1 text-[10px] uppercase tracking-widest text-ink-mute first:pt-1"
              >
                {bucket.label}
                <span className="ml-2 normal-case tracking-normal text-ink-mute">
                  ({bucket.orders.length})
                </span>
              </li>,
              ...bucket.orders.map((o) => (
              <li
                key={o.orderId}
                data-actionable={ACTIONABLE_STATUSES.has(o.status) ? "true" : "false"}
                className="py-3 flex items-start justify-between gap-4"
              >
                <OrderRow
                  order={o}
                  sellerId={seller.sellerId}
                  customerOrderCount={
                    o.customer ? customerOrderCounts.get(o.customer.phone) : undefined
                  }
                  isNew={Date.now() - new Date(o.createdAt).getTime() < NEW_ORDER_WINDOW_MS}
                  isStale={
                    STALE_ROW_STATUSES.has(o.status) &&
                    Date.now() - new Date(o.createdAt).getTime() > STALE_AFTER_MS_ROW
                  }
                />
              </li>
              )),
            ])}
          </ul>
          </OrdersListFilter>
        )}
      </section>
      <section aria-labelledby={`${headingId}-products`} className="p-4 sm:p-6">
        <h3 id={`${headingId}-products`} className="text-sm font-medium text-ink-soft mb-3">
          {seller.productCount === 1 ? "Produit" : "Produits"} ({seller.productCount})
        </h3>
        {productsError ? (
          <p className="text-sm text-bad">Impossible de charger les produits.</p>
        ) : products.length === 0 ? (
          <GetStartedChecklist seller={seller} />
        ) : (
          (() => {
            // Counts for the stock tab strip. Computed inline so the
            // SellerSection body stays a flat JSX expression — no
            // additional top-level vars to hoist past the existing
            // products/orders fetch dance.
            const stockCounts: Record<StockTab, number> = {
              all: products.length,
              in: products.filter((p) => p.inStock).length,
              out: products.filter((p) => !p.inStock).length,
            };
            return (
          <ProductsStockFilter counts={stockCounts}>
          <ProductsListFilter totalCount={products.length}>
          <ul className="divide-y divide-line-soft">
            {products.map((p) => (
              <li
                key={p.productId}
                data-search={`${cleanProductTitle(p.title)} ${p.brand ?? ""}`.toLowerCase()}
                data-stock={p.inStock ? "in" : "out"}
              >
                <ProductRow product={p} />
              </li>
            ))}
          </ul>
          </ProductsListFilter>
          </ProductsStockFilter>
            );
          })()
        )}
      </section>
    </article>
  );

  if (!collapsible) return article;

  // Multi-shop disclosure. A thin clickable bar opens/closes the full
  // shop card. Even when expanded the bar stays — it's the affordance to
  // collapse back. `[&::-webkit-details-marker]:hidden` strips the
  // default browser triangle; we render our own chevron that flips on
  // open via `group-open:rotate-90`.
  return (
    <details open={defaultOpen} className="group rounded-2xl">
      <summary
        aria-controls={headingId}
        className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-bg-soft/40 active:bg-bg-soft/40 transition select-none"
      >
        <span
          aria-hidden
          className="text-ink-mute text-xs transition-transform duration-150 group-open:rotate-90 shrink-0"
        >
          ▶
        </span>
        <span dir="auto" className="text-sm font-medium text-ink truncate min-w-0 flex-1">
          {seller.displayName}
        </span>
        {actionableCount > 0 && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent text-xs shrink-0"
            aria-label={`${actionableCount} commande${actionableCount === 1 ? "" : "s"} à traiter`}
          >
            <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="font-medium tabular-nums">{actionableCount}</span> à traiter
          </span>
        )}
        {shopStaleCount > 0 && (
          // Stale chip on the collapsed disclosure summary — tells
          // the seller "this shop's actionable backlog has lagger
          // orders inside" without expanding the card. Warn-tinted
          // to match the row chips and dashboard banner.
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-warn/40 bg-warn/10 text-warn text-xs shrink-0"
            aria-label={`${shopStaleCount} commande${shopStaleCount === 1 ? "" : "s"} en attente depuis plus de 48 heures`}
            title="Commandes en attente depuis plus de 48 heures"
          >
            <span aria-hidden>⏳</span>
            <span className="font-medium tabular-nums">{shopStaleCount}</span> lent
            {shopStaleCount === 1 ? "" : "s"}
          </span>
        )}
        <span className="text-xs text-ink-mute tabular-nums shrink-0 hidden sm:inline">
          {products.length} produit{products.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="mt-2">{article}</div>
    </details>
  );
}

function ContactSummary({ seller }: { seller: SellerRecord }) {
  // kind drives the per-row rendering: "tel" → tel link with ltr, "wa" →
  // wa.me click-to-chat (test the WhatsApp path opens — WhatsApp lets you
  // message your own number, so "Send to self" is a real verification),
  // "url" → anchor link new tab. Website used to render as bare text.
  const items: Array<{ label: string; value: string | null | undefined; kind: "tel" | "wa" | "url" | "mailto" }> = [
    { label: "Téléphone", value: seller.phone, kind: "tel" },
    { label: "WhatsApp", value: seller.whatsapp, kind: "wa" },
    { label: "Site web", value: seller.website, kind: "url" },
    { label: "E-mail", value: seller.supportEmail, kind: "mailto" },
  ];
  const set = items.filter((i) => i.value);
  if (set.length === 0) {
    // CTA-prompt the seller to fill contact info when none is set —
    // empty contact => no way for buyers to reach them after orders.
    return (
      <p className="mt-2 text-xs text-ink-mute">
        Aucune coordonnée renseignée.{" "}
        <Link
          href={`/seller/contact?sellerId=${encodeURIComponent(seller.sellerId)}`}
          className="text-accent hover:underline active:underline"
        >
          Ajouter
        </Link>
      </p>
    );
  }
  return (
    <ul className="mt-2 text-xs text-ink-soft space-y-0.5">
      {set.map((i) => (
        <li key={i.label} className="break-all">
          <span className="text-ink-mute">{i.label} :</span>{" "}
          {i.kind === "tel" ? (
            <a href={`tel:${i.value}`} dir="ltr" className="text-ink hover:text-accent active:text-accent">
              {i.value}
            </a>
          ) : i.kind === "wa" ? (
            <a
              href={`https://wa.me/${i.value!.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="text-ink hover:text-accent active:text-accent"
            >
              {i.value}
            </a>
          ) : i.kind === "mailto" ? (
            <a href={`mailto:${i.value}`} dir="ltr" className="text-ink hover:text-accent active:text-accent">
              {i.value}
            </a>
          ) : (
            <a
              href={i.value!}
              target="_blank"
              rel="nofollow noopener"
              dir="ltr"
              className="text-ink hover:text-accent active:text-accent"
            >
              {i.value}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
