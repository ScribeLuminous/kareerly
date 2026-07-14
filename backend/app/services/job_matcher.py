from pathlib import Path
import re
from typing import Any, Optional

import joblib
import pandas as pd
from scipy import sparse
from sklearn.metrics.pairwise import cosine_similarity

from .learning_recommender import (
    add_skill_gap_fields,
    get_learning_resources_source,
    prioritize_skill_gaps,
    recommend_learning_resources,
)
from .supabase_jobs import load_internal_jobs_dataframe


BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
MODELS_DIR = BACKEND_DIR / "baseline_models"

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


def role_level_preference_score(job: pd.Series, preferences: Optional[dict] = None) -> float:
    if not preferences:
        return 0.0

    role_level = safe_text(preferences.get("role_level") or preferences.get("job_level")).lower()
    experience = safe_text(job.get("job_level") or job.get("experience_level_required")).lower()

    if not role_level or role_level in {"any", "not sure"}:
        return 0.0

    if role_level in experience:
        return 1.0
    if "entry" in role_level and any(term in experience for term in ["entry", "junior", "associate", "fresh"]):
        return 1.0
    if "junior" in role_level and any(term in experience for term in ["entry", "junior", "associate"]):
        return 1.0
    if "mid" in role_level and any(term in experience for term in ["mid", "intermediate"]):
        return 1.0
    if "senior" in role_level and any(term in experience for term in ["senior", "lead"]):
        return 1.0
    return 0.0


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


def salary_preference_score(job: pd.Series, preferences: Optional[dict] = None) -> float:
    if not preferences:
        return 0.0

    salary_pref = safe_text(preferences.get("salary_expectation") or preferences.get("salary")).lower()
    salary = safe_text(job.get("salary_range_monthly_php")).lower()

    if not salary_pref or salary_pref in {"any", "not sure"}:
        return 0.0
    if salary_pref in salary:
        return 1.0
    pref_numbers = re.findall(r"\d+", salary_pref)
    if pref_numbers and all(number in salary.replace(",", "") for number in pref_numbers):
        return 1.0
    return 0.0


def career_preference_alignment_score(job: pd.Series, preferences: Optional[dict] = None) -> float:
    if not preferences:
        return 0.0

    signals = [
        (0.35, role_or_industry_preference_score(job, preferences)),
        (0.25, work_setup_preference_score(job, preferences)),
        (0.25, role_level_preference_score(job, preferences)),
        (0.15, salary_preference_score(job, preferences)),
    ]
    return round(sum(weight * score for weight, score in signals), 4)


def build_development_progress(skill_gaps: list[dict]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}

    for gap in skill_gaps:
        category_name = safe_text(gap.get("category_name") or gap.get("skill_category")) or "Other"
        bucket = grouped.setdefault(
            category_name,
            {
                "category_name": category_name,
                "progress_score": 0,
                "progress_label": "Not Started / Missing",
                "skill_records": [],
                "related_skill_records": [],
                "missing_skills": [],
                "covered_skills": [],
                "supporting_evidence": 0,
                "completed_learning": 0,
                "in_progress_count": 0,
                "completed_count": 0,
                "evidence_uploaded_count": 0,
            },
        )
        skill_name = safe_text(gap.get("skill_name"))
        if skill_name and skill_name not in bucket["skill_records"]:
            bucket["skill_records"].append(skill_name)
            bucket["related_skill_records"].append(skill_name)
            bucket["missing_skills"].append(skill_name)

    return list(grouped.values())


