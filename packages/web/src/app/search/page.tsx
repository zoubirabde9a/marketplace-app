import { Suspense } from "react";
import type { Metadata } from "next";
import { searchProducts } from "@/lib/api";
import { parseSearchParams } from "@/lib/url";
import { ActiveFilters } from "@/components/ActiveFilters";
import { ProductGridSkeleton } from "@/components/ProductGrid";
import { EmptyState } from "@/components/EmptyState";
import { InfiniteResults } from "@/components/InfiniteResults";
import { jsonLdString } from "@/lib/jsonld";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const brand = (Array.isArray(sp.brand) ? sp.brand[0] : sp.brand) ?? "";
  const sellerIdParam = sp.sellerId;
  const sellerId = Array.isArray(sellerIdParam)
    ? sellerIdParam.length === 1
      ? sellerIdParam[0]
      : ""
    : sellerIdParam ?? "";
  const categoryParam = sp.category;
  const category = Array.isArray(categoryParam)
    ? categoryParam.length === 1
      ? categoryParam[0]
      : ""
    : categoryParam ?? "";
  const definedKeys = Object.keys(sp).filter((k) => sp[k] !== undefined);
  // Canonicalize. q-only, brand-only, single-seller, and single-category
  // slices are worth indexing as their own pages; everything else (cursor,
  // price ranges, ratings, multi-filter combinations) collapses back to the
  // bare /search canonical.
  const canonical = q
    ? `/search?q=${encodeURIComponent(q)}`
    : brand && definedKeys.length === 1
      ? `/search?brand=${encodeURIComponent(brand)}`
      : sellerId && definedKeys.length === 1
        ? `/search?sellerId=${encodeURIComponent(sellerId)}`
        : category && definedKeys.length === 1
          ? `/search?category=${encodeURIComponent(category)}`
          : "/search";
  const indexableKeys = new Set(["q", "brand", "sellerId", "category"]);
  const hasNonIndexableParam = definedKeys.some((k) => !indexableKeys.has(k));
  const isMultiValuedCategory =
    definedKeys.length === 1 && Array.isArray(categoryParam) && categoryParam.length > 1;
  // Only index single-key q-only, brand-only, or seller-only views.
  const isMultiFilter = definedKeys.length > 1;
  // Multi-valued sellerId collapses to "" — that's a synthetic combo, not a
  // single seller landing, so noindex it even though it's a single key.
  const isMultiValuedSeller =
    definedKeys.length === 1 && Array.isArray(sellerIdParam) && sellerIdParam.length > 1;

  let title: string;
  let description: string;
  if (q) {
    title = `Search: ${q}`;
    description = `Marketplace results matching "${q}".`;
  } else if (brand) {
    title = `${brand} products`;
    description = `Browse ${brand} products on Teno Store.`;
  } else if (category && !isMultiValuedCategory) {
    // Category-only landing — humanise the slug for the title and description
    // so the SERP snippet reads naturally instead of "telephones products".
    const human = category.replace(/[-_]/g, " ");
    title = `${human.charAt(0).toUpperCase()}${human.slice(1)} on Teno Store`;
    description = `Browse ${human} listings on Teno Store.`;
  } else if (sellerId && !isMultiValuedSeller) {
    // Single-seller landing — resolve the display name so the title and
    // description carry the seller's brand instead of a generic "Browse..."
    // string. Falls back gracefully when the API is unreachable.
    let sellerName: string | null = null;
    try {
      const r = await searchProducts({ sellerId: [sellerId], limit: 1 });
      sellerName =
        r.facets?.sellers?.find((s) => s.value === sellerId)?.displayName ??
        r.data[0]?.sellerDisplayName ??
        null;
    } catch {
      // ignore
    }
    title = sellerName ? `${sellerName} on Teno Store` : "Storefront on Teno Store";
    description = sellerName
      ? `Browse listings from ${sellerName} on Teno Store.`
      : "Browse listings from this seller on Teno Store.";
  } else {
    title = "Browse the marketplace";
    description = "Browse the marketplace catalog.";
  }

  return {
    title,
    description,
    alternates: { canonical },
    robots:
      hasNonIndexableParam || isMultiFilter || isMultiValuedSeller || isMultiValuedCategory
        ? { index: false, follow: true }
        : { index: true, follow: true },
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const input = parseSearchParams(sp);

  return (
    <div className="pt-8">
      <Suspense
        fallback={
          <>
            <div className="skeleton h-8 w-1/3 mb-6" />
            <ProductGridSkeleton />
          </>
        }
      >
        <Results input={input} sp={sp} />
      </Suspense>
    </div>
  );
}

