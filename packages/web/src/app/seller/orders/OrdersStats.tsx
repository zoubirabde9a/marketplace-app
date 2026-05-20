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
  orders: ReadonlyArray<{ order: SellerOrder }>;
  actionableCount: number;
  now: Date;
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

export function OrdersStats({ orders, actionableCount, now }: OrdersStatsProps): React.JSX.Element {
  const DAY_MS = 86_400_000;
  const sevenDaysAgo = now.getTime() - 7 * DAY_MS;

  let shippedThisWeek = 0;
  const revenueByCcy: Record<string, bigint> = {};
  for (const { order: o } of orders) {
    const t = new Date(o.createdAt).getTime();
    const within7d = !Number.isNaN(t) && t >= sevenDaysAgo;
    if (within7d && o.status === "shipped") shippedThisWeek++;
    if (within7d && REVENUE_STATUSES.has(o.status)) {
      try {
        revenueByCcy[o.currency] = (revenueByCcy[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
      } catch {
        // unparseable subtotal — skip rather than blow up the tile
      }
    }
  }
  const topCcyEntry = Object.entries(revenueByCcy).sort((a, b) => Number(b[1] - a[1]))[0];
  const revenueLabel = topCcyEntry
    ? formatPrice(topCcyEntry[1].toString(), topCcyEntry[0], "fr-DZ")
    : null;

  return (
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
      />
      <Tile
        label="Revenu (7 jours)"
        value={revenueLabel ?? "—"}
        tone="muted"
        hint="Total des commandes non annulées des 7 derniers jours"
      />
    </dl>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "accent" | "muted";
}): React.JSX.Element {
  const valueClass =
    tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="rounded-2xl border border-line-soft bg-bg-soft/60 px-4 py-3">
      <dt className="text-[10px] uppercase tracking-widest text-ink-mute">{label}</dt>
      <dd
        title={hint}
        className={"mt-1 text-2xl font-semibold tabular-nums " + valueClass}
      >
        {value}
      </dd>
    </div>
  );
}
