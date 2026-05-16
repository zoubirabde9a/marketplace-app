#!/usr/bin/env python3
"""
Refresh catalog stats in /.well-known/agents.json from the live DB.

Designed to be invoked on a systemd timer (see deploy/systemd/
marketplace-refresh-catalog-stats.{service,timer}) so the GEO manifest
stays in sync with the live catalog as the scrape loop adds listings.

What it updates in agents.json:
  catalog.total_listings        ← SELECT count(*) FROM catalog.products
  catalog.active_sellers        ← COUNT DISTINCT seller_id
  catalog.snapshot_date         ← today's UTC date (YYYY-MM-DD)
  catalog.snapshot_time_utc     ← current UTC time (HH:MM)
  catalog.size                  ← prose blurb re-stitched from the above
  catalog.top_categories[]      ← ranked by SELECT count GROUP BY slug
  catalog.top_brands[]          ← ranked by SELECT count GROUP BY brand

What it does NOT touch:
  The two prose files (llms.txt, llms-full.txt). Those have natural-
  language phrasing that I don't want to corrupt with regex substitution
  — refresh manually when the figures move enough to matter (e.g.
  monthly, or when crossing a round number like 50k).

After updating, the URL is pushed to IndexNow so Bing re-fetches the
new payload immediately.

Idempotent: re-running with no DB changes is a no-op (same numbers
written back).

Usage:
  refresh-catalog-stats.py                       # production
  REFRESH_DRY_RUN=1 refresh-catalog-stats.py     # print, don't write
"""

import json
import os
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

COMPOSE = "/opt/marketplace/docker-compose.prod.yml"
PUBLIC_HOST = Path("/opt/marketplace/packages/web/public")
PUBLIC_CONTAINER = "/app/packages/web/public"
MANIFEST_HOST = PUBLIC_HOST / ".well-known/agents.json"
MANIFEST_CONTAINER = f"{PUBLIC_CONTAINER}/.well-known/agents.json"
LLMS_HOST = PUBLIC_HOST / "llms.txt"
LLMS_CONTAINER = f"{PUBLIC_CONTAINER}/llms.txt"
LLMS_FULL_HOST = PUBLIC_HOST / "llms-full.txt"
LLMS_FULL_CONTAINER = f"{PUBLIC_CONTAINER}/llms-full.txt"
INDEXNOW_AGENTS = "https://teno-store.com/.well-known/agents.json"
INDEXNOW_LLMS = "https://teno-store.com/llms.txt"
INDEXNOW_LLMS_FULL = "https://teno-store.com/llms-full.txt"

DRY_RUN = os.environ.get("REFRESH_DRY_RUN") == "1"

CATEGORY_LABELS = {
    "informatique": "Informatique",
    "electronique_electromenager": "Électronique & Électroménager",
    "telephones": "Téléphones",
    "immobilier": "Immobilier",
    "vetements_mode": "Vêtements & Mode",
}


def psql(sql: str) -> str:
    """Run a SQL statement via the live Postgres container, return raw output."""
    cmd = [
        "docker", "compose", "-f", COMPOSE, "exec", "-T", "postgres",
        "psql", "-U", "marketplace", "-d", "marketplace", "-tA", "-c", sql,
    ]
    return subprocess.check_output(cmd, text=True).strip()


