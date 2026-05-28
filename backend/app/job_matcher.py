from pathlib import Path
from typing import Any, Optional

import joblib
import pandas as pd
from scipy import sparse
from sklearn.metrics.pairwise import cosine_similarity

from .learning_recommender import (
    add_skill_gap_fields,
    prioritize_skill_gaps,
    recommend_learning_resources,
)


BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
MODELS_DIR = BACKEND_DIR / "models"

REFERENCE_JOBS_PATH = DATA_DIR / "reference_jobs.csv"
TFIDF_VECTORIZER_PATH = MODELS_DIR / "tfidf_vectorizer.joblib"
JOB_TFIDF_MATRIX_PATH = MODELS_DIR / "job_tfidf_matrix.npz"
JOB_INDEX_PATH = MODELS_DIR / "job_index.csv"


def safe_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or pd.isna(value):
            return default
        text = str(value).strip()
        if not text:
            return default
        return float(text)
    except (TypeError, ValueError):
        return default


def role_or_industry_preference_score(job: pd.Series, preferences: Optional[dict] = None) -> float:
    if not preferences:
        return 0.0

    industry = safe_text(preferences.get("industry")).lower()
    target_role = safe_text(preferences.get("target_role") or preferences.get("role")).lower()

    job_text = " ".join(
        [
            safe_text(job.get("job_title")),
            safe_text(job.get("job_category")),
            safe_text(job.get("job_subcategory")),
            safe_text(job.get("job_text_for_matching")),
        ]
    ).lower()

    score = 0.0

    if industry and industry in job_text:
        score += 0.5

    if target_role and target_role in job_text:
        score += 0.5

    return min(score, 1.0)


def work_setup_preference_score(job: pd.Series, preferences: Optional[dict] = None) -> float:
    if not preferences:
        return 0.0

    preferred_setup = safe_text(preferences.get("work_setup")).lower()
    work_type = safe_text(job.get("work_type")).lower()

    if not preferred_setup:
        return 0.0

    if preferred_setup == "flexible":
        return 0.5

    if preferred_setup in work_type:
        return 1.0

    if preferred_setup == "remote" and ("remote" in work_type or "work from home" in work_type):
        return 1.0

    if preferred_setup == "hybrid" and "hybrid" in work_type:
        return 1.0

    if preferred_setup == "onsite" and ("onsite" in work_type or "on-site" in work_type):
        return 1.0

    return 0.0


