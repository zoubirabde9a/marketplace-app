// Unified cross-shop products view. Symmetric with /seller/orders: the
// dashboard nests products inside each shop card (great for the common
// single-shop seller), but a multi-shop seller managing inventory
// across two or three shops wants one chronological list of every
// listing they own. This page fans out, flattens, and renders with the
// same search + stock filter + ProductRow primitives so the seller's
// mental model carries over from the per-shop sections and the unified
// orders view.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import {
  listMySellers,
  listProductsBySeller,
  type SellerRecord,
} from "@/lib/api";
import { cleanProductTitle } from "@/lib/format";
import { ProductRow, type ProductRowData } from "../dashboard/ProductRow";
import { ProductsListFilter } from "../dashboard/ProductsListFilter";
import { ProductsStockFilter, type StockTab } from "../dashboard/ProductsStockFilter";
import { ProductsShopFilter } from "./ProductsShopFilter";
import { ProductsSortToggle } from "./ProductsSortToggle";
import { AutoRefresh } from "../orders/AutoRefresh";
import { LastRefreshed } from "../orders/LastRefreshed";
import { OfflineIndicator } from "../orders/OfflineIndicator";
import { ResetFiltersWrapper } from "../orders/ResetFiltersWrapper";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tous les produits",
  robots: { index: false, follow: false },
};

interface UnifiedProduct {
  product: ProductRowData;
  /** Owning shop's UUID. Used by ProductsShopFilter to scope the
   *  list to one shop on multi-shop accounts. */
  sellerId: string;
  shopName: string;
  /** Server time the listing was created — used for chronological sort.
   * Falls back to the empty string when missing (puts those last). */
  postedAt: string;
}

