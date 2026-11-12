"""The open-jobs list behind the Kareers page (/api/jobs).

Kept apart from job_matcher.py (the TF-IDF evaluation baseline) so the API does
not load the baseline to list jobs.
"""

import threading
import time
from typing import Any

import pandas as pd

from .supabase_jobs import JobCatalogueIncomplete, load_internal_jobs_dataframe


def safe_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


# Every open Kareers page re-reads the list every 30 seconds. Reading ~2,000
# jobs takes several Supabase pages, so one complete list is shared for a short
# while, and a read that comes back short never replaces it.
JOB_LIST_CACHE_SECONDS = 30.0
_job_list_cache: dict[str, Any] = {"limit": 0, "loaded_at": 0.0, "results": None}
_job_list_lock = threading.Lock()


def list_available_jobs(limit: int = 5000) -> list[dict[str, Any]]:
    """Every open job, or the last complete list when a fresh read is cut short.
    With no complete list yet, the jobs that could be read: one table that
    cannot be read must not empty the whole page."""
    safe_limit = max(1, min(limit, 5000))
    with _job_list_lock:
        cached = _job_list_cache["results"]
        if cached is not None and _job_list_cache["limit"] == safe_limit and time.monotonic() - _job_list_cache["loaded_at"] < JOB_LIST_CACHE_SECONDS:
            return cached
        try:
            results = _read_available_jobs(safe_limit)
        except JobCatalogueIncomplete:
            if cached is not None and _job_list_cache["limit"] == safe_limit:
                return cached
            return _read_available_jobs(safe_limit, strict=False)
        _job_list_cache.update(limit=safe_limit, loaded_at=time.monotonic(), results=results)
        return results


def _read_available_jobs(safe_limit: int, *, strict: bool = True) -> list[dict[str, Any]]:
    jobs = load_internal_jobs_dataframe(limit=safe_limit, strict=strict)

    if jobs.empty:
        return []
    jobs.columns = [str(column).strip().lstrip("\ufeff") for column in jobs.columns]
    jobs["_source_priority"] = jobs["job_source"].map({"employer": 0, "internal": 1}).fillna(2)
    jobs = jobs.sort_values(["_source_priority", "created_at", "job_title"], ascending=[True, False, True])


    output: list[dict[str, Any]] = []
    for index, row in jobs.head(safe_limit).iterrows():
        record = row.to_dict()
        required_skills_raw = safe_text(record.get("required_skills_comma_separated"))
        required_skills = [skill.strip() for skill in required_skills_raw.split(",") if skill.strip()]
        source_dataset = safe_text(record.get("source_dataset"))
        external_link = safe_text(record.get("external_job_link_optional"))
        company_name = safe_text(record.get("company_name")) or (
            source_dataset.replace("_", " ").strip().title() if source_dataset else "Kareerly Internal Jobs"
        )

        output.append(
            {
                "job_id": safe_text(record.get("job_id")) or f"JOB-{index + 1}",
                "job_title": safe_text(record.get("job_title")) or "Untitled role",
                "psoc_unit_code": safe_text(record.get("psoc_unit_code")),
                "psoc_title": safe_text(record.get("psoc_title")),
                "job_category": safe_text(record.get("job_category")),
                "job_subcategory": safe_text(record.get("job_subcategory")),
                "experience_level_required": safe_text(record.get("experience_level_required")),
                "location": safe_text(record.get("location")) or "Philippines",
                "work_type": safe_text(record.get("work_type")) or "Flexible",
                "employment_type": safe_text(record.get("employment_type")),
                "salary_range_monthly_php": safe_text(record.get("salary_range_monthly_php")),
                "salary_min_php": safe_text(record.get("salary_min_php")),
                "salary_max_php": safe_text(record.get("salary_max_php")),
                "required_skills": required_skills[:12],
                "preferred_skills": [skill.strip() for skill in safe_text(record.get("nice_to_have_skills_optional")).split(",") if skill.strip()],
                "job_description": safe_text(record.get("job_description")),
                "responsibilities": [item.strip() for item in safe_text(record.get("responsibilities")).splitlines() if item.strip()],
                "qualifications": [item.strip() for item in safe_text(record.get("qualifications")).splitlines() if item.strip()],
                "external_job_link_optional": external_link,
                "source_dataset": source_dataset,
                "company_name": company_name,
                "job_source": safe_text(record.get("job_source")) or "internal",
                "created_at": safe_text(record.get("created_at")),
                "updated_at": safe_text(record.get("updated_at")),
            }
        )

    return output
