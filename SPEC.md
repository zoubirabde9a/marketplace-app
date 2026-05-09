# Agent-to-Agent Marketplace — Specification

**Status:** Draft v0.5 (continuously refined)
**Last updated:** 2026-05-03
**Owner:** mahlledz@gmail.com

> The world's most feature-complete marketplace built API-first for AI agents. No UI. Agents discover, browse, negotiate, transact, and resolve disputes through standardized protocols (MCP, A2A, AP2, ACP). Humans participate only via delegated authorization.

## Contents

- [§0 Goals & Non-Goals](#0-goals--non-goals)
- [§1 Tech Stack](#1-tech-stack-versions-pinned-may-2026)
- [§2 Architecture](#2-architecture)
- [§3 Identity, Authorization & Agent Trust](#3-identity-authorization--agent-trust)
- [§4 Domain Model](#4-domain-model-postgresql-schemas)
- [§5 API Surfaces](#5-api-surfaces)
- [§6 Feature Catalog](#6-feature-catalog)
- [§7 Payments & Money Movement](#7-payments--money-movement)
  - [§7a Agent Reputation System](#7a-agent-reputation-system-resolved)
  - [§7b Negotiation, Auctions & Dynamic Pricing](#7b-negotiation-auctions--dynamic-pricing-resolved)
- [§8 Search, Discovery & Recommendations](#8-search-discovery--recommendations)
  - [§8a Trust & Safety](#8a-trust--safety)
- [§9 Observability & Operations](#9-observability--operations)
- [§10 Testing Strategy](#10-testing-strategy)
- [§11 Security Controls](#11-security-controls)
- [§12 Roadmap](#12-roadmap-driving-the-spec-not-committed-dates)
- [§13 Open Questions](#13-open-questions--continuous-refinement-backlog) → backlog lives in [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md)
- [Appendix A — Sources](#appendix-a--sources-may-2026-versions)

---

## 0. Goals & Non-Goals

### Goals
- **Agent-native.** Every capability is exposed as MCP tools and A2A skills, not screens.
- **Comprehensive.** Catalog, multi-vendor sellers, cart, checkout, orders, returns, disputes, reviews, messaging, search, recommendations, subscriptions, digital goods, escrow, payouts, taxes, shipping, promotions, loyalty, affiliate, analytics, admin.
- **Secure by default.** OAuth 2.1 + PKCE + DPoP, agent-passport delegation, signed mandates (AP2 VDCs), per-agent spending limits, scoped capability tokens, full audit trail.
- **Latest stack (May 2026).** TypeScript 6.0.3, Node 24 LTS, PostgreSQL 18.3, MCP SDK 1.29, Stripe Agentic Commerce, AP2 v0.2.0.
- **Fully testable.** Deterministic test mode, sandbox payments, contract tests for every MCP tool, golden-file API tests, load tests, security tests, agent-simulator integration suite.

### Non-Goals
- No web/mobile UI. (Admin uses CLI + API.)
- No proprietary agent runtime — we serve any MCP/A2A-compatible client.
- No first-party logistics — we integrate carriers, not run warehouses.

---

## 1. Tech Stack (versions pinned May 2026)

| Layer | Choice | Version | Rationale |
|---|---|---|---|
| Language | TypeScript | **6.0.3** (stable; 7.0-beta available) | Latest stable; defer 7.0 (Go-based compiler) until GA |
| Runtime | Node.js | **24.15.0 LTS** | Current active LTS (until Apr 2028) |
| Package mgr | **pnpm** | 10.x (mandatory) | Workspace monorepo; only supported package manager — `npm` and `yarn` are blocked via `preinstall` hook and `packageManager` field in `package.json` |
| API framework | **Fastify** | 5.x | High-perf, JSON-schema-first, plugin ecosystem |
| Database | **PostgreSQL** | **18.3** | Latest stable; native UUIDv7, logical replication, OAuth client cert auth |
| ORM | **Drizzle ORM** | latest | TypeScript-native, lightweight, SQL-first, edge-ready |
| Migrations | drizzle-kit | latest | Schema-first generated migrations |
| Cache / queue | Redis 7.4 + BullMQ | latest | Sessions, rate limits, job queues |
| Search | OpenSearch 3.x or Meilisearch | latest | Full-text + vector for semantic agent queries |
| MCP server | `@modelcontextprotocol/sdk` | **1.29.x** | Official TS SDK; OAuth 2.1 preview |
| Payments | Stripe Agentic Commerce Suite + Agent Toolkit | latest | Delegated tokens, virtual cards, ACP endpoint |
| Agent payments | **AP2 v0.2.0** (Google) | 0.2.0 | Verifiable digital credentials, mandates |
| A2A | google-a2a/A2A protocol | latest | Agent↔agent negotiation |
| Auth | OAuth 2.1 + PKCE + DPoP, JWT (EdDSA) | — | RFC 9449, draft-ietf-oauth-2-1 |
| Validation | Zod 4 | latest | Runtime + compile-time schemas |
| Testing | Vitest 3, Supertest, Pact, k6 | latest | Unit, contract, e2e, load |
| Observability | OpenTelemetry, Grafana Tempo/Loki/Mimir | latest | Traces, logs, metrics |
| Infra | Docker, Kubernetes, Terraform | latest | Cloud-portable |
| Secrets | HashiCorp Vault or cloud KMS | — | mTLS internal |

---

### 1.1 Package Manager — pnpm (mandatory)

`pnpm` is the **only** supported package manager. Enforced by:
- `package.json` → `"packageManager": "pnpm@10.x"` (Corepack-pinned)
- `package.json` → `"engines": { "node": ">=24.15.0", "pnpm": ">=10" }`
- Root `preinstall` script: `npx only-allow pnpm` (fails fast if a contributor runs `npm install` or `yarn`)
- CI uses `pnpm install --frozen-lockfile`; lockfile is `pnpm-lock.yaml` (committed)
- Workspace layout: `pnpm-workspace.yaml` declaring `packages/*` (api, mcp-server, a2a-server, domain, db, shared, test-utils, agent-sim)
- Catalog dependencies (pnpm `catalog:` feature) used to pin shared versions across workspace packages
- Renovate configured to bump via pnpm; reproducible installs via `--frozen-lockfile` everywhere

## 2. Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Buyer Agent (Claude / GPT / Gemini / custom)                 │
└──────────────┬───────────────────────────┬────────────────────┘
               │ MCP (Streamable HTTP)     │ A2A (negotiation)
               ▼                           ▼
        ┌──────────────────────────────────────────┐
        │  Edge Gateway (Fastify + WAF)            │
        │  - OAuth 2.1 + DPoP verify               │
        │  - Rate limit / quota / abuse heuristics │
        │  - Mandate (AP2 VDC) verification        │
        └──────────────┬───────────────────────────┘
                       │
        ┌──────────────┼──────────────────────────┐
        │              │                          │
        ▼              ▼                          ▼
   MCP Server    REST/OpenAPI v3.1         A2A Skill Server
   (tools)       (canonical surface)        (agent dialogues)
        │              │                          │
        └──────────────┼──────────────────────────┘
                       ▼
   ┌───────────────────────────────────────────────┐
   │  Domain Services (modular monolith)           │
   │  catalog · seller · cart · order · payment    │
   │  escrow · shipping · tax · review · message   │
   │  promo · loyalty · dispute · audit · search   │
   └───────┬─────────────────┬────────────────────┘
           ▼                 ▼
      PostgreSQL 18.3   Redis 7.4 + queues
           │                 │
           ▼                 ▼
   Stripe ACP / AP2     OpenSearch + embeddings
```

**Pattern:** modular monolith, each domain a bounded context with its own schema namespace. Internal calls type-checked (no network). External integrations (Stripe, carriers, tax) behind adapter interfaces with sandbox stubs.

---

## 3. Identity, Authorization & Agent Trust

### 3.1 Principals
- **Human** — natural person (buyer, seller, admin). Authenticates with WebAuthn/passkey or federated OIDC.
- **Agent** — software acting on behalf of a human or organization. Has a dedicated *Agent Passport*.
- **Organization** — seller entity; can own agents and humans.

### 3.2 Agent Passport
A signed credential issued by the marketplace that binds an agent identity to:
- Owning principal (human or org)
- Public key (Ed25519)
- Capability scopes (e.g. `cart:write`, `checkout:execute`, `catalog:read`)
- Spend caps (per-tx, per-day, per-merchant, currency)
- Allowlist/denylist of merchants & categories
- Expiry and revocation status
- Audit-trail commitment (Merkle root)

Issued via `/agents/passports/issue` after human consent flow (push notification → passkey approval).

### 3.3 OAuth 2.1 Flow
- Authorization Code + PKCE (mandatory).
- DPoP (RFC 9449) bound tokens — replay-resistant.
- Token introspection endpoint with cache-headers.
- Refresh tokens rotated, sender-constrained.
- Mandate-bound access tokens for purchase scopes (token references AP2 mandate ID).

### 3.4 Mandates (AP2)
- **Intent Mandate** (Open Checkout): "agent may buy ≤ $X of {category} from {merchant set} before {deadline}".
- **Cart Mandate** (Closed Checkout): "this exact cart is approved".
- **Payment Mandate**: cryptographic authorization for a specific transaction amount on a specific instrument.
Verified server-side; receipts stored as VDCs.

### 3.5 Mandate persistence (resolved)

We persist **both** the raw signed VDC (encrypted at rest with envelope encryption, AES-256-GCM, KMS-managed keys) **and** a content hash in a separate hot table. Rationale:
- Hash-only would leave us unable to defend a chargeback or replay an audit; raw VDC is dispute-grade evidence.
- Privacy controlled at the access layer, not by deletion: hot table holds `(mandate_id, hash, principal_id_hash, expiry, status)` and is queryable by services; raw VDC blob lives in a dedicated `audit.mandate_vault` accessible only via privileged service with break-glass logging.
- Retention: raw VDCs kept for `max(7 years, dispute window + 1y)` per jurisdiction; hash row kept indefinitely. GDPR erasure requests redact principal-identifying fields but keep the hash chain (legitimate-interest basis: fraud / accounting).

### 3.6 Revocation propagation (resolved)

Goal: a revoked passport stops being honored across the fleet within **2 seconds p99**.

Mechanism (layered):
1. **Authoritative store**: `identity.agent_passports.status` flipped to `revoked` in a single Postgres transaction with a `revoked_at` timestamp.
2. **Push fanout**: Postgres `LISTEN/NOTIFY` → revocation channel → all API + MCP gateway pods update an in-memory bloom filter + LRU cache (≤ 1 s).
3. **Pull fallback**: every gateway re-validates passport freshness on tokens older than 60 s by hitting the `/oauth/introspect` endpoint, which always reads the source of truth.
4. **DPoP token TTL**: capped at 10 minutes — bounds blast radius even if push & pull both fail.
5. **CRL endpoint** at `/.well-known/agent-passport-revocations` for offline / federated consumers; signed JWT, refreshed every 30 s.

### 3.7 Step-up authorization (resolved)

Tiered thresholds; each tier requires a fresher human-bound proof.

| Tier | Trigger | Required proof |
|---|---|---|
| 0 | Read-only catalog calls | Agent passport only |
| 1 | Cart mutations, low-value subscriptions | Active passport + DPoP |
| 2 | Checkout ≤ mandate cap, ≤ $250, ≤ daily cap | Open Intent Mandate (AP2) |
| 3 | Checkout > $250 OR new merchant OR cross-border | Closed Cart Mandate, fresh ≤ 5 min |
| 4 | Checkout > $5,000 OR high-risk category OR velocity anomaly | Step-up: live passkey/WebAuthn assertion from human; mandate signed within 60 s |
| 5 | Account-level changes (payout target, passport scopes, spend caps) | Two-factor: passkey + email/SMS challenge; cooldown 24 h before takes effect |

Defaults are platform-set; principals can tighten (never loosen) via `/agents/policies`. Velocity anomalies (3× rolling-30-day median spend, 10× hourly tx rate, geo jump > 1000 km in 1 h) auto-escalate one tier.

### 3.8 Seller agent passport issuance (resolved)

A seller's agent bootstraps the relationship — there is no pre-existing seller account. Flow:

1. Agent calls `seller.onboard()` (unauthenticated public MCP tool, rate-limited per agent identity + IP).
2. Marketplace creates a pending principal row and returns `{consent_url, expires_in: 600s}`. The URL hosts a minimal consent screen: "Agent <name> wants to sell on <marketplace> on your behalf. Sign in with Google or passkey to approve."
3. Human signs in (OIDC or WebAuthn). On success: marketplace creates `users` row, links to the pending principal, issues a seller agent passport (Ed25519, scopes above, default spend caps N/A for sellers), returns it to the agent via short-lived pickup URL keyed by a code the agent received in step 2.
4. Agent now has a seller passport and may immediately call `seller.create_profile` and list products. No email confirmation, no captcha, no manual review at this stage — fraud signals are evaluated post-listing and at KYB.

The consent screen is the **only** UI in the entire system and exists solely because OAuth/passkey requires a human-in-loop ceremony.

### 3.9 Threat Model (summary)
- Prompt injection from product data → all agent-readable content tagged `untrusted`, never rendered as instructions.
- Rogue agent draining funds → spend caps + velocity checks + step-up human re-auth on threshold.
- Replay → DPoP nonces + idempotency keys.
- Sybil sellers → KYB, payout holdback, behavioral signals.
- Credential exfiltration → no long-lived bearer tokens; all sender-constrained.
- Marketplace impersonation → signed `.well-known/agent-card.json` with org domain validation.

---

## 4. Domain Model (PostgreSQL schemas)

Each schema is a bounded context. UUIDv7 for all IDs (time-ordered).

### 4.1 `identity`
- `users` (humans), `organizations`, `agents`, `agent_passports`, `oauth_clients`, `sessions`, `mfa_factors`, `consents`.

### 4.2 `catalog`
- `products`, `product_variants`, `categories`, `attributes`, `media`, `inventory_levels`, `price_lists`, `bundles`, `digital_assets`.
- Embeddings column (pgvector) for semantic search.
- Versioned (`product_versions`) for ACP near-real-time feed.

### 4.3 `seller`
- `seller_profiles`, `kyb_records`, `payout_accounts`, `seller_policies` (returns, shipping, SLAs), `seller_metrics`.

### 4.4 `cart`
- `carts`, `cart_items`, `saved_for_later`, `wishlists`. Cart can be agent- or human-owned; agent carts carry mandate ref.

### 4.5 `order`
- `orders`, `order_items`, `order_status_history`, `fulfillments`, `shipments`, `returns`, `rmas`.

### 4.6 `payment`
- `payment_intents`, `mandates` (AP2), `payment_methods`, `transactions`, `refunds`, `payouts`, `disputes`, `chargebacks`, `escrow_holds`.

### 4.7 `messaging`
- `threads`, `messages`, `notifications`, `webhooks_outbound`, `agent_dialogues` (A2A transcripts).

### 4.8 `review`
- `reviews`, `ratings`, `review_responses`, `review_signals` (verified-purchase, agent-vs-human flag).

### 4.9 `promo`
- `coupons`, `promotions`, `loyalty_accounts`, `loyalty_ledger`, `referrals`, `affiliate_partners`.

### 4.10 `tax_shipping`
- `tax_zones`, `tax_rates`, `shipping_zones`, `shipping_rates`, `carriers`, `customs_declarations`.

### 4.11 `audit`
- `audit_events` (append-only, hash-chained), `mandate_receipts`, `agent_actions`.

### 4.12 `analytics`
- Materialized views; OLAP queries off read replicas.

---

## 5. API Surfaces

### 5.1 REST/OpenAPI 3.1 (canonical)
Versioned `/v1`. Idempotency-Key header required on all mutating calls. Cursor pagination. Problem+JSON errors (RFC 9457). All endpoints emit OpenTelemetry spans.

Resources: `/products`, `/categories`, `/sellers`, `/carts`, `/orders`, `/returns`, `/payments`, `/mandates`, `/reviews`, `/messages`, `/promotions`, `/wishlists`, `/subscriptions`, `/disputes`, `/payouts`, `/agents`, `/passports`, `/oauth/*`, `/webhooks`, `/.well-known/*`.

### 5.2 MCP Server (primary agent interface)
Streamable HTTP transport at `/mcp`. OAuth 2.1 protected. Tool naming: `noun.verb`.

**Buyer onboarding**
- `buyer.onboard()` → returns a one-time consent URL (Google OIDC or passkey). Same flow as `seller.onboard()` (§3.8) but issues a buyer agent passport with `cart:write`, `checkout:execute`, `catalog:read` scopes and default spend caps (per-tx $250, per-day $1,000; principal can tighten via `/agents/policies`). One human click, then the agent transacts. Guest checkout (§6.1) remains available when the agent's principal does not yet want a persistent account.

**Discovery & search**
- `catalog.search(query, filters, page, embeddings_mode)`
- `catalog.get_product(id)`
- `catalog.compare(ids[])`
- `catalog.recommend(context, limit)`

**Cart**
- `cart.create()`, `cart.add_item(cart_id, sku, qty, options)`, `cart.update_item`, `cart.remove_item`, `cart.apply_coupon`, `cart.estimate(shipping_address)`

**Checkout**
- `checkout.quote(cart_id)` → returns priced cart + tax + shipping options
- `checkout.create_intent(cart_id, mandate_id)` → AP2 Cart Mandate verification
- `checkout.confirm(intent_id, payment_mandate)` → final commit

**Orders & returns**
- `order.list`, `order.get`, `order.cancel`, `order.track`
- `return.request`, `return.label`, `return.status`

**Sellers (seller agent scope)**
- `seller.onboard()` → returns a one-time consent URL (Google OIDC or passkey). Human clicks once; on approval the marketplace issues a seller agent passport with `seller:write`, `catalog:write`, `order:write` scopes. No other human step required to begin listing.
- `seller.create_profile(name, phone, address, support_email)` — agent-callable; creates `seller_profiles` row in state `active_listing_only`.
- `seller.update_profile(fields)` — agent-callable for any non-financial field (name, phone, address, support_email, return policy text, shipping defaults). Changes to payout target, legal entity, or tax ID are Tier 5 (§3.7) and require fresh human passkey.
- `seller.create_product`, `seller.update_inventory`, `seller.fulfill_order`, `seller.respond_to_message`, `seller.payout_status`
- `seller.start_kyb()` → returns a Stripe Connect Express onboarding URL the seller's principal completes once. On success, profile state flips to `active_full` and payouts unlock. Listings created before KYB remain valid; orders accrue to a held balance and release on KYB completion.

**Reviews & messaging**
- `review.submit`, `review.list`, `message.send`, `message.list`

**Subscriptions, wishlists, loyalty**
- `subscription.create/cancel/pause`, `wishlist.*`, `loyalty.balance/redeem`

**Disputes**
- `dispute.open`, `dispute.respond`, `dispute.evidence_upload`

Each tool ships with: JSON Schema, examples, error catalog, idempotency semantics, scope requirement, audit-event type.

### 5.3 A2A Skill Server
Skills for agent-to-agent dialogue: `negotiate_price`, `request_custom_quote`, `bulk_order`, `dispute_mediation`. Signed agent cards at `/.well-known/agent-card.json`.

### 5.4 ACP (Agentic Commerce Protocol — Stripe)
Hosted product feed at `/acp/feed` and checkout endpoint per Stripe's spec — enables Stripe-routed agent buyers to transact without bespoke integration.

### 5.5 Webhooks
Outbound, signed (Ed25519), at-least-once with idempotency token, exponential backoff, replay UI via API. Topics: `order.*`, `payment.*`, `dispute.*`, `inventory.*`, `mandate.*`, `agent.*`.

---

## 6. Feature Catalog

Buyer (human or agent), Seller (human or agent), Platform.

### 6.1 Buyer features
- Catalog browse, faceted filter, semantic search, comparison, recommendations
- Cart, multi-cart, saved-for-later, wishlists (public/private/shared)
- Guest checkout (delegated mandate without account)
- One-click reorder, subscription orders, scheduled delivery
- Coupons, gift cards, loyalty redemption, referrals
- Order tracking, partial cancellation, returns/RMA, refunds
- Reviews & Q&A, verified-purchase badge, agent vs human authorship flag
- Direct messaging with sellers, dispute filing, escrow release
- Address book, payment methods, multiple currencies, tax-exempt status
- Notifications (webhook, email, push) per channel preference

### 6.2 Seller features
- **Minimum-friction onboarding** (resolved): two human touches total — (1) one-click consent to issue a seller agent passport, (2) one Stripe Connect KYB session before first payout. Everything else (profile creation, catalog, inventory, pricing, fulfillment, messaging) is pure agent-driven via MCP. Profile has two states: `active_listing_only` (can list and accept orders, payouts held) and `active_full` (KYB complete, payouts flow). Sellers may list and earn from day one; held balance releases automatically on KYB completion within the standard payout cycle.
- Onboarding + KYB (Stripe Connect, Persona)
- Catalog: products, variants, bundles, digital goods, services, subscriptions, pre-orders, backorders
- Inventory: multi-location, reservations, low-stock alerts, lot/serial tracking
- Pricing: list/sale/tiered/quantity discounts/personalized via agent
- Promotions, coupons, BOGO, time-boxed deals
- Order mgmt, partial fulfillment, split shipments, label printing
- Returns config, restocking fees, warranties
- Payouts, statements, tax reports, fee transparency
- Analytics dashboard via API (conversion, AOV, agent-traffic share)
- Seller-to-buyer messaging, automated FAQ agent

### 6.3 Platform features
- Multi-tenant, multi-currency (FX rates daily), multi-locale (i18n strings table)
- Tax engine: nexus rules, VAT/GST, marketplace facilitator, cross-border duties
- Shipping: rate shopping (multi-carrier), zone rules, hazmat flags, customs forms
- Fraud: velocity, geo, device fingerprint, agent-anomaly scoring
- Trust & safety: prohibited items, content moderation (LLM-assisted), counterfeit signals
- Admin: feature flags, rate-limit overrides, dispute escalation, ban/restore
- Compliance: GDPR/CCPA data export & erasure, SOC2 audit logs, PCI scope minimization (no PAN at rest)
- Localization: language packs, RTL, currency formatting

---

## 7. Payments & Money Movement

- **Stripe Agentic Commerce Suite** for buyer payments (delegated tokens, virtual single-use cards, ACP endpoint).
- **AP2** mandates layered on top — cart & payment mandates verified before charge.
- **Connect** for seller payouts (Express/Custom).
- **Escrow** holds for high-risk categories or new sellers; release on fulfillment confirmation.
- **Refunds & chargebacks** routed through Stripe with mandate cross-reference.
- **Multi-currency** settlement; daily FX snapshot table.
- **Stablecoin lane** (optional, x402) for B2B/cross-border agent-to-agent micro-billing.
- **Reconciliation**: nightly job matches Stripe transactions ↔ orders ↔ payouts; mismatches paged.

### 7.1 Subscription billing under AP2 (resolved)

Subscriptions need authorization that survives the original session. Mapped to AP2 as:

- **Recurring Intent Mandate**: parent mandate with `recurrence: {interval, max_per_period, end_after, total_cap}` and explicit list of allowed SKUs. Signed once by the human at checkout (Tier 4 step-up).
- **Per-cycle Cart Mandate**: synthesized server-side at each renewal from the parent mandate; server is the relying party, not the agent. Uses a marketplace-controlled signing key delegated by the parent mandate's `delegate_to` claim.
- **Per-cycle Payment Mandate**: bound to a tokenized payment instrument (Stripe customer, network token, or AP2 payment-method handle that supports recurring use).
- **Pre-charge notification**: 72h advance webhook + email to principal; cancellation window enforced server-side.
- **Mandate refresh**: principal must re-sign every 12 months (configurable, never longer); auto-pause on refresh expiry, not silent failure.
- **Failure handling**: smart retry with exponential backoff (1d, 3d, 7d), then dunning email/notification, then auto-pause after 14d. No more than 3 retries; each retry uses a fresh per-cycle mandate.
- **Proration**: handled by `subscription.update`; emits a delta Cart Mandate the principal must approve when the change increases spend.

### 7.2 Refund routing for destroyed instruments (resolved)

Single-use virtual cards, by design, can't be re-credited. Resolution order:

1. **Original instrument first**: if Stripe says the underlying funding source (the card, bank account, or wallet that funded the virtual card) is still valid, route refund there via Stripe's `source_transfer_reversal`. This works for ~95% of cases since the virtual card is just a tokenization layer.
2. **Linked principal wallet**: if (1) fails, credit the principal's marketplace stored-value account (`payment.wallet_balance`). Wallet is FBO custodial under our payments partner; redeemable on the next purchase or withdrawable to a verified bank account.
3. **Manual payout**: if no wallet exists or principal opts out, fall back to a Stripe payout to a bank account the principal verifies via micro-deposit / Plaid.
4. **Issued-credit-note as last resort**: signed VDC entitling principal to redeem within 7 years; non-expiring, transferable to same human.

The chosen route is part of the refund record (immutable) and surfaced in `/refunds/{id}.routing_method`.

### 7.3 Multi-party splits — atomic settlement (resolved)

A purchase splits across: seller(s), marketplace fee, payment-processor fee, affiliate, tax authority remittance, optional tip, optional charity. Atomic guarantees:

- **Single Stripe Connect transaction** with `transfer_data[]` and `application_fee_amount` carries the marketplace + seller + affiliate split atomically — Stripe enforces atomicity at the ledger.
- **Tax remittance** is a separate ledger move (we are marketplace-facilitator in many jurisdictions; tax sits in a segregated liability account until filing). The Stripe transaction credits us; a downstream bookkeeping job (TigerBeetle or double-entry Postgres ledger) immediately splits our slice into `marketplace_revenue` + `tax_payable`.
- **Saga pattern** for any cross-system step (e.g., charity rounding-up via a separate processor): coordinator records intent, executes side effects, and on partial failure runs compensating actions. Saga state stored in `payment.saga_executions` with status enum and replayable handlers.
- **Idempotency**: every leg keyed by `(order_id, leg_type, version)`; replays are no-ops.
- **Reconciliation**: hourly job verifies `Σ(legs) == gross - fees` per order; deviations halt payouts and page on-call.

We ship our own append-only **double-entry ledger** in Postgres regardless of Stripe — Stripe is one account in our ledger, not the source of truth for the marketplace P&L.

---

## 7a. Agent Reputation System (resolved)

Per-marketplace reputation, **portable** via signed export (no global leaderboard — avoids gaming, antitrust, and privacy issues).

**Inputs (signals)**
- Successful settlements (count, value, recency-weighted)
- Disputes opened against the agent (severity-weighted)
- Chargeback rate, refund rate, cancellation rate
- Latency / abandonment in checkout flows
- Compliance with stated mandate scopes (no scope-edge probing)
- Counterparty ratings (post-transaction, agent-side and seller-side)

**Score**
- Bayesian-smoothed, decayed (half-life 90 d).
- Stored as `agent_reputation(agent_id, score, components_jsonb, last_updated)`.
- Exposed via MCP tool `agent.reputation(agent_id)` — read by sellers when deciding whether to accept negotiation requests.

**Portability**
- `/agents/{id}/reputation/export` returns a signed VDC: `{agent_id, marketplace_id, score, components, period, signature}`. Other marketplaces may import as a prior; weight is their decision.
- No automatic federation — explicit consent each time.

**Anti-gaming**
- Reputation requires N≥10 settled tx and ≥30 days of history to be displayed; below that, "insufficient data".
- Wash-trading detection (cyclic graph in counterparties) → freeze + manual review.
- Self-reviews (same principal owns both sides) suppressed.

## 7b. Negotiation, Auctions & Dynamic Pricing (resolved)

A2A skill: `negotiate_price` with strict guardrails.

**Allowed**
- Quantity discounts within seller-pre-declared bands.
- Time-limited offers within seller-declared min margin floor.
- Bundle pricing.

**Not allowed (enforced server-side)**
- Cross-buyer price discrimination on protected attributes (jurisdiction-dependent).
- Discount below seller's `floor_price` (set per SKU; private to seller).
- Buyer-agent ↔ buyer-agent coordination on offers (collusion).

**Auction types** (skills): `auction.english`, `auction.dutch`, `auction.sealed_bid`. Each runs server-side as a state machine; agents submit bids via skill messages bound to a Cart Mandate that pre-authorizes the maximum bid.

**Anti-collusion**
- Negotiation transcripts hashed and stored; periodic statistical scan for price-fixing patterns.
- Reserve prices opaque to buyers.
- Per-(buyer-org, seller-org) negotiation rate limit.

## 8. Search, Discovery & Recommendations

- **Hybrid search**: BM25 (OpenSearch) + dense embeddings (pgvector or external) re-ranked with cross-encoder.
- **Agent-friendly queries**: natural language → structured filters via tool args (no NL parsing in DB).
- **Personalization**: per-agent and per-principal vectors; opt-in only.
- **Recommendations**: collaborative-filter + content-based; exposed as `catalog.recommend`.
- **Feeds**: real-time (SSE) for inventory & price changes for agent caches.

### 8.1 Embedding model versioning (resolved)

Embedding spaces are not portable across model versions, so re-ranking, similarity, and recommendations break the moment the model changes. Strategy:

- **Versioned columns**: `product_embeddings(product_id, model_id, model_version, vector, created_at)` — composite primary key on (product_id, model_id, model_version). pgvector index per (model_id, model_version) partition.
- **Active set marker**: a `embedding_model_active` table holds at most two rows: `current` and `next`. Search reads `current`; ingestion of new vectors writes to `next` during migration.
- **Dual-write window**: when introducing a new model, both `current` and `next` get vectors for every new/updated product. Background backfill computes `next` for the historic catalog.
- **Cutover**: when backfill is ≥ 99.5% complete and quality eval (NDCG@10 against held-out query set) shows non-regression, atomically swap `current` ← `next`. Old vectors retained 30 days for rollback.
- **Query-side**: queries are also embedded with the active model; query embedding is not cached across model versions.
- **Eval gate**: a labeled query/product judgment set lives in `test/embedding-eval/`; CI fails a model bump if NDCG@10 drops > 2 pp on held-out data.

### 8.2 SKU canonicalization (resolved)

Sellers list the same physical product under different SKUs, GTINs, MPNs, and titles. The marketplace canonicalizes to enable comparison, search dedup, and fair-rank.

- **Canonical product**: `catalog.canonical_products` keyed by `canonical_id` (UUIDv7). Holds normalized title, brand, GTIN-14, MPN, attributes, hero media.
- **Listing**: each seller's offer is a `catalog.listings` row referencing `canonical_id` + their own SKU + price + inventory. A canonical product is the rollup of N listings.
- **Matching pipeline** (deterministic → fuzzy → embedding):
  1. Exact match on `(GTIN, brand)` or `(MPN, brand)` if seller provides one (validated against GS1 check digit).
  2. Brand-locked title fuzzy match (Jaro-Winkler ≥ 0.92) plus key-attribute equality (size, color, model number).
  3. Embedding similarity ≥ threshold AND no contradicting attribute (e.g. capacity, region).
- **Confidence tiers**: matches stored with confidence enum (`exact`, `high`, `medium`); medium requires seller confirmation before the listing rolls up.
- **Disambiguation**: ambiguous matches surface to seller via `/seller/listings/{id}/canonical-suggestions`; if none accepted within 7 days, listing stays unrolled and excluded from comparison features (still searchable on its own).
- **Authoritative attributes**: brand-verified attributes (from authorized brand registry) win over seller-declared attributes when they conflict.
- **GTIN registry**: cache of GS1 GEPIR + brand-supplied data; missing entries fall back to fuzzy/embedding flow.

### 8.3 Counterfeit detection (resolved)

Layered signals; arbitration via two-stage process.

**Signals (per listing)**
- Brand-registry mismatch (declared brand not authorizing this seller).
- Price anomaly: ≥ 35% below brand's authorized-reseller floor on that GTIN.
- New-seller velocity: high-value brand SKUs from sellers < 90 days old with low reputation.
- Image hash hit against known-counterfeit corpus (perceptual hashing + brand-supplied templates).
- Description anomalies: missing/wrong serial format, misspelled brand, region-mismatch language.
- Buyer-side: historical refund/dispute rate for this listing or seller above brand category baseline.
- Test-buy program: marketplace operations staff sample-purchase flagged listings for physical authentication.

**Scoring**: weighted sum → `counterfeit_risk` ∈ {`low`, `elevated`, `high`}. Thresholds tuned per category.

**Actions by tier**
- `low`: list normally.
- `elevated`: listing visible but de-ranked; seller must upload supply-chain doc within 14 days; payouts held in escrow until clear.
- `high`: listing suppressed pending review (≤ 48 h SLA); buyer notified if already in cart.

**Arbitration**
1. **Brand-led** (Brand Registry portal): authorized brand reps submit takedown request with evidence (DMCA-style); auto-action within 24 h, seller can appeal.
2. **Marketplace-led** (no participating brand): trust-and-safety team rules on signal evidence; appeals go to a separate reviewer.
3. **Repeat offenders**: 3 substantiated counterfeit findings in 12 months → seller account terminated, payouts frozen pending dispute window, principals notified.

**Buyer remedy**: counterfeit-finding triggers full refund + return-shipping covered by marketplace, regardless of seller's policy. Marketplace recoups from seller's reserve.

---

### 8.4 Result snapshots (resolved)

Agents operate without screens; humans often want to see what the agent saw before approving a cart, taking over a session, or auditing a decision. Live re-querying is misleading because inventory, prices, and ranking shift second-to-second. Solution:

- **Frozen snapshot**: every call to `catalog.search`, `catalog.get_product`, `catalog.compare`, and `catalog.recommend` writes the exact tool output to a snapshot store keyed by an unguessable token (128 bits, base64url).
- **Link in tool response**: each response carries `snapshotUrl: {web_base}/s/{token}` plus `snapshotCreatedAt` and `snapshotExpiresAt` (epoch ms). The agent can paste the link into a chat with the human.
- **Public-token access**: anyone holding the link can open the snapshot — no login, no principal binding. The token entropy is the only access control. This matches the "agent shares a link with a human who may not even have a marketplace account" use case. Sensitive personalised recommendations rely on the token being shared deliberately.
- **TTL = 24h**: snapshots are stored in Redis with `EX 86400`. After 24h the key is gone and the route returns 410 Gone with a "snapshot expired" page. There is no extension or refresh; agents that need a fresh view re-run the tool.
- **Immutable**: once written, a snapshot is never updated. Edits to the underlying products do not propagate.
- **Storage**: production is Redis 7.4; an in-memory implementation is provided for tests. Both implement a common `SnapshotStore { put, get }` interface in `@marketplace/domain/catalog`.
- **Web rendering**: `/s/{id}` (Next.js route) fetches via `GET /v1/snapshots/{id}` and renders kind-specific views (search list, product card, comparison table, raw recommend payload). The page is `noindex,nofollow`.
- **Audit**: snapshot creation does not produce a separate audit event — it is a side effect of the originating tool call, which already audits inputs and outputs. The snapshot id is part of the audited output hash.
- **Privacy**: snapshots may contain seller-supplied content tagged `untrusted_content`; the renderer treats it as data exactly like the agent does.

## 8a. Trust & Safety

### 8a.1 Prompt-injection defense (resolved)

Any seller-supplied text (titles, descriptions, attributes, Q&A, messages) is **untrusted content** that may attempt to hijack a buyer agent reading it. Defenses:

- **Content tagging at API boundary**: every field that originates from a non-platform principal is wrapped in a structured envelope `{role: "untrusted_content", origin: "seller:<id>", value: "..."}` when returned via MCP tools. SDK clients are documented to render content fields as data, never as instructions.
- **Output sanitization**: strip or escape `<system>`, `<assistant>`, `<tool>` tags, role markers, and known jailbreak prefixes ("ignore previous", "you are now", etc.) at write time. Original raw text retained in `*_raw` columns for audit; agents only see sanitized.
- **Length & structure caps**: titles ≤ 200, descriptions ≤ 16 KB, attributes ≤ 1 KB. Hard rejection above; soft truncation with explicit `truncated: true` flag.
- **Image/file alt-text**: same envelope; OCR'd text from images flagged and treated as untrusted.
- **Outbound rate-limiting on agent actions**: a buyer agent that suddenly issues unusual tool calls right after reading a product (e.g. `cart.add_item` on a different SKU than searched, or `agent.update_passport`) triggers a soft step-up.
- **Detection layer**: classifier (small fine-tuned LLM) scores every seller-submitted field for injection-likelihood; high scores → manual review, listing not surfaced via search until cleared.
- **Honeypot canaries**: synthetic "trap" instructions injected into a tiny fraction of fields; if a buyer-side agent ever echoes the canary back through messaging or actions, we know the agent is non-compliant and flag the integration.

### 8a.2 Fake-review and review-fraud detection (resolved)

Reviews are valuable signal precisely because they're hard to fake. With agents authoring reviews, we must distinguish legitimate agent-authored from coordinated fakes.

- **Authorship tagging**: every review carries `author_kind ∈ {human, agent}` and, if agent, the agent passport ref. Buyers and sellers see the tag; ranking weights agent reviews differently (down-weighted by default, configurable per buyer's filter).
- **Verified-purchase requirement**: only reviewable from accounts (or agents) with a settled order for that listing or canonical product. Returned/refunded purchases mark the review with `outcome: returned`.
- **Coordination signals**:
  - Burst detection: > N reviews on a SKU within a window from accounts with shared signal (IP block, payment instrument graph, agent-org graph, device fingerprint).
  - Linguistic similarity: embedding-cluster of review text; clusters of near-duplicates from unrelated accounts → suppressed.
  - Reviewer history: accounts that only review a single brand or seller across categories.
  - Incentive disclosure: keyword & graph detection of seller-buyer side-channels offering refunds for reviews.
- **Action ladder**: low-suspicion → keep + display; medium → display but exclude from rating average; high → suppress and notify reviewer; confirmed coordination → seller penalty (rating reset, payouts on hold), reviewer ban.
- **Right of reply**: sellers can post one official response per review; responses ranked alongside.
- **Appeal**: reviewers and sellers can appeal suppression; reviewed by a different team member from the suppressor.
- **Public methodology**: aggregated stats published quarterly (% suppressed, % appealed, % overturned) — transparency report.

### 8a.3 Prohibited items & jurisdictional enforcement (resolved)

A listing must be allowed in **both** the seller's origin jurisdiction AND every jurisdiction it can ship to. Implementation:

- **Restricted-items registry**: hierarchical taxonomy mapped to ISO-3166 country codes (and US state subdivisions) with effective-date ranges. Categories: outright prohibited, age-restricted, license-required, carrier-prohibited, export-controlled, hazmat.
- **Listing classification**: every listing tagged with one or more taxonomy nodes via (a) seller declaration, (b) ML classifier on title/description/images, (c) GTIN→category mapping. Conflicts resolved by stricter wins.
- **Storefront filtering**: catalog queries always include a buyer-jurisdiction filter; listings invisible where prohibited.
- **Checkout gate**: re-validates at quote time using the actual ship-to address; blocks with explicit reason. Cart Mandate cannot pre-authorize across jurisdictional restrictions.
- **Age/identity gates**: age-restricted items require a verified age claim from the buyer's principal (cached, refresh annually). Government-ID verification through a regulated provider (e.g. Persona, Onfido) for stricter categories.
- **Export controls**: dual-use goods (EAR, ITAR) — export classification number on the listing; ship-to country denied-party list checked against US OFAC, UK OFSI, EU consolidated list, UN sanctions; sanctioned-party screening on principals.
- **Hazmat & carrier rules**: cross-checked against carrier prohibitions before label generation; lithium batteries, aerosols, perishables flagged.
- **Audit trail**: every block decision logged with `(listing_id, principal_id, ship_to, reason, registry_version)` for regulator inquiries.
- **Operator override**: only the platform compliance role can unblock a listing in a given jurisdiction, with documented reason; auto-expires.

## 9. Observability & Operations

- OpenTelemetry traces with `agent.id`, `mandate.id`, `principal.id` baggage.
- Per-tool latency SLOs (p99 < 250 ms read, < 800 ms write).
- Structured JSON logs; PII redaction at log gateway.
- Hash-chained audit log; daily Merkle root anchored to public ledger (optional).
- Health: `/livez`, `/readyz`, dependency checks.
- Chaos: nightly fault-injection in staging.
- Backups: PITR (PostgreSQL physical), 30-day retention, quarterly restore drills.
- DR: warm standby in second region; RPO 1 min, RTO 15 min.

---

## 10. Testing Strategy

Marketplace MUST be fully testable with no UI. Five layers:

1. **Unit** (Vitest) — pure domain logic, ≥ 90% line coverage on services.
2. **Contract** (Pact + JSON Schema) — every MCP tool & REST endpoint has a contract test; CI fails on breaking change without version bump.
3. **Integration** — testcontainers Postgres + Redis + Stripe-mock + AP2 reference impl; full request cycles.
4. **Agent simulation** — fixture-driven "buyer agent" runs end-to-end purchase journeys against staging using the official MCP client SDK; recorded as golden transcripts.
5. **Load & chaos** — k6 for throughput; Toxiproxy for failure injection; DAST (OWASP ZAP) and SAST (Semgrep) gates on every PR.

Test data: deterministic seed fixtures, plus a *catalog generator* producing 10M synthetic products for scale tests. Sandbox Stripe + AP2 reference server for payment tests.

---

## 11. Security Controls

- TLS 1.3 only, HSTS preload.
- Argon2id for any passwords (humans only; agents use keys).
- All agent tokens DPoP-bound, short-lived (≤ 10 min), with refresh.
- mTLS internal service mesh.
- Dependency scanning (Renovate + Snyk), reproducible builds, SLSA L3.
- Signed container images (cosign), admission policy.
- Secret scanning (gitleaks) pre-commit + CI.
- Bug bounty program, coordinated disclosure policy.
- Annual pentest, quarterly internal red-team focused on agent-specific attacks (prompt injection, mandate forgery, scope escalation).

---

## 12. Roadmap (driving the spec, not committed dates)

- **M1 — Skeleton**: monorepo, schemas, OAuth, MCP scaffolding, catalog read tools, sandbox payments. Contract & integration tests green.
- **M2 — Buy path**: cart, checkout, AP2 mandate verification, Stripe ACP, order lifecycle, webhooks. End-to-end agent purchase passes.
- **M3 — Sell path**: seller onboarding, product mgmt, fulfillment, payouts, returns, disputes.
- **M4 — Discovery**: search, recommendations, A2A negotiation skills.
- **M5 — Trust**: reviews, messaging, escrow, fraud rules, admin tooling.
- **M6 — Scale**: multi-region, observability hardening, chaos suite, performance tuning.
- **M7 — Ecosystem**: stablecoin lane, public partner API, marketplace registry listing.

---

## 13. Open Questions / Continuous Refinement Backlog

- Should mandates be persisted as raw VDCs or only hashes? (privacy vs auditability)
- Reputation system for agents — global score vs per-marketplace?
- Pricing primitives for agent-negotiated dynamic prices (anti-collusion)?
- Cross-marketplace cart federation via A2A?
- On-chain settlement option for B2B?
- Carbon accounting per shipment as a first-class field?
- Bot-vs-bot arbitrage detection — when is it abuse vs normal commerce?

These are tracked in `OPEN_QUESTIONS.md` and resolved iteratively as the spec is refined.

---

## Appendix A — Sources (May 2026 versions)

- TypeScript 6.0.3 (stable), 7.0 beta — devblogs.microsoft.com/typescript
- Node.js 24.15.0 LTS — nodejs.org/en/blog/release/v24.15.0
- PostgreSQL 18.3 — postgresql.org news 2026-02-26
- MCP TypeScript SDK 1.29 — github.com/modelcontextprotocol/typescript-sdk
- Stripe Agentic Commerce Suite — stripe.com/blog/agentic-commerce-suite
- AP2 v0.2.0 (Apr 2026) — github.com/google-agentic-commerce/AP2
- Drizzle ORM, Prisma 7 comparisons — 2026 community surveys