interface SellerProductsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SellerProductsPage({
  searchParams,
}: SellerProductsPageProps): Promise<React.JSX.Element> {
  const sp = await searchParams;
  const sortOldestFirst = sp.sort === "oldest";
  const session = await getCurrentUser();
  if (!session) redirect("/seller");
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(session.jwt, agentId);
  const sellers: SellerRecord[] = sellersResp.data;
  if (sellers.length === 0) redirect("/seller/dashboard");

  const results = await Promise.allSettled(
    sellers.map((s) => listProductsBySeller(s.sellerId, session.jwt)),
  );
  const products: UnifiedProduct[] = [];
  let anyFetchFailed = false;
  results.forEach((r, i) => {
    const s = sellers[i]!;
    if (r.status === "fulfilled") {
      for (const h of r.value.data) {
        products.push({
          sellerId: s.sellerId,
          shopName: s.displayName,
          postedAt: h.postedAt ?? "",
          product: {
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
          },
        });
      }
    } else {
      anyFetchFailed = true;
    }
  });

  // Sort by listing creation — newest-first by default, oldest-
  // first when the seller flips ?sort=oldest. Stable on tie via
  // productId (UUIDv7 already orders by time, so ties only happen
  // on simultaneous creates which are rare in practice).
  products.sort((a, b) => {
    const cmp = sortOldestFirst
      ? a.postedAt.localeCompare(b.postedAt)
      : b.postedAt.localeCompare(a.postedAt);
    if (cmp !== 0) return cmp;
    return a.product.productId.localeCompare(b.product.productId);
  });

  const stockCounts: Record<StockTab, number> = {
    all: products.length,
    in: products.filter((u) => u.product.inStock).length,
    out: products.filter((u) => !u.product.inStock).length,
  };
  // Per-shop counts for the shop filter chips (multi-shop only).
  const shopCounts = sellers.map((s) => ({
    sellerId: s.sellerId,
    displayName: s.displayName,
    count: products.filter((u) => u.sellerId === s.sellerId).length,
  }));
  const showShopName = sellers.length > 1;

  return (
    <section
      aria-labelledby="products-heading"
      className="pt-6 sm:pt-10 pb-12 sm:pb-24 max-w-5xl mx-auto"
      lang="fr"
    >
      <AutoRefresh />
      <OfflineIndicator />
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 id="products-heading" className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Tous les produits
          </h1>
          <p className="mt-2 text-xs text-ink-mute">
            <span className="text-ink-soft tabular-nums">{products.length}</span>{" "}
            produit{products.length === 1 ? "" : "s"}
            {sellers.length > 1 && (
              <>
                {" "}sur <span className="text-ink-soft tabular-nums">{sellers.length}</span> boutiques
              </>
            )}
            {stockCounts.out > 0 && (
              <>
                {" "}·{" "}
                <span className="text-warn tabular-nums">{stockCounts.out}</span> en rupture
              </>
            )}
          </p>
          <div className="mt-2">
            <LastRefreshed renderedAt={new Date().toISOString()} />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Primary CTA — completes the page's "manage products"
              mandate. NewProductForm already renders a shop picker
              when sellers.length > 1, so we link without a sellerId
              and the form handles defaulting. Styled with the accent
              fill to be visibly the principal action vs the muted
              Exporter / back link next to it. */}
          <Link
            href="/seller/products/new"
            className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center gap-1.5 rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition"
          >
            <span aria-hidden>+</span> Nouveau produit
          </Link>
          {sellers.length === 1 && products.length > 0 && (
            // Single-shop sellers get a one-tap preview of their
            // public storefront — the most common "I just edited
            // a listing, let me see how it looks to buyers" path
            // without going via the dashboard. Multi-shop sellers
            // skip this link (ambiguous which store to open) and
            // use each shop card's "Voir la boutique" link instead.
            <a
              href={`/store/${encodeURIComponent(sellers[0]!.sellerId)}`}
              target="_blank"
              rel="noopener"
              className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center gap-1 rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
              title="Voir la boutique publique"
            >
              Voir la boutique <span aria-hidden>↗</span>
            </a>
          )}
          {products.length > 0 && (
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
          <Link
            href="/seller/dashboard"
            className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
          >
            ← Tableau de bord
          </Link>
        </div>
      </header>

      {anyFetchFailed && (
        <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Certaines boutiques n’ont pas pu être chargées. La liste ci-dessous
          peut être incomplète.
        </p>
      )}

      <div className="mt-8 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-6">
        {products.length === 0 ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-ink-mute">
              Aucun produit pour le moment. Ajoutez votre première annonce
              pour la rendre visible aux acheteurs.
            </p>
            <Link
              href="/seller/products/new"
              className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center justify-center gap-1.5 rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition shrink-0"
            >
              <span aria-hidden>+</span> Nouveau produit
            </Link>
          </div>
        ) : (
          <ResetFiltersWrapper>
          <ProductsShopFilter shops={shopCounts} totalCount={products.length}>
          <ProductsStockFilter counts={stockCounts}>
            <ProductsSortToggle />
            <ProductsListFilter totalCount={products.length}>
              <ul className="divide-y divide-line-soft">
                {products.map((u) => (
                  <li
                    key={u.product.productId}
                    data-search={`${cleanProductTitle(u.product.title)} ${u.product.brand ?? ""} ${u.shopName}`.toLowerCase()}
                    data-stock={u.product.inStock ? "in" : "out"}
                    data-shop-id={u.sellerId}
                  >
                    <ProductRow
                      product={u.product}
                      shopName={showShopName ? u.shopName : undefined}
                    />
                  </li>
                ))}
              </ul>
            </ProductsListFilter>
          </ProductsStockFilter>
          </ProductsShopFilter>
          </ResetFiltersWrapper>
        )}
      </div>

      {/* Mobile-only floating "+" CTA. The header CTA above is great
          on desktop, but mobile sellers scrolling a long list lose
          sight of it. The FAB stays in thumb reach the entire scroll.
          sm:hidden — desktop sellers use the header CTA. */}
      <Link
        href="/seller/products/new"
        aria-label="Nouveau produit"
        className="sm:hidden fixed bottom-5 right-5 z-20 inline-flex items-center justify-center w-14 h-14 rounded-full bg-accent text-bg shadow-xl hover:bg-accent-hover active:brightness-90 transition"
      >
        <svg
          className="w-7 h-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </section>
  );
}
