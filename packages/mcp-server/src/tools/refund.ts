// Refund tools — preview the §7.2 refund-routing waterfall against a refund context.
// The tool is read-only and idempotent; the caller (the ledger service) is responsible
// for executing the chosen leg through real provider integrations. See SOP 06 step 4.

import { z } from "zod";
import { routeRefund } from "@marketplace/domain/ledger/refund-routing";
import type { RouteResolver, RefundContext } from "@marketplace/domain/ledger/refund-routing";
import type { McpRegistry } from "../registry.js";

const InstrumentKind = z.enum(["card", "bank", "wallet", "virtual_card", "stablecoin"]);

const Input = z.object({
  // Bound the refund id at the gate. Pre-fix it accepted any string,
  // including a multi-MB payload — refund ids in this system are UUIDv7
  // or provider-side opaque ids, never anywhere near 200 chars.
  refundId: z.string().min(1).max(200),
  // Strictly positive — refunding 0 or a negative amount is meaningless and
  // would silently waste an audit row + a route-resolver pick. The caller
  // should not invoke this tool at all for a zero refund.
  amountMinor: z.bigint().positive(),
  // ISO 4217 alpha-3 — same allow-list every other money-bearing surface
  // uses (catalog/types.ts, checkout, ledger/double-entry). Pre-fix the
  // 3–8 char range admitted lowercase / mixed-case / stray-space variants
  // that the ledger then carries through as currency keys, fragmenting the
  // reconciliation tables.
  currency: z.string().regex(/^[A-Z]{3}$/),
  ctx: z.object({
    instrumentKind: InstrumentKind,
    originalSourceRecreditable: z.boolean(),
    walletAvailable: z.boolean(),
    walletOptedOut: z.boolean(),
    manualPayoutAvailable: z.boolean(),
  }),
});

const RouteKind = z.enum(["original_source", "wallet", "manual_payout", "credit_note_vdc"]);

const Output = z.object({
  refundId: z.string(),
  amountMinor: z.bigint(),
  currency: z.string(),
  routeKind: RouteKind,
  /** Routes that the waterfall considered and rejected, in order. */
  rejectedRoutes: z.array(
    z.object({ kind: RouteKind, reason: z.string() }),
  ),
});

function buildPreviewResolver(): RouteResolver {
  // Synthetic refs: the preview tool never executes the leg — the caller does.
  return {
    reverseToOriginalSource: async () => "preview:reverse",
    creditWallet: async () => "preview:wallet",
    enqueueManualPayout: async () => "preview:payout",
    issueCreditNoteVdc: async () => "preview:vdc",
  };
}

function buildRejectedRoutes(ctx: RefundContext): Array<{ kind: z.infer<typeof RouteKind>; reason: string }> {
  const out: Array<{ kind: z.infer<typeof RouteKind>; reason: string }> = [];
  if (!ctx.originalSourceRecreditable) {
    out.push({ kind: "original_source", reason: "original_source_not_recreditable" });
  } else {
    return out; // Will be picked
  }
  if (!(ctx.walletAvailable && !ctx.walletOptedOut)) {
    out.push({
      kind: "wallet",
      reason: !ctx.walletAvailable ? "wallet_unavailable" : "wallet_opted_out",
    });
  } else {
    return out;
  }
  if (!ctx.manualPayoutAvailable) {
    out.push({ kind: "manual_payout", reason: "manual_payout_unavailable" });
  } else {
    return out;
  }
  // Falls through to credit_note_vdc — no rejection added for the chosen leg.
  return out;
}

export function registerRefundTools(reg: McpRegistry): void {
  reg.register({
    name: "refund.preview_route",
    description:
      "Preview the §7.2 refund-routing waterfall: original-instrument → wallet → manual payout → credit-note VDC. Returns the chosen route and the rejected legs (with the reason each was skipped). The caller's ledger service is responsible for executing the chosen leg.",
    scope: "return:write",
    auditEvent: "refund.preview_route",
    idempotent: true,
    inputSchema: Input,
    outputSchema: Output,
    handler: async (input) => {
      const route = await routeRefund(input.ctx, buildPreviewResolver());
      const rejected = buildRejectedRoutes(input.ctx);
      return {
        refundId: input.refundId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        routeKind: route.kind,
        rejectedRoutes: rejected,
      };
    },
    errorCatalog: [
      { code: "validation", httpStatus: 400, description: "Refund context failed schema validation." },
    ],
  });
}
