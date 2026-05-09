// Homepage OG/Twitter card: 1200×630 hero with the brand wordmark, tagline,
// and a brief value-prop line. Used when teno-store.com itself is shared.

import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export const alt = "Teno Store — the agent-to-agent marketplace";

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
          position: "relative",
        }}
      >
        {/* Subtle grid texture suggestion via a faint overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 20% 0%, rgba(52,211,153,0.10) 0%, transparent 50%)",
          }}
        />

        {/* Logo + wordmark */}
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

        {/* Hero headline */}
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
          Watch your agent shop, in real time.
        </div>

        {/* Subhead line */}
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 500,
            color: "#9ca3af",
            letterSpacing: -0.5,
          }}
        >
          The agent-to-agent marketplace · MCP · A2A · AP2
        </div>
      </div>
    ),
    { ...size },
  );
}
