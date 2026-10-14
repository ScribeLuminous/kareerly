from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any, Optional
from datetime import date
from urllib.parse import quote_plus, urlsplit
import os
import re
import threading
import time

import pandas as pd

from functools import lru_cache
from typing import Callable

from .supabase_learning_resources import load_learning_resources_dataframe
from .skill_variants import remove_excluded_aliases
from .resource_links import WEB_SEARCH_TEMPLATE
from .skill_gap_config import COURSES_PER_SKILL_MAX, TIER_LABELS, assign_tier, skill_sort_key
from . import skill_resolver


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
        # Rows that can never be recommended (no provider link, all inactive)
        # would leave every report without learning resources; use the
        # bundled catalog instead.
        if not supabase_df.empty and any(
            resource_is_reviewed(row) or resource_is_listable(row)
            for row in supabase_df.to_dict(orient="records")
        ):
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
    # The same reviewed exclusions as extraction and matching ("XPath" is not SQL).
    return pd.DataFrame(remove_excluded_aliases(df.to_dict(orient="records")), columns=df.columns)


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

    aggregate: dict[str, dict[str, Any]] = {}

    for result in match_results:
        missing_ids = [skill_id.strip().upper() for skill_id in result.get("missing_skill_ids", []) if skill_id]
        must_have_ids = {skill_id.strip().upper() for skill_id in split_ids(result.get("must_have_skill_ids", "")) if skill_id}
        job_title = str(result.get("job_title", "")).strip()

        for skill_id in missing_ids:
            bucket = aggregate.setdefault(
                skill_id,
                {
                    "skill_id": skill_id,
                    "frequency_count": 0,
                    "best_match_pct": 0.0,
                    "affected_jobs": [],
                    "requirement_importance": "unknown",
                },
            )
            bucket["frequency_count"] += 1
            bucket["best_match_pct"] = max(bucket["best_match_pct"], safe_float(result.get("match_percentage"), 0.0))
            if job_title and job_title not in bucket["affected_jobs"]:
                bucket["affected_jobs"].append(job_title)

            if skill_id in must_have_ids:
                bucket["requirement_importance"] = "must-have"
            elif bucket["requirement_importance"] != "must-have":
                bucket["requirement_importance"] = "preferred"

    gaps: list[dict[str, Any]] = []

    for skill_id, bucket in aggregate.items():
        skill = skills_lookup.get(skill_id, {})
        frequency_count = int(bucket["frequency_count"])
        # Every gap here is a missing required skill, so the shared tier rule
        # (skill_gap_config) reads it as required by frequency_count jobs.
        tier = assign_tier(frequency_count, 0)

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
        }

        top_resources = recommend_learning_resources_for_gap(
            gap=gap_payload,
            learning_df=learning_df,
            skills_lookup=skills_lookup,
            preferences=preferences,
            max_recommendations=3,
        )

        gap_payload.update(
            {
                "tier": tier,
                "severity": TIER_LABELS[tier],
                "best_match_pct": bucket["best_match_pct"],
                "learning_resource_available": bool(top_resources),
                "recommended_learning_resources": top_resources,
            }
        )
        gaps.append(gap_payload)

    gaps.sort(key=lambda item: skill_sort_key(item["tier"], item["missing_count"], item["best_match_pct"], str(item["skill_name"])))
    return gaps[:max_gaps]


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


PLACEHOLDER_RESOURCE_STATUSES = {"generated - review needed"}
# Mapping statuses whose "skills you'll gain" list was filled from the
# category template, not from the provider, so it is not evidence.
TEMPLATE_SKILL_LIST_STATUSES = {"template_category_skills", "generated_mapped", "category_fallback_review"}
INACTIVE_RESOURCE_STATUSES = {"inactive", "retired", "archived", "deprecated", "removed", "rejected"}


def _clean_text(value: Any) -> str:
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return ""
    return " ".join(str(value).split())


def _normalize_skill_text(value: Any) -> str:
    text = _clean_text(value).lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    return " ".join(re.sub(r"[^a-z0-9+#]+", " ", text).split())


