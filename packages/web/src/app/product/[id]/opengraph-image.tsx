// Dynamically generated 1200×630 OG/Twitter card image for each product.
// Triggers when a customer shares the product URL on Facebook, X, LinkedIn,
// Slack, iMessage, etc. — the platform fetches /product/<id>/opengraph-image
// (via the og:image meta tag Next.js generates for this convention) and uses
// it as the share preview. Far better than the apple-icon fallback when the
// seller hasn't supplied a hero image.

import { ImageResponse } from "next/og";
import { getProduct } from "@/lib/api";
import { cleanProductTitle, formatPrice, formatPriceRange } from "@/lib/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// French alt text — the OG image is the first thing a French-locale buyer
// sees when this URL is shared on Facebook / Discord / Slack / iMessage,
// and accessibility tools read this alt aloud.
export const alt = "Annonce Teno Store";

export default async function OG({ params }: { params: { id: string } }) {
  const p = await getProduct(params.id).catch(() => null);
  if (!p) {
    // Fall back to the brand mark if the product can't be loaded.
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #0a0a0a, #18221b)",
            color: "#34d399",
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -4,
          }}
        >
          Teno Store
        </div>
      ),
      { ...size },
    );
  }

  const variants = [...p.variants].sort((a, b) => Number(a.priceMinor) - Number(b.priceMinor));
  const minPrice = variants[0]?.priceMinor;
  const maxPrice = variants[variants.length - 1]?.priceMinor;
  // DZD is the marketplace default — 100% of live listings price in dinars.
  // The previous USD fallback would have rendered `$0.00` style strings on
  // any variantless edge case, which is exactly the social-share preview a
  // French buyer DOESN'T want to see.
  const currency = variants[0]?.currency ?? "DZD";
  const priceLabel =
    variants.length > 1
      ? formatPriceRange(minPrice ?? null, maxPrice ?? null, currency)
      : formatPrice(minPrice ?? null, currency);

  // Truncate long titles to fit the card; ImageResponse can wrap text but
  // keeping a hard ceiling keeps the layout predictable. Run through the
  // cleanProductTitle helper first so brand-duplicated scraped titles
  // ("Samsung Samsung a31" / "Iphone11 Iphone11") don't leak into the
  // share-card image — that's the first thing a Facebook/Twitter visitor
  // sees and the most expensive surface to fix once it's cached.
  const title = cleanProductTitle(p.title.value).slice(0, 80);
  const brand = p.brand?.slice(0, 24);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "60px 80px",
          background: "linear-gradient(135deg, #0a0a0a 0%, #0f1a13 60%, #14241c 100%)",
          color: "#e5e7eb",
        }}
      >
        {/* Top row — brand + Teno Store wordmark */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            color: "#9ca3af",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          <span>{brand ?? "Teno Store"}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "linear-gradient(135deg, #10b981, #34d399)",
                display: "block",
              }}
            />
            <span style={{ fontWeight: 600, color: "#e5e7eb" }}>Teno Store</span>
          </span>
        </div>

        {/* Title — main visual focus */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            color: "#ffffff",
            marginTop: 40,
          }}
        >
          {title}
        </div>

        {/* Bottom row — price */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 16,
            fontSize: 48,
            fontWeight: 700,
            color: "#34d399",
            letterSpacing: -0.5,
          }}
        >
          {priceLabel}
        </div>
      </div>
    ),
    { ...size },
  );
}
