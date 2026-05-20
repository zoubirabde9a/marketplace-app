// GET /seller/products/export — return every product across every shop
// the signed-in seller owns as a CSV download. Symmetric with the
// orders CSV at /seller/orders/export (ddc47ec). Inventory audits and
// stock syncs with external POS / accounting systems both need this.
//
// Server-side fan-out via listProductsBySeller — same auth posture as
// the dashboard's per-shop product fetch. Promise.allSettled keeps a
// single shop's failure from blanking the export; failed shop count
// surfaces in a response header for future client UI to react on.

import {
  SITE_URL,
} from "@/lib/sitemap";
import {
  getCurrentUser,
  getSessionJwt,
  syntheticAgentId,
} from "@/lib/sellerSession";
import {
  listMySellers,
  listProductsBySeller,
} from "@/lib/api";

// Same anti-injection escape as the orders CSV — a leading `=`, `+`,
// `-`, or `@` is a known formula-execution vector in spreadsheet apps
// when the cell value happens to be customer-supplied.
function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cells: ReadonlyArray<unknown>): string {
  return cells.map(csvCell).join(",");
}

export async function GET(): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return new Response("not_signed_in", { status: 401 });
  const session = await getCurrentUser();
  if (!session) return new Response("not_signed_in", { status: 401 });
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(jwt, agentId);
  const sellers = sellersResp.data;
  if (sellers.length === 0) {
    return new Response("no_shops", { status: 404 });
  }

  const results = await Promise.allSettled(
    sellers.map((s) => listProductsBySeller(s.sellerId, jwt)),
  );
  const failedShops: string[] = [];
  const rows: Array<{ p: ReturnType<typeof shapeRow>; shopName: string }> = [];
  results.forEach((r, i) => {
    const s = sellers[i]!;
    if (r.status === "fulfilled") {
      for (const hit of r.value.data) {
        rows.push({ p: shapeRow(hit), shopName: s.displayName });
      }
    } else {
      failedShops.push(s.displayName);
    }
  });

  const lines: string[] = [];
  const HEADER = [
    "Boutique",
    "Titre",
    "Marque",
    "Catégories",
    "Variantes",
    "Prix",
    "Devise",
    "Stock",
    "Lien public",
    "ID produit",
  ];
  lines.push(row(HEADER));
  for (const { p, shopName } of rows) {
    lines.push(
      row([
        shopName,
        p.title,
        p.brand,
        p.categoryIds,
        p.variantCount,
        // Like the orders export — raw minor-currency integer keeps
        // accounting math deterministic; the seller divides by 100 in
        // their sheet. Empty when the listing has a price range
        // instead of a single number (multi-variant pricing).
        p.priceMinor,
        p.currency,
        p.inStock ? "en stock" : "rupture",
        p.publicUrl,
        p.productId,
      ]),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  // UTF-8 BOM so Excel reads accented characters correctly on Windows.
  const csv = "﻿" + lines.join("\r\n") + "\r\n";
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="produits-${today}.csv"`,
      "cache-control": "private, no-store",
      ...(failedShops.length > 0
        ? {
            "x-export-incomplete": "true",
            "x-export-failed-shops": failedShops.length.toString(),
          }
        : {}),
    },
  });
}

// Flatten the API search-hit shape into the columns the CSV exposes.
// Pulls just the fields the spreadsheet user actually cares about and
// ignores the rest (heroImageUrl, rating, internal scores).
function shapeRow(h: {
  productId: string;
  title: { value: string };
  brand?: string;
  categoryIds: string[];
  variantCount?: number;
  inStock: boolean;
  priceMinor?: string;
  currency?: string;
}): {
  productId: string;
  title: string;
  brand: string;
  categoryIds: string;
  variantCount: number;
  priceMinor: string;
  currency: string;
  inStock: boolean;
  publicUrl: string;
} {
  return {
    productId: h.productId,
    title: h.title.value,
    brand: h.brand ?? "",
    categoryIds: h.categoryIds.join("; "),
    variantCount: h.variantCount ?? 1,
    priceMinor: h.priceMinor ?? "",
    currency: h.currency ?? "",
    inStock: h.inStock,
    publicUrl: `${SITE_URL}/product/${h.productId}`,
  };
}