class JobMatcher:
    def __init__(self):
        self.vectorizer = self._load_vectorizer()
        self.job_tfidf_matrix = self._load_job_matrix()
        self.jobs = self._load_jobs()

        if self.job_tfidf_matrix.shape[0] != len(self.jobs):
            raise ValueError(
                "Model mismatch: job_tfidf_matrix row count does not match job_index.csv row count. "
                f"Matrix rows: {self.job_tfidf_matrix.shape[0]}, Job rows: {len(self.jobs)}. "
                "Regenerate job_index.csv and job_tfidf_matrix.npz from the same reference_jobs.csv."
            )

    def _load_vectorizer(self):
        if not TFIDF_VECTORIZER_PATH.exists():
            raise FileNotFoundError(f"Missing TF-IDF vectorizer: {TFIDF_VECTORIZER_PATH}")
        return joblib.load(TFIDF_VECTORIZER_PATH)

    def _load_job_matrix(self):
        if not JOB_TFIDF_MATRIX_PATH.exists():
            raise FileNotFoundError(f"Missing job TF-IDF matrix: {JOB_TFIDF_MATRIX_PATH}")
        return sparse.load_npz(JOB_TFIDF_MATRIX_PATH)

    def _load_jobs(self) -> pd.DataFrame:
        if not JOB_INDEX_PATH.exists():
            raise FileNotFoundError(f"Missing job index file: {JOB_INDEX_PATH}")

        jobs = pd.read_csv(JOB_INDEX_PATH, dtype=str, keep_default_na=False)
        jobs.columns = [column.strip() for column in jobs.columns]

        # If job_index.csv does not include required_skill_ids, try to merge them from reference_jobs.csv.
        if "required_skill_ids" not in jobs.columns and REFERENCE_JOBS_PATH.exists():
            reference_jobs = pd.read_csv(REFERENCE_JOBS_PATH, dtype=str, keep_default_na=False)
            reference_jobs.columns = [column.strip() for column in reference_jobs.columns]

            useful_columns = [
                "job_id",
                "required_skill_ids",
                "nice_to_have_skill_ids",
                "mapped_required_skill_names",
                "mapped_nice_to_have_skill_names",
                "skill_gap_reliability",
            ]

            available_columns = [col for col in useful_columns if col in reference_jobs.columns]

            if "job_id" in jobs.columns and "job_id" in reference_jobs.columns and "required_skill_ids" in reference_jobs.columns:
                jobs = jobs.merge(
                    reference_jobs[available_columns].drop_duplicates(subset=["job_id"]),
                    on="job_id",
                    how="left",
                    suffixes=("", "_ref"),
                )

        # Ensure required columns exist.
        required_defaults = {
            "job_id": "",
            "job_title": "",
            "job_category": "",
            "job_subcategory": "",
            "location": "",
            "work_type": "",
            "source_dataset": "",
            "required_skill_ids": "",
            "must_have_skill_ids": "",
            "required_skills_comma_separated": "",
            "skill_gap_reliability": "",
            "job_text_for_matching": "",
        }

        for column, default_value in required_defaults.items():
            if column not in jobs.columns:
                jobs[column] = default_value

        jobs["required_skill_ids"] = jobs["required_skill_ids"].fillna("").astype(str)

        return jobs

    def match_jobs(
        self,
        resume_text_for_matching: str,
        candidate_skill_ids: Optional[list[str]] = None,
        preferences: Optional[dict] = None,
        top_n_retrieval: int = 100,
        top_n_output: int = 10,
    ) -> dict:
        candidate_skill_ids = candidate_skill_ids or []

        if not resume_text_for_matching or not resume_text_for_matching.strip():
            return {
                "fit_now_matches": [],
                "aspiration_matches": [],
                "skill_gaps": [],
                "learning_recommendations": [],
                "warnings": ["No resume text was provided for job matching."],
            }

        resume_vector = self.vectorizer.transform([resume_text_for_matching])
        similarities = cosine_similarity(resume_vector, self.job_tfidf_matrix).flatten()

        top_indices = similarities.argsort()[::-1][:top_n_retrieval]

        base_results = []

        for idx in top_indices:
            job = self.jobs.iloc[idx]

            text_similarity = float(similarities[idx])

            base_results.append(
                {
                    "job_id": safe_text(job.get("job_id")),
                    "job_title": safe_text(job.get("job_title")),
                    "job_category": safe_text(job.get("job_category")),
                    "job_subcategory": safe_text(job.get("job_subcategory")),
                    "location": safe_text(job.get("location")),
                    "work_type": safe_text(job.get("work_type")),
                    "source_dataset": safe_text(job.get("source_dataset")),
                    "required_skill_ids": safe_text(job.get("required_skill_ids")),
                    "must_have_skill_ids": safe_text(job.get("must_have_skill_ids")),
                    "required_skills": safe_text(job.get("required_skills_comma_separated")),
                    "skill_gap_reliability": safe_text(job.get("skill_gap_reliability")),
                    "text_similarity": round(text_similarity, 4),
                }
            )

        # Add skill coverage, matched_skill_ids, missing_skill_ids, and fit_now_score.
        enriched_results = add_skill_gap_fields(
            match_results=base_results,
            candidate_skill_ids=candidate_skill_ids,
        )

        fit_now_matches = sorted(
            enriched_results,
            key=lambda item: safe_float(item.get("fit_now_score"), default=0.0),
            reverse=True,
        )[:top_n_output]

        aspiration_candidates = []

        for item in enriched_results:
            job_row = pd.Series(item)

            text_similarity = safe_float(item.get("text_similarity"), default=0.0)
            skill_coverage = safe_float(item.get("skill_coverage"), default=0.0)
            role_pref = role_or_industry_preference_score(job_row, preferences)
            work_pref = work_setup_preference_score(job_row, preferences)

            aspiration_score = (
                0.45 * text_similarity
                + 0.25 * skill_coverage
                + 0.20 * role_pref
                + 0.10 * work_pref
            )

            aspiration_item = dict(item)
            aspiration_item["role_or_industry_preference"] = round(role_pref, 4)
            aspiration_item["work_setup_preference"] = round(work_pref, 4)
            aspiration_item["aspiration_score"] = round(aspiration_score, 4)
            aspiration_item["aspiration_percentage"] = round(aspiration_score * 100, 2)

            aspiration_candidates.append(aspiration_item)

        aspiration_matches = sorted(
            aspiration_candidates,
            key=lambda item: safe_float(item.get("aspiration_score"), default=0.0),
            reverse=True,
        )[:top_n_output]

        # Use the broader retrieved set for skill-gap basis, not only the final top 10.
        skill_gaps = prioritize_skill_gaps(
            match_results=enriched_results,
            max_gaps=8,
        )

        learning_recommendations = recommend_learning_resources(
            skill_gaps=skill_gaps,
            preferences=preferences,
            max_recommendations=8,
        )

        warnings = []

        if not skill_gaps:
            warnings.append(
                "No skill gaps were identified. This may happen if matched jobs have no required_skill_ids or the candidate already covers the detected required skills."
            )

        if not learning_recommendations:
            warnings.append(
                "No learning recommendations were found for the current skill gaps."
            )

        return {
            "fit_now_matches": fit_now_matches,
            "aspiration_matches": aspiration_matches,
            "skill_gaps": skill_gaps,
            "learning_recommendations": learning_recommendations,
            "warnings": warnings,
        }


