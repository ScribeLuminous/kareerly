"""Inventory what depends on the 422 unreviewed ESCO auto-expansion skills.

Rows with ``mapping_status = auto_generated_review`` are no longer searched
for in resume, job or course text (skill_resolver). Their IDs still resolve,
so nothing that already stores one loses it. This script measures, per
unreviewed skill, what stores or requires it, and proposes an action, so each
one can be reviewed, mapped to its reviewed equivalent or retired knowingly.

    python3 -m backend.scripts.unreviewed_skill_dependencies --output /tmp/unreviewed
    python3 -m backend.scripts.unreviewed_skill_dependencies --output /tmp/unreviewed --live

Repository sources: reference_jobs.csv (required and nice-to-have IDs),
learning_resources.csv (skill_ids), the alias, variant, relation and
exclusion files, and backend/tests.

``--live`` also reads Supabase with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
(environment or backend/.env; never printed): user_skills (confirmed skills),
candidate_skill_progress, match_history.results_json (saved matches),
resumes.extracted_profile_json, candidate_external_job_matches.result_json,
internal_jobs and employer_job_posts (must_have_skill_ids) and
learning_resources. Only counts are written; no user identifiers.
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA = BACKEND_DIR / "data"
UNREVIEWED = "auto_generated_review"
SKILL_ID = re.compile(r"\bSK\d{3,4}\b")

# (table, columns to read, label used in the report)
LIVE_SOURCES = [
    ("user_skills", "skill_id", "confirmed_skills"),
    ("candidate_skill_progress", "skill_id", "skill_progress"),
    ("match_history", "results_json", "saved_matches"),
    ("resumes", "extracted_profile_json", "saved_resume_analyses"),
    ("candidate_external_job_matches", "result_json", "saved_external_analyses"),
    ("internal_jobs", "must_have_skill_ids", "live_internal_jobs"),
    ("employer_job_posts", "must_have_skill_ids", "live_employer_jobs"),
    ("learning_resources", "skill_ids", "live_learning_resources"),
]


def read_csv(path: Path) -> List[Dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def ids_in(value: object) -> set:
    text = value if isinstance(value, str) else json.dumps(value)
    return set(SKILL_ID.findall(text.upper()))


def count_rows(rows: Iterable[object], unreviewed: set) -> collections.Counter:
    """Rows mentioning each unreviewed ID (a row counts once per ID)."""
    counts: collections.Counter = collections.Counter()
    for row in rows:
        for skill_id in ids_in(row) & unreviewed:
            counts[skill_id] += 1
    return counts


def repository_counts(unreviewed: set) -> Dict[str, collections.Counter]:
    counts = {
        "reference_jobs": count_rows((row.get("required_skill_ids", "") + ";" + row.get("nice_to_have_skill_ids", "")
                                      for row in read_csv(DATA / "reference_jobs.csv")), unreviewed),
        "bundled_learning_resources": count_rows((row.get("skill_ids", "") for row in read_csv(DATA / "learning_resources.csv")), unreviewed),
    }
    reviewed_names = collections.Counter()
    for name in ("skill_name_variants.csv", "skill_evidence_relations.csv", "skill_alias_exclusions.csv"):
        path = DATA / name
        if path.is_file():
            reviewed_names.update(count_rows((row.get("skill_id", "") for row in read_csv(path)), unreviewed))
    counts["reviewed_name_files"] = reviewed_names
    counts["tests"] = count_rows((path.read_text(encoding="utf-8") for path in (BACKEND_DIR / "tests").glob("*.py")), unreviewed)
    return counts


def _env(name: str) -> str:
    value = os.getenv(name, "").strip()
    env_path = BACKEND_DIR / ".env"
    if not value and env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            key, _, raw = line.partition("=")
            if key.strip() == name:
                value = raw.strip().strip("'\"")
    if not value:
        raise SystemExit(f"! {name} is not set (environment or backend/.env)")
    return value


def fetch_table(url: str, key: str, table: str, column: str, page: int = 1000) -> Iterable[object]:
    offset = 0
    while True:
        query = urllib.parse.urlencode({"select": column, "limit": page, "offset": offset})
        request = urllib.request.Request(f"{url}/rest/v1/{table}?{query}",
                                         headers={"apikey": key, "Authorization": f"Bearer {key}"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                rows = json.loads(response.read())
        except urllib.error.HTTPError as error:
            # The key is in a header, never in the URL or this message.
            print(f"! {table}: HTTP {error.code}; skipped", file=sys.stderr)
            return
        for row in rows:
            yield row.get(column)
        if len(rows) < page:
            return
        offset += page


def live_counts(unreviewed: set, fetch: Optional[Callable[[str, str], Iterable[object]]] = None) -> Dict[str, collections.Counter]:
    if fetch is None:
        url, key = _env("SUPABASE_URL").rstrip("/"), _env("SUPABASE_SERVICE_ROLE_KEY")

        def fetch(table: str, column: str) -> Iterable[object]:
            return fetch_table(url, key, table, column)
    return {label: count_rows(fetch(table, column), unreviewed) for table, column, label in LIVE_SOURCES}


def proposed_action(skill_id: str, equivalent: str, counts: Dict[str, collections.Counter]) -> str:
    stored = {label: counts[label][skill_id] for label in counts if counts[label][skill_id]}
    if equivalent:
        return f"map_to_{equivalent}" + (" (runtime already maps it; migrate stored IDs)" if stored else "")
    if any(label in stored for label in ("confirmed_skills", "saved_matches", "saved_resume_analyses", "skill_progress",
                                         "saved_external_analyses")):
        return "review_before_retiring (candidates hold it)"
    if any(label in stored for label in ("reference_jobs", "live_internal_jobs", "live_employer_jobs")):
        return "review (a job requires it)"
    if stored:
        return "review_or_retire (only catalogue or test references)"
    return "inactive_ok (nothing stores it)"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--live", action="store_true", help="also count live Supabase records (read-only)")
    args = parser.parse_args(argv)

    skills = read_csv(DATA / "skills_reference.csv")
    unreviewed = {row["skill_id"].strip().upper() for row in skills if row.get("mapping_status") == UNREVIEWED}
    by_uri: Dict[str, List[Dict[str, str]]] = collections.defaultdict(list)
    for row in skills:
        if row.get("esco_skill_uri", "").startswith("http"):
            by_uri[row["esco_skill_uri"]].append(row)
    equivalents = {}
    for rows in by_uri.values():
        primary = [row["skill_id"] for row in rows if row.get("mapping_status") != UNREVIEWED]
        if len(primary) == 1:
            for row in rows:
                if row.get("mapping_status") == UNREVIEWED:
                    equivalents[row["skill_id"]] = primary[0]

    counts = repository_counts(unreviewed)
    if args.live:
        counts.update(live_counts(unreviewed))
    labels = sorted(counts)
    args.output.mkdir(parents=True, exist_ok=True)
    rows = []
    for row in sorted(skills, key=lambda item: item["skill_id"]):
        skill_id = row["skill_id"].strip().upper()
        if skill_id not in unreviewed:
            continue
        rows.append({"skill_id": skill_id, "skill_name": row["skill_name"], "reviewed_equivalent": equivalents.get(skill_id, ""),
                     **{label: counts[label][skill_id] for label in labels},
                     "proposed_action": proposed_action(skill_id, equivalents.get(skill_id, ""), counts)})
    with (args.output / "unreviewed_skill_dependencies.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["skill_id", "skill_name", "reviewed_equivalent", *labels, "proposed_action"])
        writer.writeheader()
        writer.writerows(rows)
    summary = {
        "unreviewed_skills": len(unreviewed),
        "sources": labels if args.live else labels + ["(live sources not read; pass --live)"],
        "skills_with_any_dependency": sum(any(row[label] for label in labels) for row in rows),
        "per_source_skills": {label: sum(1 for row in rows if row[label]) for label in labels},
        "per_source_references": {label: sum(row[label] for row in rows) for label in labels},
        "proposed_actions": dict(collections.Counter(row["proposed_action"].split(" (")[0] for row in rows)),
    }
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
