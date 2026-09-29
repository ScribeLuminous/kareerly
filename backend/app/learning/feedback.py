"""Build a match_feedback row from the recommendation the candidate was shown.

The context is taken from the candidate's own saved match history, not from the
request body, so a vote is always tied to a job that was actually recommended to
that account and to the signals it was ranked with. Only whitelisted numeric
signals are copied: no resume text, skill names or contact details.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, Optional

FIT_NOW = "Fit-Now"
ASPIRATION = "Aspiration"
JOB_SOURCES = {"internal", "employer"}
VOTES = {"good": 1, "bad": -1}
HISTORY_ROWS_SEARCHED = 30
# PostgREST JSON-path select: only the match lists and metadata, never the resume.
HISTORY_SELECT = (
    "id,created_at,"
    "all_fit_now:results_json->all_fit_now_matches,fit_now:results_json->fit_now_matches,"
    "all_aspiration:results_json->all_aspiration_matches,aspiration:results_json->aspiration_matches,"
    "metadata:results_json->metadata"
)
UNIT_FIELDS = {
    "match_score": ("match_score",),
    "semantic_similarity": ("semantic_similarity", "semantic_score"),
    "required_skill_coverage": ("required_skill_coverage",),
    "preferred_skill_coverage": ("preferred_skill_coverage",),
    "preference_alignment": ("preference_alignment",),
    "learning_readiness": ("learning_readiness",),
}


def _unit(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(min(max(number, 0.0), 1.0), 4)


def _text(value: Any, limit: int = 120) -> Optional[str]:
    text = str(value or "").strip()
    return text[:limit] or None


def _item_source(item: Dict[str, Any]) -> str:
    source = str(item.get("job_source") or "internal").strip().lower()
    return source if source in JOB_SOURCES else "internal"


def context_from_item(item: Dict[str, Any], category: str, position: int, history: Dict[str, Any]) -> Dict[str, Any]:
    context: Dict[str, Any] = {
        "match_history_id": history.get("id"),
        "match_category": category,
        "rank_position": int(item.get("rank_position") or position),
    }
    for column, keys in UNIT_FIELDS.items():
        context[column] = next((v for v in (_unit(item.get(k)) for k in keys) if v is not None), None)
    if context["match_score"] is None:
        try:
            context["match_score"] = _unit(float(item.get("match_percentage")) / 100.0)
        except (TypeError, ValueError):
            pass
    critical = item.get("critical_missing_skill_ids")
    breakdown = item.get("match_breakdown") if isinstance(item.get("match_breakdown"), dict) else {}
    count = len(critical) if isinstance(critical, list) else breakdown.get("critical_missing_count")
    try:
        context["critical_missing_count"] = max(0, min(50, int(count))) if count is not None else None
    except (TypeError, ValueError):
        context["critical_missing_count"] = None
    in_area = item.get("in_preferred_career_area")
    context["in_preferred_career_area"] = in_area if isinstance(in_area, bool) else None
    context["job_category_id"] = _text(item.get("category_id"), 20)
    metadata = history.get("metadata") if isinstance(history.get("metadata"), dict) else {}
    context["model_version"] = _text(metadata.get("model_version"))
    context["ranker_version"] = _text(item.get("ranker_version") or metadata.get("ranker_version"))
    return context


def find_match_context(history_rows: Iterable[Dict[str, Any]], job_id: str, job_source: str) -> Optional[Dict[str, Any]]:
    """Context of the most recent recommendation of this job, or None if never shown."""
    for history in history_rows:
        for keys, category in ((("all_fit_now", "fit_now"), FIT_NOW), (("all_aspiration", "aspiration"), ASPIRATION)):
            items = next((history.get(key) for key in keys if isinstance(history.get(key), list) and history.get(key)), [])
            for position, item in enumerate(items, start=1):
                if not isinstance(item, dict):
                    continue
                if str(item.get("job_id") or "").strip() == job_id and _item_source(item) == job_source:
                    return context_from_item(item, category, position, history)
    return None


def fallback_match_context(category: Optional[str], score: Any) -> Optional[Dict[str, Any]]:
    """Minimal context for a job that is not in the recent saved runs (older run, application, Kareers)."""
    label = {"fit-now": FIT_NOW, "fit_now": FIT_NOW, "aspiration": ASPIRATION}.get(str(category or "").strip().lower().replace(" ", "-"))
    if label is None:
        return None
    value = _unit(score)
    return {"match_category": label, "match_score": value}
