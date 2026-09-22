"""External-job extraction, canonicalization, and shared match analysis."""

from __future__ import annotations

import html
import logging
import re
from typing import Any

from .gemma_service import ExternalJobExtraction, GemmaUnavailable, gemma_service
from .learning_recommender import prioritize_skill_gaps, recommend_learning_resources
from .matching_service import (
    analyze_candidate_job_match,
    clean_text,
    extract_skills_from_text,
    get_skill_labels_by_id,
    _skill_key,
)

logger = logging.getLogger(__name__)

MAX_EXTERNAL_JOB_DESCRIPTION = 30_000
MIN_EXTERNAL_JOB_DESCRIPTION = 40


def normalize_external_job_text(value: str) -> str:
    # HTML is deliberately treated as ordinary text; it is never rendered or fetched.
    return clean_text(html.unescape(value).replace("\x00", " "))


def _clean_list(values: list[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = clean_text(value)
        if not text:
            continue
        key = text.casefold()
        if key not in seen:
            seen.add(key)
            result.append(text)
    return result


def _canonical_skills(values: list[str]) -> tuple[list[str], list[str]]:
    labels = get_skill_labels_by_id()
    names: list[str] = []
    ids: list[str] = []
    for value in _clean_list(values):
        skill_id = _skill_key(value)
        if skill_id not in labels or skill_id in ids:
            continue
        ids.append(skill_id)
        names.append(labels[skill_id])
    return names, ids


def _deterministic_extraction(description: str, title: str, company: str) -> ExternalJobExtraction:
    extracted = extract_skills_from_text(description, max_skills=40)
    skills = _clean_list([item.get("skill_name", "") for item in extracted])
    return ExternalJobExtraction(
        job_title=title or None,
        company_name=company or None,
        summary=description[:400],
        required_skills=skills,
    )


def _normalize_extraction(extraction: ExternalJobExtraction, description: str, title: str, company: str) -> dict[str, Any]:
    required_names, required_ids = _canonical_skills(extraction.required_skills)
    preferred_names, preferred_ids = _canonical_skills(extraction.preferred_skills)
    normalized_title = clean_text(extraction.job_title or title) or "External job"
    normalized_company = clean_text(extraction.company_name or company)
    return {
        "job_title": normalized_title,
        "company_name": normalized_company,
        "job_description": description,
        "summary": clean_text(extraction.summary),
        "responsibilities": _clean_list(extraction.responsibilities),
        "required_skills_for_eval": ";".join(required_names),
        "required_skill_ids": ";".join(required_ids),
        "must_have_skill_ids": ";".join(required_ids),
        "mapped_required_skill_names": ";".join(required_names),
        "preferred_skills": preferred_names,
        "nice_to_have_skill_ids": ";".join(preferred_ids),
        "nice_to_have_skills_optional": ";".join(preferred_names),
        "education_requirements": _clean_list(extraction.education_requirements),
        "experience_requirements": _clean_list(extraction.experience_requirements),
        "certifications": _clean_list(extraction.certifications),
        "job_level": clean_text(extraction.job_level),
        "industry": clean_text(extraction.industry),
        "work_type": clean_text(extraction.work_setup),
        "job_source": "external_paste",
        "source_dataset": "external_paste",
        "job_id": "external-paste",
    }


def analyze_external_job(
    *,
    job_description: str,
    job_title: str = "",
    company_name: str = "",
    resume_text: str,
    confirmed_skills: list[dict[str, Any]] | None = None,
    preferences: dict[str, Any] | None = None,
    profile_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    description = normalize_external_job_text(job_description)
    if not description:
        raise ValueError("Paste a job description to continue.")
    if len(description) < MIN_EXTERNAL_JOB_DESCRIPTION:
        raise ValueError("Please paste more of the job description so Kareerly can identify its requirements.")
    if len(description) > MAX_EXTERNAL_JOB_DESCRIPTION:
        raise ValueError("Job descriptions must be 30,000 characters or fewer.")
    if not clean_text(resume_text):
        raise ValueError("PROFILE_REQUIRED")

    extraction_source = "gemma4"
    try:
        extraction = gemma_service.extract_external_job(description, clean_text(job_title), clean_text(company_name))
    except GemmaUnavailable:
        extraction_source = "deterministic_fallback"
        extraction = _deterministic_extraction(description, clean_text(job_title), clean_text(company_name))

    normalized_job = _normalize_extraction(extraction, description, clean_text(job_title), clean_text(company_name))
    result = analyze_candidate_job_match(
        resume_text,
        normalized_job,
        preferences=preferences or {},
        confirmed_skills=confirmed_skills,
    )
    match = result["match"]

    fallback_explanation = (
        f"Your profile matches {len(match['matched_skills'])} of {len(match['matched_skills']) + len(match['missing_skills'])} "
        f"identified required skills. Strongest aligned skills include "
        f"{', '.join(match['matched_skills'][:5]) if match['matched_skills'] else 'related resume evidence'}. "
        f"The primary skills to develop are {', '.join(match['missing_skills'][:5]) if match['missing_skills'] else 'none identified'}."
    )
    explanation_source = "deterministic_fallback"
    try:
        explanation = gemma_service.explain_match({
            "match_score": match["match_percentage"],
            "semantic_similarity": match["semantic_similarity"],
            "skill_coverage": match["skill_coverage"],
            "matched_skills": match["matched_skills"],
            "missing_skills": match["missing_skills"],
            "match_type": match["match_type"],
        })
        explanation_source = "gemma4"
    except GemmaUnavailable:
        explanation = fallback_explanation

    warnings = []
    if not normalized_job["required_skill_ids"]:
        warnings.append("Kareerly could not identify enough explicit canonical skills from this job description for a complete skill-gap analysis.")

    return {
        "job": {
            "title": normalized_job["job_title"],
            "company_name": normalized_job["company_name"],
            "source": "external_paste",
        },
        "extracted_requirements": {
            "summary": normalized_job["summary"],
            "responsibilities": normalized_job["responsibilities"],
            "required_skills": _clean_list(extraction.required_skills),
            "preferred_skills": _clean_list(extraction.preferred_skills),
            "normalized_required_skills": _canonical_skills(extraction.required_skills)[0],
            "normalized_preferred_skills": _canonical_skills(extraction.preferred_skills)[0],
            "experience_requirements": normalized_job["experience_requirements"],
            "education_requirements": normalized_job["education_requirements"],
            "certifications": normalized_job["certifications"],
            "job_level": normalized_job["job_level"],
            "industry": normalized_job["industry"],
            "work_setup": normalized_job["work_type"],
        },
        "match": {**match, "explanation": explanation},
        "matched_skills": match["matched_skills"],
        "missing_skills": match["missing_skills"],
        "preference_alignment": match["preference_alignment"],
        "learning_recommendations": result["learning_recommendations"],
        "warnings": warnings,
        "metadata": {
            "extraction_source": extraction_source,
            "explanation_source": explanation_source,
            "matching_source": "shared_kareerly_matching_service",
            "model_used": result["metadata"]["model_version"],
            "external_job_is_persisted": False,
        },
    }
