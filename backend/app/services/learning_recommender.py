from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any, Optional
from datetime import date
from urllib.parse import urlsplit
import os
import threading
import time

import pandas as pd

from .supabase_learning_resources import load_learning_resources_dataframe


BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"

LEARNING_RESOURCES_PATH = DATA_DIR / "learning_resources.csv"
SKILLS_REFERENCE_PATH = DATA_DIR / "skills_reference.csv"
LEARNING_RESOURCES_SOURCE = "csv"
LEARNING_RESOURCES_CACHE_SECONDS = float(os.getenv("KAREERLY_LEARNING_RESOURCES_CACHE_SECONDS", "300"))
_learning_resources_cache_lock = threading.Lock()
_learning_resources_cache: dict[str, Any] = {"data": None, "loaded_at": 0.0}


def get_learning_resources_source() -> str:
    return LEARNING_RESOURCES_SOURCE


def load_learning_resources() -> pd.DataFrame:
    global LEARNING_RESOURCES_SOURCE

    with _learning_resources_cache_lock:
        cached = _learning_resources_cache["data"]
        if cached is not None and time.monotonic() - _learning_resources_cache["loaded_at"] < LEARNING_RESOURCES_CACHE_SECONDS:
            return cached.copy()

        supabase_df = load_learning_resources_dataframe()
        if not supabase_df.empty:
            LEARNING_RESOURCES_SOURCE = "supabase_learning_resources"
            df = supabase_df
        else:
            if not LEARNING_RESOURCES_PATH.exists():
                raise FileNotFoundError(
                    f"Missing learning resources file: {LEARNING_RESOURCES_PATH}"
                )

            df = pd.read_csv(LEARNING_RESOURCES_PATH, dtype=str, keep_default_na=False)
            df.columns = [column.strip() for column in df.columns]
            LEARNING_RESOURCES_SOURCE = "csv"

        _learning_resources_cache.update(data=df.copy(), loaded_at=time.monotonic())
        return df.copy()


def clear_learning_resources_cache() -> None:
    with _learning_resources_cache_lock:
        _learning_resources_cache.update(data=None, loaded_at=0.0)


def load_skills_reference() -> pd.DataFrame:
    if not SKILLS_REFERENCE_PATH.exists():
        raise FileNotFoundError(
            f"Missing skills reference file: {SKILLS_REFERENCE_PATH}"
        )

    df = pd.read_csv(SKILLS_REFERENCE_PATH, dtype=str, keep_default_na=False)
    df.columns = [column.strip() for column in df.columns]
    return df


def split_ids(value: Any) -> list[str]:
    if value is None or pd.isna(value):
        return []

    text = str(value)
    text = text.replace(",", ";").replace("|", ";")

    return [item.strip().upper() for item in text.split(";") if item.strip()]


def split_text_values(value: Any) -> list[str]:
    if value is None or pd.isna(value):
        return []

    text = str(value)
    text = text.replace("|", ";").replace(",", ";")
    return [item.strip() for item in text.split(";") if item.strip()]


def safe_float(value: Any, default: float = 70.0) -> float:
    try:
        if value is None or pd.isna(value):
            return default

        text = str(value).strip()

        if not text:
            return default

        return float(text)
    except (TypeError, ValueError):
        return default


def _evidence_strength_from_reliability(value: Any) -> float:
    reliability = str(value or "").strip().lower()
    if reliability == "high":
        return 0.85
    if reliability == "medium":
        return 0.65
    if reliability == "low":
        return 0.45
    numeric_value = safe_float(value, default=0.0)
    if numeric_value <= 0:
        return 0.0
    if numeric_value > 1:
        return min(numeric_value / 100.0, 1.0)
    return min(numeric_value, 1.0)


def compute_skill_coverage_by_id(
    candidate_skill_ids: list[str],
    required_skill_ids: list[str],
) -> tuple[float, list[str], list[str]]:
    candidate_set = {skill_id.strip().upper() for skill_id in candidate_skill_ids if skill_id.strip()}
    required_set = {skill_id.strip().upper() for skill_id in required_skill_ids if skill_id.strip()}

    if not required_set:
        return 0.0, [], []

    matched = sorted(candidate_set.intersection(required_set))
    missing = sorted(required_set.difference(candidate_set))

    coverage = len(matched) / len(required_set)

    return coverage, matched, missing