def resource_is_listable(resource: Any) -> bool:
    """Catalog rows the candidate can act on: active, titled, with a provider link.

    Unreviewed rows are still listed (flagged ``review_status="unreviewed"``) so
    the learning page is never empty while the catalog review is in progress.
    """
    status = _clean_text(resource.get("status", "")).lower()
    if status in INACTIVE_RESOURCE_STATUSES:
        return False
    # Auto-generated placeholders ("Certificate Pathway: SQL" pointing at a
    # provider search page): the course itself was never identified, so it is
    # not offered as one until a person reviews it.
    if status in PLACEHOLDER_RESOURCE_STATUSES:
        return False
    return bool(
        _clean_text(resource.get("resource_id", ""))
        and _clean_text(resource.get("course_or_certification_title", ""))
        and provider_url(_clean_text(resource.get("external_course_or_certification_link", "")))
    )


def _provider_skill_list(resource: Any) -> str:
    """The provider's own "skills you'll gain" list, or "" when a template filled it."""
    if _clean_text(resource.get("skill_id_mapping_status", "")).lower() in TEMPLATE_SKILL_LIST_STATUSES:
        return ""
    return _clean_text(resource.get("skills_youll_gain", ""))


def _resource_skill_names(resource: Any) -> set[str]:
    """Skills the provider says the resource teaches, as normalized names.

    Only the provider's own list counts. ``mapped_skill_names`` mirrors the
    catalog's generated skill-ID mapping, so it is not evidence of what the
    resource teaches.
    """
    if not _provider_skill_list(resource):
        return set()
    names = set()
    for item in split_text_values(resource.get("skills_youll_gain", "")):
        normalized = _normalize_skill_text(item)
        if normalized:
            names.add(normalized)
    return names


def _resource_text(resource: Any) -> str:
    """What the provider says about the resource: title, description and skills."""
    return "\n".join([_clean_text(resource.get("course_or_certification_title", "")),
                      _clean_text(resource.get("course_or_certification_description", "")),
                      _provider_skill_list(resource)])


SkillEvidence = Callable[[str], set]


@lru_cache(maxsize=1)
def _default_extractor():
    from .skill_extractor import SkillExtractor

    return SkillExtractor(include_inactive=True)


@lru_cache(maxsize=4096)
def default_resource_skill_evidence(text: str) -> frozenset:
    """Taxonomy skills a resource's own text names, read like a resume is read."""
    return frozenset(
        str(item.get("skill_id", "")).strip().upper()
        for item in _default_extractor().extract_skills(text, limit=None)
        if item.get("skill_id")
    )


RELEVANCE_RANK = {
    "reviewed_skill_id_mapping": 0,
    "catalog_skill_id_mapping": 1,
    "skill_name_match": 2,
}

# Why a resource is shown for a skill, in words a candidate can check.
RELEVANCE_PHRASES = {
    "reviewed_skill_id_mapping": "a reviewer confirmed it teaches {skill}",
    "catalog_skill_id_mapping": "the provider's course details name {skill}",
    "skill_name_match": "its title or listed skills name {skill}",
}


