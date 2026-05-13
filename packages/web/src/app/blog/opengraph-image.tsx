// Dedicated 1200×630 OG card for /blog (the blog index). Without this, the
// route inherits the layout default (180×180 apple-icon), which Twitter's
// summary_large_image card and Facebook's share preview both render
// undersized. Matches the visual language of the /blog/[slug] OG cards.

import { ImageResponse } from "next/og";
import { BLOG_POSTS } from "./posts";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Blog Teno Store — guides d'achat et conseils vendeurs";

export default function OG() {
  const postCount = BLOG_POSTS.length;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "80px 100px",
          background: "linear-gradient(135deg, #0a0a0a 0%, #0f1a13 50%, #14241c 100%)",
          color: "#e5e7eb",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
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
          <span
            style={{
              fontSize: 22,
              color: "#9ca3af",
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Blog · {postCount} articles
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            fontSize: 96,
            fontWeight: 700,
            lineHeight: 1.0,
            letterSpacing: -2.5,
            color: "#ffffff",
            marginTop: 32,
          }}
        >
          Blog Teno Store
        </div>

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            fontSize: 30,
            fontWeight: 500,
            color: "#9ca3af",
            letterSpacing: -0.5,
            lineHeight: 1.3,
          }}
        >
          Guides d&apos;achat et conseils vendeurs · marketplace algérien · prix en DZD
        </div>
      </div>
    ),
    { ...size },
  );
}
