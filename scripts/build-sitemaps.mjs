#!/usr/bin/env node
import { mkdir, rename, writeFile, readdir, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { argv, env, exit } from "node:process";
import postgres from "postgres";

const SITE_URL = (env.SITE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? "https://teno-store.com").replace(/\/$/, "");
const OUT_DIR = resolve(env.SITEMAP_OUT_DIR ?? "/data/sitemaps");
const URLS_PER_FILE = Number(env.SITEMAP_URLS_PER_FILE ?? 40000);
const DATABASE_URL = env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  exit(2);
}

const HERO_PATTERN = /^(https?:\/\/cdn\d*\.ouedkniss\.com)\/\d{2,4}(\/medias\/)/;
function upscaleHero(url) {
  return url.replace(HERO_PATTERN, "$1/1200$2");
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoDate(d) {
  if (!d) return new Date().toISOString();
  const date = d instanceof Date ? d : new Date(d);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

// Editorial /c/<slug> aliases that resolve via CATEGORY_ALIASES in
// packages/web/src/lib/categories.ts but never appear in the live
// `category_ids` JSON (no product is tagged with the short slug directly).
const ALIAS_SLUGS = [
  "smartphones", "portables", "electromenager", "mode", "vehicules",
  "femme", "homme", "accessoires", "traditionnel", "bebe", "sport",
  "ordinateurs", "ecrans", "peripheriques", "jeux",
  "maison", "decoration", "salon",
  "motos", "voitures",
];

const STATIC_PATHS = [
  { path: "", changefreq: "daily", priority: "1.0" },
  { path: "/search", changefreq: "hourly", priority: "0.9" },
  { path: "/seller", changefreq: "monthly", priority: "0.5" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
  { path: "/blog", changefreq: "weekly", priority: "0.7" },
  { path: "/blog/rss.xml", changefreq: "weekly", priority: "0.5" },
  { path: "/llms.txt", changefreq: "daily", priority: "0.9" },
  { path: "/llms-full.txt", changefreq: "daily", priority: "0.9" },
  { path: "/.well-known/agents.json", changefreq: "daily", priority: "0.9" },
  { path: "/.well-known/ai-policy.json", changefreq: "monthly", priority: "0.7" },
];

const MIN_FACET_COUNT = 5;

async function atomicWrite(path, body) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}

function urlsetXml(entries) {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/0.9">',
  ];
  for (const e of entries) {
    parts.push("<url>");
    parts.push(`<loc>${xmlEscape(e.loc)}</loc>`);
    parts.push(`<lastmod>${e.lastmod}</lastmod>`);
    if (e.changefreq) parts.push(`<changefreq>${e.changefreq}</changefreq>`);
    if (e.priority) parts.push(`<priority>${e.priority}</priority>`);
    if (e.image) {
      parts.push("<image:image>");
      parts.push(`<image:loc>${xmlEscape(e.image)}</image:loc>`);
      parts.push("</image:image>");
    }
    parts.push("</url>");
  }
  parts.push("</urlset>");
  return parts.join("\n");
}

function indexXml(children, lastmod) {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const c of children) {
    parts.push("<sitemap>");
    parts.push(`<loc>${xmlEscape(c.loc)}</loc>`);
    parts.push(`<lastmod>${c.lastmod ?? lastmod}</lastmod>`);
    parts.push("</sitemap>");
  }
  parts.push("</sitemapindex>");
  return parts.join("\n");
}

// Mirrors packages/web/src/app/blog/posts/index.ts. Keep in sync when adding
// or removing a blog post — the web app's own /sitemap-static.xml route
// imports BLOG_POSTS directly, so the truth lives there; this list is only
// used by the static-file generator (which can't import TS sources from
// inside the api image).
const BLOG_SLUGS = [
  "guide-smartphone-occasion-algerie",
  "vendre-conseils-annonces",
  "acheter-voiture-occasion-algerie-verifications",
  "ordinateur-portable-etudes-algerie-2026",
  "machine-a-cafe-algerie-guide",
  "electromenager-algerie-guide",
  "acheter-en-ligne-algerie-sans-arnaque",
  "payer-en-ligne-algerie-2026",
  "livraison-algerie-services-colis-2026",
  "climatiseur-algerie-guide-2026",
  "televiseur-algerie-guide-2026",
  "mode-vetements-algerie-guide-2026",
  "vendre-en-ligne-algerie-demarrer-2026",
  "refrigerateur-algerie-guide-2026",
  "lave-linge-algerie-guide-2026",
];

