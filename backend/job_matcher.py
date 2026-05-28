from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import joblib
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from scipy.sparse import load_npz
from sklearn.metrics.pairwise import cosine_similarity


router = APIRouter(prefix="/api/matches", tags=["job-matching"])

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"

JOB_INDEX_PATH = MODELS_DIR / "job_index.csv"
VECTORIZER_PATH = MODELS_DIR / "tfidf_vectorizer.joblib"
JOB_MATRIX_PATH = MODELS_DIR / "job_tfidf_matrix.npz"
MODEL_METADATA_PATH = MODELS_DIR / "model_metadata.json"


class MatchPreferences(BaseModel):
    industry: Optional[str] = None
    job_level: Optional[str] = None
    work_setup: Optional[str] = None
    salary_expectation: Optional[str] = None
    skill_to_develop: Optional[str] = None


class MatchRunRequest(BaseModel):
    resume_text_for_matching: str = Field(..., min_length=1)
    skill_names: list[str] = Field(default_factory=list)
    preferences: MatchPreferences = Field(default_factory=MatchPreferences)


def _missing_model_files() -> list[str]:
    required_paths = [
        JOB_INDEX_PATH,
        VECTORIZER_PATH,
        JOB_MATRIX_PATH,
        MODEL_METADATA_PATH,
    ]
    return [str(path.relative_to(BASE_DIR.parent)) for path in required_paths if not path.exists()]


def _normalize_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def _normalize_skill(value: Any) -> str:
    return re.sub(r"\s+", " ", _normalize_text(value).lower())


def _split_skills(value: Any) -> list[str]:
    text = _normalize_text(value)
    if not text:
        return []

    parts = re.split(r"[,;|/]+", text)
    return [part.strip() for part in parts if part.strip()]


def _skill_coverage(candidate_skills: set[str], job_skills: list[str]) -> tuple[float, list[str], list[str]]:
    if not job_skills:
        return 0.0, [], []

    matched: list[str] = []
    missing: list[str] = []

    for skill in job_skills:
        normalized = _normalize_skill(skill)
        if normalized in candidate_skills:
            matched.append(skill)
        else:
            missing.append(skill)

    return len(matched) / len(job_skills), matched, missing


def _preference_score(row: pd.Series, preferences: MatchPreferences) -> float:
    industry = _normalize_skill(preferences.industry or "")
    job_level = _normalize_skill(preferences.job_level or "")
    searchable_role_text = " ".join(
        [
            _normalize_text(row.get("job_title")),
            _normalize_text(row.get("job_category")),
            _normalize_text(row.get("job_subcategory")),
            _normalize_text(row.get("job_description")),
        ]
    ).lower()

    score = 0.0
    signals = 0

    if industry:
        signals += 1
        if industry in searchable_role_text:
            score += 1.0

    if job_level:
        signals += 1
        level_text = _normalize_text(row.get("experience_level_required")).lower()
        if job_level in level_text or job_level in searchable_role_text:
            score += 1.0
        elif "entry" in job_level and any(term in searchable_role_text for term in ["entry", "junior", "associate"]):
            score += 1.0
        elif "mid" in job_level and any(term in searchable_role_text for term in ["mid", "intermediate"]):
            score += 1.0
        elif "senior" in job_level and "senior" in searchable_role_text:
            score += 1.0

    if signals == 0:
        return 0.0

    return score / signals


def _work_setup_score(row: pd.Series, preferences: MatchPreferences) -> float:
    setup = _normalize_skill(preferences.work_setup or "")
    if not setup:
        return 0.0

    work_type = _normalize_skill(row.get("work_type"))
    description = _normalize_skill(row.get("job_description"))
    haystack = f"{work_type} {description}"

    if setup in haystack:
        return 1.0
    if "hybrid" in setup and "hybrid" in haystack:
        return 1.0
    if "remote" in setup and any(term in haystack for term in ["remote", "work from home", "wfh"]):
        return 1.0
    if "on-site" in setup or "onsite" in setup:
        return 1.0 if any(term in haystack for term in ["on-site", "onsite", "office"]) else 0.0
    if "flexible" in setup:
        return 0.5

    return 0.0


def _match_percentage(score: float) -> int:
    return max(0, min(100, round(score * 100)))


def _build_explanation(kind: str, text_similarity: float, skill_coverage: float) -> str:
    if kind == "fit_now":
        if skill_coverage >= 0.75 and text_similarity >= 0.25:
            return "Strong fit because your resume matches the job text and includes most required skills."
        if skill_coverage >= 0.5:
            return "Good fit because you already cover several required skills, with some gaps to close."
        return "Possible fit based on resume similarity, but several required skills may still be missing."

    if skill_coverage >= 0.5:
        return "Promising aspiration match because your resume and skills overlap with this role."
    return "Aspirational role based on resume similarity and preferences, with skill gaps to prioritize."