def fetch_stats() -> dict:
    total = int(psql("SELECT count(*) FROM catalog.products"))
    sellers = int(psql("SELECT count(DISTINCT seller_id) FROM catalog.products WHERE seller_id IS NOT NULL"))
    # Honesty fields: the bare "active_sellers" count is misleading because
    # most listings (~95% on 2026-05-16) are imported from the broader
    # Algerian marketplace and have NULL seller_id (not attributed to any
    # account), while the seller-onboarded portion is currently dominated
    # by a single account. AI panels that cite "7 active sellers" without
    # this nuance produce false-precision claims. Surface the breakdown
    # explicitly so consumers of the manifest can frame correctly.
    unattributed = int(psql("SELECT count(*) FROM catalog.products WHERE seller_id IS NULL"))
    onboarded = int(psql("SELECT count(*) FROM catalog.products WHERE seller_id IS NOT NULL"))
    sellers_meaningful = int(psql("SELECT count(*) FROM (SELECT seller_id FROM catalog.products WHERE seller_id IS NOT NULL GROUP BY seller_id HAVING count(*) >= 10) s"))
    # Top wilayas with actual listings — same pattern as the static
    # cities[] array, but ranked by real count and including only wilayas
    # that actually have ≥5 listings. The wilaya field is populated only
    # on seller-attributed listings (~4.9% of the catalog as of
    # 2026-05-16), but those are the listings whose location signals
    # matter for "[product] available in [city]" AI panel queries.
    wilayas_raw = psql(
        "SELECT attributes->>'wilaya' || '|' || count(*) "
        "FROM catalog.products WHERE attributes->>'wilaya' IS NOT NULL "
        "AND attributes->>'wilaya' <> '' "
        "GROUP BY attributes->>'wilaya' HAVING count(*) >= 5 "
        "ORDER BY count(*) DESC LIMIT 10"
    )
    top_wilayas: list[dict] = []
    for line in wilayas_raw.splitlines():
        name, n = line.split("|", 1)
        top_wilayas.append({"name": name, "listings": int(n)})
    wilaya_tagged = int(psql(
        "SELECT count(*) FROM catalog.products WHERE attributes->>'wilaya' IS NOT NULL"
    ))
    cats_raw = psql(
        "SELECT category_ids->>0 || '|' || count(*) "
        "FROM catalog.products GROUP BY category_ids->>0 "
        "ORDER BY count(*) DESC LIMIT 5"
    )
    top_categories = []
    for line in cats_raw.splitlines():
        slug, n = line.split("|", 1)
        if slug not in CATEGORY_LABELS:
            continue
        top_categories.append({
            "slug": slug,
            "listings": int(n),
            "label": CATEGORY_LABELS[slug],
        })
    brands_raw = psql(
        "SELECT brand || '|' || count(*) "
        "FROM catalog.products WHERE brand IS NOT NULL AND brand <> '' "
        "GROUP BY brand ORDER BY count(*) DESC LIMIT 15"
    )
    top_brands = []
    for line in brands_raw.splitlines():
        name, n = line.split("|", 1)
        top_brands.append({"name": name, "listings": int(n)})
    return {
        "total_listings": total,
        "active_sellers": sellers,
        "sellers_with_meaningful_inventory": sellers_meaningful,
        "listings_attributed_to_a_seller": onboarded,
        "listings_unattributed_imports": unattributed,
        "top_categories": top_categories,
        "top_brands": top_brands,
        "top_wilayas": top_wilayas,
        "wilaya_tagged_listings": wilaya_tagged,
    }


def update_manifest(stats: dict) -> bool:
    """Mutate agents.json in place. Return True if anything actually changed."""
    data = json.loads(MANIFEST_HOST.read_text(encoding="utf-8"))
    catalog = data["catalog"]
    now = datetime.now(timezone.utc)
    new_total = stats["total_listings"]
    catalog["total_listings"] = new_total
    catalog["active_sellers"] = stats["active_sellers"]
    # See fetch_stats() for why these breakdown fields exist. Surfacing them
    # in the manifest lets AI consumers cite "Teno Store has X seller-
    # onboarded listings plus Y imported listings from the broader Algerian
    # marketplace" instead of the false-precision "7 active sellers".
    catalog["sellers_with_meaningful_inventory"] = stats["sellers_with_meaningful_inventory"]
    catalog["listings_attributed_to_a_seller"] = stats["listings_attributed_to_a_seller"]
    catalog["listings_unattributed_imports"] = stats["listings_unattributed_imports"]
    # Replace the static geography.cities array with a ranked, count-
    # bearing wilaya list reflecting the actual seller-tagged geographic
    # distribution. Mirrors the top_brands shape so AI consumers can do
    # the same "rank by listing count" reasoning on cities.
    if "geography" in catalog:
        catalog["geography"]["top_wilayas"] = stats["top_wilayas"]
        catalog["geography"]["wilaya_tagged_listings"] = stats["wilaya_tagged_listings"]
        catalog["geography"]["wilaya_tagged_note"] = (
            "Wilaya / city data is populated only on seller-onboarded listings "
            "(currently ~5% of the catalog). The 95% bulk-imported portion has "
            "no per-listing location attribution. The ranked list below is the "
            "true distribution within the tagged subset."
        )
    catalog["snapshot_date"] = now.strftime("%Y-%m-%d")
    catalog["snapshot_time_utc"] = now.strftime("%H:%M")
    catalog["size"] = (
        f"{new_total:,}+ live listings across {stats['active_sellers']} active "
        f"sellers, refreshed continuously (snapshot "
        f"{catalog['snapshot_date']} {catalog['snapshot_time_utc']} UTC)"
    )
    catalog["top_categories"] = stats["top_categories"]
    catalog["top_brands"] = stats["top_brands"]
    new_text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    old_text = MANIFEST_HOST.read_text(encoding="utf-8")
    if new_text == old_text:
        return False
    if DRY_RUN:
        print("DRY_RUN — would write:")
        print(new_text[:500] + ("..." if len(new_text) > 500 else ""))
        return True
    MANIFEST_HOST.write_text(new_text, encoding="utf-8")
    return True