async function main() {
  const sql = postgres(DATABASE_URL, { max: 4, application_name: "build-sitemaps" });
  const now = new Date().toISOString();

  try {
    const productRows = await sql`
      SELECT
        p.id AS product_id,
        p.updated_at,
        p.created_at,
        m.url AS hero_url
      FROM catalog.products p
      LEFT JOIN catalog.media m ON m.id = p.hero_media_id
      WHERE p.status = 'active' AND p.moderation_status <> 'suppressed'
      ORDER BY p.created_at DESC
    `;

    const categoryRows = await sql`
      SELECT slug, count(*) AS n
      FROM (
        SELECT jsonb_array_elements_text(category_ids) AS slug
        FROM catalog.products
        WHERE category_ids IS NOT NULL
          AND status = 'active' AND moderation_status <> 'suppressed'
      ) s
      WHERE slug IS NOT NULL AND slug <> ''
      GROUP BY slug
      HAVING count(*) > 0
      ORDER BY count(*) DESC
    `;

    const brandRows = await sql`
      SELECT brand, count(*) AS n
      FROM catalog.products
      WHERE brand IS NOT NULL AND brand <> ''
        AND status = 'active' AND moderation_status <> 'suppressed'
      GROUP BY brand
      HAVING count(*) >= ${MIN_FACET_COUNT}
      ORDER BY count(*) DESC
    `;

    const sellerRows = await sql`
      SELECT seller_id, count(*) AS n
      FROM catalog.products
      WHERE seller_id IS NOT NULL
        AND status = 'active' AND moderation_status <> 'suppressed'
      GROUP BY seller_id
      HAVING count(*) >= ${MIN_FACET_COUNT}
      ORDER BY count(*) DESC
    `;

    await mkdir(OUT_DIR, { recursive: true });

    const staticEntries = [
      ...STATIC_PATHS.map((s) => ({
        loc: `${SITE_URL}${s.path}`,
        lastmod: now,
        changefreq: s.changefreq,
        priority: s.priority,
      })),
      ...BLOG_SLUGS.map((slug) => ({
        loc: `${SITE_URL}/blog/${slug}`,
        lastmod: now,
        changefreq: "monthly",
        priority: "0.6",
      })),
    ];
    await atomicWrite(resolve(OUT_DIR, "sitemap-static.xml"), urlsetXml(staticEntries));

    const categorySlugs = new Set(categoryRows.map((r) => r.slug));
    const categoryEntries = [
      ...categoryRows.flatMap((r) => [
        {
          loc: `${SITE_URL}/c/${encodeURIComponent(r.slug)}`,
          lastmod: now,
          changefreq: "daily",
          priority: "0.8",
        },
        {
          loc: `${SITE_URL}/search?category=${encodeURIComponent(r.slug)}`,
          lastmod: now,
          changefreq: "daily",
          priority: "0.7",
        },
      ]),
      ...ALIAS_SLUGS.filter((s) => !categorySlugs.has(s)).map((s) => ({
        loc: `${SITE_URL}/c/${encodeURIComponent(s)}`,
        lastmod: now,
        changefreq: "daily",
        priority: "0.8",
      })),
      ...brandRows.map((r) => ({
        loc: `${SITE_URL}/search?brand=${encodeURIComponent(r.brand)}`,
        lastmod: now,
        changefreq: "daily",
        priority: "0.6",
      })),
      ...sellerRows.map((r) => ({
        loc: `${SITE_URL}/store/${encodeURIComponent(r.seller_id)}`,
        lastmod: now,
        changefreq: "daily",
        priority: "0.6",
      })),
    ];
    await atomicWrite(resolve(OUT_DIR, "sitemap-categories.xml"), urlsetXml(categoryEntries));

    const productChunks = [];
    for (let i = 0; i < productRows.length; i += URLS_PER_FILE) {
      productChunks.push(productRows.slice(i, i + URLS_PER_FILE));
    }
    if (productChunks.length === 0) productChunks.push([]);

    for (let i = 0; i < productChunks.length; i++) {
      const chunk = productChunks[i];
      const entries = chunk.map((r) => ({
        loc: `${SITE_URL}/product/${encodeURIComponent(r.product_id)}`,
        lastmod: isoDate(r.updated_at ?? r.created_at),
        changefreq: "daily",
        priority: "0.7",
        ...(r.hero_url ? { image: upscaleHero(r.hero_url) } : {}),
      }));
      await atomicWrite(resolve(OUT_DIR, `sitemap-products-${i + 1}.xml`), urlsetXml(entries));
    }

    // Sweep older product shards that this run didn't produce (catalog
    // shrank or URLS_PER_FILE was raised). The sitemap index only links
    // shards 1..N from this run, but Caddy would still serve stale shards
    // if old files remained on disk.
    const existing = await readdir(OUT_DIR);
    for (const name of existing) {
      const m = name.match(/^sitemap-products-(\d+)\.xml$/);
      if (m && Number(m[1]) > productChunks.length) {
        await unlink(resolve(OUT_DIR, name)).catch(() => {});
      }
    }

    const indexChildren = [
      { loc: `${SITE_URL}/sitemap-static.xml`, lastmod: now },
      { loc: `${SITE_URL}/sitemap-categories.xml`, lastmod: now },
      ...productChunks.map((_, i) => ({
        loc: `${SITE_URL}/sitemap-products-${i + 1}.xml`,
        lastmod: now,
      })),
    ];
    await atomicWrite(resolve(OUT_DIR, "sitemap.xml"), indexXml(indexChildren, now));

    console.log(
      `OK products=${productRows.length} shards=${productChunks.length} ` +
      `categories=${categoryRows.length} brands=${brandRows.length} ` +
      `sellers=${sellerRows.length} out=${OUT_DIR}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[build-sitemaps] failed:", err);
  exit(1);
});
