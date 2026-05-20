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
    //
    // ENCODING NOTE: use Unicode escapes (\uXXXX) rather than literal
    // multi-byte UTF-8 characters in this string. Earlier the source had
    // literal em-dash and accented letters, and the live
    // /manifest.webmanifest response shipped double-encoded mojibake -
    // bytes c3 a2 e2 82 ac e2 80 9d for the em-dash instead of the
    // correct e2 80 94. The file on disk was valid UTF-8, but Next.js's
    // metadata-route serializer read those bytes as Latin-1 / cp1252
    // then re-encoded as UTF-8 (classic double-encode). Escapes sidestep
    // the question by carrying only ASCII bytes through the build;
    // V8 decodes the \uXXXX sequences directly to the correct codepoints
    // regardless of how the file's bytes are read. Keep every non-ASCII
    // character in this file as an escape going forward.
    description:
      "Teno Store \u2014 marketplace alg\u00e9rien avec des milliers d'annonces de t\u00e9l\u00e9phones, informatique, \u00e9lectrom\u00e9nager, mode et v\u00e9hicules. Vendeurs alg\u00e9riens, prix en dinars (DZD), catalogue actualis\u00e9 en continu.",
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
