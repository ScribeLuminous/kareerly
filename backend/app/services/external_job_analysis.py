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


def _requirement_names(values: list[str]) -> tuple[list[str], list[str]]:
    """Every requirement as a name the matcher compares, and the taxonomy IDs among them.

    A name with no taxonomy skill ("Node.js", "Canva") stays a requirement,
    compared by name like an internal job's custom skill. Dropping it would
    leave coverage computed over fewer requirements than the posting lists,
    so a candidate could look ready for a job that asks for skills the resume
    does not show.
    """
    labels = get_skill_labels_by_id()
    names: dict[str, str] = {}
    for value in _clean_list(values):
        key = _skill_key(value)
        names.setdefault(key, labels.get(key, value))
    return list(names.values()), [key for key in names if key in labels]


# Headings that say whether the skills under them are required, preferred or
# not requirements at all. Matched at the start of a short line.
REQUIRED_HEADING = re.compile(
    r"^(?:(?:minimum|basic|key|job|mandatory)\s+)?(?:requirements?|qualifications?|required\s+skills?|skills\s+required|"
    r"must[\s-]*haves?|what\s+you(?:'ll|\s+will)?\s+need|what\s+we(?:'re|\s+are)\s+looking\s+for|who\s+you\s+are|"
    r"you\s+have|you\s+must\s+have|skills(?:\s+and\s+(?:qualifications|experience))?|competenc(?:y|ies))\b", re.IGNORECASE)
PREFERRED_HEADING = re.compile(
    r"^(?:preferred(?:\s+(?:qualifications?|skills?|requirements?))?|nice[\s-]*to[\s-]*haves?|good[\s-]*to[\s-]*haves?|"
    r"bonus(?:\s+points?)?|desirable|pluses|plus\s+points?|advantages?|it(?:'s|\s+is)\s+a\s+plus)\b", re.IGNORECASE)
IGNORED_HEADING = re.compile(
    r"^(?:about\s+(?:us|the\s+company|the\s+team|our\s+company)|who\s+we\s+are|our\s+(?:company|story|mission)|"
    r"benefits|perks|what\s+we\s+offer|why\s+(?:join|work)|compensation|salary|how\s+to\s+apply|equal\s+opportunity)\b",
    re.IGNORECASE)
# Other section headings end a requirements section ("Responsibilities").
OTHER_HEADING = re.compile(r"^(?:(?:key\s+|main\s+|job\s+)?(?:responsibilities|duties)|role|the\s+role|what\s+you(?:'ll|\s+will)\s+do|"
                           r"job\s+description|overview|summary)\b", re.IGNORECASE)
PREFERRED_INLINE = re.compile(r"\b(?:is\s+a\s+plus|a\s+plus|nice[\s-]to[\s-]have|preferred|preferably|is\s+an\s+advantage|"
                              r"an\s+advantage|advantageous|bonus|desirable|good\s+to\s+have)\b", re.IGNORECASE)
REQUIRED_INLINE = re.compile(r"\b(?:required|requires?|must\s+have|must\s+be|mandatory|essential|at\s+least\s+\d)\b", re.IGNORECASE)
MAX_HEADING_CHARS = 60

REQUIRED, PREFERRED, IGNORED, UNCLASSIFIED = "required", "preferred", "ignored", "unclassified"


def _heading(line: str) -> tuple[str, str]:
    """(section, rest of the line) when the line starts with a section heading, else ("", line)."""
    stripped = re.sub(r"^[\s#*\-•–—]+", "", line).strip()
    head, colon, rest = stripped.partition(":")
    candidate = head.strip() if colon else stripped.rstrip(".")
    if not candidate or len(candidate) > MAX_HEADING_CHARS:
        return "", line
    for section, pattern in ((PREFERRED, PREFERRED_HEADING), (REQUIRED, REQUIRED_HEADING),
                             (IGNORED, IGNORED_HEADING), (UNCLASSIFIED, OTHER_HEADING)):
        match = pattern.match(candidate)
        # The heading must be the whole label ("Requirements", "Preferred skills:"),
        # not the start of a sentence ("Skills in Excel are needed").
        if match and (colon or match.end() >= len(candidate.rstrip(" ."))):
            return section, rest.strip() if colon else ""
    return "", line