def _build_recommendation(resource: Any, skill_id: str, skill_name: str, reviewed: bool, method: str) -> dict[str, Any]:
    def value(key: str, default: str = "") -> str:
        text = _clean_text(resource.get(key, ""))
        return text or default
    # Resource kind is catalog data, independent of award claims.
    kind = value("resource_type").lower()
    credential_type = value("credential_type").lower()
    if kind in {"exam_review", "exam_preparation"} or credential_type == "exam_review":
        action = "View preparation course"
    elif kind in {"certification", "credential", "exam", "industry_certification", "national certificate"} or credential_type in {"industry_certification", "professional_certificate"}:
        action = "View certification"
    else:
        action = "Start learning"
    credential_verified = value("credential_review_status").lower() == "verified" and bool(value("credential_conditions")) and bool(provider_url(value("credential_evidence")))
    return {
        "resource_id": value("resource_id"), "title": value("course_or_certification_title"),
        "description": value("course_or_certification_description"), "provider": value("offered_by_provider", "Course provider"),
        "provider_type": value("provider_type"), "resource_type": kind,
        "credential_type": credential_type,
        "category_id": value("category_id"), "category_name": value("category_name"),
        "review_status": "verified" if reviewed else "unreviewed",
        "matched_gap_skill_ids": [skill_id] if skill_id else [],
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
        # No recommendation score is calculated; these stay zero for older clients.
        "certification_score": 0, "recommendation_percentage": 0,
        "why_recommended": f"Recommended for {skill_name}: {RELEVANCE_PHRASES[method].format(skill=skill_name)}.",
        "relevance_method": method,
        # Every resource here teaches the skill directly; supporting or
        # prerequisite learning is not modelled (see docs/learning-recommendations.md).
        "learning_relation": "direct",
    }


def recommend_learning_resources_for_gap(
    gap: dict[str, Any],
    learning_df: Optional[pd.DataFrame] = None,
    skills_lookup: Optional[dict[str, dict[str, Any]]] = None,
    preferences: Optional[dict] = None,
    max_recommendations: int = 3,
    skill_evidence: Optional[SkillEvidence] = None,
) -> list[dict[str, Any]]:
    """Resources that teach one gap's skill, strongest evidence first.

    A skill-ID mapping counts when a reviewer verified the resource, or when
    the resource's own text names the skill. Without one, the provider's
    listed skills or title must name the gap. Nothing broader is used: a
    resource in the same field that does not teach the skill is not shown,
    and a gap with no such resource gets none.
    """
    if learning_df is None:
        learning_df = load_learning_resources()
    return _recommend_for_gap(gap, _prepare_resources(learning_df, skill_evidence), skills_lookup, max_recommendations)


def _prepare_resources(
    learning_df: pd.DataFrame,
    skill_evidence: Optional[SkillEvidence] = None,
    canonical_id: Optional[Callable[[str], str]] = None,
) -> list[dict[str, Any]]:
    evidence = skill_evidence or default_resource_skill_evidence
    canonical = canonical_id or (lambda skill_id: skill_id)
    # The gathered catalog repeats some offerings under several resource IDs;
    # show each (title, link) once, keeping a reviewed copy when there is one.
    prepared: dict[tuple[str, str], dict[str, Any]] = {}
    for resource in learning_df.to_dict(orient="records"):
        reviewed = resource_is_reviewed(resource)
        if not reviewed and not resource_is_listable(resource):
            continue
        mapped = {canonical(skill_id) for skill_id in split_ids(resource.get("skill_ids", ""))}
        # What the resource's own text names, read by the shared resolver.
        named = {canonical(skill_id) for skill_id in evidence(_resource_text(resource))}
        # Generated catalog mappings put SQL on a social-media certificate and
        # Bookkeeping on a marketing course. An unreviewed mapping is kept only
        # when the resource's own text names the skill.
        skill_ids = mapped if reviewed else mapped & named
        title = _normalize_skill_text(resource.get("course_or_certification_title", ""))
        key = (title, provider_url(_clean_text(resource.get("external_course_or_certification_link", ""))) or _clean_text(resource.get("resource_id", "")))
        item = {
            "resource": resource,
            "reviewed": reviewed,
            "skill_ids": skill_ids,
            "named_skill_ids": named,
            "skill_names": _resource_skill_names(resource),
            "title": title,
        }
        existing = prepared.get(key)
        if existing is None:
            prepared[key] = item
            continue
        keep, other = (item, existing) if reviewed and not existing["reviewed"] else (existing, item)
        # Unreviewed duplicates only widen the unreviewed copy's mappings.
        if not keep["reviewed"]:
            keep["skill_ids"] |= other["skill_ids"]
            keep["named_skill_ids"] |= other["named_skill_ids"]
            keep["skill_names"] |= other["skill_names"]
        prepared[key] = keep
    return list(prepared.values())


