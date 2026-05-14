// Per-seller 1200×630 OG card. Without this, /store/<id> shares fall back
// to the global brand card — same image for every seller, so a Facebook /
// X / Discord preview gives no clue which store is being shared. This
// route renders the seller's display name + city + product count.

import { ImageResponse } from "next/og";
import { getSeller } from "@/lib/api";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Boutique sur Teno Store";

export default async function OG({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seller = await getSeller(id).catch(() => null);

  // Truncate so long display names don't overflow the card. ~28 chars fits
  // at 80px in the bounding box; truncate harder for very long stores.
  const name = (seller?.displayName ?? "Boutique").slice(0, 42);
  const city = seller?.city ?? null;
  const productCount = seller?.productCount;
  const subtitle = (() => {
    const parts: string[] = [];
    if (city) parts.push(city);
    if (typeof productCount === "number" && productCount > 0) {
      parts.push(
        productCount === 1 ? "1 annonce active" : `${productCount.toLocaleString("fr-FR")} annonces actives`,
      );
    }
    if (parts.length === 0) parts.push("Vendeur algérien · prix en DZD");
    return parts.join(" · ");
  })();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "70px 90px",
          background: "linear-gradient(135deg, #0a0a0a 0%, #0f1a13 50%, #14241c 100%)",
          color: "#e5e7eb",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: "linear-gradient(135deg, #10b981, #34d399)",
                display: "block",
                boxShadow: "0 0 32px rgba(52,211,153,0.4)",
              }}
            />
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.8, color: "#ffffff" }}>
              Teno Store
            </span>
          </div>
          <span
            style={{
              fontSize: 20,
              color: "#9ca3af",
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Boutique
          </span>
        </div>

        {/* Seller name — the dominant visual element */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            fontSize: name.length > 28 ? 76 : 92,
            fontWeight: 700,
            lineHeight: 1.0,
            letterSpacing: -2,
            color: "#ffffff",
            marginTop: 28,
          }}
        >
          {name}
        </div>

        {/* Subtitle: city · product count, or generic fallback */}
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 500,
            color: "#9ca3af",
            letterSpacing: -0.3,
          }}
        >
          {subtitle}
        </div>
      </div>
    ),
    { ...size },
  );
}