class JobMatcher:
    def __init__(self):
        self.vectorizer = self._load_vectorizer()
        self.jobs_source = "model_csv"
        self.jobs = self._load_supabase_jobs()

        if self.jobs.empty:
            self.job_tfidf_matrix = self._load_job_matrix()
            self.jobs = self._load_jobs()
        else:
            self.jobs_source = "supabase_internal_jobs"
            self.job_tfidf_matrix = self.vectorizer.transform(self.jobs["job_text_for_matching"].fillna("").astype(str))

        if self.job_tfidf_matrix.shape[0] != len(self.jobs):
            raise ValueError(
                "Model mismatch: job_tfidf_matrix row count does not match the loaded job rows. "
                f"Matrix rows: {self.job_tfidf_matrix.shape[0]}, Job rows: {len(self.jobs)}. "
                "Regenerate job_index.csv and job_tfidf_matrix.npz from the same reference_jobs.csv, or check Supabase internal_jobs data."
            )

    def _load_vectorizer(self):
        if not TFIDF_VECTORIZER_PATH.exists():
            raise FileNotFoundError(f"Missing TF-IDF vectorizer: {TFIDF_VECTORIZER_PATH}")
        return joblib.load(TFIDF_VECTORIZER_PATH)

    def _load_job_matrix(self):
        if not JOB_TFIDF_MATRIX_PATH.exists():
            raise FileNotFoundError(f"Missing job TF-IDF matrix: {JOB_TFIDF_MATRIX_PATH}")
        return sparse.load_npz(JOB_TFIDF_MATRIX_PATH)

    def _load_supabase_jobs(self) -> pd.DataFrame:
        jobs = load_internal_jobs_dataframe()
        if jobs.empty:
            return jobs

        jobs.columns = [column.strip() for column in jobs.columns]
        if "job_text_for_matching" not in jobs.columns:
            jobs["job_text_for_matching"] = ""
        return jobs

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

        preference_query = " ".join(
            safe_text((preferences or {}).get(key))
            for key in ["industry", "target_role", "role", "role_level", "job_level", "work_setup", "salary_expectation", "skill_to_develop"]
        )
        retrieval_query = f"{resume_text_for_matching} {preference_query}".strip()

        resume_vector = self.vectorizer.transform([resume_text_for_matching])
        retrieval_vector = self.vectorizer.transform([retrieval_query])
        similarities = cosine_similarity(resume_vector, self.job_tfidf_matrix).flatten()
        retrieval_similarities = cosine_similarity(retrieval_vector, self.job_tfidf_matrix).flatten()

        # Rank and score the complete jobs table. `top_n_retrieval` is retained in
        # the public signature for compatibility, but display limits are applied
        # only after matching so no possible database job is skipped.
        top_indices = retrieval_similarities.argsort()[::-1]

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
                    "company": safe_text(job.get("company_name")),
                    "location": safe_text(job.get("location")),
                    "work_type": safe_text(job.get("work_type")),
                    "employment_type": safe_text(job.get("employment_type")),
                    "job_level": safe_text(job.get("experience_level_required")),
                    "salary_range_monthly_php": safe_text(job.get("salary_range_monthly_php")),
                    "external_job_link_optional": safe_text(job.get("external_job_link_optional")),
                    "job_url": safe_text(job.get("external_job_link_optional")),
                    "job_source": safe_text(job.get("job_source")) or "internal",
                    "source_dataset": safe_text(job.get("source_dataset")),
                    "required_skill_ids": safe_text(job.get("required_skill_ids")),
                    "must_have_skill_ids": safe_text(job.get("must_have_skill_ids")),
                    "required_skills": safe_text(job.get("required_skills_comma_separated")),
                    "preferred_skills": safe_text(job.get("nice_to_have_skills_optional")),
                    "skill_gap_reliability": safe_text(job.get("skill_gap_reliability")),
                    "text_similarity": round(text_similarity, 4),
                }
            )

        # Add skill coverage, matched_skill_ids, missing_skill_ids, and fit_now_score.
        enriched_results = add_skill_gap_fields(
            match_results=base_results,
            candidate_skill_ids=candidate_skill_ids,
        )

        all_fit_now_matches = sorted(
            enriched_results,
            key=lambda item: safe_float(item.get("fit_now_score"), default=0.0),
            reverse=True,
        )
        fit_now_matches = all_fit_now_matches[:top_n_output]

        aspiration_candidates = []

        for item in enriched_results:
            job_row = pd.Series(item)

            text_similarity = safe_float(item.get("text_similarity"), default=0.0)
            skill_coverage = safe_float(item.get("skill_coverage"), default=0.0)
            role_pref = role_or_industry_preference_score(job_row, preferences)
            work_pref = work_setup_preference_score(job_row, preferences)
            level_pref = role_level_preference_score(job_row, preferences)
            salary_pref = salary_preference_score(job_row, preferences)
            preference_alignment = career_preference_alignment_score(job_row, preferences)

            aspiration_score = (
                0.60 * preference_alignment
                + 0.25 * text_similarity
                + 0.15 * skill_coverage
            )

            aspiration_item = dict(item)
            aspiration_item["role_or_industry_preference"] = round(role_pref, 4)
            aspiration_item["work_setup_preference"] = round(work_pref, 4)
            aspiration_item["role_level_preference"] = round(level_pref, 4)
            aspiration_item["salary_preference"] = round(salary_pref, 4)
            aspiration_item["preference_alignment_score"] = round(preference_alignment, 4)
            aspiration_item["aspiration_score"] = round(aspiration_score, 4)
            aspiration_item["aspiration_percentage"] = round(aspiration_score * 100, 2)

            aspiration_candidates.append(aspiration_item)

        fit_job_ids = {safe_text(item.get("job_id")) for item in fit_now_matches if safe_text(item.get("job_id"))}
        all_aspiration_matches = [
            item for item in sorted(
                aspiration_candidates,
                key=lambda item: safe_float(item.get("aspiration_score"), default=0.0),
                reverse=True,
            )
            if safe_text(item.get("job_id")) not in fit_job_ids
        ]
        aspiration_matches = all_aspiration_matches[:top_n_output]

        top_gap_basis_map: dict[str, dict[str, Any]] = {}
        for item in fit_now_matches + aspiration_matches:
            job_id = safe_text(item.get("job_id")) or safe_text(item.get("job_title"))
            if not job_id or job_id in top_gap_basis_map:
                continue
            top_gap_basis_map[job_id] = item
            if len(top_gap_basis_map) >= top_n_output:
                break

        skill_gaps = prioritize_skill_gaps(
            match_results=list(top_gap_basis_map.values()) or enriched_results[:top_n_output],
            preferences=preferences,
            max_gaps=8,
        )

        learning_recommendations = recommend_learning_resources(
            skill_gaps=skill_gaps,
            preferences=preferences,
            max_recommendations=8,
        )
        development_progress = build_development_progress(skill_gaps)

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
            "all_fit_now_matches": all_fit_now_matches,
            "all_aspiration_matches": all_aspiration_matches,
            "total_qualifying_matches": len({safe_text(item.get("job_id")) or safe_text(item.get("job_title")) for item in all_fit_now_matches + all_aspiration_matches}),
            "skill_gaps": skill_gaps,
            "learning_recommendations": learning_recommendations,
            "development_progress": development_progress,
            "warnings": warnings,
            "metadata": {
                "jobs_source": self.jobs_source,
                "learning_resources_source": get_learning_resources_source(),
                "total_jobs_scored": len(self.jobs),
            },
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


