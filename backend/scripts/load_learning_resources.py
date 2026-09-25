"""Push the learning resource catalog (courses and certifications) into Supabase.

Upserts data/learning_resources.csv (or --csv) into public.learning_resources
by resource_id, using the service role key (SUPABASE_SERVICE_ROLE_KEY in
backend/.env). Afterwards it reads the table back with the anon key, which is
how the backend reads it, and reports how many rows the matching service can
see and recommend. Rows the anon key cannot see are never recommended; apply
supabase/migrations/20260926090000_learning_resources_read_policy.sql if the
check reports hidden rows.

    python3 scripts/load_learning_resources.py --dry-run   # validate only, writes nothing
    python3 scripts/load_learning_resources.py             # upsert, then check visibility
    python3 scripts/load_learning_resources.py --check     # visibility check only

Review columns (review_status, reviewer, credential_review_status, ...) are not
in the CSV and are left as they are in Supabase.
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

from app.services.learning_recommender import resource_is_listable, resource_is_reviewed  # noqa: E402

CSV_PATH = BACKEND_DIR / "data" / "learning_resources.csv"
TABLE = "learning_resources"
CHUNK = 200
NUMERIC_COLUMNS = {"provider_trust_score_auto"}
CREDENTIAL_TYPES = {"exam_review", "professional_certificate", "industry_certification", "certificate_course", "course"}
# Columns of public.learning_resources the CSV may fill (supabase/schema.sql).
TABLE_COLUMNS = {
    "resource_id", "course_or_certification_title", "course_or_certification_description", "recommended_experience",
    "schedule", "level", "estimated_duration", "skills_youll_gain", "skill_ids", "category_id", "category_name",
    "offered_by_provider", "provider_type", "provider_trust_score_auto", "resource_type", "credential_type",
    "language", "delivery_mode", "cost_type", "status", "notes", "external_course_or_certification_link",
    "mapped_skill_names", "skill_id_mapping_status", "skill_id_mapping_notes",
}


def _env(name: str, required: bool = True) -> str:
    value = os.getenv(name, "").strip()
    if not value and (BACKEND_DIR / ".env").exists():
        for line in (BACKEND_DIR / ".env").read_text(encoding="utf-8").splitlines():
            key, _, raw = line.partition("=")
            if key.strip() == name:
                value = raw.strip().strip("'\"")
    if not value and required:
        raise SystemExit(f"! {name} is not set in backend/.env")
    return value


def read_rows(path: Path) -> tuple[list[dict], list[str], list[str]]:
    """The CSV as table rows, the problems that would make Supabase reject them,
    and the rows skipped because they have no title (the column is NOT NULL, and
    the recommender never lists an untitled resource)."""
    with path.open(encoding="utf-8", newline="") as handle:
        raw_rows = list(csv.DictReader(handle))
    rows, problems, skipped, seen = [], [], [], set()
    for number, raw in enumerate(raw_rows, start=2):
        row = {}
        for column, value in raw.items():
            column = (column or "").strip()
            if column not in TABLE_COLUMNS:
                continue
            value = (value or "").strip()
            if not value:
                row[column] = None
            elif column in NUMERIC_COLUMNS:
                try:
                    row[column] = float(value)
                except ValueError:
                    problems.append(f"line {number}: {column} {value!r} is not a number")
            else:
                row[column] = value
        resource_id = row.get("resource_id")
        if not resource_id:
            problems.append(f"line {number}: resource_id is empty")
        elif resource_id in seen:
            problems.append(f"line {number}: resource_id {resource_id} appears twice")
        seen.add(resource_id)
        if not row.get("course_or_certification_title"):
            skipped.append(f"line {number}: {resource_id or 'no resource_id'} has no course_or_certification_title")
            continue
        # The column is NOT NULL with a default; leave it out rather than send null.
        if row.get("credential_type") is None:
            row.pop("credential_type", None)
        elif row["credential_type"] not in CREDENTIAL_TYPES:
            problems.append(f"line {number}: credential_type {row['credential_type']!r} is not one of {sorted(CREDENTIAL_TYPES)}")
        rows.append(row)
    return rows, problems, skipped


def _request(url: str, key: str, method: str = "GET", body: object = None, prefer: str = "") -> bytes:
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    request = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode("utf-8"),
                                     method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"! {method} {url.split('?')[0]}: HTTP {error.code} {error.read()[:400].decode('utf-8', 'replace')}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"! Cannot reach {url.split('/rest/')[0]}: {error.reason}") from error


def _read_all(url: str, key: str) -> list[dict]:
    rows: list[dict] = []
    while True:
        page = json.loads(_request(f"{url}/rest/v1/{TABLE}?select=*&order=resource_id&limit=1000&offset={len(rows)}", key))
        rows.extend(page)
        if len(page) < 1000:
            return rows


def check_visibility(url: str, service_key: str, anon_key: str) -> int:
    """Compare what is stored with what the backend (anon key) can read and recommend."""
    stored = _read_all(url, service_key)
    visible = _read_all(url, anon_key)
    usable = [row for row in visible if resource_is_reviewed(row) or resource_is_listable(row)]
    print(f"stored in {TABLE}:            {len(stored)}")
    print(f"readable by the backend:        {len(visible)}")
    print(f"recommendable (active + link):  {len(usable)}")
    hidden = len(stored) - len(visible)
    if hidden:
        statuses = sorted({str(row.get('status')) for row in stored} - {str(row.get('status')) for row in visible})
        print(f"! {hidden} rows are hidden from the backend by the read policy (status {', '.join(statuses)}).")
        print("  Apply supabase/migrations/20260926090000_learning_resources_read_policy.sql.")
    if stored and not usable:
        print("! No row can be recommended, so the backend falls back to backend/data/learning_resources.csv.")
    return 1 if hidden or (stored and not usable) else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", type=Path, default=CSV_PATH)
    parser.add_argument("--dry-run", action="store_true", help="validate the CSV; write nothing")
    parser.add_argument("--check", action="store_true", help="only report what the backend can read")
    args = parser.parse_args(argv)

    if not args.check:
        rows, problems, skipped = read_rows(args.csv)
        for problem in problems:
            print(f"! {problem}")
        for row in skipped:
            print(f"skipped {row}")
        if problems:
            return 1
        print(f"{args.csv.name}: {len(rows)} rows are valid for {TABLE}")
        if args.dry_run:
            return 0

    url = _env("SUPABASE_URL").rstrip("/")
    service_key = _env("SUPABASE_SERVICE_ROLE_KEY")
    if not args.check:
        for start in range(0, len(rows), CHUNK):
            _request(f"{url}/rest/v1/{TABLE}?on_conflict=resource_id", service_key, "POST", rows[start:start + CHUNK],
                     prefer="resolution=merge-duplicates,return=minimal")
        print(f"upserted {len(rows)} rows into {TABLE}")

    anon_key = _env("SUPABASE_ANON_KEY", required=False) or _env("VITE_SUPABASE_ANON_KEY")
    return check_visibility(url, service_key, anon_key)


if __name__ == "__main__":
    raise SystemExit(main())
