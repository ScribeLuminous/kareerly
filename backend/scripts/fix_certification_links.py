"""Set canonical links on the hand-curated certification rows.

The 23 rows with status 'Active/Review' are the only real, named credentials in
the catalog; the other 220 are auto-generated prototype filler. 21 of the 23 had
no link at all, so the highest-value entries were the ones a candidate could not
open. Their URLs are stable in a way the generated rows' never will be, which is
why these are worth pinning by hand instead of leaving to resource_links.py.

Every URL below returned HTTP 200 on 2026-08-27 except the two marked
UNVERIFIED, whose hosts refuse non-browser clients outright (CIPS sits behind
Akamai; Facebook rejects scripted requests). Those two were checked for shape,
not reachability -- open them once in a browser before you rely on them.

    python3 scripts/fix_certification_links.py [--dry-run]
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
CSV_PATH = BACKEND_DIR / "data" / "learning_resources.csv"
COLUMN = "external_course_or_certification_link"

#: resource_id -> canonical URL. Redirect targets are recorded as resolved, so
#: the stored URL is the one that actually serves the page.
CANONICAL_LINKS = {
    "LR-004": "https://aws.amazon.com/certification/certified-solutions-architect-associate/",
    "LR-005": "https://www.coursera.org/professional-certificates/google-data-analytics",
    "LR-006": "https://www.comptia.org/en-us/certifications/security/",
    "LR-007": "https://learn.microsoft.com/en-us/credentials/certifications/azure-fundamentals/",
    "LR-008": "https://www.isc2.org/certifications/cissp",
    "LR-009": "https://www.cfainstitute.org/programs/cfa-program",
    "LR-010": "https://www.prc.gov.ph/",
    "LR-011": "https://www.pmi.org/certifications/project-management-pmp",
    "LR-012": "https://www.imaglobal.org/certifications",
    "LR-013": "https://www.cips.org/qualifications",  # UNVERIFIED: Akamai blocks scripted requests
    "LR-014": "https://www.coursera.org/professional-certificates/google-digital-marketing-ecommerce",
    "LR-015": "https://academy.hubspot.com/courses/inbound-marketing",
    "LR-016": "https://www.coursera.org/professional-certificates/facebook-social-media-marketing",
    "LR-017": "https://trailhead.salesforce.com/credentials/salesrepresentative",
    "LR-018": "https://skillshop.exceedlms.com/student/catalog/list?category_ids=6431-google-analytics",
    "LR-019": "https://www.coursera.org/professional-certificates/google-ux-design",
    "LR-020": "https://certifiedprofessional.adobe.com/en/home",
    "LR-021": "https://academy.hubspot.com/courses/content-marketing",
    "LR-022": "https://www.facebook.com/business/learn/certification",  # UNVERIFIED: Facebook blocks scripted requests
    "LR-023": "https://www.prsa.org/professional-development/accreditation",
}

#: LR-002 ("Teaching 21st Century Skills in College Courses") is a course, not a
#: credential, and has no canonical page on record. It is deliberately left to
#: resource_links.build_resource_url() rather than given an invented URL.
UNRESOLVED = {"LR-002"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=CSV_PATH)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--sql-out",
        type=Path,
        default=None,
        help="also write the same updates as SQL, for the authoritative Supabase table",
    )
    args = parser.parse_args(argv)

    with args.csv.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = [name.strip() for name in (reader.fieldnames or [])]
        rows = list(reader)

    updated = 0
    for row in rows:
        resource_id = str(row.get("resource_id") or "").strip()
        url = CANONICAL_LINKS.get(resource_id)
        if not url:
            continue
        if str(row.get(COLUMN) or "").strip() == url:
            continue
        row[COLUMN] = url
        updated += 1
        title = " ".join(str(row.get("course_or_certification_title") or "").split())
        print(f"  {resource_id}  {title[:46]:46}  ->  {url[:58]}")

    if not args.dry_run:
        with args.csv.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows({name: row.get(name, "") for name in fieldnames} for row in rows)

    if args.sql_out and not args.dry_run:
        def quote(value: str) -> str:
            return "'" + str(value).replace("'", "''") + "'"

        statements = [
            f"update public.learning_resources set {COLUMN} = {quote(url)} "
            f"where resource_id = {quote(resource_id)};"
            for resource_id, url in sorted(CANONICAL_LINKS.items())
        ]
        args.sql_out.parent.mkdir(parents=True, exist_ok=True)
        args.sql_out.write_text("\n".join(statements) + "\n", encoding="utf-8")
        print(f"  wrote {len(statements)} update statements to {args.sql_out}")

    print(f"\n  {updated} link(s) set; {len(UNRESOLVED)} left to the URL constructor ({', '.join(sorted(UNRESOLVED))})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
