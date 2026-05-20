// Dedicated 1200×630 OG card for /about. Without this, Facebook / X /
// Discord / LinkedIn shares of the About page render the layout's
// 180×180 apple-icon fallback (too small for summary_large_image cards).
// Matches the visual language of the other dedicated OG routes.

import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "À propos de Teno Store — marketplace algérien";

export default function OG() {
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
            <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1, color: "#ffffff" }}>
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
            À propos
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            fontSize: 88,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2.5,
            color: "#ffffff",
            marginTop: 32,
          }}
        >
          Marketplace algérien.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 500,
            color: "#9ca3af",
            letterSpacing: -0.4,
            lineHeight: 1.3,
          }}
        >
          Annonces de vendeurs algériens · prix en dinars (DZD) · catalogue actualisé en continu.
        </div>
      </div>
    ),
    { ...size },
  );
}