def _recommend_for_gap(
    gap: dict[str, Any],
    prepared: list[dict[str, Any]],
    skills_lookup: Optional[dict[str, dict[str, Any]]] = None,
    max_recommendations: int = 3,
) -> list[dict[str, Any]]:
    skill_id = str(gap.get("skill_id", "") or "").strip().upper()
    skill_name = _clean_text(gap.get("skill_name") or (skills_lookup or {}).get(skill_id, {}).get("skill_name") or skill_id)
    if (not skill_id and not skill_name) or not prepared:
        return []
    normalized_name = _normalize_skill_text(skill_name)
    # A named-only gap (no taxonomy skill, e.g. "Node.js") is taught by a
    # resource whose title or provider skill list names it as a whole phrase.
    name_pattern = re.compile(rf"(^| ){re.escape(normalized_name)}( |$)") if not skill_id and len(normalized_name) >= 3 else None
    id_matches: list[dict[str, Any]] = []
    name_matches: list[dict[str, Any]] = []
    for item in prepared:
        resource, reviewed = item["resource"], item["reviewed"]
        if skill_id and skill_id in item["skill_ids"]:
            method = "reviewed_skill_id_mapping" if reviewed else "catalog_skill_id_mapping"
            id_matches.append(_build_recommendation(resource, skill_id, skill_name, reviewed, method))
        elif skill_id and skill_id in item["named_skill_ids"]:
            # Not mapped, but its own text names the skill (read by the shared resolver).
            name_matches.append(_build_recommendation(resource, skill_id, skill_name, reviewed, "skill_name_match"))
        elif name_pattern and (normalized_name in item["skill_names"] or name_pattern.search(item["title"])):
            name_matches.append(_build_recommendation(resource, skill_id, skill_name, reviewed, "skill_name_match"))
    recommendations = id_matches or name_matches
    recommendations.sort(key=lambda entry: (
        entry["review_status"] != "verified",
        not entry["url"],
        entry["resource_id"],
    ))
    return recommendations[:max(0, max_recommendations)]


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


ESSENTIAL = "essential"
PREFERRED = "preferred"
REMOVED_BY_CANDIDATE = "removed_by_candidate"


def _gap_reason(skill: str, gap: dict[str, Any], job_ids: Optional[list[str]] = None) -> str:
    """Why this skill is a gap, from the matches: which job needs it and how."""
    jobs = [job for job in gap["jobs"] if job_ids is None or job["job_id"] in job_ids]
    if not jobs:
        return ""
    requirement = ESSENTIAL if any(job["requirement"] == ESSENTIAL for job in jobs) else PREFERRED
    kind = "a required skill" if requirement == ESSENTIAL else "a nice-to-have skill"
    titles = list(dict.fromkeys(job["job_title"] for job in jobs if job["job_title"]))
    if len(titles) == 1:
        where = f"for {titles[0]}"
    elif titles:
        where = f"for {len(titles)} of your matches ({', '.join(titles[:3])}{', …' if len(titles) > 3 else ''})"
    else:
        where = "for this job"
    removed = any(job["removed"] for job in jobs)
    evidence = "that you removed from your skill list" if removed else "that your resume does not show"
    return f"{skill} is {kind} {where} {evidence}"


