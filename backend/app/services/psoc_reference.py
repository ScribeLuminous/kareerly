"""The published PSOC reference: read-only, local, no network.

scripts/import_reference_data.py psoc --publish downloads PSOC 2012 from the
PSA Classifications API and writes the last-known-good copy to data/psoc/.
Nothing here calls the API, so matching and job validation keep working when
the API is down or the token is missing; the reference is simply as old as its
retrieved_at date, and reference_status() says so.

PSOC classifies occupations. It is used to validate or describe a job's
occupation group, never to decide which skills a vacancy requires.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

REFERENCE_DIR = Path(__file__).resolve().parents[2] / "data" / "psoc"
GROUPS_FILE = "psoc_2012_groups.csv"
META_FILE = "psoc_reference_meta.json"
CROSSWALK_FILE = "psoc_isco_crosswalk.csv"
DEFAULT_MAX_AGE_DAYS = 365
LEVEL_BY_WIDTH = {1: "major", 2: "sub_major", 3: "minor", 4: "unit"}


def max_age_days() -> int:
    try:
        return max(1, int(os.getenv("PSOC_REFERENCE_MAX_AGE_DAYS", DEFAULT_MAX_AGE_DAYS)))
    except ValueError:
        return DEFAULT_MAX_AGE_DAYS


def _read_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


@lru_cache(maxsize=4)
def load_reference(directory: Path = REFERENCE_DIR) -> Dict[str, object]:
    meta_path = directory / META_FILE
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    except (OSError, ValueError):
        meta = {}
    return {
        "meta": meta,
        "groups": {row["psoc_code"]: row for row in _read_csv(directory / GROUPS_FILE)},
        "crosswalk": {row["psoc_code"]: row for row in _read_csv(directory / CROSSWALK_FILE)},
    }


def reference_status(directory: Path = REFERENCE_DIR, now: Optional[dt.datetime] = None) -> Dict[str, object]:
    """Whether a reference is available and how old it is. Never raises."""
    reference = load_reference(directory)
    meta, groups = reference["meta"], reference["groups"]
    limit = max_age_days()
    status: Dict[str, object] = {
        "available": bool(groups),
        "source": "local file published from the PSA Classifications API; not called at runtime",
        "version": meta.get("version", ""),
        "retrieved_at": meta.get("retrieved_at", ""),
        "groups": len(groups),
        "crosswalk_rows": len(reference["crosswalk"]),
        "max_age_days": limit,
        "age_days": None,
        "stale": None,
    }
    if not groups:
        status["note"] = "No PSOC reference published yet (import_reference_data.py psoc --publish)."
        return status
    try:
        retrieved = dt.datetime.fromisoformat(str(meta.get("retrieved_at", "")))
    except ValueError:
        status["stale"] = True
        status["note"] = "retrieved_at is missing or unreadable; treat the reference as stale."
        return status
    if retrieved.tzinfo is None:
        retrieved = retrieved.replace(tzinfo=dt.timezone.utc)
    age = ((now or dt.datetime.now(dt.timezone.utc)) - retrieved).days
    status["age_days"] = age
    status["stale"] = age > limit
    if status["stale"]:
        status["note"] = f"Older than {limit} days; refresh it from the PSA API when the token is available."
    return status


def normalize_code(value: object) -> str:
    text = re.sub(r"\s+", "", str(value or ""))
    return text[:-2] if text.endswith(".0") else text


def validate_occupation_code(code: object, directory: Path = REFERENCE_DIR) -> Dict[str, object]:
    """Is this a PSOC 2012 group? The code is not corrected: 110 is not 0110."""
    value = normalize_code(code)
    result: Dict[str, object] = {"code": value, "valid": False, "level": "", "title": "", "parent_code": "",
                                 "reason": "", "crosswalk_status": ""}
    if not value.isdigit() or len(value) not in LEVEL_BY_WIDTH:
        result["reason"] = "not_a_psoc_code"
        return result
    reference = load_reference(directory)
    if not reference["groups"]:
        result["reason"] = "reference_unavailable"
        return result
    group = reference["groups"].get(value)
    if group is None:
        padded = value.zfill(4)
        result["reason"] = "unknown_code" + (f" (did you mean {padded}?)" if padded != value and padded in reference["groups"] else "")
        return result
    crosswalk = reference["crosswalk"].get(value, {})
    result.update(valid=True, level=group["level"], title=group["title"], parent_code=group["parent_code"],
                  reason="ok", crosswalk_status=crosswalk.get("status", ""))
    return result


def isco_crosswalk(code: object, directory: Path = REFERENCE_DIR) -> Dict[str, str]:
    """The reviewed-or-proposed ISCO-08 correspondence for a PSOC group, or {} when none is recorded."""
    return dict(load_reference(directory)["crosswalk"].get(normalize_code(code), {}))
