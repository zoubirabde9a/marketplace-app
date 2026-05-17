# Audit: scraper validation rejects entire pages for several categories

- **Detected:** 2026-05-17 19:42 local (server time 17:42 UTC)
- **Severity:** medium — wasted scrape bandwidth, catalog not growing in affected categories
- **Source:** `/opt/marketplace/data/logs/metrics.jsonl` (vps-eu)

## Evidence

Successive run-loop iterations show `seeded=0, dup_skipped=0, invalid_skipped=50` for an entire 50-listing page, repeated across multiple categories and multiple runs:

```
2026-05-17T17:32:18Z electronique_electromenager  start_page=581  seeded=0  invalid_skipped=50
2026-05-17T17:34:13Z immobilier                   start_page=3017 seeded=0  invalid_skipped=50
2026-05-17T17:35:14Z automobiles_vehicules        start_page=3015 seeded=0  invalid_skipped=50
2026-05-17T17:36:21Z telephones                   start_page=499  seeded=0  invalid_skipped=50
2026-05-17T17:38:14Z electronique_electromenager  start_page=583  seeded=0  invalid_skipped=50
2026-05-17T17:40:15Z immobilier                   start_page=3019 seeded=0  invalid_skipped=50
2026-05-17T17:41:15Z automobiles_vehicules        start_page=3017 seeded=0  invalid_skipped=50
```

Only `informatique` and (sometimes) `vetements_mode` are seeding any rows. `dup_skipped=0` on the failing categories means the seeder is not even getting to the dedup check — listings are being rejected by validation before insert.

## Hypothesis

The validation step in `scripts/seed-from-scraped.mjs` (or its built sibling `packages/db/dist/seed-from-scraped.js`) is rejecting 100% of scraped rows for these categories. Likely cause: a schema field added to validation (price format, currency, required attribute, image URL pattern) that the scraper hasn't been updated to emit for these specific categories. `immobilier` and `automobiles_vehicules` are structurally different from `informatique` (no SKU, different price unit, often "à débattre" instead of a numeric price), which lines up.

## Fix steps

1. Inside one of the ad-hoc node containers the run-loop spins up, re-run the seeder with verbose/debug logging so the rejection reason is visible per listing. The validator likely silently increments `invalid_skipped` — add a `console.warn` with the failing field on first ~5 rejections per run.
2. Sample one scraped listing from each failing category and a passing category; diff the JSON to find the missing/malformed field.
3. Either (a) relax validation for fields that aren't load-bearing, or (b) fix the scraper extractor for those categories to populate them.
4. Verify by tailing `metrics.jsonl` and watching `seeded` go non-zero for the affected categories.

## Similar issues to scan for

- Check whether `seller_id` is empty in metrics for the seeder runs (it is — `"seller_id":""` on every line above). The CLAUDE.md note says the canonical run passes `--seller-id 019e08a4-97cd-7d98-afd7-670878dc51c2` but metrics show empty. Either the orchestration that calls `run-loop.sh` isn't passing it, or the metrics emitter isn't reading it. Confirm what seller these rows are being attributed to in the DB — if it's a default/wrong account, that's a data-integrity problem.
- The `max_products` cap is 280000 in metrics but CLAUDE.md documents 14200 as the steady-state cap. Either the doc is stale or the systemd unit got changed; reconcile.
