from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any, Optional
import math

import pandas as pd

from .supabase_learning_resources import load_learning_resources_dataframe
from .cross_encoder_service import score_text_pairs


BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"

LEARNING_RESOURCES_PATH = DATA_DIR / "learning_resources.csv"
SKILLS_REFERENCE_PATH = DATA_DIR / "skills_reference.csv"
LEARNING_RESOURCES_SOURCE = "csv"


def get_learning_resources_source() -> str:
    return LEARNING_RESOURCES_SOURCE


def load_learning_resources() -> pd.DataFrame:
    global LEARNING_RESOURCES_SOURCE

    supabase_df = load_learning_resources_dataframe()
    if not supabase_df.empty:
        LEARNING_RESOURCES_SOURCE = "supabase_learning_resources"
        return supabase_df

    if not LEARNING_RESOURCES_PATH.exists():
        raise FileNotFoundError(
            f"Missing learning resources file: {LEARNING_RESOURCES_PATH}"
        )

    df = pd.read_csv(LEARNING_RESOURCES_PATH, dtype=str, keep_default_na=False)
    df.columns = [column.strip() for column in df.columns]
    LEARNING_RESOURCES_SOURCE = "csv"
    return df


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


def recommend_learning_resources_for_gap(
    gap: dict[str, Any],
    learning_df: Optional[pd.DataFrame] = None,
    skills_lookup: Optional[dict[str, dict[str, Any]]] = None,
    preferences: Optional[dict] = None,
    max_recommendations: int = 3,
) -> list[dict[str, Any]]:
    if learning_df is None:
        learning_df = load_learning_resources()
    if learning_df.empty:
        return []

    if skills_lookup is None:
        skills_lookup = _skills_lookup_by_id(load_skills_reference())

    skill_id = str(gap.get("skill_id", "")).strip().upper()
    skill_meta = skills_lookup.get(skill_id, {})
    skill_name = str(gap.get("skill_name") or skill_meta.get("skill_name") or skill_id).strip()
    skill_aliases = _skill_aliases(skill_meta)
    if skill_name:
        skill_aliases.add(skill_name.lower())

    gap_category_name = str(gap.get("category_name") or skill_meta.get("skill_category") or "").strip().lower()
    preferred_skill = str((preferences or {}).get("skill_to_develop", "")).strip().lower()

    recommendations: list[dict[str, Any]] = []
    resource_texts = [_resource_text(resource) for _, resource in learning_df.iterrows()]
    cross_encoder_scores: list[float] = []
    try:
        query = " ".join(
            part for part in [
                f"Learning resource for skill gap: {skill_name}",
                f"Target skill: {preferred_skill}" if preferred_skill else "",
                f"Career category: {gap_category_name}" if gap_category_name else "",
            ]
            if part
        )
        raw_scores = score_text_pairs(query, resource_texts)
        cross_encoder_scores = [1.0 / (1.0 + math.exp(-float(score))) for score in raw_scores]
    except Exception:
        # Keep an explicit keyword fallback for offline development only.
        cross_encoder_scores = [0.0] * len(resource_texts)

    for resource_position, (_, resource) in enumerate(learning_df.iterrows()):
        resource_skill_ids = set(split_ids(resource.get("skill_ids", "")))
        resource_mapped_names = {item.lower() for item in split_text_values(resource.get("mapped_skill_names", ""))}
        resource_text = _resource_text(resource)

        id_match = skill_id and skill_id in resource_skill_ids
        alias_match = bool(skill_aliases.intersection(resource_mapped_names))
        keyword_match = any(alias in resource_text for alias in skill_aliases)

        if not (id_match or alias_match or keyword_match):
            continue

        keyword_relevance = 1.0 if id_match else 0.85 if alias_match else 0.65
        cross_encoder_relevance = cross_encoder_scores[resource_position]
        semantic_or_keyword_relevance = (
            cross_encoder_relevance if cross_encoder_relevance > 0 else keyword_relevance
        )
        skill_coverage = min(len(resource_skill_ids.intersection({skill_id})) or int(alias_match) or int(keyword_match), 1)
        provider_trust_score = safe_float(resource.get("provider_trust_score_auto", 70.0), default=70.0) / 100.0

        level_text = str(resource.get("level", "")).lower()
        level_fit = 1.0 if "beginner" in level_text or "foundation" in level_text else 0.8 if level_text else 0.6
        duration_text = str(resource.get("estimated_duration", "")).lower()
        cost_fit = 1.0 if "free" in str(resource.get("cost_type", "")).lower() else 0.75
        if any(token in duration_text for token in ["week", "hour", "self-paced"]):
            cost_fit = min(1.0, cost_fit + 0.1)

        if preferred_skill and preferred_skill in resource_text:
            semantic_or_keyword_relevance = min(1.0, semantic_or_keyword_relevance + 0.1)

        learning_score = (
            0.35 * semantic_or_keyword_relevance
            + 0.25 * float(skill_coverage)
            + 0.20 * provider_trust_score
            + 0.10 * level_fit
            + 0.10 * cost_fit
        )

        recommendations.append(
            {
                "resource_id": resource.get("resource_id", ""),
                "title": resource.get("course_or_certification_title", ""),
                "description": resource.get("course_or_certification_description", ""),
                "provider": resource.get("offered_by_provider", ""),
                "provider_type": resource.get("provider_type", ""),
                "resource_type": resource.get("resource_type", ""),
                "level": resource.get("level", ""),
                "language": resource.get("language", ""),
                "delivery_mode": resource.get("delivery_mode", ""),
                "cost_type": resource.get("cost_type", ""),
                "estimated_duration": resource.get("estimated_duration", ""),
                "matched_gap_skill_ids": [skill_id] if skill_id else [],
                "skills_youll_gain": resource.get("skills_youll_gain", ""),
                "certification_score": round(learning_score, 4),
                "recommendation_percentage": round(learning_score * 100, 2),
                "url": resource.get("external_course_or_certification_link", ""),
                "category_name": resource.get("category_name", ""),
                "semantic_or_keyword_relevance": round(semantic_or_keyword_relevance, 4),
                "cross_encoder_relevance": round(cross_encoder_relevance, 4),
                "relevance_method": (
                    "cross_encoder_bert" if cross_encoder_relevance > 0 else "keyword_fallback"
                ),
                "gap_skill_name": skill_name,
                "why_recommended": (
                    f"Helps address the repeated skill gap in {skill_name}."
                    if skill_name
                    else "Helps address a repeated skill gap found in your recommended roles."
                ),
            }
        )

    return sorted(recommendations, key=lambda item: item["certification_score"], reverse=True)[:max_recommendations]


