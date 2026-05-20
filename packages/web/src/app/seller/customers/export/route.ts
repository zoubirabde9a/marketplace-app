// GET /seller/customers/export — aggregated customer CSV. Each row is
// one unique buyer (deduped by phone across the seller's full order
// history), with the same columns the on-screen list surfaces plus
// the raw timestamps useful for CRM imports.
//
// Same hygiene as the orders / products exports: UTF-8 BOM for Excel,
// CSV-injection escape on leading =/+/-/@, CR/LF terminators,
// Content-Disposition: attachment.

import { getCurrentUser, getSessionJwt, syntheticAgentId } from "@/lib/sellerSession";
import { listMySellers, listSellerOrders, type SellerOrder } from "@/lib/api";

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

interface CustomerAggregate {
  phone: string;
  name: string;
  region: string;
  orderCount: number;
  revenueByCcy: Record<string, bigint>;
  lastOrderAt: string;
  firstOrderAt: string;
}

export async function GET(): Promise<Response> {
  const jwt = await getSessionJwt();
  if (!jwt) return new Response("not_signed_in", { status: 401 });
  const session = await getCurrentUser();
  if (!session) return new Response("not_signed_in", { status: 401 });
  const agentId = syntheticAgentId(session.user.id);
  const sellersResp = await listMySellers(jwt, agentId);
  const sellers = sellersResp.data;
  if (sellers.length === 0) return new Response("no_shops", { status: 404 });

  const results = await Promise.allSettled(
    sellers.map((s) => listSellerOrders(s.sellerId, jwt)),
  );
  const failedShops: string[] = [];
  // Same dedup-by-phone aggregation as the page (page.tsx). Duplicated
  // here rather than extracted to a shared helper because the route
  // returns CSV and the page returns JSX — different output shapes, the
  // logic happens to align but isn't a stable abstraction yet.
  const byPhone = new Map<string, CustomerAggregate>();
  results.forEach((r) => {
    if (r.status !== "fulfilled") {
      failedShops.push("(unknown)");
      return;
    }
    for (const o of r.value.data as SellerOrder[]) {
      if (!o.customer) continue;
      const phone = o.customer.phone;
      const existing = byPhone.get(phone);
      if (existing) {
        existing.orderCount++;
        if (o.createdAt > existing.lastOrderAt) {
          existing.lastOrderAt = o.createdAt;
          existing.name = o.customer.name;
          existing.region = o.customer.region;
        }
        if (o.createdAt < existing.firstOrderAt) existing.firstOrderAt = o.createdAt;
        try {
          existing.revenueByCcy[o.currency] =
            (existing.revenueByCcy[o.currency] ?? 0n) + BigInt(o.subtotalMinor);
        } catch {
          /* skip */
        }
      } else {
        const agg: CustomerAggregate = {
          phone,
          name: o.customer.name,
          region: o.customer.region,
          orderCount: 1,
          revenueByCcy: {},
          lastOrderAt: o.createdAt,
          firstOrderAt: o.createdAt,
        };
        try {
          agg.revenueByCcy[o.currency] = BigInt(o.subtotalMinor);
        } catch {
          /* skip */
        }
        byPhone.set(phone, agg);
      }
    }
  });
  const customers = Array.from(byPhone.values()).sort(
    (a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt),
  );

  const lines: string[] = [];
  const HEADER = [
    "Nom",
    "Téléphone",
    "Wilaya",
    "Nombre de commandes",
    "Total dépensé",
    "Devise",
    "Première commande",
    "Dernière commande",
  ];
  lines.push(row(HEADER));
  for (const c of customers) {
    const top = Object.entries(c.revenueByCcy).sort(
      (a, b) => Number(b[1] - a[1]),
    )[0];
    lines.push(
      row([
        c.name,
        c.phone,
        c.region,
        c.orderCount,
        // Raw minor-currency integer same as the orders CSV — keeps
        // accountant math deterministic.
        top ? top[1].toString() : "",
        top ? top[0] : "",
        c.firstOrderAt,
        c.lastOrderAt,
      ]),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const csv = "﻿" + lines.join("\r\n") + "\r\n";
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="clients-${today}.csv"`,
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
