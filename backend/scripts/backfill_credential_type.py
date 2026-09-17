"""Backfill ``credential_type`` into the learning resource catalog.

Writes the column into data/learning_resources.csv (the fallback source) and
emits SQL to apply the same values to the Supabase table (the authoritative
source). Re-runnable: it reclassifies every row from the title each time, so
correcting a title and re-running corrects the classification.

    python3 scripts/backfill_credential_type.py            # CSV + print SQL
    python3 scripts/backfill_credential_type.py --sql-out supabase/seed_credential_type.sql
"""

from __future__ import annotations

import argparse
import collections
import csv
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.credential_types import classify_credential_type  # noqa: E402

CSV_PATH = BACKEND_DIR / "data" / "learning_resources.csv"
COLUMN = "credential_type"


def _sql_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=CSV_PATH)
    parser.add_argument("--sql-out", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    with args.csv.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = [name.strip() for name in (reader.fieldnames or [])]
        rows = list(reader)

    if not rows:
        print(f"! {args.csv} has no rows")
        return 1

    counts: collections.Counter[str] = collections.Counter()
    statements: list[str] = []

    for row in rows:
        credential_type = classify_credential_type(row.get("course_or_certification_title"))
        row[COLUMN] = credential_type
        counts[credential_type] += 1

        resource_id = str(row.get("resource_id") or "").strip()
        if resource_id:
            statements.append(
                f"update public.learning_resources set {COLUMN} = {_sql_quote(credential_type)} "
                f"where resource_id = {_sql_quote(resource_id)};"
            )

    if COLUMN not in fieldnames:
        # Keep it beside resource_type, which it qualifies.
        anchor = fieldnames.index("resource_type") + 1 if "resource_type" in fieldnames else len(fieldnames)
        fieldnames.insert(anchor, COLUMN)

    if not args.dry_run:
        with args.csv.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows({name: row.get(name, "") for name in fieldnames} for row in rows)
        print(f"  wrote {COLUMN} into {args.csv} ({len(rows)} rows)")

    sql = "\n".join(statements)
    if args.sql_out and not args.dry_run:
        args.sql_out.parent.mkdir(parents=True, exist_ok=True)
        args.sql_out.write_text(sql + "\n", encoding="utf-8")
        print(f"  wrote {len(statements)} update statements to {args.sql_out}")
    elif not args.sql_out:
        print("\n-- run these against Supabase after applying the migration --")
        print("\n".join(statements[:3]))
        print(f"-- ... {len(statements)} statements total; re-run with --sql-out to save them")

    print("\n  classification:")
    for credential_type, count in counts.most_common():
        print(f"    {credential_type:26} {count:4}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
