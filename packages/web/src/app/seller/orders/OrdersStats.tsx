// Three-tile stats banner rendered at the top of the unified orders page.
// Server component — derives every number from the orders array the page
// already has in hand, no extra fetches. Three numbers picked to answer
// the seller's three implicit questions on opening the page:
//
//   1. "What do I owe action on?"        → actionable count
//   2. "Am I keeping up with shipping?"  → orders shipped in the last 7 days
//   3. "Am I making money this week?"    → revenue from non-cancelled orders
//                                          (subtotal sum, paid+shipped+delivered)
//
// Revenue is bucketed by currency because a sum across mixed currencies
// would be meaningless. In practice the marketplace is single-currency
// (DZD) and the topCcy fallback in the dashboard collapses to one value;
// here we surface the dominant currency the same way and ignore minor
// outliers.

import type { SellerOrder } from "@/lib/api";
import { formatPrice } from "@/lib/format";

interface OrdersStatsProps {
  orders: ReadonlyArray<{ order: SellerOrder; sellerId?: string; shopName?: string }>;
  actionableCount: number;
  now: Date;
  /** When the seller owns more than one shop, render a compact per-
   *  shop breakdown strip beneath the aggregate tiles. The page
   *  passes this only in the multi-shop case; single-shop sellers
   *  see just the three aggregate tiles. */
  shops?: ReadonlyArray<{ sellerId: string; displayName: string }>;
}

// Statuses that represent real revenue (money has moved or will move on
// COD). Excludes cancelled/refunded so a week of refunds doesn't look
// like a positive week, and excludes the pre-payment states (created/
// authorized) which haven't committed to a sale yet.
const REVENUE_STATUSES: ReadonlySet<string> = new Set([
  "paid",
  "fulfilling",
  "shipped",
  "delivered",
]);

