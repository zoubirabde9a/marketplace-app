import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Teno Store",
    short_name: "Teno",
    description:
      "Teno Store — Algerian marketplace with thousands of live listings (phones, computing, home appliances, fashion, vehicles) priced in DZD, refreshed continuously. Also an agent-to-agent marketplace via MCP/A2A/AP2.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["shopping"],
    lang: "en",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
