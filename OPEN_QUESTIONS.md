# Open Questions — refinement backlog

Each iteration of `/loop` picks 1–3 of these and converts them into resolved
spec sections. Once a question is answered in `SPEC.md` and two iterations
pass without amendment, it is removed from this file — the spec is the
record, this list is the queue.

## Identity & trust
- Agent reputation portability format — VDC schema beyond what's sketched in §7a needs concrete JSON Schema.
- Cross-tenant passport recognition: do we honor passports issued by other marketplaces, and how do we trust their root keys?
- CRL signing key rotation process and key custody.
- Reputation export VDC: claim set definition.
- Mandate-receipt format details (we reference VDCs; need exact JSON Schema).

## Commerce model
- Cross-marketplace cart federation via A2A — cart "portability" semantics?
- Tipping/gratuity for agents-as-service?
- Group-buy / cooperative purchasing primitives?
- Floor-price storage for sellers (encrypted column? RLS-protected?).
- Auction state machine: timeout / network partition recovery.
- Negotiation transcript retention vs GDPR.

## Payments
- Stablecoin lane (x402): which chains; how to KYT?
- Stored-value wallet (mentioned in §7.2): regulatory positioning per jurisdiction (money transmitter, e-money, FBO custodial)?
- Double-entry ledger: TigerBeetle vs vanilla Postgres — which scales for our projected throughput?

## Catalog & data
- Localized product copy: per-locale rows vs translation overlay?
- Product ingestion API: bulk + streaming + change-data-capture semantics?
- Brand Registry portal — onboarding flow, authentication, scope of brand authority over listings?
- Test-buy program operational details — budget, jurisdiction handling, post-test handling of goods?

## Trust & safety
- LLM-assisted moderation — human-in-loop threshold; appeal SLA? (partially addressed in §8a.2 ladder; SLAs still TBD)
- Bot-vs-bot arbitrage: when does it become abuse vs healthy market-making?
- Appeal-process SLAs (review suppression, listing block, account suspension) — concrete numbers.
- Restricted-items registry: who maintains, how often updated, source of truth?

## Operations
- Multi-region active-active vs active-passive — cost vs RPO?
- Tenant isolation: schema-per-tenant vs row-level + RLS?
- Audit-log anchoring to public ledger — frequency & cost?
- Cache invalidation on product/price changes — push-based feed for agent caches?
- Database sharding strategy beyond ~10TB?

## Sustainability / ethics
- Carbon footprint per order as a first-class field — calc methodology?
- Fair-rank mandates (no pay-to-play in agent recommendations)?
- Right-to-repair / reusable-packaging discoverability flags?
