"""Approved skill additions merged with backend/data/skills_reference.csv at runtime.

Admins approve proposals from skill discovery (backend/app/learning/skill_discovery.py);
approval writes a row to ``skill_taxonomy_additions``. This module reads the active
rows with the public anon key and merges them into the reference rows every
taxonomy consumer loads, so an approved skill or alias is usable without a code
change or redeploy. Only approved rows are ever read: proposals are not visible
here and user-entered text never becomes a skill on its own.

Failure behaviour: Supabase not configured, unreachable or returning bad rows
means the CSV taxonomy alone (or the last good set of additions).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from typing import Any, Dict, Iterable, List

from ..learning.supabase_client import SupabaseError, SupabaseRest, configured_anon_key, configured_url

logger = logging.getLogger(__name__)

SKILL_ID_PATTERN = re.compile(r"^SK\d+$")
APPROVED_ALIASES_FIELD = "approved_aliases"
ADDITION_MAPPING_STATUS = "approved_addition"

_lock = threading.Lock()
_cache: Dict[str, Any] = {"rows": [], "loaded_at": 0.0, "loaded": False}


def _cache_seconds() -> float:
    try:
        return max(0.0, float(os.getenv("KAREERLY_TAXONOMY_CACHE_SECONDS", "300")))
    except ValueError:
        return 300.0


def enabled() -> bool:
    return os.getenv("KAREERLY_TAXONOMY_ADDITIONS", "1").strip().lower() not in {"0", "false", "off"}


def _valid(row: Dict[str, Any]) -> bool:
    label = str(row.get("label") or "").strip()
    return (
        row.get("kind") in {"skill", "alias"}
        and bool(SKILL_ID_PATTERN.match(str(row.get("skill_id") or "").strip().upper()))
        and 2 <= len(label) <= 80
    )


def _fetch() -> List[Dict[str, Any]]:
    rows = SupabaseRest.anon().select("skill_taxonomy_additions", {
        "select": "kind,skill_id,label,category_id,skill_category,approved_at",
        "status": "eq.active",
        "order": "approved_at.asc",
        "limit": "5000",
    })
    return [
        {**row, "skill_id": str(row["skill_id"]).strip().upper(), "label": str(row["label"]).strip()}
        for row in rows if _valid(row)
    ]


def active_additions() -> List[Dict[str, Any]]:
    if not enabled() or not configured_url() or not configured_anon_key():
        return []
    with _lock:
        if _cache["loaded"] and time.monotonic() - _cache["loaded_at"] < _cache_seconds():
            return list(_cache["rows"])
    try:
        rows = _fetch()
    except SupabaseError as exc:
        # Keep serving the last good set; retry after another cache period.
        logger.warning("Skill taxonomy additions unavailable: %s", exc)
        with _lock:
            _cache.update(loaded_at=time.monotonic(), loaded=True)
            return list(_cache["rows"])
    with _lock:
        _cache.update(rows=rows, loaded_at=time.monotonic(), loaded=True)
    return list(rows)


def clear_cache() -> None:
    with _lock:
        _cache.update(rows=[], loaded_at=0.0, loaded=False)


def fingerprint(additions: Iterable[Dict[str, Any]]) -> str:
    material = sorted((row["kind"], row["skill_id"], row["label"].lower(), row.get("category_id") or "") for row in additions)
    return hashlib.sha256(json.dumps(material).encode()).hexdigest()[:16]


def merge_reference_rows(base_rows: List[Dict[str, Any]], additions: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return reference rows with approved skills appended and aliases attached.

    A new skill whose ID already exists in the CSV is ignored, so an addition can
    never overwrite a reviewed CSV row. Aliases are stored in their own field and
    count as aliases whatever the row's ESCO mapping status.
    """
    rows = [dict(row) for row in base_rows]
    by_id = {str(row.get("skill_id") or "").strip().upper(): row for row in rows}
    additions = list(additions)
    for addition in (a for a in additions if a["kind"] == "skill"):
        if addition["skill_id"] in by_id:
            continue
        row = {
            "skill_id": addition["skill_id"],
            "category_id": addition.get("category_id") or "",
            "skill_category": addition.get("skill_category") or "",
            "skill_subcategory": "",
            "skill_name": addition["label"],
            "skill_description": "",
            "related_skills": "",
            "esco_skill_uri": "",
            "esco_preferred_label": addition["label"],
            "esco_alternative_labels": "",
            "mapping_status": ADDITION_MAPPING_STATUS,
            APPROVED_ALIASES_FIELD: "",
        }
        rows.append(row)
        by_id[addition["skill_id"]] = row
    for addition in (a for a in additions if a["kind"] == "alias"):
        row = by_id.get(addition["skill_id"])
        if row is None:
            continue
        existing = [part for part in str(row.get(APPROVED_ALIASES_FIELD) or "").split(";") if part]
        if addition["label"] not in existing:
            existing.append(addition["label"])
        row[APPROVED_ALIASES_FIELD] = ";".join(existing)
    return rows
