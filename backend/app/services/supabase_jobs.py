from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import pandas as pd


SUPABASE_URL = (
    os.getenv("SUPABASE_URL")
    or os.getenv("VITE_SUPABASE_URL")
    or "https://dgnxigotdpqiwohocloi.supabase.co"
).rstrip("/")
SUPABASE_ANON_KEY = (
    os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("VITE_SUPABASE_ANON_KEY")
    or "sb_publishable_Z77o41ry4seJ7opnojlbaA_aiNUFo6B"
)
PHILIPPINE_TIMEZONE = ZoneInfo("Asia/Manila")

SKILL_ID_ALIASES = {
    "SK_PYTHON": "SK001",
    "SK_JAVASCRIPT": "SK002",
    "SK_SQL": "SK004",
    "SK_DATA_ANALYSIS": "SK005",
    "SK_DATA_VISUALIZATION": "SK006",
    "SK_TECHNICAL_SUPPORT": "SK007",
    "SK_CYBERSECURITY": "SK010",
    "SK_NETWORKING": "SK011",
    "SK_TROUBLESHOOTING": "SK007",
    "SK_HELPDESK": "SK007",
}


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_skill_ids(value: Any) -> str:
    raw_text = _safe_text(value)
    if not raw_text:
        return ""

    normalized_items = []
    for item in raw_text.replace(",", ";").replace("|", ";").split(";"):
        skill_id = item.strip().upper()
        if not skill_id:
            continue
        normalized_items.append(SKILL_ID_ALIASES.get(skill_id, skill_id))

    return ";".join(dict.fromkeys(normalized_items))


def _join_job_text(record: dict[str, Any]) -> str:
    fields = [
        "job_title",
        "job_description",
        "required_skills",
        "preferred_skills",
        "category_name",
        "location",
        "work_setup",
        "employment_type",
        "job_level",
    ]
    return " ".join(_safe_text(record.get(field)) for field in fields if _safe_text(record.get(field))).lower()


def _split_job_content(value: Any) -> tuple[str, str]:
    text = _safe_text(value).replace("\r\n", "\n").replace("\r", "\n")
    marker = re.search(r"(?:^|\n)\s*(?:key responsibilities|responsibilities|what you'll do)\s*:\s*", text, re.IGNORECASE)
    if not marker:
        return text, ""
    description = text[: marker.start()].strip()
    items = [re.sub(r"^\s*[-–—•*]\s*", "", item).strip() for item in text[marker.end() :].splitlines()]
    return description, "\n".join(item for item in items if item)


def _map_job_record(record: dict[str, Any], source: str) -> dict[str, str]:
    required_skills = _safe_text(record.get("required_skills"))
    preferred_skills = _safe_text(record.get("preferred_skills"))
    must_have_skill_ids = _normalize_skill_ids(record.get("must_have_skill_ids"))
    source_note = _safe_text(record.get("source_note"))
    source_platform = _safe_text(record.get("source_platform"))
    description, responsibilities = _split_job_content(record.get("job_description"))

    return {
        "job_id": _safe_text(record.get("job_id")),
        "category_id": _safe_text(record.get("category_code")),
        "job_category": _safe_text(record.get("category_name")),
        "job_subcategory": _safe_text(record.get("job_subcategory")),
        "job_title": _safe_text(record.get("job_title")),
        "company_name": _safe_text(record.get("company_name")),
        "location": _safe_text(record.get("location")),
        "work_type": _safe_text(record.get("work_setup")),
        "employment_type": _safe_text(record.get("employment_type")),
        "experience_level_required": _safe_text(record.get("job_level")),
        "salary_min_php": _safe_text(record.get("salary_min_php")),
        "salary_max_php": _safe_text(record.get("salary_max_php")),
        "salary_range_monthly_php": _format_salary_range(record),
        "job_description": description,
        "responsibilities": responsibilities,
        "required_skills_comma_separated": required_skills,
        "required_skill_ids": must_have_skill_ids,
        "must_have_skill_ids": must_have_skill_ids,
        "mapped_required_skill_names": required_skills,
        "nice_to_have_skills_optional": preferred_skills,
        "mapped_nice_to_have_skill_names": preferred_skills,
        "skill_gap_reliability": "high" if must_have_skill_ids else "medium",
        "external_job_link_optional": _safe_text(record.get("source_url")),
        "source_dataset": source_platform or source_note or f"{source}_jobs",
        "job_source": source,
        "created_at": _safe_text(record.get("created_at")),
        "updated_at": _safe_text(record.get("updated_at")),
        "posting_status": _safe_text(record.get("posting_status")),
        "job_text_for_matching": _join_job_text(record),
    }