def _row_to_match(row: pd.Series, score: float, text_similarity: float, skill_coverage: float, matched_skills: list[str], missing_skills: list[str], kind: str) -> dict:
    return {
        "job_id": _normalize_text(row.get("job_id")) or _normalize_text(row.name),
        "job_title": _normalize_text(row.get("job_title")) or "Untitled role",
        "company": _normalize_text(row.get("company")) or _normalize_text(row.get("source_dataset")) or "Unknown company",
        "location": _normalize_text(row.get("location")) or "Not specified",
        "match_percentage": _match_percentage(score),
        "text_similarity": round(float(text_similarity), 4),
        "skill_coverage": round(float(skill_coverage), 4),
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "explanation": _build_explanation(kind, text_similarity, skill_coverage),
    }


@lru_cache(maxsize=1)
def _load_matcher_assets() -> tuple[Any, Any, pd.DataFrame, dict[str, Any]]:
    missing_files = _missing_model_files()
    if missing_files:
        raise FileNotFoundError("Missing job matching model files: " + ", ".join(missing_files))

    vectorizer = joblib.load(VECTORIZER_PATH)
    job_matrix = load_npz(JOB_MATRIX_PATH)
    job_index = pd.read_csv(JOB_INDEX_PATH)

    if job_matrix.shape[0] != len(job_index):
        raise ValueError(
            f"Model mismatch: matrix has {job_matrix.shape[0]} rows but job_index.csv has {len(job_index)} rows."
        )

    with MODEL_METADATA_PATH.open("r", encoding="utf-8") as metadata_file:
        metadata = json.load(metadata_file)

    return vectorizer, job_matrix, job_index, metadata


def _prioritize_skill_gaps(matches: list[dict]) -> list[dict]:
    missing_counter: Counter[str] = Counter()
    related_jobs: defaultdict[str, list[str]] = defaultdict(list)
    display_names: dict[str, str] = {}

    for match in matches:
        title = match["job_title"]
        for skill in match["missing_skills"]:
            normalized = _normalize_skill(skill)
            missing_counter[normalized] += 1
            display_names.setdefault(normalized, skill)
            if title not in related_jobs[normalized]:
                related_jobs[normalized].append(title)

    gaps = []
    for normalized_skill, count in missing_counter.most_common():
        if count >= 3:
            severity = "Critical"
        elif count == 2:
            severity = "High"
        else:
            severity = "Moderate"

        gaps.append(
            {
                "skill_name": display_names[normalized_skill],
                "missing_count": count,
                "severity": severity,
                "related_jobs": related_jobs[normalized_skill],
            }
        )

    return gaps


@router.post("/run")
def run_job_matching(payload: MatchRunRequest) -> dict:
    try:
        vectorizer, job_matrix, job_index, model_metadata = _load_matcher_assets()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to load job matching model: {exc}") from exc

    candidate_vector = vectorizer.transform([payload.resume_text_for_matching])
    similarities = cosine_similarity(candidate_vector, job_matrix).ravel()
    candidate_skills = {_normalize_skill(skill) for skill in payload.skill_names if skill.strip()}

    scored_rows = []
    for row_index, row in job_index.iterrows():
        required_skills = _split_skills(row.get("required_skills_comma_separated"))
        nice_to_have_skills = _split_skills(row.get("nice_to_have_skills_optional"))
        job_skills = required_skills + [skill for skill in nice_to_have_skills if skill not in required_skills]

        skill_coverage, matched_skills, missing_skills = _skill_coverage(candidate_skills, job_skills)
        text_similarity = float(similarities[row_index])
        role_industry_score = _preference_score(row, payload.preferences)
        work_setup_score = _work_setup_score(row, payload.preferences)

        fit_now_score = (0.60 * text_similarity) + (0.40 * skill_coverage)
        aspiration_score = (
            (0.45 * text_similarity)
            + (0.25 * skill_coverage)
            + (0.20 * role_industry_score)
            + (0.10 * work_setup_score)
        )

        scored_rows.append(
            {
                "row": row,
                "fit_now_score": fit_now_score,
                "aspiration_score": aspiration_score,
                "text_similarity": text_similarity,
                "skill_coverage": skill_coverage,
                "matched_skills": matched_skills,
                "missing_skills": missing_skills,
            }
        )

    fit_now_matches = [
        _row_to_match(
            item["row"],
            item["fit_now_score"],
            item["text_similarity"],
            item["skill_coverage"],
            item["matched_skills"],
            item["missing_skills"],
            "fit_now",
        )
        for item in sorted(scored_rows, key=lambda match: match["fit_now_score"], reverse=True)[:5]
    ]

    aspiration_matches = [
        _row_to_match(
            item["row"],
            item["aspiration_score"],
            item["text_similarity"],
            item["skill_coverage"],
            item["matched_skills"],
            item["missing_skills"],
            "aspiration",
        )
        for item in sorted(scored_rows, key=lambda match: match["aspiration_score"], reverse=True)[:5]
    ]

    top_matches_for_gaps = fit_now_matches + aspiration_matches

    return {
        "status": "success",
        "fit_now_matches": fit_now_matches,
        "aspiration_matches": aspiration_matches,
        "prioritized_skill_gaps": _prioritize_skill_gaps(top_matches_for_gaps),
        "metadata": {
            "model_version": model_metadata.get("model_version") or model_metadata.get("model_type") or "unknown",
            "total_jobs_scored": len(job_index),
            "method": "TF-IDF cosine similarity + skill coverage + preference reranking",
        },
    }