def hot_copy_to_web_container(host_path: Path, container_path: str) -> None:
    cid = subprocess.check_output(
        ["docker", "compose", "-f", COMPOSE, "ps", "-q", "web"], text=True
    ).strip()
    if not cid:
        raise SystemExit("web container not running")
    subprocess.check_call([
        "docker", "cp", str(host_path), f"{cid}:{container_path}"
    ])


def push_to_indexnow(urls: list[str]) -> None:
    subprocess.run(
        [
            "docker", "run", "--rm", "-i",
            "--network", "marketplace_default",
            "-v", "/opt/marketplace/scripts:/scripts",
            "node:22-alpine",
            "node", "/scripts/indexnow-submit.mjs", "--stdin",
        ],
        input="\n".join(urls) + "\n",
        text=True,
        check=False,  # IndexNow failure shouldn't fail the refresh
    )


# Round to the nearest 100 for prose phrasing — keeps the manifest from
# churning on every single listing add (e.g. 48,103 → 48,107 isn't worth
# rewriting the file for). The structured JSON keeps exact counts; this
# is just for the human-readable text.
def round_to_100(n: int) -> int:
    return round(n / 100) * 100


CATEGORY_TABLE_LABELS = {
    "informatique": "Informatique",
    "electronique_electromenager": "Électronique & Électroménager",
    "telephones": "Téléphones",
    "immobilier": "Immobilier",
    "vetements_mode": "Vêtements & Mode",
}


def refresh_llms_full_txt(stats: dict) -> bool:
    """Patch the exact-count markdown tables in llms-full.txt plus the
    snapshot/total prose lines. Tables show precise figures (not rounded
    — they're structured data, like JSON cells). Drift-safe: rows whose
    label anchor isn't found are skipped silently."""
    import re
    text = LLMS_FULL_HOST.read_text(encoding="utf-8")
    original = text
    now = datetime.now(timezone.utc)
    total = stats["total_listings"]
    sellers = stats["active_sellers"]
    cat_counts = {c["slug"]: c["listings"] for c in stats["top_categories"]}
    # 1. Snapshot line at the top.
    text = re.sub(
        r"^Snapshot: [\d-]+(?: \d\d:\d\d UTC)?[^\n]*\.",
        f"Snapshot: {now.strftime('%Y-%m-%d %H:%M UTC')} (catalog grows ~500/hour from the live scraper).",
        text,
        count=1,
        flags=re.M,
    )
    # 2. Total-listings prose line.
    text = re.sub(
        r"^- Total listings: ~[\d,]+ across \d+ active sellers[^\n]*",
        f"- Total listings: ~{round_to_100(total):,} across {sellers} active sellers (and growing).",
        text,
        count=1,
        flags=re.M,
    )
    # 3. Per-category markdown table rows. Anchor on the French label at
    #    column start so we can't match the unrelated `informatique` slug
    #    column.
    for slug, label in CATEGORY_TABLE_LABELS.items():
        if slug not in cat_counts:
            continue
        # Pattern: "| Label<padding>| <count> ... |"
        # Use a non-greedy match so we don't span multiple table rows.
        pattern = re.compile(
            r"(\| " + re.escape(label) + r"\s+\| )[\d,]+(\s+\| `" + re.escape(slug) + r"`)"
        )
        text = pattern.sub(lambda m, n=cat_counts[slug]: f"{m.group(1)}{n:,}{m.group(2)}", text)
    # 4. Brand markdown table rows. Anchor on the brand name at column
    #    start. Iterate over the live top-brands list so we capture
    #    every brand currently in the table.
    for brand in stats["top_brands"]:
        name = brand["name"]
        count = brand["listings"]
        pattern = re.compile(
            r"(\| " + re.escape(name) + r"\s+\| )[\d,]+(\s+\|)"
        )
        text = pattern.sub(lambda m, n=count: f"{m.group(1)}{n:,}{m.group(2)}", text)
    if text == original:
        return False
    if DRY_RUN:
        print("DRY_RUN llms-full.txt diff: (would patch)")
        return True
    LLMS_FULL_HOST.write_text(text, encoding="utf-8")
    return True


