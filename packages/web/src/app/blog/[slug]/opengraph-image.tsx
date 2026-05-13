// Dynamically generated 1200×630 OG/Twitter card image for each blog post.
// When a French-locale reader shares /blog/<slug> on Facebook / Discord /
// Slack / iMessage / X, the platform fetches this route (linked via the
// og:image meta tag Next.js generates from the file-based convention) and
// uses it as the share preview — much richer than the 180×180 apple-icon
// fallback, and matches the visual language of the homepage + product
// OG cards (green gradient, brand mark top-right).

import { ImageResponse } from "next/og";
import { getPostBySlug } from "../posts";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// French alt text — the OG image is the first surface a French-locale
// reader sees when a blog post URL is shared, and assistive tech reads
// this aloud.
export const alt = "Article Teno Store";

export default async function OG({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    // Generic blog card fallback when slug is unknown.
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            padding: "80px 100px",
            background:
              "linear-gradient(135deg, #0a0a0a 0%, #0f1a13 50%, #14241c 100%)",
            color: "#e5e7eb",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: "linear-gradient(135deg, #10b981, #34d399)",
                display: "block",
                boxShadow: "0 0 40px rgba(52,211,153,0.4)",
              }}
            />
            <span
              style={{
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: -1,
                color: "#ffffff",
              }}
            >
              Teno Store
            </span>
          </div>
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
              marginTop: 48,
            }}
          >
            Blog Teno Store
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 500,
              color: "#9ca3af",
              letterSpacing: -0.5,
            }}
          >
            Conseils et guides pour acheter et vendre en Algérie
          </div>
        </div>
      ),
      { ...size },
    );
  }

  const title = post.title.slice(0, 110);
  const description = post.description.slice(0, 160);
  const category = post.category.slice(0, 40);

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
        {/* Top row — brand mark left, Teno Store wordmark right */}
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
            Blog
          </span>
        </div>

        {/* Category chip */}
        <div style={{ display: "flex", marginTop: 56 }}>
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
            {category}
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            display: "flex",
            fontSize: 60,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            color: "#ffffff",
            marginTop: 28,
          }}
        >
          {title}
        </div>

        {/* Description */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "flex-end",
            fontSize: 26,
            fontWeight: 400,
            lineHeight: 1.35,
            color: "#9ca3af",
            letterSpacing: -0.3,
            marginTop: 24,
          }}
        >
          {description}
        </div>
      </div>
    ),
    { ...size },
  );
}
