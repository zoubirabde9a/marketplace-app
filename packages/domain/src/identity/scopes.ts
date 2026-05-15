// OAuth scopes & MCP tool capability scopes.
// Naming: <resource>:<verb> where verb ∈ {read, write, execute, admin}.

export const SCOPES = {
  catalogRead: "catalog:read",
  cartWrite: "cart:write",
  checkoutExecute: "checkout:execute",
  orderRead: "order:read",
  orderWrite: "order:write",
  orderCancel: "order:cancel",
  returnWrite: "return:write",
  reviewWrite: "review:write",
  messageWrite: "message:write",
  sellerProductWrite: "seller:product:write",
  sellerInventoryWrite: "seller:inventory:write",
  sellerFulfillExecute: "seller:fulfill:execute",
  sellerPayoutRead: "seller:payout:read",
  subscriptionWrite: "subscription:write",
  loyaltyRead: "loyalty:read",
  loyaltyRedeem: "loyalty:redeem",
  disputeRead: "dispute:read",
  disputeWrite: "dispute:write",
  agentPolicyWrite: "agent:policy:write",
  passportIssue: "agent:passport:issue",
  passportRevoke: "agent:passport:revoke",
  reputationRead: "agent:reputation:read",
} as const;

export type ScopeName = (typeof SCOPES)[keyof typeof SCOPES];

export const ALL_SCOPES: readonly ScopeName[] = Object.values(SCOPES);

export function hasScope(granted: ReadonlySet<string>, required: ScopeName): boolean {
  return granted.has(required);
}

export function requireScope(granted: ReadonlySet<string>, required: ScopeName): void {
  if (!hasScope(granted, required)) {
    throw new Error(`missing_scope:${required}`);
  }
}
