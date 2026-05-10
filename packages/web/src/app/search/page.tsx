import type { Metadata } from "next";
import Link from "next/link";
import { searchProducts } from "@/lib/api";
import { parseSearchParams } from "@/lib/url";
import { ActiveFilters } from "@/components/ActiveFilters";
// (ProductGridSkeleton removed with the Suspense boundary below — see comment.)
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

  // Resolve the slice's seller name + total count once for reuse in title and
  // description. The count adds a real number to SERP snippets ("1,486 Samsung
  // listings…" instead of "Browse Samsung products…") which historically lifts
  // CTR meaningfully. Cheap because Next dedups the request-scoped fetch with
  // the page render — same parsed input later reuses the same data.
  let sellerName: string | null = null;
  let totalCount: number | null = null;
  if (q || brand || (category && !isMultiValuedCategory) || (sellerId && !isMultiValuedSeller)) {
    try {
      const r = await searchProducts({
        ...(q ? { q } : {}),
        ...(brand ? { brand } : {}),
        ...(category && !isMultiValuedCategory ? { category: [category] } : {}),
        ...(sellerId && !isMultiValuedSeller ? { sellerId: [sellerId] } : {}),
        limit: 1,
      });
      totalCount = r.pagination?.totalEstimate ?? null;
      if (sellerId && !isMultiValuedSeller) {
        sellerName =
          r.facets?.sellers?.find((s) => s.value === sellerId)?.displayName ??
          r.data[0]?.sellerDisplayName ??
          null;
      }
    } catch {
      // ignore — fall back to count-less variants below
    }
  }
  const fmtCount = totalCount != null ? totalCount.toLocaleString() : null;

  let title: string;
  let description: string;
  if (q) {
    title = `Search: ${q}`;
    description = fmtCount
      ? `${fmtCount} listings matching “${q}” on Teno Store — phones, computing and more from Algerian sellers, prices in DZD.`
      : `Marketplace results matching “${q}” on Teno Store.`;
  } else if (brand) {
    title = `${brand} products`;
    description = fmtCount
      ? `Browse ${fmtCount} ${brand} listings from Algerian sellers on Teno Store. Filter by category, price or seller. Prices in DZD.`
      : `Browse ${brand} products on Teno Store.`;
  } else if (category && !isMultiValuedCategory) {
    const human = category.replace(/[-_]/g, " ");
    title = `${human.charAt(0).toUpperCase()}${human.slice(1)} on Teno Store`;
    description = fmtCount
      ? `${fmtCount} ${human} listings from Algerian sellers on Teno Store. Annonces actualisées en temps réel, prix en DZD.`
      : `Browse ${human} listings on Teno Store.`;
  } else if (sellerId && !isMultiValuedSeller) {
    title = sellerName ? `${sellerName} on Teno Store` : "Storefront on Teno Store";
    description = fmtCount
      ? sellerName
        ? `All ${fmtCount} listings from ${sellerName} on Teno Store, refreshed continuously.`
        : `All ${fmtCount} listings from this seller on Teno Store, refreshed continuously.`
      : sellerName
        ? `Browse listings from ${sellerName} on Teno Store.`
        : "Browse listings from this seller on Teno Store.";
  } else {
    title = "Browse the marketplace";
    // Bare /search is the catalog hub URL. Surface what the catalog actually
    // contains so SERP snippet and AI-search summarisation have something
    // topical to anchor on, instead of "Browse the marketplace catalog."
    description =
      "Browse thousands of live listings on Teno Store — phones, computing, home appliances, fashion and vehicles from Algerian sellers, priced in DZD. Filter by category, brand or seller.";
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

  // No Suspense boundary here. With the API on the same docker network the
  // search fetch lands in ~50 ms and React's streaming SSR otherwise flushes
  // the layout footer (CategoryFooter chips) BEFORE the resolved main content,
  // because the footer is synchronous and Results is async. Crawlers read
  // the response top-down: with the boundary, footer chips landed ~17 KB
  // earlier in the byte stream than the H1 and product list, dragging
  // snippet selection toward footer text. Awaiting Results inline preserves
  // source order for negligible TTFB cost.
  return (
    <div className="pt-8">
      <Results input={input} sp={sp} />
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
  const singleCategory = (input.category ?? []).length === 1 ? input.category![0] : undefined;
  const humanCategory = singleCategory
    ? singleCategory.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase())
    : undefined;
  const itemListName = input.q
    ? `Marketplace search: ${input.q}`
    : itemListSellerName
      ? `Products from ${itemListSellerName}`
      : input.brand
        ? `${input.brand} products`
        : humanCategory
          ? `${humanCategory} on Teno Store`
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

  // Wrap the ItemList in a CollectionPage so Google sees this as a curated
  // catalog landing (q-only, brand-only, seller-only, category-only) rather
  // than an opaque list. Bare /search collapses to a generic Catalog page.
  const collectionUrl = `${SITE_URL}${canonicalSlicePath(input)}`;
  const collectionName = itemListName;
  const collectionDescription = input.q
    ? `Marketplace results matching “${input.q}”.`
    : itemListSellerName
      ? `Listings from ${itemListSellerName} on Teno Store.`
      : input.brand
        ? `Browse ${input.brand} products on Teno Store.`
        : humanCategory
          ? `Browse ${humanCategory.toLowerCase()} listings on Teno Store.`
          : "Browse the Teno Store catalog.";
  const collectionPageJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": collectionUrl,
    url: collectionUrl,
    name: collectionName,
    description: collectionDescription,
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website` },
    mainEntity: itemListJsonLd,
  };
  if (contentLang) collectionPageJsonLd.inLanguage = contentLang;

  // Breadcrumbs both as visible nav and as JSON-LD. Three-segment trail —
  // Home › Catalog › <slice label>. The slice label tracks whichever
  // single-key landing the user is on (q, brand, single-seller, single
  // category); for the bare /search root we omit the third segment so
  // we don't emit a trail that points at itself.
  const sliceLabel = input.q
    ? `“${input.q}”`
    : itemListSellerName
      ? itemListSellerName
      : input.brand
        ? input.brand
        : humanCategory ?? null;
  const sliceUrl = canonicalSlicePath(input);
  const breadcrumbJsonLd = sliceLabel
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Catalog", item: `${SITE_URL}/search` },
          {
            "@type": "ListItem",
            position: 3,
            name: sliceLabel,
            item: `${SITE_URL}${sliceUrl}`,
          },
        ],
      }
    : null;

  return (
    <div lang={contentLang}>
      {/* CollectionPage embeds the ItemList via mainEntity, so we only
          emit one block here — emitting both would create a duplicate
          ItemList in Google's structured-data view. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(collectionPageJsonLd) }}
      />
      {breadcrumbJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd) }}
        />
      )}
      {sliceLabel && <SearchBreadcrumbs label={sliceLabel} />}
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
        category={humanCategory}
      />
      {sliceLabel && (
        <SliceIntro
          total={result.pagination.totalEstimate}
          sellerName={itemListSellerName}
          brand={input.brand}
          category={humanCategory}
          q={input.q}
          contentLang={contentLang}
        />
      )}
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
  category,
}: {
  q?: string;
  total: number;
  resultCount?: number;
  sellerName?: string;
  brand?: string;
  category?: string;
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
        ) : category ? (
          <><span className="text-accent">{category}</span> on Teno Store</>
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

// Substantive intro paragraph below the H1 on every slice landing —
// q-only, brand-only, single-seller, single-category. Adds topical
// keyword density (in French where the result set is predominantly
// DZD) and a real sentence of text Google can use as a snippet
// candidate beyond the generic meta description. ~80-120 chars.
function SliceIntro({
  total,
  sellerName,
  brand,
  category,
  q,
  contentLang,
}: {
  total: number;
  sellerName?: string;
  brand?: string;
  category?: string;
  q?: string;
  contentLang?: string;
}) {
  const isFr = contentLang === "fr";
  const fmt = total.toLocaleString();
  // Bilingual: lead with the audience-matching language, follow with a
  // shorter English sentence so search engines that don't honor the
  // <div lang> wrap still see English keywords.
  const fr = (() => {
    if (q) return `Plus de ${fmt} annonces correspondant à « ${q} » en provenance de vendeurs algériens. Prix en DZD, mises à jour en continu.`;
    if (sellerName) return `Toutes les annonces de ${sellerName}. ${fmt} produits, prix en DZD, actualisés en temps réel.`;
    if (brand) return `Annonces ${brand} en Algérie · ${fmt} listings de vendeurs algériens. Filtrez par catégorie, prix ou vendeur. Prix en DZD.`;
    if (category) return `Découvrez ${fmt} annonces de ${category.toLowerCase()} en Algérie. Filtrez par marque, prix ou vendeur. Annonces actualisées en temps réel, prix en DZD.`;
    return null;
  })();
  const en = (() => {
    if (q) return `${fmt} listings matching “${q}” from Algerian sellers, refreshed continuously. Prices in DZD.`;
    if (sellerName) return `All ${fmt} listings from ${sellerName}, refreshed continuously.`;
    if (brand) return `Browse ${fmt} ${brand} listings from Algerian sellers, priced in DZD.`;
    if (category) return `Browse ${fmt} ${category.toLowerCase()} listings from Algerian sellers, priced in DZD.`;
    return null;
  })();
  if (!fr && !en) return null;
  return (
    <div className="-mt-3 mb-5 text-sm text-ink-soft leading-relaxed max-w-3xl">
      {isFr ? (
        <p lang="fr">{fr}</p>
      ) : (
        <p>{en}</p>
      )}
    </div>
  );
}

function SearchBreadcrumbs({ label }: { label: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-ink-mute flex items-center gap-2 mb-3">
      <Link href="/" className="hover:text-ink-soft">Home</Link>
      <span aria-hidden>/</span>
      <Link href="/search" className="hover:text-ink-soft">Catalog</Link>
      <span aria-hidden>/</span>
      <span aria-current="page" className="text-ink-soft truncate max-w-[40ch]">{label}</span>
    </nav>
  );
}

function canonicalSlicePath(input: ReturnType<typeof parseSearchParams>): string {
  if (input.q) return `/search?q=${encodeURIComponent(input.q)}`;
  const sellerIds = (input.sellerId ?? []).filter(Boolean);
  if (sellerIds.length === 1) return `/search?sellerId=${encodeURIComponent(sellerIds[0])}`;
  if (input.brand) return `/search?brand=${encodeURIComponent(input.brand)}`;
  const cats = (input.category ?? []).filter(Boolean);
  if (cats.length === 1) return `/search?category=${encodeURIComponent(cats[0])}`;
  return "/search";
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
