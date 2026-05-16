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
MANIFEST_HOST = Path("/opt/marketplace/packages/web/public/.well-known/agents.json")
MANIFEST_CONTAINER = "/app/packages/web/public/.well-known/agents.json"
INDEXNOW_URL = "https://teno-store.com/.well-known/agents.json"

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
    sellers = int(psql("SELECT count(DISTINCT seller_id) FROM catalog.products"))
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
        "top_categories": top_categories,
        "top_brands": top_brands,
    }


def update_manifest(stats: dict) -> bool:
    """Mutate agents.json in place. Return True if anything actually changed."""
    data = json.loads(MANIFEST_HOST.read_text(encoding="utf-8"))
    catalog = data["catalog"]
    now = datetime.now(timezone.utc)
    new_total = stats["total_listings"]
    catalog["total_listings"] = new_total
    catalog["active_sellers"] = stats["active_sellers"]
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


def hot_copy_to_web_container() -> None:
    cid = subprocess.check_output(
        ["docker", "compose", "-f", COMPOSE, "ps", "-q", "web"], text=True
    ).strip()
    if not cid:
        raise SystemExit("web container not running")
    subprocess.check_call([
        "docker", "cp", str(MANIFEST_HOST), f"{cid}:{MANIFEST_CONTAINER}"
    ])


def push_to_indexnow() -> None:
    subprocess.run(
        [
            "docker", "run", "--rm", "-i",
            "--network", "marketplace_default",
            "-v", "/opt/marketplace/scripts:/scripts",
            "node:22-alpine",
            "node", "/scripts/indexnow-submit.mjs", "--stdin",
        ],
        input=INDEXNOW_URL + "\n",
        text=True,
        check=False,  # IndexNow failure shouldn't fail the refresh
    )


def main() -> int:
    stats = fetch_stats()
    print(
        f"stats: total={stats['total_listings']} "
        f"sellers={stats['active_sellers']} "
        f"top1={stats['top_categories'][0]['slug']}={stats['top_categories'][0]['listings']}"
    )
    changed = update_manifest(stats)
    if not changed:
        print("manifest unchanged — nothing to push")
        return 0
    if DRY_RUN:
        return 0
    hot_copy_to_web_container()
    push_to_indexnow()
    print("manifest refreshed + hot-copied to container + pushed to IndexNow")
    return 0


if __name__ == "__main__":
    sys.exit(main())
