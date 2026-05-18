import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { searchProducts } from "@/lib/api";
import { searchProductsCached } from "@/lib/searchCache";
import { parseSearchParams } from "@/lib/url";
import { ActiveFilters } from "@/components/ActiveFilters";
// (ProductGridSkeleton removed with the Suspense boundary below — see comment.)
import { EmptyState } from "@/components/EmptyState";
import { InfiniteResults } from "@/components/InfiniteResults";
import { jsonLdString } from "@/lib/jsonld";
import { upscaleOuedknissForCrawler } from "@/lib/images";
import { humanizeCategorySlug, resolveCategorySlugs } from "@/lib/categories";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

// FR_CATEGORY + humanizeCategorySlug moved to @/lib/categories so the
// product page can use the same map for its JSON-LD `category` field.

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
  // Tracking / attribution params don't change the page content — they're
  // attached by ad networks, share platforms, and analytics tools (utm_*,
  // fbclid, gclid, msclkid, yclid, etc.). Without stripping these from the
  // canonical-selection logic, a real category URL like
  //   /search?category=telephones&utm_source=facebook
  // would canonicalize to bare /search (losing the category landing context)
  // because definedKeys.length === 2 fails the single-key check below.
  // Strip them up front so the user-visible content key (q/brand/category/
  // sellerId) drives canonical and indexability decisions.
  const TRACKING_PREFIXES = ["utm_"];
  const TRACKING_KEYS = new Set([
    "fbclid", "gclid", "msclkid", "yclid", "dclid", "ttclid",
    "twclid", "li_fat_id", "_hsenc", "_hsmi", "mc_eid", "mkt_tok",
    "ref", "ref_src", "ref_url", "source", "via",
  ]);
  const isTrackingKey = (k: string): boolean => {
    if (TRACKING_KEYS.has(k)) return true;
    for (const pfx of TRACKING_PREFIXES) if (k.startsWith(pfx)) return true;
    return false;
  };
  const definedKeys = Object.keys(sp).filter((k) => sp[k] !== undefined && !isTrackingKey(k));
  // Canonicalize. q-only, brand-only, single-seller, and single-category
  // slices are worth indexing as their own pages; everything else (cursor,
  // price ranges, ratings, multi-filter combinations) collapses back to the
  // bare /search canonical.
  const canonical = q
    ? `/search?q=${encodeURIComponent(q)}`
    : brand && definedKeys.length === 1
      ? `/search?brand=${encodeURIComponent(brand)}`
      : sellerId && definedKeys.length === 1
        // Single-seller view: point canonical at the dedicated /store/{id}
        // storefront route. Both URLs render the same seller's products
        // (commit d62bd2f added /store/[id] as the prettier canonical
        // seller URL); self-canonicalising /search?sellerId=... would
        // tell Google there are two indexable URLs for the same content
        // and split link equity between them. Let /search?sellerId=
        // canonical at /store/{id} so PageRank consolidates.
        ? `/store/${encodeURIComponent(sellerId)}`
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
      // searchProductsCached: this fetch fires on EVERY slice render to
      // enrich the count-bearing meta description (iter-17). With many
      // crawlers sharing the same handful of slice queries, a 5-min cache
      // converts thousands of identical hits into one. Mitigation for the
      // iter-29 API overload incident.
      const r = await searchProductsCached({
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
  // English noun pluralisation hook so we don't ship "1 listings matching ..."
  // — broken grammar reads as low-quality content to search-engine quality
  // signals AND to the human readers of SERP snippets. French side is
  // covered in SliceIntro/below.
  // French pluralization for the noun used in meta descriptions.
  // Was "listing"/"listings" (English) — left over from a pre-iter-25
  // pass and threaded into the French-language sentence templates below,
  // producing mixed-language SERP snippets like "200 listings
  // correspondant à « iphone »…" on the /search?q= page.
  const listingWord = totalCount === 1 ? "annonce" : "annonces";

  let title: string;
  let description: string;
  if (q) {
    // iter-25: French primary on a `<html lang="fr">` page — `Recherche : `
    // (non-breaking-space before colon is French typography) instead of
    // English `Search: `. These pages are noindex'd but the title still
    // shows in browser tabs, OG share previews on Facebook/Discord/X,
    // and Bing's Webmaster Tools listing — all of which were leaking
    // English copy on what's otherwise a French-locale site.
    title = `Recherche : ${q}`;
    description = fmtCount
      ? `${fmtCount} ${listingWord} correspondant à « ${q} » sur Teno Store — téléphones, informatique et plus de vendeurs algériens, prix en dinars (DZD).`
      : `Résultats du marketplace correspondant à « ${q} » sur Teno Store.`;
  } else if (brand) {
    // Brand title is just "{brand}" — the layout template appends " · Teno
    // Store" so "{brand} products" would duplicate the brand context.
    // Description in French to match the lang=fr document and the
    // overwhelmingly-French catalog content (Ouedkniss listings).
    title = brand;
    const frAnnonceBrand = totalCount === 1 ? "annonce" : "annonces";
    description = fmtCount
      ? `${fmtCount} ${frAnnonceBrand} ${brand} de vendeurs algériens sur Teno Store. Filtrez par catégorie, prix ou vendeur. Prix en dinars (DZD).`
      : `Annonces ${brand} de vendeurs algériens sur Teno Store. Prix en DZD.`;
  } else if (category && !isMultiValuedCategory) {
    const human = humanizeCategorySlug(category);
    title = human;
    // Description in pure French — matches the document's primary language
    // and the catalog's source language. The 'annonces' / 'vendeurs algériens'
    // / 'prix en DZD' phrasing reinforces the locale signal in SERP snippets.
    // French plural agreement: "1 annonces" reads as a low-quality
    // machine-translated string both to humans and to language classifiers.
    // Singular: "1 annonce ... actualisée en temps réel".
    const frAnnonce = totalCount === 1 ? "annonce" : "annonces";
    const frActualisee = totalCount === 1 ? "actualisée" : "actualisées";
    description = fmtCount
      ? `${fmtCount} ${frAnnonce} ${human.toLowerCase()} de vendeurs algériens sur Teno Store, ${frActualisee} en temps réel. Filtrez par marque, prix ou vendeur. Prix en dinars (DZD).`
      : `Annonces ${human.toLowerCase()} de vendeurs algériens sur Teno Store. Prix en DZD.`;
  } else if (sellerId && !isMultiValuedSeller) {
    // Same suffix-duplication concern as the category branch — layout
    // appends " · Teno Store", so "{Seller} on Teno Store" would render
    // as "{Seller} on Teno Store · Teno Store".
    // Seller-slice description in French to match lang=fr + the seller's
    // own catalog content (Algerian seller storefronts on the platform are
    // exclusively French / Arabic). "Toutes les X annonces de {seller}"
    // matches the catalog's actual voice.
    title = sellerName ?? "Boutique";
    const frAnnonceSeller = totalCount === 1 ? "annonce" : "annonces";
    description = fmtCount
      ? sellerName
        ? `Toutes les ${fmtCount} ${frAnnonceSeller} de ${sellerName} sur Teno Store, actualisées en continu.`
        : `Toutes les ${fmtCount} ${frAnnonceSeller} de ce vendeur sur Teno Store, actualisées en continu.`
      : sellerName
        ? `Annonces de ${sellerName} sur Teno Store.`
        : "Annonces de ce vendeur sur Teno Store.";
  } else {
    // /search root — French to match lang=fr root + the catalog content
    // language. ~150 chars for Google SERP; the lede leads with the
    // Algerian-marketplace positioning (the actual ranking-relevant
    // signal) and lists the same top categories as the home topical
    // block so the meta description reinforces them.
    title = "Parcourir le marketplace";
    description =
      "Parcourez des milliers d'annonces — téléphones, informatique, électroménager, mode et véhicules de vendeurs algériens, prix en dinars (DZD).";
  }

  return {
    title,
    description,
    alternates: {
      canonical,
      // Re-declare hreflang — Next.js replaces layout-level alternates
      // wholesale on child pages. Anchor at canonical (single source per
      // slice; multi-filter combinations canonical back to bare /search).
      languages: {
        "fr-DZ": `${SITE_URL}${canonical}`,
        "ar-DZ": `${SITE_URL}${canonical}`,
        "x-default": `${SITE_URL}${canonical}`,
      },
    },
    robots:
      // Noindex when the slice has zero results. Without this, anyone can
      // construct /search?q=<garbage> or /search?brand=<typo> and we
      // declare that empty page indexable — Google flags those as
      // soft-404s and they pollute the index. totalCount === 0 is the
      // signal we got back from the API; null (fetch failed) keeps the
      // current behaviour so a transient outage doesn't deindex a
      // legitimate slice.
      // Free-text /search?q=... is noindex. Open-ended internal search results
      // are exactly the surface Google's thin/duplicate-content heuristics
      // target (Search Quality Guidelines § "low-value pages" explicitly
      // calls out "search results pages from another search engine"). Three
      // concrete risks of indexing them:
      //   1. Spam injection: anyone can link /search?q=<spammy text> and
      //      Google will crawl and index that variant under our domain —
      //      one viral spam link can drag the whole site's quality score.
      //   2. Duplicate content: /search?q=samsung returns the same products
      //      as /search?brand=Samsung (the indexable canonical brand
      //      landing), so we'd be competing against ourselves for the same
      //      query.
      //   3. Infinite URL space: every typo, synonym, language variant
      //      becomes a discoverable thin page; crawl budget bleeds into
      //      noise.
      // Brand/category/seller landings stay indexable because they have a
      // finite, curated URL space. follow=true so internal links from the
      // results still pass equity to product pages.
      // Thin brand / seller landings: mirror the sitemap min-count floor
      // (sitemap.ts MIN_FACET_COUNT=5). Even after dropping noisy brand
      // entries from the sitemap, Google can still discover thin brand
      // URLs via internal links (CategoryFooter chips, filter UI). A
      // /search?brand=Acme page with 1 listing reads as soft-404 thin
      // content. Categories stay indexable at any count (closed taxonomy,
      // each slug has prose intro + structured data even with one item).
      hasNonIndexableParam ||
      isMultiFilter ||
      isMultiValuedSeller ||
      isMultiValuedCategory ||
      totalCount === 0 ||
      ((Boolean(brand) || (Boolean(sellerId) && !isMultiValuedSeller)) &&
        totalCount !== null &&
        totalCount < 5) ||
      Boolean(q)
        ? { index: false, follow: true }
        : {
            // Indexable path — keep the layout-level rich-result hints
            // (max-image-preview:large, max-snippet:-1, max-video-preview:-1).
            // Next.js wholesale-replaces `robots` on child pages, so without
            // re-declaring these the SERP/AI-Overviews preview for indexable
            // /search slices falls back to small thumbnails + ~155-char
            // snippets, while every other indexable page on the site gets
            // large-image + unlimited-snippet previews. Same wholesale-
            // replace bug class as the openGraph / alternates.languages
            // fixes earlier in this session.
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
    // Also override openGraph and twitter so social-share scrapers
    // (FB/Discord/Slack/X) render the slice-specific title and description
    // instead of inheriting the layout default ("Teno Store — the agent-to-
    // agent marketplace" / "Watch your AI agent..."). Layout's openGraph
    // type/locale/siteName still apply via merge.
    // siteName has to be repeated here — Next.js's openGraph merge replaces
    // child fields entirely instead of merging into the layout default,
    // so without this every /search share loses the "Teno Store" brand
    // context that the home and product pages carry.
    // Next.js metadata REPLACES openGraph wholesale on child pages (no
    // shallow-merge of nested fields). Re-declare locale + alternateLocale
    // here or Facebook share previews on slice landings get no regional
    // signal. siteName redeclared for the same reason — without it,
    // FB share cards on /search?... drop the 'Teno Store' brand context.
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      siteName: "Teno Store",
      locale: "fr_DZ",
      alternateLocale: ["ar_DZ", "en_US"],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const input = parseSearchParams(sp);

  // Single-seller view canonicals at /store/{id} (commits efb4f54 + 80d55de
  // consolidated the duplicate URL pair). 308-redirect here so:
  //   - Browser URL bar updates to /store/{id} on every visit (cleaner UX
  //     for users who share the link from their address bar afterward)
  //   - Old indexed /search?sellerId=... URLs hard-migrate instead of
  //     relying on Google to follow the canonical hint
  //   - Crawlers / link-checkers that don't honor <link rel="canonical">
  //     still arrive at the right URL.
  // Strict filter: ONLY redirect when sellerId is the sole content key
  // (matches the existing canonical-eligibility branch). Multi-filter
  // combinations stay on /search (they're noindex anyway).
  const sellerIds = (input.sellerId ?? []).filter(Boolean);
  if (sellerIds.length === 1) {
    const otherKeys = Object.keys(sp).filter(
      (k) => k !== "sellerId" && sp[k] !== undefined,
    );
    if (otherKeys.length === 0) {
      // permanentRedirect → 308 (permanent). redirect() defaults to 307
      // (temporary) which Google treats as 'do not consolidate'; we want
      // the full canonical-migration signal.
      permanentRedirect(`/store/${encodeURIComponent(sellerIds[0])}`);
    }
  }

  // No Suspense boundary here. With the API on the same docker network the
  // search fetch lands in ~50 ms and React's streaming SSR otherwise flushes
  // the layout footer (CategoryFooter chips) BEFORE the resolved main content,
  // because the footer is synchronous and Results is async. Crawlers read
  // the response top-down: with the boundary, footer chips landed ~17 KB
  // earlier in the byte stream than the H1 and product list, dragging
  // snippet selection toward footer text. Awaiting Results inline preserves
  // source order for negligible TTFB cost.
  return (
    <div className="pt-4 sm:pt-8">
      <Results input={input} sp={sp} />
    </div>
  );
}

async function Results({ input, sp }: { input: ReturnType<typeof parseSearchParams>; sp: SP }) {
  let result;
  let error: string | null = null;
  try {
    // Resolve editorial alias slugs (e.g. "mode" → ["vetements_mode"]) to
    // the underlying compound API category set before the fetch. Users who
    // land on /search?category=mode (typed URL, stale external link, or
    // the /c/<alias> CTA) get matching products instead of an empty grid.
    // input.category is left untouched so canonical URLs, breadcrumbs, and
    // singleCategory display keep the alias slug the user actually navigated to.
    const apiCategory = input.category?.flatMap(resolveCategorySlugs);
    result = await searchProducts(
      apiCategory ? { ...input, category: apiCategory } : input,
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error || !result) {
    return (
      <div>
        <ResultsHeader q={input.q} total={0} />
        <ApiErrorBanner message={error ?? "fetch_failed"} />
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
    if (hit.sellerId && hit.sellerDisplayName && !sellerDisplayNames[hit.sellerId]) {
      sellerDisplayNames[hit.sellerId] = hit.sellerDisplayName;
    }
  }

  // Match feed.xml + product/[id]/page.tsx MIN_REAL_PRICE_MINOR. Returns
  // undefined for priceMinor < 100 DZD (10000 santeem) so Ouedkniss
  // 'Prix sur demande' placeholders ('1 DA', '4 DA', '0 DA') don't leak
  // into the ItemList JSON-LD as fake Offers.
  const minorToMajor = (minor: string | undefined) => {
    if (!minor) return undefined;
    const n = Number(minor);
    if (!Number.isFinite(n) || n < 10000) return undefined;
    return (n / 100).toFixed(2);
  };
  const itemListSellerName = (() => {
    const ids = (input.sellerId ?? []).filter(Boolean);
    if (ids.length !== 1) return undefined;
    return sellerDisplayNames[ids[0]];
  })();
  const singleCategory = (input.category ?? []).length === 1 ? input.category![0] : undefined;
  const humanCategory = singleCategory
    ? humanizeCategorySlug(singleCategory)
    : undefined;
  // ItemList name surfaces in Google rich-result graphs + AI-search panels.
  // Keep parallel with the page's <title> + <h1> French phrasing so the
  // structured-data layer matches the user-facing text.
  const itemListName = input.q
    ? `Recherche marketplace : ${input.q}`
    : itemListSellerName
      ? `Annonces de ${itemListSellerName}`
      : input.brand
        ? `Annonces ${input.brand}`
        : humanCategory
          ? `${humanCategory} sur Teno Store`
          : "Catalogue marketplace";
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
      if (hit.heroImageUrl) product.image = [upscaleOuedknissForCrawler(hit.heroImageUrl)];
      if (hit.brand) product.brand = { "@type": "Brand", name: hit.brand };
      const availability = hit.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
      const seller = hit.sellerId && hit.sellerDisplayName
        ? {
            "@type": "Organization",
            name: hit.sellerDisplayName,
            identifier: hit.sellerId,
            url: `${SITE_URL}/store/${encodeURIComponent(hit.sellerId)}`,
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
  // CollectionPage description feeds Google's structured-data graph
  // alongside the SERP meta description. Keep French to match the rest of
  // the slice metadata + on-page text (lang=fr document, French body).
  const collTotal = result.pagination.totalEstimate;
  const collFmtCount = collTotal != null ? collTotal.toLocaleString() : null;
  const collAnnonce = collTotal === 1 ? "annonce" : "annonces";
  const collectionDescription = input.q
    ? collFmtCount
      ? `${collFmtCount} ${collAnnonce} correspondant à « ${input.q} » sur Teno Store, de vendeurs algériens. Prix en dinars (DZD).`
      : `Résultats marketplace pour « ${input.q} » sur Teno Store.`
    : itemListSellerName
      ? collFmtCount
        ? `Toutes les ${collFmtCount} ${collAnnonce} de ${itemListSellerName} sur Teno Store.`
        : `Annonces de ${itemListSellerName} sur Teno Store.`
      : input.brand
        ? collFmtCount
          ? `${collFmtCount} ${collAnnonce} ${input.brand} de vendeurs algériens sur Teno Store. Prix en dinars (DZD).`
          : `Annonces ${input.brand} sur Teno Store.`
        : humanCategory
          ? collFmtCount
            ? `${collFmtCount} ${collAnnonce} ${humanCategory.toLowerCase()} de vendeurs algériens sur Teno Store. Prix en dinars (DZD).`
            : `Annonces ${humanCategory.toLowerCase()} sur Teno Store.`
          : "Catalogue Teno Store — annonces de vendeurs algériens en dinars (DZD).";
  const collectionPageJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": collectionUrl,
    url: collectionUrl,
    name: collectionName,
    description: collectionDescription,
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website` },
    // Cross-link to canonical Organization (iter-64) so AI panels see the
    // CollectionPage as published BY Teno Store rather than as an
    // anonymous list page. Mirrors the same field on /c/[slug] and /blog.
    publisher: { "@id": `${SITE_URL}/#organization` },
    mainEntity: itemListJsonLd,
  };
  if (contentLang) collectionPageJsonLd.inLanguage = contentLang;
  // CollectionPage `about` clarifies the entity the page is "about". For
  // seller / brand / category landings this is what Google's
  // entity-graph wants to see — a typed reference distinct from the
  // ItemList of products. Without it the page is structurally an
  // anonymous list-of-products; with it Google can wire the page back
  // to the Organization / Brand / Thing it represents.
  if (input.q) {
    collectionPageJsonLd.about = { "@type": "Thing", name: input.q };
  } else if (itemListSellerName) {
    const sellerIds = (input.sellerId ?? []).filter(Boolean);
    collectionPageJsonLd.about = {
      "@type": "Organization",
      name: itemListSellerName,
      identifier: sellerIds[0],
      url: collectionUrl,
      areaServed: { "@type": "Country", name: "Algeria" },
    };
  } else if (input.brand) {
    // Brand object matches the shape product pages emit (`@type: Brand`,
    // `@id: SITE_URL/search?brand=<name>`, `url`). Cross-page @id makes
    // KG bots resolve the Brand on /search?brand=Samsung and the Brand
    // node on every Samsung product page as the SAME entity rather than
    // two independent same-named brands. iter-64 entity-graph fix.
    const brandUrl = `${SITE_URL}/search?brand=${encodeURIComponent(input.brand)}`;
    collectionPageJsonLd.about = {
      "@type": "Brand",
      "@id": brandUrl,
      name: input.brand,
      url: brandUrl,
    };
  } else if (humanCategory) {
    collectionPageJsonLd.about = {
      "@type": "ProductGroup",
      name: humanCategory,
      productGroupID: input.category?.[0],
    };
  }

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
          { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Catalogue", item: `${SITE_URL}/search` },
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
      {sliceLabel ? (
        <SliceIntro
          total={result.pagination.totalEstimate}
          sellerName={itemListSellerName}
          brand={input.brand}
          category={humanCategory}
          q={input.q}
          contentLang={contentLang}
        />
      ) : (
        // Bare /search: there's no slice to describe, but it's still our
        // catalog hub URL. Surface a bilingual intro mirroring the home
        // page's topical block — without it the page below the H1 is just
        // "X matches · showing 25" and a product grid, with no prose for
        // search engines or AI summarisers to anchor on.
        <BareCatalogIntro total={result.pagination.totalEstimate} contentLang={contentLang} />
      )}
      <ActiveFilters sp={sp} sellerDisplayNames={sellerDisplayNames} />
      {result.data.length === 0 ? (
        // Site default locale is fr_DZ (see og:locale on the layout); the
        // search empty-state can't infer contentLang from the result rows
        // because there are none, so default to French. English-speaking
        // visitors hit this rarely (most live catalog is French DZD
        // listings) and it preserves locale consistency with the rest of
        // the chrome (header, footer, category names).
        Object.keys(input).length === 0 ? (
          <EmptyState
            title="Catalogue vide"
            hint="Aucune annonce pour le moment. Si vous êtes vendeur, vous pouvez être le premier."
            showSellCta
          />
        ) : (
          <EmptyState
            title="Aucun produit trouvé"
            hint="Essayez une requête plus large, activez la recherche approximative, ou retirez un filtre ci-dessus."
            q={input.q}
            hasFilters
            fuzzyAlreadyOn={input.fuzzy}
          />
        )
      ) : (
        (() => {
          // Drop `cursor` from the inherited params — the client component
          // appends its own as it walks forward through pages. Also used as
          // a remount key so a new query resets the infinite-scroll state
          // (useState initializers only run on mount; without the key, a
          // fresh /search?q=… navigation would keep the previous query's
          // hits and cursor).
          const q = new URLSearchParams(params.toString());
          q.delete("cursor");
          const baseQuery = q.toString();
          return (
            <InfiniteResults
              key={baseQuery}
              initialHits={result.data}
              initialCursor={result.pagination.cursor}
              baseQuery={baseQuery}
            />
          );
        })()
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
          <>Résultats pour <span className="text-accent">«&nbsp;{q}&nbsp;»</span></>
        ) : sellerName ? (
          <>Annonces de <span className="text-accent">{sellerName}</span></>
        ) : brand ? (
          <>Annonces <span className="text-accent">{brand}</span></>
        ) : category ? (
          <><span className="text-accent">{category}</span> sur Teno Store</>
        ) : (
          "Parcourir le catalogue"
        )}
      </h1>
      <p className="text-sm text-ink-soft mt-1">
        {total === 1
          ? "1 résultat"
          : `${total.toLocaleString()} résultats`}
        {resultCount != null && total > resultCount ? ` · ${resultCount} affichés` : ""}
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
  // Pluralisation: "1 listings matching" reads broken in SERP snippets.
  // French uses singular nouns at 0 and 1 (annonce/produit/listing),
  // plural otherwise.
  const isOne = total === 1;
  const enListing = isOne ? "listing" : "listings";
  const frAnnonce = isOne ? "annonce" : "annonces";
  const frProduit = isOne ? "produit" : "produits";
  // Bilingual: lead with the audience-matching language, follow with a
  // shorter English sentence so search engines that don't honor the
  // <div lang> wrap still see English keywords.
  const fr = (() => {
    if (q) return `${isOne ? "1 annonce correspondant" : `Plus de ${fmt} annonces correspondant`} à « ${q} » en provenance de vendeurs algériens. Prix en DZD, mises à jour en continu.`;
    if (sellerName) return `Toutes les ${frAnnonce} de ${sellerName}. ${fmt} ${frProduit}, prix en DZD, actualisés en temps réel.`;
    if (brand) return `Annonces ${brand} en Algérie · ${fmt} ${frAnnonce} de vendeurs algériens. Filtrez par catégorie, prix ou vendeur. Prix en DZD.`;
    if (category) return `Découvrez ${fmt} ${frAnnonce} de ${category.toLowerCase()} en Algérie. Filtrez par marque, prix ou vendeur. ${isOne ? "Annonce actualisée" : "Annonces actualisées"} en temps réel, prix en DZD.`;
    return null;
  })();
  const en = (() => {
    if (q) return `${fmt} ${enListing} matching “${q}” from Algerian sellers, refreshed continuously. Prices in DZD.`;
    if (sellerName) return `All ${fmt} ${enListing} from ${sellerName}, refreshed continuously.`;
    if (brand) return `Browse ${fmt} ${brand} ${enListing} from Algerian sellers, priced in DZD.`;
    if (category) return `Browse ${fmt} ${category.toLowerCase()} ${enListing} from Algerian sellers, priced in DZD.`;
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

function BareCatalogIntro({ total, contentLang }: { total: number; contentLang?: string }) {
  const fmt = total.toLocaleString();
  const isOne = total === 1;
  const enListing = isOne ? "listing" : "listings";
  const frAnnonce = isOne ? "annonce" : "annonces";
  const frActualisee = isOne ? "actualisée" : "actualisées";
  return (
    <div className="-mt-3 mb-5 text-sm text-ink-soft leading-relaxed max-w-3xl">
      {contentLang === "fr" ? (
        <p lang="fr">
          Découvrez {fmt} {frAnnonce} de vendeurs algériens — téléphones, informatique,
          électroménager, mode, véhicules et plus. Filtrez par marque, prix, vendeur
          ou catégorie. Prix en DZD, {frAnnonce} {frActualisee} en temps réel.
        </p>
      ) : (
        <p>
          Browse {fmt} live {enListing} from Algerian sellers — phones, computing,
          home appliances, fashion, vehicles and more. Filter by brand, price,
          seller, or category. Prices in DZD, refreshed continuously.
        </p>
      )}
    </div>
  );
}

function SearchBreadcrumbs({ label }: { label: string }) {
  return (
    <nav aria-label="Fil d'Ariane" className="text-xs text-ink-mute flex items-center gap-x-2 gap-y-0 flex-wrap mb-3">
      <Link href="/" className="py-1 hover:text-ink-soft active:text-ink-soft">Accueil</Link>
      <span aria-hidden>/</span>
      <Link href="/search" className="py-1 hover:text-ink-soft active:text-ink-soft">Catalogue</Link>
      <span aria-hidden>/</span>
      <span aria-current="page" className="py-1 text-ink-soft truncate max-w-[40ch]">{label}</span>
    </nav>
  );
}

function canonicalSlicePath(input: ReturnType<typeof parseSearchParams>): string {
  if (input.q) return `/search?q=${encodeURIComponent(input.q)}`;
  const sellerIds = (input.sellerId ?? []).filter(Boolean);
  // Single-seller view canonicals at /store/{id} (commit d62bd2f added the
  // dedicated storefront URL; previous /search?sellerId=... is now a
  // redirect-via-canonical to consolidate PageRank).
  if (sellerIds.length === 1) return `/store/${encodeURIComponent(sellerIds[0])}`;
  if (input.brand) return `/search?brand=${encodeURIComponent(input.brand)}`;
  const cats = (input.category ?? []).filter(Boolean);
  if (cats.length === 1) return `/search?category=${encodeURIComponent(cats[0])}`;
  return "/search";
}

// User-facing fallback when the catalog API is unreachable. Previous copy
// ("Marketplace API unreachable / Check that MARKETPLACE_API_URL is set")
// was developer text that landed on the buyer-facing /search page during
// outages — caught 2026-05-12. Server log gets the technical `message`;
// the rendered surface stays buyer-friendly French.
function ApiErrorBanner({ message }: { message: string }) {
  if (typeof console !== "undefined") {
    console.error("[search] api_error", message);
  }
  return (
    <div className="rounded-xl border border-bad/30 bg-bad/10 px-5 py-4" lang="fr">
      <div className="text-bad font-medium text-sm">Catalogue momentanément indisponible</div>
      <div className="text-xs text-ink-soft mt-1">
        Le service est temporairement injoignable. Réessayez dans un instant — nos vendeurs sont toujours là.
      </div>
    </div>
  );
}

// /search reads only URL search params — no cookies, no per-user state — so
// the page is safe to ISR-cache per URL combination. Previously force-dynamic,
// which made every Googlebot / Bingbot hit on the high-value slice landings
// (?category=, ?brand=, ?sellerId=, ?q=) pay full SSR on origin even though
// the rendered output is identical for every anonymous visitor with the same
// URL. With revalidate=60 the page is cached at Next's render layer for 60s
// per param combination; the anonymous-cache middleware (s-maxage=300 + 30min
// swr) then sits on top so the bulk of crawler traffic is served from
// Cloudflare's edge in MENA. Cookie-bearing requests bypass the edge cache
// via the existing Vary: Cookie / middleware gate.
export const revalidate = 60;
