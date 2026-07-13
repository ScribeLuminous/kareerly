from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

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

EXPECTED_COLUMNS = [
    "resource_id",
    "course_or_certification_title",
    "course_or_certification_description",
    "recommended_experience",
    "schedule",
    "level",
    "estimated_duration",
    "skills_youll_gain",
    "skill_ids",
    "category_id",
    "category_name",
    "offered_by_provider",
    "provider_type",
    "provider_trust_score_auto",
    "resource_type",
    "language",
    "delivery_mode",
    "cost_type",
    "status",
    "notes",
    "external_course_or_certification_link",
    "mapped_skill_names",
    "skill_id_mapping_status",
    "skill_id_mapping_notes",
]

COLUMN_ALIASES = {
    "title": "course_or_certification_title",
    "description": "course_or_certification_description",
    "provider": "offered_by_provider",
    "url": "external_course_or_certification_link",
    "external_url": "external_course_or_certification_link",
    "link": "external_course_or_certification_link",
    "duration": "estimated_duration",
    "skill_id": "skill_ids",
    "skill_ids_csv": "skill_ids",
}


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def fetch_learning_resources(limit: int = 1000) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 5000))
    query = urlencode(
        {
            "select": "*",
            "or": "(status.eq.active,status.is.null)",
            "limit": str(safe_limit),
        }
    )
    request = Request(
        f"{SUPABASE_URL}/rest/v1/learning_resources?{query}",
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
        return []

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return []

    if not isinstance(data, list):
        return []

    return [item for item in data if isinstance(item, dict)]


def _map_learning_resource(record: dict[str, Any]) -> dict[str, str]:
    mapped = {column: "" for column in EXPECTED_COLUMNS}

    for raw_key, value in record.items():
        key = COLUMN_ALIASES.get(str(raw_key), str(raw_key))
        if key in mapped:
            mapped[key] = _safe_text(value)

    if not mapped["resource_id"]:
        mapped["resource_id"] = _safe_text(record.get("id"))

    return mapped


def load_learning_resources_dataframe(limit: int = 1000) -> pd.DataFrame:
    rows = [_map_learning_resource(record) for record in fetch_learning_resources(limit=limit)]
    rows = [
        row
        for row in rows
        if row.get("resource_id") and row.get("course_or_certification_title")
    ]
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows, columns=EXPECTED_COLUMNS)
