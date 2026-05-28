from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any, Optional

import pandas as pd


BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"

LEARNING_RESOURCES_PATH = DATA_DIR / "learning_resources.csv"
SKILLS_REFERENCE_PATH = DATA_DIR / "skills_reference.csv"


def load_learning_resources() -> pd.DataFrame:
    if not LEARNING_RESOURCES_PATH.exists():
        raise FileNotFoundError(
            f"Missing learning resources file: {LEARNING_RESOURCES_PATH}"
        )

    df = pd.read_csv(LEARNING_RESOURCES_PATH, dtype=str, keep_default_na=False)
    df.columns = [column.strip() for column in df.columns]
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
    max_gaps: int = 8,
) -> list[dict]:
    if skills_df is None:
        skills_df = load_skills_reference()

    skills_df.columns = [column.strip() for column in skills_df.columns]

    if "skill_id" not in skills_df.columns:
        raise ValueError("skills_reference.csv must contain a skill_id column.")

    skills_lookup = skills_df.set_index("skill_id").to_dict(orient="index")

    counter = Counter()

    for result in match_results:
        for skill_id in result.get("missing_skill_ids", []):
            if skill_id:
                counter[skill_id.strip().upper()] += 1

    gaps = []

    for skill_id, count in counter.most_common(max_gaps):
        skill = skills_lookup.get(skill_id, {})

        if count >= 3:
            severity = "Critical"
        elif count == 2:
            severity = "High"
        else:
            severity = "Moderate"

        gaps.append(
            {
                "skill_id": skill_id,
                "skill_name": skill.get("skill_name", skill_id),
                "skill_category": skill.get("skill_category", ""),
                "skill_subcategory": skill.get("skill_subcategory", ""),
                "appears_in_top_matches": count,
                "severity": severity,
            }
        )

    return gaps


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


def recommend_learning_resources(
    skill_gaps: list[dict],
    learning_df: Optional[pd.DataFrame] = None,
    preferences: Optional[dict] = None,
    max_recommendations: int = 8,
) -> list[dict]:
    if learning_df is None:
        learning_df = load_learning_resources()

    gap_ids = {
        gap.get("skill_id", "").strip().upper()
        for gap in skill_gaps
        if gap.get("skill_id")
    }

    if not gap_ids:
        return []

    recommendations = []

    for _, resource in learning_df.iterrows():
        resource_skill_ids = set(split_ids(resource.get("skill_ids", "")))

        matched_gap_ids = sorted(gap_ids.intersection(resource_skill_ids))

        if not matched_gap_ids:
            continue

        gap_coverage = len(matched_gap_ids) / max(len(gap_ids), 1)

        provider_trust = safe_float(
            resource.get("provider_trust_score_auto", 70),
            default=70.0,
        ) / 100

        affordability = affordability_score(resource.get("cost_type", ""))
        user_fit = user_fit_score(resource, preferences)

        certification_score = compute_certification_score(
            gap_coverage=gap_coverage,
            provider_trust=provider_trust,
            affordability=affordability,
            user_fit=user_fit,
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
                "matched_gap_skill_ids": matched_gap_ids,
                "skills_youll_gain": resource.get("skills_youll_gain", ""),
                "certification_score": round(certification_score, 4),
                "recommendation_percentage": round(certification_score * 100, 2),
                "url": resource.get("external_course_or_certification_link", ""),
            }
        )

    return sorted(
        recommendations,
        key=lambda item: item["certification_score"],
        reverse=True,
    )[:max_recommendations]