async function Results({ input, sp }: { input: ReturnType<typeof parseSearchParams>; sp: SP }) {
  let result;
  let error: string | null = null;
  try {
    result = await searchProducts(input);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error || !result) {
    return (
      <div>
        <ResultsHeader q={input.q} total={0} />
        <ApiErrorBanner message={error ?? "Could not reach the marketplace API."} />
      </div>
    );
  }

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) params.append(k, x);
    else params.append(k, v);
  }

  // Build a sellerId -> displayName map: prefer the API's seller facets
  // (authoritative even when the slice is empty), and fall back to names
  // observed in the result set itself.
  const sellerDisplayNames: Record<string, string> = {};
  for (const f of result.facets?.sellers ?? []) {
    if (f.value && f.displayName) sellerDisplayNames[f.value] = f.displayName;
  }
  for (const hit of result.data) {
    if (hit.sellerDisplayName && !sellerDisplayNames[hit.sellerId]) {
      sellerDisplayNames[hit.sellerId] = hit.sellerDisplayName;
    }
  }

  const minorToMajor = (minor: string | undefined) => {
    if (!minor) return undefined;
    const n = Number(minor);
    if (!Number.isFinite(n)) return undefined;
    return (n / 100).toFixed(2);
  };
  const itemListSellerName = (() => {
    const ids = (input.sellerId ?? []).filter(Boolean);
    if (ids.length !== 1) return undefined;
    return sellerDisplayNames[ids[0]];
  })();
  const itemListName = input.q
    ? `Marketplace search: ${input.q}`
    : itemListSellerName
      ? `Products from ${itemListSellerName}`
      : input.brand
        ? `${input.brand} products`
        : "Marketplace catalog";
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: itemListName,
    numberOfItems: result.data.length,
    itemListElement: result.data.map((hit, idx) => {
      const productUrl = `${SITE_URL}/product/${encodeURIComponent(hit.productId)}`;
      const product: Record<string, unknown> = {
        "@type": "Product",
        "@id": productUrl,
        name: hit.title?.value,
        url: productUrl,
        productID: hit.productId,
      };
      if (hit.heroImageUrl) product.image = [hit.heroImageUrl];
      if (hit.brand) product.brand = { "@type": "Brand", name: hit.brand };
      const availability = hit.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
      const seller = hit.sellerDisplayName
        ? {
            "@type": "Organization",
            name: hit.sellerDisplayName,
            identifier: hit.sellerId,
            url: `${SITE_URL}/search?sellerId=${encodeURIComponent(hit.sellerId)}`,
          }
        : undefined;
      const lowPrice = minorToMajor(hit.priceFromMinor);
      const highPrice = minorToMajor(hit.priceToMinor);
      const flatPrice = minorToMajor(hit.priceMinor);
      if (lowPrice && highPrice && hit.currency && (hit.variantCount ?? 0) > 1) {
        product.offers = {
          "@type": "AggregateOffer",
          offerCount: hit.variantCount,
          lowPrice,
          highPrice,
          priceCurrency: hit.currency,
          availability,
          url: productUrl,
          ...(seller ? { seller } : {}),
        };
      } else if ((flatPrice ?? lowPrice) && hit.currency) {
        product.offers = {
          "@type": "Offer",
          price: flatPrice ?? lowPrice,
          priceCurrency: hit.currency,
          availability,
          url: productUrl,
          ...(seller ? { seller } : {}),
        };
      }
      if (typeof hit.rating === "number" && typeof hit.ratingCount === "number" && hit.ratingCount > 0) {
        product.aggregateRating = {
          "@type": "AggregateRating",
          ratingValue: hit.rating,
          reviewCount: hit.ratingCount,
        };
      }
      return {
        "@type": "ListItem",
        position: idx + 1,
        item: product,
      };
    }),
  };

  // When the visible result set is predominantly DZD-priced, the listings
  // are almost certainly French. <html lang="en"> at the layout root would
  // otherwise tell French-language search engines "ignore this page" — wrap
  // the article subtree with the right BCP-47 tag and mirror it into the
  // ItemList JSON-LD via inLanguage. Mirrors the product-page heuristic.
  const dzdHits = result.data.filter((h) => h.currency === "DZD").length;
  const contentLang = dzdHits > 0 && dzdHits >= result.data.length / 2 ? "fr" : undefined;
  if (contentLang) (itemListJsonLd as Record<string, unknown>).inLanguage = contentLang;

  return (
    <div lang={contentLang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(itemListJsonLd) }}
      />
      <ResultsHeader
        q={input.q}
        total={result.pagination.totalEstimate}
        resultCount={result.data.length}
        sellerName={(() => {
          const ids = (input.sellerId ?? []).filter(Boolean);
          if (ids.length !== 1) return undefined;
          return sellerDisplayNames[ids[0]];
        })()}
        brand={input.brand}
      />
      <ActiveFilters sp={sp} sellerDisplayNames={sellerDisplayNames} />
      {result.data.length === 0 ? (
        Object.keys(input).length === 0 ? (
          <EmptyState
            title="Catalog is empty"
            hint="No listings yet. If you sell products, you can be the first."
            showSellCta
          />
        ) : (
          <EmptyState
            title="No products matched"
            hint="Try a broader query, enable fuzzy matching, or remove a filter chip above."
            q={input.q}
            hasFilters
            fuzzyAlreadyOn={input.fuzzy}
          />
        )
      ) : (
        <InfiniteResults
          initialHits={result.data}
          initialCursor={result.pagination.cursor}
          baseQuery={(() => {
            // Drop `cursor` from the inherited params — the client component
            // appends its own as it walks forward through pages.
            const q = new URLSearchParams(params.toString());
            q.delete("cursor");
            return q.toString();
          })()}
        />
      )}
    </div>
  );
}

function ResultsHeader({
  q,
  total,
  resultCount,
  sellerName,
  brand,
}: {
  q?: string;
  total: number;
  resultCount?: number;
  sellerName?: string;
  brand?: string;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
        {q ? (
          <>Results for <span className="text-accent">“{q}”</span></>
        ) : sellerName ? (
          <>Products from <span className="text-accent">{sellerName}</span></>
        ) : brand ? (
          <><span className="text-accent">{brand}</span> products</>
        ) : (
          "Browse the catalog"
        )}
      </h1>
      <p className="text-sm text-ink-soft mt-1">
        {total.toLocaleString()} match{total === 1 ? "" : "es"}
        {resultCount != null && total > resultCount ? ` · showing ${resultCount}` : ""}
      </p>
    </div>
  );
}

function ApiErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-bad/30 bg-bad/10 px-5 py-4">
      <div className="text-bad font-medium text-sm">Marketplace API unreachable</div>
      <div className="text-xs text-ink-soft mt-1 font-mono break-all">{message}</div>
      <div className="text-xs text-ink-mute mt-2">
        Check that <code className="text-ink-soft">MARKETPLACE_API_URL</code> is set and the API is running.
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
