// GET /seller/orders/export — return every order across every shop the
// signed-in seller owns as a CSV download. Sellers reconciling sales,
// running monthly accounting, or sharing data with a partner have had
// no way to get their data out of the UI; this is the escape hatch.
//
// Server-side fan-out via listSellerOrders is identical to what
// /seller/orders/page.tsx does — same auth, same Promise.allSettled
// resilience. A single shop's fetch failure doesn't blank the export;
// it just emits a row in the CSV header comment so the seller knows
// the file is incomplete.

import { getSessionJwt, getCurrentUser, syntheticAgentId } from "@/lib/sellerSession";
import { listMySellers, listSellerOrders, type SellerOrder } from "@/lib/api";

// Excel + Sheets quirk: a leading `=`, `+`, `-`, or `@` in a cell is
// interpreted as a formula, which is a known CSV injection vector when
// the data contains attacker-controlled text. Prefix with a single
// apostrophe in those cases — the apostrophe is a literal escape in
// spreadsheet apps and gets dropped on display.
function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  // Quote if the cell contains comma, double-quote, CR, or LF.
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cells: ReadonlyArray<unknown>): string {
  return cells.map(csvCell).join(",");
}

// Compact line-item summary that fits in a single CSV cell. Stable
// format: "qty × title (sku); qty × title (sku); …". Falls back to
// variantId when the line has no display title.
function summarizeLines(o: SellerOrder): string {
  return o.lines
    .map((l) => {
      const title = l.title ?? l.sku ?? l.variantId;
      const sku = l.sku && l.title ? ` (${l.sku})` : "";
      return `${l.qty} × ${title}${sku}`;
    })
    .join("; ");
}

export async function GET(): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) {
    return new Response("not_signed_in", { status: 401 });
  }
  const session = await getCurrentUser();
  if (!session) {
    return new Response("not_signed_in", { status: 401 });
  }
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(jwt, agentId);
  const sellers = sellersResp.data;
  if (sellers.length === 0) {
    return new Response("no_shops", { status: 404 });
  }

  const results = await Promise.allSettled(
    sellers.map((s) => listSellerOrders(s.sellerId, jwt)),
  );
  const failedShops: string[] = [];
  // Flatten with shop annotation; the unified page does the same.
  const rows: Array<{ order: SellerOrder; shopName: string }> = [];
  results.forEach((r, i) => {
    const s = sellers[i]!;
    if (r.status === "fulfilled") {
      for (const o of r.value.data) {
        rows.push({ order: o, shopName: s.displayName });
      }
    } else {
      failedShops.push(s.displayName);
    }
  });

  rows.sort((a, b) => {
    const cmp = new Date(b.order.createdAt).getTime() - new Date(a.order.createdAt).getTime();
    if (cmp !== 0) return cmp;
    return a.order.orderId.localeCompare(b.order.orderId);
  });

  const lines: string[] = [];
  // BOM so Excel reads UTF-8 correctly without prompting — Algerian
  // sellers will have customer names with accents (Yacine, Lyès,
  // etc.) and Excel's default Windows-1252 mangles them otherwise.
  const HEADER = [
    "Date",
    "Numéro",
    "Boutique",
    "Statut",
    "Client",
    "Téléphone",
    "Wilaya",
    "Articles",
    "Total",
    "Devise",
  ];
  lines.push(row(HEADER));
  for (const { order: o, shopName } of rows) {
    lines.push(
      row([
        o.createdAt,
        o.publicNumber,
        shopName,
        o.status,
        o.customer?.name ?? "",
        o.customer?.phone ?? "",
        o.customer?.region ?? "",
        summarizeLines(o),
        // The subtotal lands in the spreadsheet as the underlying
        // minor-currency integer (e.g. "299900" for 2 999,00 DZD).
        // Doing the minor-to-major conversion in the CSV would make
        // accounting math brittle (locale-aware decimal separators,
        // rounding); leaving it raw keeps the field unambiguous and
        // sellers can divide by 100 in their sheet.
        o.subtotalMinor,
        o.currency,
      ]),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const csv = "﻿" + lines.join("\r\n") + "\r\n";
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="commandes-${today}.csv"`,
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