def recommend_learning_resources(
    skill_gaps: list[dict],
    learning_df: Optional[pd.DataFrame] = None,
    preferences: Optional[dict] = None,
    max_recommendations: int = 8,
) -> list[dict]:
    if learning_df is None:
        learning_df = load_learning_resources()
    skills_lookup = _skills_lookup_by_id(load_skills_reference())
    flattened: list[dict[str, Any]] = []
    seen_resource_ids: set[str] = set()

    for gap in skill_gaps:
        for resource in recommend_learning_resources_for_gap(
            gap=gap,
            learning_df=learning_df,
            skills_lookup=skills_lookup,
            preferences=preferences,
            max_recommendations=3,
        ):
            resource_id = str(resource.get("resource_id", "")).strip()
            if not resource_id or resource_id in seen_resource_ids:
                continue
            seen_resource_ids.add(resource_id)
            flattened.append(resource)

    if len(flattened) < max_recommendations and learning_df is not None and not learning_df.empty:
        preferred_skill = str((preferences or {}).get("skill_to_develop", "")).strip().lower()
        preferred_industry = str((preferences or {}).get("industry", "")).strip().lower()
        gap_skill_names = [
            str(gap.get("skill_name") or gap.get("skill") or "").strip()
            for gap in skill_gaps
            if str(gap.get("skill_name") or gap.get("skill") or "").strip()
        ]

        fallback_rows: list[dict[str, Any]] = []
        for _, resource in learning_df.iterrows():
            resource_id = str(resource.get("resource_id", "")).strip()
            if not resource_id or resource_id in seen_resource_ids:
                continue

            resource_text = _resource_text(resource)
            provider_trust_score = safe_float(resource.get("provider_trust_score_auto", 70.0), default=70.0) / 100.0
            keyword_fit = 0.0
            if preferred_skill and preferred_skill in resource_text:
                keyword_fit += 0.15
            if preferred_industry and preferred_industry in resource_text:
                keyword_fit += 0.10

            level_text = str(resource.get("level", "")).lower()
            level_fit = 1.0 if "beginner" in level_text or "foundation" in level_text else 0.8 if level_text else 0.6
            cost_fit = 1.0 if "free" in str(resource.get("cost_type", "")).lower() else 0.75
            learning_score = min(0.84, 0.35 + keyword_fit + (0.25 * provider_trust_score) + (0.15 * level_fit) + (0.10 * cost_fit))

            fallback_rows.append(
                {
                    "resource_id": resource_id,
                    "title": resource.get("course_or_certification_title", ""),
                    "description": resource.get("course_or_certification_description", ""),
                    "provider": resource.get("offered_by_provider", ""),
                    "provider_type": resource.get("provider_type", ""),
                    "resource_type": resource.get("resource_type", ""),
                    "level": resource.get("level", ""),
                    "language": resource.get("language", ""),
                    "delivery_mode": resource.get("delivery_mode", ""),
                    "cost_type": resource.get("cost_type", ""),
                    "estimated_duration": resource.get("estimated_duration", ""),
                    "matched_gap_skill_ids": [],
                    "skills_youll_gain": resource.get("skills_youll_gain", ""),
                    "certification_score": round(learning_score, 4),
                    "recommendation_percentage": round(learning_score * 100, 2),
                    "url": resource.get("external_course_or_certification_link", ""),
                    "category_name": resource.get("category_name", ""),
                    "semantic_or_keyword_relevance": round(0.50 + keyword_fit, 4),
                    "gap_skill_name": gap_skill_names[0] if gap_skill_names else "",
                    "why_recommended": (
                        "Recommended from the learning catalog to support your career goals while more precise skill matches are limited."
                    ),
                }
            )

        for resource in sorted(fallback_rows, key=lambda item: item["certification_score"], reverse=True):
            if len(flattened) >= max_recommendations:
                break
            seen_resource_ids.add(str(resource.get("resource_id", "")).strip())
            flattened.append(resource)

    return sorted(flattened, key=lambda item: item["certification_score"], reverse=True)[:max_recommendations]
