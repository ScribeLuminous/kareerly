"""Write the September 2026 catalogue expansion as one paste-ready Supabase SQL file.

The expansion adds courses and certifications (resource IDs LR-2609-*) to
data/learning_resources.csv and sample reference roles (job IDs JOB-2609-*) to
data/reference_jobs.csv. The backend reads both tables from Supabase when they
have rows, so the CSV rows only reach candidates once they are in
public.learning_resources and public.internal_jobs.

    python3 scripts/export_catalog_expansion_sql.py   # writes supabase/seed_catalog_expansion_2026_09.sql

Paste the file into Supabase > SQL Editor and run it. It is safe to run more
than once: rows are upserted by resource_id / job_id. The jobs are sample
postings written to widen matching coverage, so they are stored with
is_synthetic_seed = true and no source URL.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.load_learning_resources import CSV_PATH as RESOURCES_CSV, read_rows  # noqa: E402

JOBS_CSV = BACKEND_DIR / "data" / "reference_jobs.csv"
OUT_PATH = BACKEND_DIR.parent / "supabase" / "seed_catalog_expansion_2026_09.sql"
RESOURCE_PREFIX = "LR-2609-"
JOB_PREFIX = "JOB-2609-"

# Shown as the company on the dashboard; says plainly that the role is a sample.
SAMPLE_EMPLOYERS = {
    "K01": "Software company", "K02": "Analytics firm", "K03": "IT services company", "K04": "Accounting firm",
    "K05": "Corporate office", "K06": "Professional services firm", "K07": "Trading company", "K08": "Marketing agency",
    "K09": "Customer experience company", "K10": "Content agency", "K11": "Creative studio", "K12": "Private school",
    "K13": "Non-profit organization", "K14": "Medical clinic", "K15": "Care home", "K16": "Engineering firm",
    "K17": "Construction company", "K18": "Hotel and resort", "K19": "Restaurant group", "K20": "Logistics company",
    "K21": "Manufacturing plant", "K22": "Agricultural company", "K23": "Government office",
    "K24": "Security and legal services firm",
}
JOB_COLUMNS = [
    "job_id", "category_code", "category_name", "job_subcategory", "job_title", "company_name", "location",
    "work_setup", "employment_type", "job_level", "salary_min_php", "salary_max_php", "job_description",
    "required_skills", "preferred_skills", "must_have_skill_ids", "source_platform", "source_note",
    "is_synthetic_seed", "posting_status",
]


def sql_value(value: object) -> str:
    if value is None or value == "":
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def upsert(table: str, columns: list[str], rows: list[dict], key: str) -> str:
    values = ",\n".join("  (" + ", ".join(sql_value(row.get(column)) for column in columns) + ")" for row in rows)
    updates = ", ".join(f"{column} = excluded.{column}" for column in columns if column != key)
    return (f"insert into public.{table} ({', '.join(columns)}) values\n{values}\n"
            f"on conflict ({key}) do update set {updates}, updated_at = now();\n")


def salary_bounds(text: str) -> tuple[int | None, int | None]:
    amounts = [int(amount.replace(",", "")) for amount in re.findall(r"\d[\d,]*", text or "")]
    return (amounts[0], amounts[1]) if len(amounts) >= 2 else (None, None)


def job_rows() -> list[dict]:
    with JOBS_CSV.open(encoding="utf-8", newline="") as handle:
        jobs = [row for row in csv.DictReader(handle) if row["job_id"].startswith(JOB_PREFIX)]
    rows = []
    for job in jobs:
        salary_min, salary_max = salary_bounds(job["salary_range_monthly_php"])
        rows.append({
            "job_id": job["job_id"], "category_code": job["category_id"], "category_name": job["job_category"],
            "job_subcategory": job["job_subcategory"], "job_title": job["job_title"],
            "company_name": f"{SAMPLE_EMPLOYERS[job['category_id']]} (sample posting)",
            "location": job["location"], "work_setup": job["work_type"], "employment_type": "Full-time",
            "job_level": job["experience_level_required"], "salary_min_php": salary_min, "salary_max_php": salary_max,
            "job_description": job["job_description"], "required_skills": job["required_skills_comma_separated"],
            "preferred_skills": job["nice_to_have_skills_optional"],
            # The backend treats must_have_skill_ids as the job's required skill IDs.
            "must_have_skill_ids": job["required_skill_ids"], "source_platform": job["source_dataset"],
            "source_note": f"Sample posting written to widen matching coverage in {job['job_category']}; not a live vacancy.",
            "is_synthetic_seed": True, "posting_status": "active",
        })
    return rows


def main() -> int:
    resources, problems, _ = read_rows(RESOURCES_CSV)
    if problems:
        for problem in problems:
            print(f"! {problem}")
        return 1
    resources = [row for row in resources if row["resource_id"].startswith(RESOURCE_PREFIX)]
    columns = list(dict.fromkeys(column for row in resources for column in row))
    jobs = job_rows()
    OUT_PATH.write_text("\n".join([
        "-- Kareerly catalogue expansion, September 2026: courses/certifications and sample reference roles.",
        "-- Generated by backend/scripts/export_catalog_expansion_sql.py; edit the CSVs, not this file.",
        "-- Paste this whole file into Supabase > SQL Editor and click Run. Safe to run more than once.",
        f"-- {len(resources)} learning resources ({RESOURCE_PREFIX}*) and {len(jobs)} internal jobs ({JOB_PREFIX}*).",
        "",
        "begin;",
        "",
        upsert("learning_resources", columns, resources, "resource_id"),
        upsert("internal_jobs", JOB_COLUMNS, jobs, "job_id"),
        "commit;",
        "",
        "-- Check: rows added by this file.",
        f"select (select count(*) from public.learning_resources where resource_id like '{RESOURCE_PREFIX}%') as learning_resources,",
        f"       (select count(*) from public.internal_jobs where job_id like '{JOB_PREFIX}%') as internal_jobs;",
        "",
    ]), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(BACKEND_DIR.parent)}: {len(resources)} resources, {len(jobs)} jobs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
