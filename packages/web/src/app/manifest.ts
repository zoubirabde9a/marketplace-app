import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Teno Store",
    short_name: "Teno",
    // Description and lang are French primary now, matching the
    // <html lang="fr"> root, the iter-7 home-page H1 swap, and every
    // other locale signal the site emits. Lighthouse PWA audits, browser
    // "Install app" surfaces, and the few search-engine pipelines that
    // consume the manifest were all seeing English copy on what's
    // otherwise a French-locale Algerian marketplace.
    description:
      "Teno Store — marketplace algérien avec des milliers d'annonces de téléphones, informatique, électroménager, mode et véhicules. Vendeurs algériens, prix en dinars (DZD), catalogue actualisé en continu. Aussi un marketplace agent-à-agent via MCP/A2A/AP2.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["shopping"],
    lang: "fr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
