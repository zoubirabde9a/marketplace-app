// Dynamically generated 1200×630 OG/Twitter card image for each category
// landing page. When a French-locale visitor shares /c/<slug> on Facebook
// / Discord / Slack / iMessage / X, the platform fetches this route
// (linked via the og:image meta tag Next.js generates from the file-based
// convention) and uses it as the share preview — far richer than the
// 180×180 apple-icon fallback, and visually consistent with the homepage
// + product + blog OG cards.

import { ImageResponse } from "next/og";
import { humanizeCategorySlug } from "@/lib/categories";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// French alt text — first surface a French-locale buyer sees when a
// category URL is shared; also read aloud by assistive tech.
export const alt = "Catégorie Teno Store";

export default async function OG({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const categoryName = humanizeCategorySlug(slug).slice(0, 60);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "60px 80px",
          background:
            "linear-gradient(135deg, #0a0a0a 0%, #0f1a13 60%, #14241c 100%)",
          color: "#e5e7eb",
        }}
      >
        {/* Top row — brand mark left, wordmark right */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "linear-gradient(135deg, #10b981, #34d399)",
                display: "block",
                boxShadow: "0 0 30px rgba(52,211,153,0.35)",
              }}
            />
            <span
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: -0.5,
                color: "#ffffff",
              }}
            >
              Teno Store
            </span>
          </div>
          <span
            style={{
              fontSize: 20,
              color: "#9ca3af",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Marketplace
          </span>
        </div>

        {/* Category chip */}
        <div style={{ display: "flex", marginTop: 64 }}>
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "#34d399",
              padding: "8px 18px",
              borderRadius: 999,
              border: "1px solid rgba(52,211,153,0.4)",
              background: "rgba(16,185,129,0.08)",
              letterSpacing: 0.3,
            }}
          >
            Catégorie
          </span>
        </div>

        {/* Category name — main focus */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
            color: "#ffffff",
            marginTop: 24,
          }}
        >
          {categoryName}
        </div>

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            fontSize: 26,
            fontWeight: 500,
            color: "#9ca3af",
            letterSpacing: -0.3,
          }}
        >
          Annonces de vendeurs algériens · prix en DZD
        </div>
      </div>
    ),
    { ...size },
  );
}