def list_available_jobs(limit: int = 5000) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 5000))
    jobs = load_internal_jobs_dataframe(limit=safe_limit)

    if jobs.empty:
        return []
    jobs.columns = [str(column).strip().lstrip("\ufeff") for column in jobs.columns]
    jobs["_source_priority"] = jobs["job_source"].map({"employer": 0, "internal": 1}).fillna(2)
    jobs = jobs.sort_values(["_source_priority", "created_at", "job_title"], ascending=[True, False, True])


    output: list[dict[str, Any]] = []
    for index, row in jobs.head(safe_limit).iterrows():
        record = row.to_dict()
        required_skills_raw = safe_text(record.get("required_skills_comma_separated"))
        required_skills = [skill.strip() for skill in required_skills_raw.split(",") if skill.strip()]
        source_dataset = safe_text(record.get("source_dataset"))
        external_link = safe_text(record.get("external_job_link_optional"))
        company_name = safe_text(record.get("company_name")) or (
            source_dataset.replace("_", " ").strip().title() if source_dataset else "Kareerly Internal Jobs"
        )

        output.append(
            {
                "job_id": safe_text(record.get("job_id")) or f"JOB-{index + 1}",
                "job_title": safe_text(record.get("job_title")) or "Untitled role",
                "job_category": safe_text(record.get("job_category")),
                "job_subcategory": safe_text(record.get("job_subcategory")),
                "experience_level_required": safe_text(record.get("experience_level_required")),
                "location": safe_text(record.get("location")) or "Philippines",
                "work_type": safe_text(record.get("work_type")) or "Flexible",
                "employment_type": safe_text(record.get("employment_type")),
                "salary_range_monthly_php": safe_text(record.get("salary_range_monthly_php")),
                "salary_min_php": safe_text(record.get("salary_min_php")),
                "salary_max_php": safe_text(record.get("salary_max_php")),
                "required_skills": required_skills[:12],
                "preferred_skills": [skill.strip() for skill in safe_text(record.get("nice_to_have_skills_optional")).split(",") if skill.strip()],
                "job_description": safe_text(record.get("job_description")),
                "responsibilities": [item.strip() for item in safe_text(record.get("responsibilities")).splitlines() if item.strip()],
                "external_job_link_optional": external_link,
                "source_dataset": source_dataset,
                "company_name": company_name,
                "job_source": safe_text(record.get("job_source")) or "internal",
                "created_at": safe_text(record.get("created_at")),
                "updated_at": safe_text(record.get("updated_at")),
            }
        )

    return output