export function OrdersStats({ orders, actionableCount, now, shops }: OrdersStatsProps): React.JSX.Element {
  const DAY_MS = 86_400_000;
  const sevenDaysAgo = now.getTime() - 7 * DAY_MS;
  // Prior-week window (14d ago → 7d ago) for the week-over-week
  // delta on each tile. Half-open at the leading edge so an order
  // exactly 7 days old counts in "this week", not "last week".
  const fourteenDaysAgo = now.getTime() - 14 * DAY_MS;

  let shippedThisWeek = 0;
  let shippedLastWeek = 0;
  const revenueByCcy: Record<string, bigint> = {};
  const revenueLastWeekByCcy: Record<string, bigint> = {};
  // Per-shop tallies — keyed by sellerId; only used when the caller
  // passes a `shops` list, which it only does in the multi-shop
  // case. Single-shop sellers skip this whole accounting layer.
  const perShop = new Map<string, { revenueByCcy: Record<string, bigint> }>();
  for (const item of orders) {
    const o = item.order;
    const sellerId = item.sellerId;
    const t = new Date(o.createdAt).getTime();
    if (Number.isNaN(t)) continue;
    const within7d = t >= sevenDaysAgo;
    const within14to7 = t >= fourteenDaysAgo && t < sevenDaysAgo;
    if (within7d && o.status === "shipped") shippedThisWeek++;
    if (within14to7 && o.status === "shipped") shippedLastWeek++;
    if (within7d && REVENUE_STATUSES.has(o.status)) {
      try {
        revenueByCcy[o.currency] = (revenueByCcy[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
        if (shops && sellerId) {
          let s = perShop.get(sellerId);
          if (!s) {
            s = { revenueByCcy: {} };
            perShop.set(sellerId, s);
          }
          s.revenueByCcy[o.currency] = (s.revenueByCcy[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
        }
      } catch {
        // unparseable subtotal — skip rather than blow up the tile
      }
    }
    if (within14to7 && REVENUE_STATUSES.has(o.status)) {
      try {
        revenueLastWeekByCcy[o.currency] =
          (revenueLastWeekByCcy[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
      } catch {
        /* skip */
      }
    }
  }
  const topCcyEntry = Object.entries(revenueByCcy).sort((a, b) => Number(b[1] - a[1]))[0];
  const revenueLabel = topCcyEntry
    ? formatPrice(topCcyEntry[1].toString(), topCcyEntry[0], "fr-DZ")
    : null;

  // Week-over-week revenue delta in the dominant currency. The
  // delta is meaningful only when at least one of the two windows
  // had any qualifying revenue; "0 → 0" is shown as no delta. Same
  // dominant currency as the tile value so the comparison is
  // apples-to-apples.
  let revenueDelta: { label: string; up: boolean | null } | null = null;
  if (topCcyEntry) {
    const ccy = topCcyEntry[0];
    const thisWeek = topCcyEntry[1];
    const lastWeek = revenueLastWeekByCcy[ccy] ?? 0n;
    if (thisWeek !== lastWeek) {
      const up = thisWeek > lastWeek;
      const diff = up ? thisWeek - lastWeek : lastWeek - thisWeek;
      revenueDelta = {
        label: formatPrice(diff.toString(), ccy, "fr-DZ"),
        up,
      };
    } else if (thisWeek > 0n) {
      revenueDelta = { label: "—", up: null };
    }
  }
  const shippedDelta =
    shippedThisWeek !== shippedLastWeek
      ? {
          label: Math.abs(shippedThisWeek - shippedLastWeek).toString(),
          up: shippedThisWeek > shippedLastWeek,
        }
      : null;

  // Per-shop breakdown — only for multi-shop sellers. Each entry
  // surfaces the same dominant-currency revenue collapse used for the
  // top tile, scoped to one shop. Skipped when fewer than 2 shops
  // (the top tile already serves that case).
  const perShopBreakdown =
    shops && shops.length > 1
      ? shops.map((s) => {
          const entry = perShop.get(s.sellerId);
          const top = entry
            ? Object.entries(entry.revenueByCcy).sort((a, b) => Number(b[1] - a[1]))[0]
            : null;
          const label = top ? formatPrice(top[1].toString(), top[0], "fr-DZ") : "—";
          return { sellerId: s.sellerId, displayName: s.displayName, label };
        })
      : null;

  return (
    <>
    <dl
      aria-label="Indicateurs des commandes"
      className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3"
    >
      <Tile
        label="À traiter"
        value={actionableCount.toString()}
        tone={actionableCount > 0 ? "accent" : "muted"}
        hint="Commandes en attente d’action"
      />
      <Tile
        label="Expédiées (7 jours)"
        value={shippedThisWeek.toString()}
        tone="muted"
        hint="Commandes marquées expédiées cette semaine"
        delta={shippedDelta}
      />
      <Tile
        label="Revenu (7 jours)"
        value={revenueLabel ?? "—"}
        tone="muted"
        hint="Total des commandes non annulées des 7 derniers jours"
        delta={revenueDelta}
      />
    </dl>
    {perShopBreakdown && (
      <dl
        aria-label="Revenu par boutique (7 jours)"
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft"
      >
        <dt className="text-[10px] uppercase tracking-widest text-ink-mute">
          Par boutique
        </dt>
        {perShopBreakdown.map((s) => (
          <div key={s.sellerId} className="inline-flex items-baseline gap-1.5">
            <dd className="text-ink-soft" dir="auto">{s.displayName}</dd>
            <dd className="tabular-nums text-ink font-medium">{s.label}</dd>
          </div>
        ))}
      </dl>
    )}
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
  delta,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "accent" | "muted";
  /** Week-over-week comparison badge. `up: null` renders neutrally
   * (used when only this week has data and last week was zero —
   * comparison is technically "infinity up" but visually a "—"
   * is honest). */
  delta?: { label: string; up: boolean | null } | null;
}): React.JSX.Element {
  const valueClass =
    tone === "accent" ? "text-accent" : "text-ink";
  const deltaCls =
    delta == null
      ? ""
      : delta.up === true
      ? "text-ok"
      : delta.up === false
      ? "text-bad"
      : "text-ink-mute";
  return (
    <div className="rounded-2xl border border-line-soft bg-bg-soft/60 px-4 py-3">
      <dt className="text-[10px] uppercase tracking-widest text-ink-mute">{label}</dt>
      <dd
        title={hint}
        className={"mt-1 text-2xl font-semibold tabular-nums " + valueClass}
      >
        {value}
      </dd>
      {delta && (
        <p
          className={"mt-1 text-[11px] tabular-nums inline-flex items-center gap-1 " + deltaCls}
          title="Variation par rapport à la semaine précédente"
        >
          <span aria-hidden>
            {delta.up === true ? "▲" : delta.up === false ? "▼" : "·"}
          </span>
          {delta.label}
          <span className="text-ink-mute"> vs semaine dernière</span>
        </p>
      )}
    </div>
  );
}