def _map_internal_job(record: dict[str, Any]) -> dict[str, str]:
    return _map_job_record(record, "internal")


def _map_employer_job(record: dict[str, Any]) -> dict[str, str]:
    return _map_job_record(record, "employer")


def _format_salary_range(record: dict[str, Any]) -> str:
    def amount(value: Any) -> int:
        raw = _safe_text(value).replace(",", "")
        if not raw:
            return 0
        try:
            return int(float(raw))
        except ValueError:
            return 0

    min_salary = amount(record.get("salary_min_php"))
    max_salary = amount(record.get("salary_max_php"))
    if min_salary and max_salary:
        return f"₱{min_salary:,} - {max_salary:,}"
    if min_salary:
        return f"₱{min_salary:,}+"
    if max_salary:
        return f"Up to ₱{max_salary:,}"
    return ""


def _fetch_jobs_table(table_name: str, limit: int = 500) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 5000))
    common_fields = "job_id,category_code,category_name,job_subcategory,job_title,company_name,location,work_setup,employment_type,job_level,salary_min_php,salary_max_php,job_description,required_skills,preferred_skills,must_have_skill_ids,posting_status,created_at,updated_at"
    selected_fields = f"{common_fields},source_platform,source_url,source_note" if table_name == "internal_jobs" else f"{common_fields},application_deadline"
    page_size = min(500, safe_limit)
    rows: list[dict[str, Any]] = []

    while len(rows) < safe_limit:
        current_limit = min(page_size, safe_limit - len(rows))
        query = urlencode(
            {
                "select": selected_fields,
                "posting_status": "in.(active,open)",
                "order": "created_at.desc",
                "limit": str(current_limit),
                "offset": str(len(rows)),
            }
        )
        request = Request(
            f"{SUPABASE_URL}/rest/v1/{table_name}?{query}",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Accept": "application/json",
            },
            method="GET",
        )

        try:
            with urlopen(request, timeout=12) as response:
                payload = response.read().decode("utf-8")
        except (HTTPError, URLError, TimeoutError, OSError):
            return rows

        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return rows

        if not isinstance(data, list):
            return rows

        page = [item for item in data if isinstance(item, dict)]
        rows.extend(page)
        if len(page) < current_limit:
            break

    if table_name == "employer_job_posts":
        today = datetime.now(PHILIPPINE_TIMEZONE).date().isoformat()
        rows = [row for row in rows if not row.get("application_deadline") or str(row.get("application_deadline")) > today]
    return rows


def fetch_internal_jobs(limit: int = 500) -> list[dict[str, Any]]:
    return _fetch_jobs_table("internal_jobs", limit=limit)


def fetch_employer_jobs(limit: int = 500) -> list[dict[str, Any]]:
    return _fetch_jobs_table("employer_job_posts", limit=limit)


def load_internal_jobs_dataframe(limit: int = 5000) -> pd.DataFrame:
    internal_rows = [_map_internal_job(record) for record in fetch_internal_jobs(limit=limit)]
    employer_rows = [_map_employer_job(record) for record in fetch_employer_jobs(limit=limit)]
    rows = [*internal_rows, *employer_rows]
    rows = [row for row in rows if row.get("job_id") and row.get("job_title")]
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)
