"""Apply the job skill ID migration from job_skill_id_review.py build.

The generated SQL is the record of what changes; this runs the same updates
through the Supabase REST API for anyone without psql. Every update is
conditional on the job still holding the value the review saw, so a job edited
since then is skipped rather than overwritten. Current values are written to a
backup CSV first.

    python3 scripts/apply_job_skill_ids.py --sql data/skill_id_review/<date>_job_skill_ids.sql --dry-run
    python3 scripts/apply_job_skill_ids.py --sql data/skill_id_review/<date>_job_skill_ids.sql
    python3 scripts/apply_job_skill_ids.py --restore data/skill_id_review/<date>_job_skill_ids_backup.csv
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.load_reference_data import _env  # noqa: E402

UPDATE = re.compile(
    r"update public\.(?P<table>\w+) set must_have_skill_ids = '(?P<new>[^']*)' "
    r"where job_id = '(?P<job_id>[^']*)' and must_have_skill_ids is not distinct from (?P<old>'[^']*'|null);"
)


def parse_updates(sql: str) -> list[dict[str, str]]:
    return [
        {"table": m["table"], "job_id": m["job_id"], "new": m["new"], "old": "" if m["old"] == "null" else m["old"][1:-1]}
        for m in UPDATE.finditer(sql)
    ]


def _request(url: str, key: str, method: str, body: object | None = None) -> list[dict]:
    request = urllib.request.Request(
        url,
        data=None if body is None else json.dumps(body).encode("utf-8"),
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        return json.loads(urllib.request.urlopen(request, timeout=60).read() or b"[]")
    except urllib.error.HTTPError as error:
        raise SystemExit(f"! HTTP {error.code} {error.read()[:300].decode('utf-8', 'replace')}") from error


def _filter(url: str, table: str, job_id: str, old: str | None = None) -> str:
    query = f"job_id=eq.{urllib.parse.quote(job_id, safe='')}"
    if old is not None:
        query += "&must_have_skill_ids=" + ("is.null" if old == "" else f"eq.{urllib.parse.quote(old, safe='')}")
    return f"{url}/rest/v1/{table}?{query}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sql", type=Path)
    parser.add_argument("--restore", type=Path, help="put back the values from a backup CSV")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    url, key = _env("SUPABASE_URL").rstrip("/"), _env("SUPABASE_SERVICE_ROLE_KEY")

    if args.restore:
        with args.restore.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        for row in rows:
            _request(_filter(url, row["table"], row["job_id"]), key, "PATCH", {"must_have_skill_ids": row["must_have_skill_ids"] or None})
        print(f"restored {len(rows)} jobs from {args.restore}")
        return 0

    if not args.sql:
        raise SystemExit("! pass --sql <file> or --restore <backup.csv>")
    updates = parse_updates(args.sql.read_text(encoding="utf-8"))
    if not updates:
        raise SystemExit(f"! no update statements found in {args.sql}")
    print(f"{len(updates)} jobs to update")
    if args.dry_run:
        for update in updates[:5]:
            print(f"  {update['table']} {update['job_id']}: {update['old']} -> {update['new']}")
        return 0

    backup_path = args.sql.with_name(args.sql.stem + "_backup.csv")
    with backup_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["table", "job_id", "must_have_skill_ids", "backed_up_at"])
        writer.writeheader()
        for update in updates:
            writer.writerow({"table": update["table"], "job_id": update["job_id"], "must_have_skill_ids": update["old"],
                             "backed_up_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")})
    print(f"backed up current values to {backup_path}")

    changed, skipped = 0, []
    for update in updates:
        rows = _request(_filter(url, update["table"], update["job_id"], update["old"]), key, "PATCH", {"must_have_skill_ids": update["new"]})
        if rows:
            changed += 1
        else:
            skipped.append(update["job_id"])
    print(f"updated {changed} jobs" + (f"; skipped {len(skipped)} changed since the review: {', '.join(skipped[:10])}" if skipped else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