def classify_requirements(text: str) -> dict[str, list[str]]:
    """Skills named in a pasted posting, by where they appear.

    Skills under a requirements heading, or on a line that says "required" or
    "must have", are required; under a preferred heading, or on a line that
    says "a plus" or "preferred", preferred. Skills under "About us" or
    "Benefits" are not requirements. Anything else (responsibilities, a
    posting without headings) is unclassified: Kareerly cannot tell from the
    text whether the employer requires it.
    """
    found: dict[str, dict[str, str]] = {REQUIRED: {}, PREFERRED: {}, UNCLASSIFIED: {}}
    section = UNCLASSIFIED
    for raw_line in (text or "").splitlines():
        line = clean_text(raw_line)
        if not line:
            continue
        heading, rest = _heading(line)
        if heading:
            section = heading
            line = rest
            if not line:
                continue
        if section == IGNORED:
            continue
        # An inline marker ("Tableau is a plus") speaks for its own sentence only.
        for sentence in re.split(r"(?<=[.;!?])\s+", line):
            kind = section
            if PREFERRED_INLINE.search(sentence):
                kind = PREFERRED
            elif section == UNCLASSIFIED and REQUIRED_INLINE.search(sentence):
                kind = REQUIRED
            for item in extract_skills_from_text(sentence, max_skills=None):
                name = clean_text(item.get("skill_name", ""))
                if name:
                    found[kind].setdefault(name.lower(), name)
    required = list(found[REQUIRED].values())
    preferred = [name for key, name in found[PREFERRED].items() if key not in found[REQUIRED]]
    unclassified = [name for key, name in found[UNCLASSIFIED].items() if key not in found[REQUIRED] and key not in found[PREFERRED]]
    return {REQUIRED: required, PREFERRED: preferred, UNCLASSIFIED: unclassified}


def _deterministic_extraction(description: str, title: str, company: str) -> tuple[ExternalJobExtraction, list[str]]:
    """The posting's skills by heading; unclassified ones are scored as nice-to-have, never required."""
    classified = classify_requirements(description)
    return ExternalJobExtraction(
        job_title=title or None,
        company_name=company or None,
        summary=clean_text(description)[:400],
        required_skills=classified[REQUIRED][:40],
        preferred_skills=(classified[PREFERRED] + classified[UNCLASSIFIED])[:40],
    ), classified[UNCLASSIFIED]


def _normalize_extraction(extraction: ExternalJobExtraction, description: str, title: str, company: str) -> dict[str, Any]:
    required_names, required_ids = _requirement_names(extraction.required_skills)
    preferred_names, preferred_ids = _requirement_names(extraction.preferred_skills)
    # With a named-only requirement among them the names are compared instead of
    # the IDs (the matcher reads IDs first and would skip the named ones); each
    # name still resolves to its taxonomy skill when it has one.
    if len(required_ids) < len(required_names):
        required_ids = []
    if len(preferred_ids) < len(preferred_names):
        preferred_ids = []
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
    unclassified: list[str] = []
    try:
        extraction = gemma_service.extract_external_job(description, clean_text(job_title), clean_text(company_name))
    except GemmaUnavailable:
        extraction_source = "deterministic_fallback"
        # Read the pasted text with its line breaks, so headings can be seen.
        extraction, unclassified = _deterministic_extraction(
            html.unescape(job_description or "").replace("\x00", " "), clean_text(job_title), clean_text(company_name))

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
    if unclassified:
        warnings.append(
            "The posting does not say whether it requires these skills, so they are treated as nice-to-have: "
            + ", ".join(unclassified[:8]) + ("…" if len(unclassified) > 8 else "") + ".")
    if not normalized_job["required_skills_for_eval"]:
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
            # Deterministic fallback only: skills whose requirement level the posting does not state.
            "unclassified_skills": unclassified,
            "explanation_source": explanation_source,
            "matching_source": "shared_kareerly_matching_service",
            "model_used": result["metadata"]["model_version"],
            "external_job_is_persisted": False,
        },
    }