def _skills_lookup_by_id(skills_df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    df = skills_df.copy()
    df.columns = [column.strip() for column in df.columns]
    if "skill_id" not in df.columns:
        raise ValueError("skills_reference.csv must contain a skill_id column.")
    return df.set_index("skill_id").to_dict(orient="index")


def _skill_aliases(skill: dict[str, Any]) -> set[str]:
    aliases: set[str] = set()
    for field in ["skill_name", "related_skills", "esco_preferred_label", "esco_alternative_labels"]:
        for item in split_text_values(skill.get(field, "")):
            aliases.add(item.strip().lower())
    return {alias for alias in aliases if alias}


def _resource_text(resource: pd.Series) -> str:
    return " ".join(
        [
            str(resource.get("course_or_certification_title", "")),
            str(resource.get("course_or_certification_description", "")),
            str(resource.get("skills_youll_gain", "")),
            str(resource.get("mapped_skill_names", "")),
            str(resource.get("category_name", "")),
        ]
    ).lower()


def add_skill_gap_fields(
    match_results: list[dict],
    candidate_skill_ids: list[str],
) -> list[dict]:
    enriched = []

    for result in match_results:
        required_ids = split_ids(result.get("required_skill_ids", ""))
        must_have_ids = split_ids(result.get("must_have_skill_ids", ""))

        coverage, matched, missing = compute_skill_coverage_by_id(
            candidate_skill_ids=candidate_skill_ids,
            required_skill_ids=required_ids,
        )

        must_have_coverage, _, _ = compute_skill_coverage_by_id(
            candidate_skill_ids=candidate_skill_ids,
            required_skill_ids=must_have_ids,
        )
        if not must_have_ids:
            must_have_coverage = coverage

        item = dict(result)
        item["skill_coverage"] = round(coverage, 4)
        item["matched_skill_ids"] = matched
        item["missing_skill_ids"] = missing
        item["must_have_skill_coverage"] = round(must_have_coverage, 4)

        evidence_strength = _evidence_strength_from_reliability(item.get("skill_gap_reliability", ""))
        must_have_or_evidence = max(must_have_coverage, evidence_strength)
        item["evidence_strength"] = round(evidence_strength, 4)
        item["must_have_or_evidence"] = round(must_have_or_evidence, 4)

        if "text_similarity" in item:
            text_similarity = safe_float(item.get("text_similarity"), default=0.0)

            item["fit_now_score"] = round(
                (0.60 * text_similarity) + (0.40 * coverage),
                4,
            )
            item["fit_now_percentage"] = round(item["fit_now_score"] * 100, 2)

            item["employer_alignment_score"] = round(
                (0.50 * text_similarity) + (0.35 * coverage) + (0.15 * must_have_or_evidence),
                4,
            )
            item["employer_alignment_percentage"] = round(item["employer_alignment_score"] * 100, 2)

        enriched.append(item)

    return enriched


def prioritize_skill_gaps(
    match_results: list[dict],
    skills_df: Optional[pd.DataFrame] = None,
    learning_df: Optional[pd.DataFrame] = None,
    preferences: Optional[dict] = None,
    max_gaps: int = 8,
) -> list[dict]:
    if skills_df is None:
        skills_df = load_skills_reference()
    if learning_df is None:
        learning_df = load_learning_resources()

    skills_df.columns = [column.strip() for column in skills_df.columns]
    skills_lookup = _skills_lookup_by_id(skills_df)

    total_top_matches = max(len(match_results), 1)
    preference_skill = str((preferences or {}).get("skill_to_develop", "")).strip().lower()
    preference_industry = str((preferences or {}).get("industry", "")).strip().lower()

    aggregate: dict[str, dict[str, Any]] = {}

    for result in match_results:
        missing_ids = [skill_id.strip().upper() for skill_id in result.get("missing_skill_ids", []) if skill_id]
        must_have_ids = {skill_id.strip().upper() for skill_id in split_ids(result.get("must_have_skill_ids", "")) if skill_id}
        job_title = str(result.get("job_title", "")).strip()
        job_category = str(result.get("job_category", "")).strip().lower()
        job_subcategory = str(result.get("job_subcategory", "")).strip().lower()

        for skill_id in missing_ids:
            bucket = aggregate.setdefault(
                skill_id,
                {
                    "skill_id": skill_id,
                    "frequency_count": 0,
                    "affected_jobs": [],
                    "requirement_importance": "unknown",
                    "requirement_importance_score": 0.4,
                    "preference_relevance_score": 0.5,
                },
            )
            bucket["frequency_count"] += 1
            if job_title and job_title not in bucket["affected_jobs"]:
                bucket["affected_jobs"].append(job_title)

            if skill_id in must_have_ids:
                bucket["requirement_importance"] = "must-have"
                bucket["requirement_importance_score"] = 1.0
            elif bucket["requirement_importance"] != "must-have":
                bucket["requirement_importance"] = "preferred"
                bucket["requirement_importance_score"] = max(bucket["requirement_importance_score"], 0.6)

            skill_meta = skills_lookup.get(skill_id, {})
            skill_text = " ".join(
                [
                    str(skill_meta.get("skill_name", "")),
                    str(skill_meta.get("skill_category", "")),
                    str(skill_meta.get("skill_subcategory", "")),
                    job_category,
                    job_subcategory,
                ]
            ).lower()
            if (preference_skill and preference_skill in skill_text) or (preference_industry and preference_industry in skill_text):
                bucket["preference_relevance_score"] = 1.0

    gaps: list[dict[str, Any]] = []

    for skill_id, bucket in aggregate.items():
        skill = skills_lookup.get(skill_id, {})
        frequency_count = int(bucket["frequency_count"])
        frequency_score = frequency_count / total_top_matches
        if frequency_count >= 3:
            gap_severity_score = 1.0
        elif frequency_count == 2:
            gap_severity_score = 0.7
        else:
            gap_severity_score = 0.4

        gap_payload = {
            "skill_id": skill_id,
            "skill_name": skill.get("skill_name", skill_id),
            "skill_category": skill.get("skill_category", ""),
            "skill_subcategory": skill.get("skill_subcategory", ""),
            "category_id": skill.get("category_id", ""),
            "category_name": skill.get("skill_category", ""),
            "appears_in_top_matches": frequency_count,
            "missing_count": frequency_count,
            "affected_jobs": bucket["affected_jobs"],
            "affected_job_count": len(bucket["affected_jobs"]),
            "requirement_importance": bucket["requirement_importance"],
            "requirement_importance_score": round(float(bucket["requirement_importance_score"]), 4),
            "frequency_score": round(frequency_score, 4),
            "gap_severity_score": round(gap_severity_score, 4),
            "preference_relevance_score": round(float(bucket["preference_relevance_score"]), 4),
        }

        top_resources = recommend_learning_resources_for_gap(
            gap=gap_payload,
            learning_df=learning_df,
            skills_lookup=skills_lookup,
            preferences=preferences,
            max_recommendations=3,
        )
        learning_resource_availability_score = 1.0 if top_resources else 0.0

        priority_score = (
            0.35 * frequency_score
            + 0.25 * float(bucket["requirement_importance_score"])
            + 0.20 * gap_severity_score
            + 0.10 * float(bucket["preference_relevance_score"])
            + 0.10 * learning_resource_availability_score
        )

        if priority_score >= 0.75 or frequency_count >= 3:
            severity = "Critical"
        elif (0.50 <= priority_score < 0.75) or frequency_count == 2:
            severity = "High"
        else:
            severity = "Moderate"

        gap_payload.update(
            {
                "severity": severity,
                "priority_score": round(priority_score, 4),
                "learning_resource_available": bool(top_resources),
                "learning_resource_availability_score": learning_resource_availability_score,
                "recommended_learning_resources": top_resources,
            }
        )
        gaps.append(gap_payload)

    return sorted(gaps, key=lambda item: (item.get("priority_score", 0.0), item.get("missing_count", 0)), reverse=True)[:max_gaps]


def affordability_score(cost_type: Any) -> float:
    cost = str(cost_type).lower()

    if "free" in cost and "paid" not in cost:
        return 1.00

    if "free" in cost and "paid" in cost:
        return 0.75

    if "paid" in cost:
        return 0.40

    return 0.50


def user_fit_score(
    resource: pd.Series,
    preferences: Optional[dict] = None,
) -> float:
    if not preferences:
        return 0.50

    preferred_skill = str(preferences.get("skill_to_develop", "")).lower()

    text = " ".join(
        [
            str(resource.get("course_or_certification_title", "")),
            str(resource.get("skills_youll_gain", "")),
            str(resource.get("level", "")),
        ]
    ).lower()

    score = 0.50

    if preferred_skill and preferred_skill in text:
        score += 0.30

    level = str(resource.get("level", "")).lower()

    if "beginner" in level or "foundation" in level:
        score += 0.10

    return min(score, 1.00)


def compute_certification_score(
    gap_coverage: float,
    provider_trust: float,
    affordability: float,
    user_fit: float,
) -> float:
    return (
        0.65 * gap_coverage
        + 0.15 * provider_trust
        + 0.10 * affordability
        + 0.10 * user_fit
    )


def provider_url(value: Any) -> str:
    """Only catalog URLs; never manufacture provider search links."""
    text = str(value or "").strip()
    try:
        parsed = urlsplit(text)
        if (parsed.scheme in {"https", "http"} and parsed.hostname
                and not parsed.username and not parsed.password
                and not any(char.isspace() for char in text)):
            _ = parsed.port
            return text
    except ValueError:
        pass
    return ""


def resource_is_reviewed(resource: Any) -> bool:
    """Fail closed for legacy, generated, and incomplete review records."""
    def field(key: str) -> str:
        value = resource.get(key, "")
        return "" if pd.isna(value) else str(value).strip()

    try:
        checked = date.fromisoformat(field("last_verified_at"))
    except ValueError:
        return False
    return (
        field("status").lower() == "active"
        and field("skill_id_mapping_status").lower() == "reviewed"
        and field("review_status").lower() == "verified"
        and checked <= date.today()
        and all(field(key) for key in (
            "resource_id", "course_or_certification_title", "offered_by_provider",
            "reviewer", "source_evidence", "skill_id_mapping_notes", "catalog_version",
        ))
        and bool(provider_url(field("source_evidence")))
        and bool(split_ids(field("skill_ids")))
    )


def recommend_learning_resources_for_gap(
    gap: dict[str, Any],
    learning_df: Optional[pd.DataFrame] = None,
    skills_lookup: Optional[dict[str, dict[str, Any]]] = None,
    preferences: Optional[dict] = None,
    max_recommendations: int = 3,
) -> list[dict[str, Any]]:
    if learning_df is None:
        learning_df = load_learning_resources()
    skill_id = str(gap.get("skill_id", "")).strip().upper()
    if not skill_id or learning_df.empty:
        return []
    skill_name = str(gap.get("skill_name") or (skills_lookup or {}).get(skill_id, {}).get("skill_name") or skill_id)
    recommendations = []
    for _, resource in learning_df.iterrows():
        if not resource_is_reviewed(resource) or skill_id not in split_ids(resource.get("skill_ids", "")):
            continue
        def value(key: str, default: str = "") -> str:
            raw = resource.get(key, "")
            return default if pd.isna(raw) or not str(raw).strip() else str(raw).strip()
        # Resource kind is reviewed catalog data, independent of award claims.
        kind = value("resource_type").lower()
        action = "View preparation course" if kind in {"exam_review", "exam_preparation"} else "View certification" if kind in {"certification", "credential", "exam", "industry_certification"} else "Start learning"
        credential_verified = value("credential_review_status").lower() == "verified" and bool(value("credential_conditions")) and bool(provider_url(value("credential_evidence")))
        recommendations.append({
            "resource_id": value("resource_id"), "title": value("course_or_certification_title"),
            "description": value("course_or_certification_description"), "provider": value("offered_by_provider"),
            "provider_type": value("provider_type"), "resource_type": kind,
            "review_status": "verified", "matched_gap_skill_ids": [skill_id],
            "matched_gap_skill_names": [skill_name], "gap_skill_name": skill_name,
            "skills_youll_gain": value("skills_youll_gain"),
            "credential_label": value("credential_conditions") if credential_verified else "Credential conditions unknown",
            "credential_conditions": value("credential_conditions") if credential_verified else "Unknown — check with provider",
            "cost_type": value("cost_type", "Unknown — check with provider"),
            "certificate_cost": value("certificate_cost", "Unknown — check with provider"),
            "prerequisites": value("prerequisites", "Unknown — check with provider"),
            "level": value("level"), "estimated_duration": value("estimated_duration"),
            "language": value("language"), "delivery_mode": value("delivery_mode"),
            "url": provider_url(value("external_course_or_certification_link")), "url_label": action,
            "last_verified_at": value("last_verified_at"),
            "certification_score": 0, "recommendation_percentage": 0,
            "why_recommended": f"Reviewed catalog mapping to {skill_name}.",
            "relevance_method": "reviewed_skill_id_mapping",
        })
    return sorted(recommendations, key=lambda item: item["resource_id"])[:max(0, max_recommendations)]


def recommend_learning_resources(
    skill_gaps: list[dict],
    learning_df: Optional[pd.DataFrame] = None,
    preferences: Optional[dict] = None,
    max_recommendations: int = 8,
) -> list[dict]:
    if learning_df is None:
        learning_df = load_learning_resources()
    resources: dict[str, dict] = {}
    for gap in skill_gaps:
        for resource in recommend_learning_resources_for_gap(gap, learning_df, preferences=preferences):
            existing = resources.get(resource["resource_id"])
            if existing:
                for id_key in ("matched_gap_skill_ids", "matched_gap_skill_names"):
                    existing[id_key] = list(dict.fromkeys(existing[id_key] + resource[id_key]))
            else:
                resources[resource["resource_id"]] = resource
    return list(resources.values())[:max(0, max_recommendations)]