def recommend_learning_resources_for_matches(
    matches: list[dict],
    learning_df: Optional[pd.DataFrame] = None,
    preferences: Optional[dict] = None,
    max_per_skill: int = 3,
    skill_evidence: Optional[SkillEvidence] = None,
    resolve_skill_id: Optional[Callable[[str], str]] = None,
    canonical_id: Optional[Callable[[str], str]] = None,
) -> list[dict]:
    """Resources for every missing skill of the shown matches, in gap priority order.

    Gaps come only from the matches' missing skills, so a skill a match
    credits is never a learning gap for it. Each resource says which gaps it
    teaches (``gap_matches``) and, per job, why it is recommended
    (``why_by_job``), so the learning page can show only the selected job's
    resources and the reason for that job. A gap with no resource that
    teaches it is left without one.

    ``resolve_skill_id`` turns a missing skill's name into its taxonomy ID the
    way matching does; ``skill_evidence`` reads which taxonomy skills a
    resource's own text names.
    """
    if learning_df is None:
        learning_df = load_learning_resources()
    try:
        skills_lookup = _skills_lookup_by_id(load_skills_reference())
    except (FileNotFoundError, ValueError):
        skills_lookup = {}
    if resolve_skill_id is None:
        # The shared resolver over the bundled taxonomy (matching passes its own,
        # which also includes approved runtime additions).
        vocabulary = skill_resolver.build_vocabulary(
            [{"skill_id": skill_id, **skill} for skill_id, skill in skills_lookup.items()])
        resolve_skill_id = vocabulary.resolve

    gaps: dict[str, dict[str, Any]] = {}

    def add_gap(key: str, skill_id: str, skill_name: str, match: dict[str, Any], requirement: str, removed: bool) -> None:
        gap = gaps.setdefault(key, {"skill_id": skill_id, "skill_name": skill_name, "jobs": []})
        job_id = _clean_text(match.get("job_id", ""))
        entry = next((job for job in gap["jobs"] if job["job_id"] == job_id), None)
        if entry is None:
            gap["jobs"].append({"job_id": job_id, "job_title": _clean_text(match.get("job_title", "")),
                                "requirement": requirement, "removed": removed,
                                "match_pct": safe_float(match.get("match_percentage"), 0.0)})
        elif requirement == ESSENTIAL:
            entry["requirement"] = ESSENTIAL

    for match in matches:
        removed_names = {_normalize_skill_text(item.get("skill")) for item in match.get("missing_skill_status", []) or []
                         if item.get("status") == REMOVED_BY_CANDIDATE}
        seen: dict[str, str] = {}
        id_by_name: dict[str, str] = {}
        for raw_id in match.get("missing_skill_ids", []) or []:
            skill_id = str(raw_id).strip().upper()
            if skill_id:
                name = _clean_text(skills_lookup.get(skill_id, {}).get("skill_name", "")) or skill_id
                id_by_name[_normalize_skill_text(name)] = skill_id
        # Required gaps first, then nice-to-have ones (listed on the Skill Gaps page too).
        for requirement, names in ((ESSENTIAL, match.get("missing_skills", []) or []),
                                   (PREFERRED, match.get("missing_preferred_skills", []) or [])):
            for raw_name in names:
                skill_name = _clean_text(raw_name)
                normalized = _normalize_skill_text(skill_name)
                if not normalized or normalized in seen:
                    continue
                skill_id = id_by_name.get(normalized) or resolve_skill_id(skill_name)
                key = skill_id or f"NAME:{normalized}"
                seen[normalized] = key
                add_gap(key, skill_id, skill_name, match, requirement, normalized in removed_names)
        # IDs whose name was not in the missing list (older clients send IDs only).
        for normalized, skill_id in id_by_name.items():
            if normalized not in seen:
                add_gap(skill_id, skill_id, _clean_text(skills_lookup.get(skill_id, {}).get("skill_name", "")) or skill_id,
                        match, ESSENTIAL, normalized in removed_names)

    def gap_order(gap: dict[str, Any]) -> tuple:
        # The Skills page's tiers and order (skill_gap_config).
        essential = sum(job["requirement"] == ESSENTIAL for job in gap["jobs"])
        tier = assign_tier(essential, len(gap["jobs"]) - essential)
        return skill_sort_key(tier, len(gap["jobs"]), max(job["match_pct"] for job in gap["jobs"]), gap["skill_name"])

    ordered_gaps = sorted(gaps.values(), key=gap_order)
    prepared = _prepare_resources(learning_df, skill_evidence, canonical_id)
    resources: dict[str, dict] = {}
    for rank, gap in enumerate(ordered_gaps):
        for resource in _recommend_for_gap(gap, prepared, skills_lookup, max_per_skill):
            method = resource["relevance_method"]
            detail = {
                "skill_id": gap["skill_id"], "skill_name": gap["skill_name"], "relevance_method": method,
                "requirement": ESSENTIAL if any(job["requirement"] == ESSENTIAL for job in gap["jobs"]) else PREFERRED,
                "job_ids": [job["job_id"] for job in gap["jobs"]],
                "job_titles": list(dict.fromkeys(job["job_title"] for job in gap["jobs"])),
            }
            existing = resources.get(resource["resource_id"])
            if existing is None:
                existing = resources[resource["resource_id"]] = {**resource, "gap_matches": [], "why_by_job": {}, "_rank": rank}
                existing["why_recommended"] = f"Recommended because {_gap_reason(gap['skill_name'], gap)}; " \
                                              f"{RELEVANCE_PHRASES[method].format(skill=gap['skill_name'])}."
            else:
                for id_key in ("matched_gap_skill_ids", "matched_gap_skill_names"):
                    existing[id_key] = list(dict.fromkeys(existing[id_key] + resource[id_key]))
                if RELEVANCE_RANK[method] < RELEVANCE_RANK[existing["relevance_method"]]:
                    existing["relevance_method"] = method
            existing["gap_matches"].append(detail)
            # Per job, the reason names that job's own gap, never another job's.
            for job in gap["jobs"]:
                if job["job_id"] not in existing["why_by_job"]:
                    existing["why_by_job"][job["job_id"]] = (
                        f"Recommended because {_gap_reason(gap['skill_name'], gap, [job['job_id']])}; "
                        f"{RELEVANCE_PHRASES[method].format(skill=gap['skill_name'])}.")
    ordered = sorted(resources.values(), key=lambda item: (
        item["_rank"], RELEVANCE_RANK[item["relevance_method"]], item["review_status"] != "verified", item["resource_id"],
    ))
    for item in ordered:
        item.pop("_rank", None)
    return ordered


