"""Apply reviewed Kareerly skill -> ESCO links to Supabase.

Takes the CSV written by skill_esco_link_review.py build and, for each skill in
it, records the reviewed link and marks that skill's other links 'rejected'
rather than deleting them, so the earlier proposal stays visible. Re-running is
safe: reviewed rows are updated in place.

    python3 scripts/apply_skill_esco_links.py --links <reviewed.csv> --dry-run
    python3 scripts/apply_skill_esco_links.py --links <reviewed.csv>
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.apply_job_skill_ids import _request  # noqa: E402
from scripts.load_reference_data import _env  # noqa: E402

TABLE = "kareerly_skill_esco_links"


def _upsert(url: str, key: str, payload: dict) -> None:
    """POST with merge-duplicates, so re-running updates the row instead of failing on its key."""
    request = urllib.request.Request(
        f"{url}/rest/v1/{TABLE}?on_conflict=skill_id,skill_uri",
        data=json.dumps([payload]).encode("utf-8"),
        method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    try:
        urllib.request.urlopen(request, timeout=60).read()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"! {payload['skill_id']}: HTTP {error.code} {error.read()[:300].decode('utf-8', 'replace')}") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--links", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    url, key = _env("SUPABASE_URL").rstrip("/"), _env("SUPABASE_SERVICE_ROLE_KEY")

    with args.links.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    reviewed_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    counts: collections.Counter[str] = collections.Counter()

    for row in rows:
        skill_id, skill_uri = row["skill_id"], row["skill_uri"]
        existing = _request(f"{url}/rest/v1/{TABLE}?skill_id=eq.{urllib.parse.quote(skill_id)}&select=skill_uri,review_status", key, "GET")
        superseded = [item for item in existing if item["skill_uri"] != skill_uri and item["review_status"] != "rejected"]
        counts["already correct"] += any(i["skill_uri"] == skill_uri and i["review_status"] == "reviewed" for i in existing)
        if args.dry_run:
            counts["would review"] += 1
            counts["would reject"] += len(superseded)
            continue
        payload = {**row, "reviewer": "kareerly-review", "reviewed_at": reviewed_at,
                   "confidence": float(row["confidence"]) if row.get("confidence") else None}
        _upsert(url, key, payload)
        counts["reviewed"] += 1
        for item in superseded:
            _request(
                f"{url}/rest/v1/{TABLE}?skill_id=eq.{urllib.parse.quote(skill_id)}&skill_uri=eq.{urllib.parse.quote(item['skill_uri'], safe='')}",
                key, "PATCH",
                {"review_status": "rejected", "reviewer": "kareerly-review", "reviewed_at": reviewed_at,
                 "evidence": f"superseded by {skill_uri} on {reviewed_at[:10]}"},
            )
            counts["rejected"] += 1
    print(", ".join(f"{key}: {value}" for key, value in counts.most_common() if value))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
