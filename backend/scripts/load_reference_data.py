"""Load the reference CSVs from import_reference_data.py into Supabase.

An alternative to psql + load.sql, using the Supabase REST API and the service
role key (SUPABASE_SERVICE_ROLE_KEY in backend/.env).

    python3 scripts/load_reference_data.py --dry-run     # counts only, writes nothing
    python3 scripts/load_reference_data.py

Reference tables are upserted, so a re-run refreshes them. The two link tables
are insert-only (existing rows are left alone), because their review_status is a
person's decision and the CSVs always say 'proposed'.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.import_reference_data import LOAD_ORDER, OUT_DIR, PRIMARY_KEYS  # noqa: E402

CHUNK = 500
INSERT_ONLY = {"psoc_esco_occupation_links", "kareerly_skill_esco_links"}
NUMERIC_COLUMNS = {"title_similarity", "confidence"}


def _env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value and (BACKEND_DIR / ".env").exists():
        for line in (BACKEND_DIR / ".env").read_text(encoding="utf-8").splitlines():
            key, _, raw = line.partition("=")
            if key.strip() == name:
                value = raw.strip().strip("'\"")
    if not value:
        raise SystemExit(f"! {name} is not set in backend/.env")
    return value


def _rows(path: Path, table: str) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        for column, value in list(row.items()):
            if value == "":
                row[column] = None
            elif column in NUMERIC_COLUMNS:
                row[column] = float(value)
    return rows


def _post(url: str, key: str, table: str, chunk: list[dict], insert_only: bool) -> None:
    prefer = "resolution=ignore-duplicates" if insert_only else "resolution=merge-duplicates"
    conflict = ",".join(PRIMARY_KEYS[table])
    request = urllib.request.Request(
        f"{url}/rest/v1/{table}?on_conflict={conflict}",
        data=json.dumps(chunk).encode("utf-8"),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": f"{prefer},return=minimal",
        },
    )
    try:
        urllib.request.urlopen(request, timeout=180).read()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"! {table}: HTTP {error.code} {error.read()[:400].decode('utf-8', 'replace')}") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--in-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--tables", nargs="*", default=LOAD_ORDER)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    url, key = _env("SUPABASE_URL").rstrip("/"), _env("SUPABASE_SERVICE_ROLE_KEY")
    for table in [name for name in LOAD_ORDER if name in args.tables]:
        path = args.in_dir / f"{table}.csv"
        if not path.exists():
            print(f"{table:32} skipped (no {path.name})")
            continue
        rows = _rows(path, table)
        mode = "insert new only" if table in INSERT_ONLY else "upsert"
        if args.dry_run:
            print(f"{table:32} {len(rows):>7} rows ({mode}) - dry run")
            continue
        for start in range(0, len(rows), CHUNK):
            _post(url, key, table, rows[start:start + CHUNK], table in INSERT_ONLY)
        print(f"{table:32} {len(rows):>7} rows ({mode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