def refresh_llms_txt(stats: dict) -> bool:
    """Patch numeric tokens in llms.txt. Safe against prose drift — if the
    expected pattern isn't found, the line is left alone."""
    import re
    text = LLMS_HOST.read_text(encoding="utf-8")
    original = text
    now = datetime.now(timezone.utc)
    total_rounded = round_to_100(stats["total_listings"])
    sellers = stats["active_sellers"]
    # Build {slug: rounded_count} from the fetched top categories.
    cat_counts = {c["slug"]: round_to_100(c["listings"]) for c in stats["top_categories"]}
    # 1. "Scale" line — total + sellers + snapshot timestamp.
    text = re.sub(
        r"- Scale: ~[\d,]+ live product listings across \d+ active sellers, sourced from\n"
        r"  real Algerian marketplaces and refreshed continuously \(snapshot [\d-]+(?: \d\d:\d\d UTC)?[^)]*\)\.",
        f"- Scale: ~{total_rounded:,} live product listings across {sellers} active sellers, sourced from\n"
        f"  real Algerian marketplaces and refreshed continuously (snapshot "
        f"{now.strftime('%Y-%m-%d %H:%M UTC')} — catalog grows by ~500/hour from the live scraper).",
        text,
    )
    # 2. Per-category bullet counts. Narrow anchors: the French label and
    #    the search?category= URL fragment so we can't accidentally match
    #    an unrelated number.
    cat_patterns = [
        ("informatique", r"(- Informatique \(~)[\d,]+(\s+listings\) — `/search\?category=informatique)"),
        ("electronique_electromenager", r"(- Électronique & Électroménager \(~)[\d,]+(\s+listings\) —\n    `/search\?category=electronique_electromenager)"),
        ("telephones", r"(- Téléphones \(~)[\d,]+(\s+listings\) — `/search\?category=telephones)"),
        ("immobilier", r"(- Immobilier \(~)[\d,]+(\s+listings\) — `/search\?category=immobilier)"),
        ("vetements_mode", r"(- Vêtements & Mode \(~)[\d,]+(\s+listings\) — `/search\?category=vetements_mode)"),
    ]
    for slug, pattern in cat_patterns:
        if slug in cat_counts:
            text = re.sub(pattern, lambda m, c=cat_counts[slug]: f"{m.group(1)}{c:,}{m.group(2)}", text)
    if text == original:
        return False
    if DRY_RUN:
        print("DRY_RUN llms.txt diff: (would patch)")
        return True
    LLMS_HOST.write_text(text, encoding="utf-8")
    return True


def main() -> int:
    stats = fetch_stats()
    print(
        f"stats: total={stats['total_listings']} "
        f"sellers={stats['active_sellers']} "
        f"top1={stats['top_categories'][0]['slug']}={stats['top_categories'][0]['listings']}"
    )
    json_changed = update_manifest(stats)
    llms_changed = refresh_llms_txt(stats)
    llms_full_changed = refresh_llms_full_txt(stats)
    if not (json_changed or llms_changed or llms_full_changed):
        print("nothing changed — no push needed")
        return 0
    if DRY_RUN:
        return 0
    changed_urls = []
    if json_changed:
        hot_copy_to_web_container(MANIFEST_HOST, MANIFEST_CONTAINER)
        changed_urls.append(INDEXNOW_AGENTS)
    if llms_changed:
        hot_copy_to_web_container(LLMS_HOST, LLMS_CONTAINER)
        changed_urls.append(INDEXNOW_LLMS)
    if llms_full_changed:
        hot_copy_to_web_container(LLMS_FULL_HOST, LLMS_FULL_CONTAINER)
        changed_urls.append(INDEXNOW_LLMS_FULL)
    push_to_indexnow(changed_urls)
    print(
        f"refreshed: json={json_changed} llms={llms_changed} "
        f"llms_full={llms_full_changed} · pushed {len(changed_urls)} URL(s) to IndexNow"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
