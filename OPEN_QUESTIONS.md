# Open Questions — refinement backlog

Each iteration of `/loop` picks 1–3 of these and converts them into resolved spec sections.
Resolved items are kept here briefly, then removed once two iterations pass without amendment.

## Identity & trust
- ~~Mandate persistence: raw VDC vs hash-only~~ — **RESOLVED v0.2 §3.5**: persist both; raw VDC encrypted in vault, hash in hot table.
- ~~Revocation propagation latency~~ — **RESOLVED v0.2 §3.6**: 2 s p99 via LISTEN/NOTIFY + DPoP TTL + CRL.
- ~~Step-up auth thresholds~~ — **RESOLVED v0.2 §3.7**: 6-tier table; principals can tighten.
- Agent reputation portability format — VDC schema beyond what's sketched in §7a needs concrete JSON Schema.
- Cross-tenant passport recognition: do we honor passports issued by other marketplaces, and how do we trust their root keys?

## Commerce model
- ~~Negotiated dynamic pricing guardrails~~ — **RESOLVED v0.2 §7b**: floor price + transcripts + anti-collusion scan.
- ~~Auctions: English, Dutch, sealed-bid~~ — **RESOLVED v0.2 §7b**: server-side state machine, mandate-bound bids.
- Cross-marketplace cart federation via A2A — cart "portability" semantics?
- Tipping/gratuity for agents-as-service?
- Group-buy / cooperative purchasing primitives?

## Payments
- Stablecoin lane (x402): which chains; how to KYT?
- ~~Refund routing when buyer's payment instrument was a single-use virtual card~~ — **RESOLVED v0.3 §7.2**: original-source → wallet → manual payout → credit-note VDC.
- ~~Multi-party splits atomic settlement guarantees~~ — **RESOLVED v0.3 §7.3**: Stripe Connect for atomic legs + own double-entry Postgres ledger + saga for cross-system steps.
- ~~Subscription billing with mandate renewal~~ — **RESOLVED v0.3 §7.1**: Recurring Intent → per-cycle Cart + Payment Mandate; 12-month re-sign cap.
- ~~Failed-payment retry policy~~ — **RESOLVED v0.3 §7.1**: 3-retry smart schedule (1d/3d/7d), then dunning, then auto-pause at 14d.
- Stored-value wallet (mentioned in §7.2): regulatory positioning per jurisdiction (money transmitter, e-money, FBO custodial)?
- Double-entry ledger: TigerBeetle vs vanilla Postgres — which scales for our projected throughput?

## Catalog & data
- ~~Counterfeit detection — signals & arbitration~~ — **RESOLVED v0.4 §8.3**: layered signals, 3-tier risk, brand-led + marketplace-led arbitration, buyer auto-refund.
- ~~Embedding model versioning — re-embed vs dual-write~~ — **RESOLVED v0.4 §8.1**: dual-write `current`/`next`, NDCG@10 eval gate, 30-day rollback window.
- ~~SKU canonicalization across sellers~~ — **RESOLVED v0.4 §8.2**: canonical-product + listings model, GTIN→fuzzy→embedding pipeline with confidence tiers.
- Localized product copy: per-locale rows vs translation overlay?
- Product ingestion API: bulk + streaming + change-data-capture semantics?
- Brand Registry portal — onboarding flow, authentication, scope of brand authority over listings?
- Test-buy program operational details — budget, jurisdiction handling, post-test handling of goods?

## Trust & safety
- LLM-assisted moderation — human-in-loop threshold; appeal SLA? (partially addressed in §8a.2 ladder; SLAs still TBD)
- ~~Prohibited items list — jurisdiction-aware enforcement~~ — **RESOLVED v0.5 §8a.3**: registry × jurisdiction matrix, classification, checkout gate, denied-party screening.
- Bot-vs-bot arbitrage: when does it become abuse vs healthy market-making?
- ~~Prompt-injection in product descriptions~~ — **RESOLVED v0.5 §8a.1**: untrusted-content envelope, sanitization, classifier, honeypot canaries.
- ~~Fake-review detection in agent-authored reviews~~ — **RESOLVED v0.5 §8a.2**: authorship tagging, verified-purchase gate, coordination signals, transparency report.
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

## Newly surfaced during v0.5 refinement
- ~~Minimum-friction seller & buyer onboarding via agent~~ — **RESOLVED v0.5 §3.8, §5.2, §6.2**: two human touches max for sellers (consent + KYB), one for buyers (consent); profile state `active_listing_only` lets sellers earn before KYB clears.

## Newly surfaced during v0.2 refinement
- Mandate-receipt format details (we reference VDCs; need exact JSON Schema).
- CRL signing key rotation process and key custody.
- Reputation export VDC: claim set definition.
- Floor-price storage for sellers (encrypted column? RLS-protected?).
- Auction state machine: timeout / network partition recovery.
- Negotiation transcript retention vs GDPR.