def recommend_learning_resources_by_skill(
    skills: list[dict],
    learning_df: Optional[pd.DataFrame] = None,
    max_per_skill: int = COURSES_PER_SKILL_MAX,
    skill_evidence: Optional[SkillEvidence] = None,
    canonical_id: Optional[Callable[[str], str]] = None,
) -> dict[str, dict[str, Any]]:
    """Courses keyed by skill, for skills already grouped by skill_gap_aggregation.

    Each entry says how many in-scope matches the skill helps and which jobs
    require it or list it as nice to have. The same evidence rules as
    ``recommend_learning_resources_for_matches`` decide whether a resource
    teaches a skill; a skill with no such resource gets an empty list.
    """
    if learning_df is None:
        learning_df = load_learning_resources()
    prepared = _prepare_resources(learning_df, skill_evidence, canonical_id)
    by_skill: dict[str, dict[str, Any]] = {}
    for skill in skills:
        name = skill["skill_name"]
        jobs = skill.get("jobs", [])
        required_by = list(dict.fromkeys(job["title"] for job in jobs if job["requirement"] == "required" and job["title"]))
        nice_for = list(dict.fromkeys(job["title"] for job in jobs if job["requirement"] != "required" and job["title"]))
        courses = _recommend_for_gap({"skill_id": skill.get("taxonomy_skill_id", ""), "skill_name": name}, prepared,
                                     max_recommendations=max_per_skill)
        helps = len(jobs)
        for course in courses:
            course["why_recommended"] = (f"Helps {helps} of your matches: "
                                         f"{RELEVANCE_PHRASES[course['relevance_method']].format(skill=name)}.")
        by_skill[skill["skill_id"]] = {
            "skill_id": skill["skill_id"], "taxonomy_skill_id": skill.get("taxonomy_skill_id", ""),
            "skill_name": name, "helps_matches": helps,
            "required_by": required_by, "nice_for": nice_for, "courses": courses,
            # A general web search, labelled as one, for a skill with no listed course.
            "search_url": WEB_SEARCH_TEMPLATE.format(query=quote_plus(f"{name} course")),
        }
    return by_skill