def match_jobs(
    resume_text_for_matching: str,
    candidate_skill_ids: Optional[list[str]] = None,
    preferences: Optional[dict] = None,
    top_n_retrieval: int = 100,
    top_n_output: int = 10,
) -> dict:
    matcher = JobMatcher()
    return matcher.match_jobs(
        resume_text_for_matching=resume_text_for_matching,
        candidate_skill_ids=candidate_skill_ids,
        preferences=preferences,
        top_n_retrieval=top_n_retrieval,
        top_n_output=top_n_output,
    )


def list_available_jobs(limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 500))
    if not JOB_INDEX_PATH.exists():
        return []

    jobs = pd.read_csv(JOB_INDEX_PATH, dtype=str, keep_default_na=False)
    jobs.columns = [str(column).strip().lstrip("\ufeff") for column in jobs.columns]

    output: list[dict[str, Any]] = []
    for index, row in jobs.head(safe_limit).iterrows():
        record = row.to_dict()
        required_skills_raw = safe_text(record.get("required_skills_comma_separated"))
        required_skills = [skill.strip() for skill in required_skills_raw.split(",") if skill.strip()]
        source_dataset = safe_text(record.get("source_dataset"))
        external_link = safe_text(record.get("external_job_link_optional"))
        company_name = source_dataset.replace("_", " ").strip().title() if source_dataset else "Kareerly Partner Employer"

        output.append(
            {
                "job_id": safe_text(record.get("job_id")) or f"JOB-{index + 1}",
                "job_title": safe_text(record.get("job_title")) or "Untitled role",
                "job_category": safe_text(record.get("job_category")),
                "job_subcategory": safe_text(record.get("job_subcategory")),
                "experience_level_required": safe_text(record.get("experience_level_required")),
                "location": safe_text(record.get("location")) or "Philippines",
                "work_type": safe_text(record.get("work_type")) or "Flexible",
                "salary_range_monthly_php": safe_text(record.get("salary_range_monthly_php")),
                "required_skills": required_skills[:12],
                "external_job_link_optional": external_link,
                "source_dataset": source_dataset,
                "company_name": company_name,
            }
        )

    return output
