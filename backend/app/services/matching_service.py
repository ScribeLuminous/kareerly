# backend/app/services/matching_service.py

import io
import os
import re
import logging
from functools import lru_cache
from typing import Dict, List, Any, Tuple, Optional

import numpy as np
import pandas as pd
from pypdf import PdfReader
from docx import Document

from .learning_recommender import (
    get_learning_resources_source,
    recommend_learning_resources,
    load_learning_resources as load_reviewed_learning_resources,
    resource_is_reviewed,
    provider_url,
    split_ids,
)
from .bi_encoder_service import MODEL_ID, MatchingModelUnavailable, build_model_input, score_jobs
from .skill_extractor import SkillExtractor
from .supabase_jobs import load_internal_jobs_dataframe

# ============================================================
# CONFIG
# ============================================================

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(BASE_DIR, "data")

REFERENCE_JOBS_PATH = os.path.join(DATA_DIR, "reference_jobs.csv")
SKILLS_REFERENCE_PATH = os.path.join(DATA_DIR, "skills_reference.csv")
LEARNING_RESOURCES_PATH = os.path.join(DATA_DIR, "learning_resources.csv")

TOP_FIT_NOW = 10
TOP_ASPIRATION = 10
logger = logging.getLogger(__name__)
MAX_CONFIRMED_SKILLS = 20
JOBS_SOURCE = "reference_jobs.csv"


# ============================================================
# BASIC TEXT HELPERS
# ============================================================

def clean_text(value: Any) -> str:
    if value is None:
        return ""

    text = str(value)
    text = text.replace("\x00", " ")
    text = re.sub(r"\s+", " ", text)
    text = text.strip()

    return text


def repair_letter_spaced_text(text: str) -> str:
    if not isinstance(text, str):
        return ""

    text = text.replace("\u00a0", " ")
    single_char_tokens = re.findall(r"\b[A-Za-z0-9]\b", text)
    word_tokens = re.findall(r"\b[A-Za-z0-9]+\b", text)

    looks_letter_spaced = (
        len(single_char_tokens) >= 30
        and len(single_char_tokens) / max(len(word_tokens), 1) >= 0.60
    )

    if not looks_letter_spaced:
        return text

    compact = re.sub(r"\s+", "", text)
    if compact and compact not in text:
        return text + "\n\n" + compact

    return text


def normalize_for_match(value: Any) -> str:
    text = clean_text(value).lower()
    text = re.sub(r"[^a-z0-9+#.\s/-]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_category_id(value: Any) -> str:
    value = "" if pd.isna(value) else str(value).strip().upper()

    match = re.search(r"K\s*0?(\d{1,2})", value)
    if match:
        number = int(match.group(1))
        if 1 <= number <= 11:
            return f"K{number:02d}"

    if value.isdigit():
        number = int(value)
        if 1 <= number <= 11:
            return f"K{number:02d}"

    return value


# ============================================================
# RESUME FILE READING
# ============================================================

def extract_text_from_pdf(file_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(file_bytes))
    pages = []

    for page in reader.pages:
        try:
            page_text = page.extract_text() or ""
            pages.append(page_text)
        except Exception:
            continue

    return clean_text(repair_letter_spaced_text(" ".join(pages)))


def extract_text_from_docx(file_bytes: bytes) -> str:
    document = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in document.paragraphs if p.text]

    # Also read tables if present
    table_texts = []
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text:
                    table_texts.append(cell.text)

    return clean_text(repair_letter_spaced_text(" ".join(paragraphs + table_texts)))


def extract_resume_text(file_bytes: bytes, filename: str) -> str:
    filename_lower = filename.lower()

    if filename_lower.endswith(".pdf"):
        text = extract_text_from_pdf(file_bytes)
    elif filename_lower.endswith(".docx"):
        text = extract_text_from_docx(file_bytes)
    else:
        raise ValueError("Unsupported file format. Please upload a readable PDF or DOCX file.")

    if len(text) < 50:
        raise ValueError(
            "The resume text is too short or unreadable. Please upload a clearer PDF or DOCX resume."
        )

    return text


# ============================================================
# DATA LOADING
# ============================================================

def safe_read_csv(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing required file: {path}")

    df = pd.read_csv(path)
    df.columns = [str(c).replace("\ufeff", "").strip() for c in df.columns]

    for col in df.columns:
        if df[col].dtype == "object":
            df[col] = df[col].fillna("").apply(clean_text)

    return df


@lru_cache(maxsize=1)
def load_skills_reference() -> pd.DataFrame:
    skills = safe_read_csv(SKILLS_REFERENCE_PATH)

    if "category_id" in skills.columns:
        skills["category_id_norm"] = skills["category_id"].apply(normalize_category_id)
    else:
        skills["category_id_norm"] = ""

    return skills


def load_reference_jobs() -> pd.DataFrame:
    global JOBS_SOURCE

    supabase_jobs = load_internal_jobs_dataframe()
    if not supabase_jobs.empty:
        jobs = supabase_jobs.copy()
        JOBS_SOURCE = "supabase_internal_and_employer_jobs"
    else:
        jobs = safe_read_csv(REFERENCE_JOBS_PATH)
        JOBS_SOURCE = "reference_jobs.csv"

    required_cols = [
        "job_id",
        "category_id",
        "job_category",
        "job_title",
        "job_description",
        "required_skills_comma_separated",
        "mapped_required_skill_names",
        "experience_level_required",
        "location",
        "work_type",
        "salary_range_monthly_php",
        "job_text_for_matching",
    ]

    missing = [col for col in required_cols if col not in jobs.columns]
    if missing:
        raise ValueError(f"reference_jobs.csv is missing columns: {missing}")

    if "job_subcategory" not in jobs.columns:
        jobs["job_subcategory"] = ""

    jobs["category_id_norm"] = jobs["category_id"].apply(normalize_category_id)

    jobs["required_skills_for_eval"] = jobs["mapped_required_skill_names"].fillna("").apply(clean_text)

    jobs.loc[
        jobs["required_skills_for_eval"].str.len() == 0,
        "required_skills_for_eval"
    ] = jobs["required_skills_comma_separated"].fillna("").apply(clean_text)

    jobs["job_text"] = jobs["job_text_for_matching"].fillna("").apply(clean_text)

    fallback_text = (
        "Job title: " + jobs["job_title"].astype(str) +
        ". Job category: " + jobs["job_category"].astype(str) +
        ". Job subcategory: " + jobs.get("job_subcategory", "").astype(str) +
        ". Job description: " + jobs["job_description"].astype(str) +
        ". Required skills: " + jobs["required_skills_for_eval"].astype(str) +
        ". Experience level: " + jobs["experience_level_required"].astype(str) +
        ". Work type: " + jobs["work_type"].astype(str) +
        ". Location: " + jobs["location"].astype(str) +
        ". Salary range: " + jobs["salary_range_monthly_php"].astype(str)
    ).apply(clean_text)

    short_mask = jobs["job_text"].str.len() < 50
    jobs.loc[short_mask, "job_text"] = fallback_text[short_mask]

    jobs = jobs[jobs["job_text"].str.len() > 50].copy()

    return jobs.reset_index(drop=True)


def get_jobs_source() -> str:
    return JOBS_SOURCE


# ============================================================
# SKILL EXTRACTION
# ============================================================

def get_skill_name_column(skills_df: pd.DataFrame) -> str:
    candidates = [
        "skill_name",
        "preferred_label",
        "preferredLabel",
        "skill",
        "name",
        "label",
    ]

    for col in candidates:
        if col in skills_df.columns:
            return col

    # fallback: first text column that is not category
    for col in skills_df.columns:
        if col not in ["category_id", "category_id_norm", "skill_category"]:
            return col

    raise ValueError("No usable skill name column found in skills_reference.csv")


def build_skill_alias_index(skills_df: pd.DataFrame) -> List[Dict[str, Any]]:
    skill_name_col = get_skill_name_column(skills_df)

    alias_columns = []
    possible_alias_cols = [
        "aliases",
        "alias",
        "alt_labels",
        "alternative_labels",
        "altLabel",
        "skill_aliases",
        "preferred_label",
        "preferredLabel",
        "esco_preferred_label",
        "esco_alternative_labels",
        "skill_name",
    ]

    for col in possible_alias_cols:
        if col in skills_df.columns:
            alias_columns.append(col)

    if skill_name_col not in alias_columns:
        alias_columns.append(skill_name_col)

    alias_index = []

    for _, row in skills_df.iterrows():
        canonical_name = clean_text(row.get(skill_name_col, ""))
        if not canonical_name:
            continue

        category_id = clean_text(row.get("category_id_norm", ""))
        skill_category = clean_text(row.get("skill_category", ""))

        aliases = set()
        aliases.add(canonical_name)

        for col in alias_columns:
            raw_value = clean_text(row.get(col, ""))

            if not raw_value:
                continue

            # split possible alias lists
            parts = re.split(r"[;,|]", raw_value)
            for part in parts:
                part = clean_text(part)
                if part:
                    aliases.add(part)

        for alias in aliases:
            normalized_alias = normalize_for_match(alias)

            # skip very short generic aliases
            if len(normalized_alias) < 2:
                continue

            alias_index.append({
                "alias": alias,
                "alias_norm": normalized_alias,
                "skill_name": canonical_name,
                "category_id": category_id,
                "skill_category": skill_category,
            })

    # longest aliases first to reduce weak matches
    alias_index = sorted(alias_index, key=lambda x: len(x["alias_norm"]), reverse=True)

    return alias_index


@lru_cache(maxsize=1)
def get_skill_alias_index_cached() -> Tuple[List[Dict[str, Any]], str]:
    skills_df = load_skills_reference()
    skill_name_col = get_skill_name_column(skills_df)
    return build_skill_alias_index(skills_df), skill_name_col


@lru_cache(maxsize=1)
def get_weighted_skill_extractor() -> SkillExtractor:
    return SkillExtractor(SKILLS_REFERENCE_PATH)


def extract_skills_from_text(text: str, max_skills: int = 30) -> List[Dict[str, Any]]:
    weighted_skills = get_weighted_skill_extractor().extract_skills(text)
    if weighted_skills:
        return weighted_skills[:max_skills]

    text_norm = normalize_for_match(text)
    alias_index, _ = get_skill_alias_index_cached()

    found = {}

    for item in alias_index:
        alias_norm = item["alias_norm"]

        # exact phrase boundary matching
        pattern = r"(?<![a-zA-Z0-9+#.])" + re.escape(alias_norm) + r"(?![a-zA-Z0-9+#.])"

        if re.search(pattern, text_norm):
            skill_name = item["skill_name"]

            if skill_name not in found:
                found[skill_name] = {
                    "skill_name": skill_name,
                    "matched_alias": item["alias"],
                    "category_id": item["category_id"],
                    "skill_category": item["skill_category"],
                }

        if len(found) >= max_skills:
            break

    return list(found.values())


def split_skill_list(value: Any) -> List[str]:
    text = clean_text(value)

    if not text:
        return []

    parts = re.split(r"[;,|]", text)
    cleaned = []

    for part in parts:
        part = clean_text(part)
        if part:
            cleaned.append(part)

    # remove duplicates while preserving order
    seen = set()
    result = []

    for skill in cleaned:
        key = skill.lower()
        if key not in seen:
            seen.add(key)
            result.append(skill)

    return result


def skill_tokens(value: Any) -> List[str]:
    normalized = normalize_for_match(value)
    if not normalized:
        return []
    return [token for token in re.split(r"[\s/-]+", normalized) if token]


# ============================================================
# RULE-BASED SCORING
# ============================================================

@lru_cache(maxsize=1)
def canonical_skill_lookup() -> Tuple[Dict[str, str], Dict[str, str]]:
    """Canonical IDs and unambiguous, explicitly mapped aliases; no token partial credit."""
    labels = {}
    owners = {}
    for _, row in load_skills_reference().iterrows():
        skill_id = clean_text(row.get("skill_id", "")).upper()
        label = clean_text(row.get("skill_name", ""))
        if not skill_id or not label:
            continue
        labels[skill_id] = label
        aliases = [label]
        if clean_text(row.get("mapping_status", "")) == "mapped":
            aliases += [clean_text(row.get("esco_preferred_label", ""))]
            aliases += split_skill_list(row.get("esco_alternative_labels", ""))
        for alias in aliases:
            normalized = normalize_for_match(alias)
            if normalized:
                owners.setdefault(normalized, set()).add(skill_id)
    aliases = {alias: next(iter(ids)) for alias, ids in owners.items() if len(ids) == 1}
    # Canonical labels are authoritative even when an imported alias conflicts.
    for skill_id, label in labels.items():
        aliases[normalize_for_match(label)] = skill_id
    return labels, aliases


def _skill_key(value: str) -> str:
    labels, aliases = canonical_skill_lookup()
    text = clean_text(value)
    if text.upper() in labels:
        return text.upper()
    normalized = normalize_for_match(text)
    return aliases.get(normalized, "CUSTOM:" + normalized)


def compute_skill_coverage(candidate_skills: List[str], required_skills: List[str]) -> Dict[str, Any]:
    labels, _ = canonical_skill_lookup()
    candidates = {_skill_key(value) for value in candidate_skills if clean_text(value)}
    required = {_skill_key(value): clean_text(value) for value in required_skills if clean_text(value)}
    matched = [key for key in required if key in candidates]
    missing = [key for key in required if key not in candidates]
    return {
        "skill_coverage": round(len(matched) / len(required), 4) if required else 0.0,
        "matched_skills": sorted(labels.get(key, required[key]) for key in matched),
        "missing_skills": sorted(labels.get(key, required[key]) for key in missing),
        "matched_skill_ids": sorted(key for key in matched if key in labels),
        "missing_skill_ids": sorted(key for key in missing if key in labels),
    }


def compute_preference_alignment(job: Dict[str, Any], preferences: Dict[str, Any]) -> float:
    if not preferences:
        return 0.0

    def token_overlap(preference: str, corpus: str) -> float:
        pref_tokens = {
            token
            for token in re.findall(r"[a-z0-9]+", preference)
            if len(token) > 2 and token not in {"and", "the", "for", "with", "any"}
        }
        if not pref_tokens:
            return 0.0
        corpus_tokens = set(re.findall(r"[a-z0-9]+", corpus))
        return len(pref_tokens.intersection(corpus_tokens)) / len(pref_tokens)

    score = 0.0
    total = 0.0

    job_category = normalize_for_match(job.get("job_category", ""))
    job_title = normalize_for_match(job.get("job_title", ""))
    job_subcategory = normalize_for_match(job.get("job_subcategory", ""))
    job_description = normalize_for_match(job.get("job_description", ""))
    work_type = normalize_for_match(job.get("work_type", ""))
    experience = normalize_for_match(job.get("experience_level_required", ""))
    salary = normalize_for_match(job.get("salary_range_monthly_php", ""))
    job_corpus = " ".join([job_category, job_subcategory, job_title, job_description, work_type, experience, salary])

    preferred_industry = normalize_for_match(preferences.get("industry", ""))
    role_level = normalize_for_match(preferences.get("role_level", ""))
    target_role = normalize_for_match(preferences.get("target_role", ""))
    work_setup = normalize_for_match(preferences.get("work_setup", ""))
    salary_expectation = normalize_for_match(preferences.get("salary_expectation", ""))
    skill_to_develop = normalize_for_match(preferences.get("skill_to_develop", ""))

    def specified(value: str) -> bool:
        return bool(value) and value not in {"any", "flexible"} and "not sure" not in value

    if specified(preferred_industry):
        total += 0.25
        if preferred_industry in job_corpus:
            score += 0.25
        else:
            score += 0.25 * token_overlap(preferred_industry, job_corpus)

    if specified(target_role):
        total += 0.30
        if target_role in job_title or target_role in job_description:
            score += 0.30
        else:
            score += 0.30 * token_overlap(target_role, f"{job_title} {job_description}")

    if specified(role_level):
        total += 0.15
        if role_level in experience:
            score += 0.15

    if specified(work_setup):
        total += 0.20
        if work_setup in work_type:
            score += 0.20

    if specified(salary_expectation):
        total += 0.10
        if salary_expectation in salary:
            score += 0.10

    if specified(skill_to_develop):
        total += 0.10
        required_names = normalize_for_match(job.get("required_skills_for_eval", ""))
        score += 0.10 * token_overlap(skill_to_develop, required_names)

    if total == 0:
        return 0.0

    return round(score / total, 4)


def compute_evidence_strength(resume_text: str, matched_skills: List[str]) -> float:
    text = normalize_for_match(resume_text)

    evidence_points = 0
    total_points = 4

    if any(word in text for word in ["experience", "employment", "work history", "professional experience"]):
        evidence_points += 1

    if any(word in text for word in ["education", "degree", "university", "college", "school"]):
        evidence_points += 1

    if any(word in text for word in ["certificate", "certification", "licensed", "training"]):
        evidence_points += 1

    if len(matched_skills) >= 3:
        evidence_points += 1

    return round(evidence_points / total_points, 4)


def reviewed_learning_skill_ids() -> set:
    covered = set()
    for _, resource in load_reviewed_learning_resources().iterrows():
        if resource_is_reviewed(resource) and provider_url(str(resource.get("external_course_or_certification_link", ""))):
            covered.update(split_ids(resource.get("skill_ids", "")))
    return covered


def compute_learning_readiness(missing_skills: List[str], available_skill_ids: Optional[set] = None) -> float:
    if not missing_skills:
        return 0.0
    available = available_skill_ids if available_skill_ids is not None else reviewed_learning_skill_ids()
    return round(sum(_skill_key(value) in available for value in missing_skills) / len(missing_skills), 4)


def bi_encoder_score_jobs(candidate_input: str, jobs_df: pd.DataFrame) -> pd.DataFrame:
    scored = jobs_df.copy()
    inputs = [build_model_input(clean_text(row.get("job_description", "")),
        title=clean_text(row.get("job_title", "")),
        skill_names=split_skill_list(row.get("required_skills_for_eval", ""))) for _, row in jobs_df.iterrows()]
    raw_scores = score_jobs(candidate_input, inputs)
    scored["semantic_score_raw"] = raw_scores
    scored["semantic_score"] = np.clip(raw_scores, 0, 1)
    scored["semantic_scoring_method"] = "fine_tuned_bi_encoder_cosine"
    return scored


# ============================================================
# JOB MATCHING MAIN FUNCTION
# ============================================================

def generate_match_explanation(
    job_title: str,
    match_type: str,
    matched_skills: List[str],
    missing_skills: List[str],
    skill_coverage: float,
    preference_alignment: float,
) -> str:
    matched_text = ", ".join(matched_skills[:5]) if matched_skills else "some related resume evidence"
    missing_text = ", ".join(missing_skills[:5]) if missing_skills else "no major required skills"

    if match_type == "Fit-Now":
        return (
            f"This role is showing as {match_type} because your resume already reflects relevant experience for "
            f"{job_title}, including skills such as {matched_text}. "
            f"The main areas to strengthen next are {missing_text}."
        )

    return (
        f"This role is showing as {match_type} because it has partial alignment with your background and career "
        f"direction. Your current profile already connects through {matched_text}. "
        f"The main skills to improve next are {missing_text}."
    )


def match_resume_to_jobs(
    file_bytes: bytes,
    filename: str,
    preferences: Optional[Dict[str, Any]] = None,
    confirmed_skills: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    return match_text_to_jobs(extract_resume_text(file_bytes, filename), filename=filename,
        preferences=preferences, confirmed_skills=confirmed_skills)


def match_text_to_jobs(
    resume_text: str,
    *,
    filename: str = "",
    preferences: Optional[Dict[str, Any]] = None,
    confirmed_skills: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    preferences = preferences or {}
    provided_confirmed_skills = confirmed_skills is not None
    confirmed_skills = confirmed_skills or []
    if len(confirmed_skills) > MAX_CONFIRMED_SKILLS:
        raise ValueError(f"You can confirm up to {MAX_CONFIRMED_SKILLS} skills.")
    resume_text = clean_text(resume_text)
    if not resume_text:
        raise ValueError("No readable resume text was provided for matching.")

    extracted_skills = extract_skills_from_text(resume_text, max_skills=30)
    confirmed_skill_records: List[Dict[str, Any]] = []

    for item in confirmed_skills:
        if isinstance(item, str):
            skill_name = clean_text(item)
            if skill_name:
                confirmed_skill_records.append({"skill_id": "", "skill_name": skill_name, "source": "confirmed_legacy_name"})
            continue

        if isinstance(item, dict):
            skill_name = clean_text(item.get("skill_name", ""))
            if not skill_name:
                continue
            confirmed_skill_records.append(
                {
                    "skill_id": clean_text(item.get("skill_id", "")).upper(),
                    "skill_name": skill_name,
                    "custom_skill_name": clean_text(item.get("custom_skill_name", "")),
                    "source": clean_text(item.get("source", "")) or "confirmed_skill",
                    "is_standardized": bool(item.get("is_standardized", bool(clean_text(item.get("skill_id", ""))))),
                    "source_metadata": item.get("source_metadata", {}) if isinstance(item.get("source_metadata"), dict) else {},
                }
            )

    if provided_confirmed_skills:
        final_skill_records = confirmed_skill_records[:MAX_CONFIRMED_SKILLS]
    else:
        final_skill_records = [
            {
                "skill_id": clean_text(skill.get("skill_id", "")).upper(),
                "skill_name": clean_text(skill.get("skill_name", "")),
                "custom_skill_name": "",
                "source": "resume_extracted",
                "is_standardized": True,
                "source_metadata": skill.get("source_metadata", {}) if isinstance(skill.get("source_metadata"), dict) else {},
            }
            for skill in extracted_skills
            if clean_text(skill.get("skill_name", ""))
        ][:MAX_CONFIRMED_SKILLS]

    labels, _ = canonical_skill_lookup()
    for skill in final_skill_records:
        skill_id = clean_text(skill.get("skill_id", "")).upper()
        if skill_id:
            if skill_id not in labels:
                raise ValueError(f"Unknown confirmed skill ID: {skill_id}")
            skill["skill_name"] = labels[skill_id]
    candidate_skill_names = list(dict.fromkeys(skill["skill_name"] for skill in final_skill_records))
    candidate_keys = [skill.get("skill_id") or skill["skill_name"] for skill in final_skill_records]
    resume_evidence_text = build_model_input(resume_text, skill_names=candidate_skill_names)
    jobs_df = load_reference_jobs()
    scored_jobs = bi_encoder_score_jobs(resume_evidence_text, jobs_df)
    available_learning_skills = reviewed_learning_skill_ids()
    min_cosine = float(os.getenv("KAREERLY_FIT_NOW_MIN_COSINE", "0.45"))
    min_coverage = float(os.getenv("KAREERLY_FIT_NOW_MIN_COVERAGE", "0.50"))
    if not 0 <= min_cosine <= 1 or not 0 <= min_coverage <= 1:
        raise RuntimeError("Fit-Now thresholds must be between zero and one.")

    results = []

    for _, row in scored_jobs.iterrows():
        job = row.to_dict()

        required_ids = split_ids(job.get("required_skill_ids", ""))
        required_skills = required_ids or split_skill_list(job.get("required_skills_for_eval", ""))

        skill_result = compute_skill_coverage(
            candidate_skills=candidate_keys,
            required_skills=required_skills,
        )

        preference_alignment = compute_preference_alignment(job, preferences)

        evidence_strength = compute_evidence_strength(
            resume_text=resume_text,
            matched_skills=skill_result["matched_skills"],
        )

        learning_readiness = compute_learning_readiness(skill_result["missing_skills"], available_learning_skills)

        semantic_score = float(job.get("semantic_score", 0.0))
        skill_coverage = float(skill_result["skill_coverage"])

        # Cosine is the ranking signal; rules organize and explain, without an invented weighted ML score.
        fit_now_score = semantic_score
        aspiration_score = semantic_score
        critical_ids = set(split_ids(job.get("must_have_skill_ids", "")))
        critical_missing = sorted(critical_ids - set(skill_result["matched_skill_ids"]))
        is_fit_now = bool(required_skills) and semantic_score >= min_cosine and skill_coverage >= min_coverage and not critical_missing

        if is_fit_now:
            match_type = "Fit-Now"
            final_score = fit_now_score
        else:
            match_type = "Aspiration"
            final_score = aspiration_score

        explanation = generate_match_explanation(
            job_title=job.get("job_title", ""),
            match_type=match_type,
            matched_skills=skill_result["matched_skills"],
            missing_skills=skill_result["missing_skills"],
            skill_coverage=skill_coverage,
            preference_alignment=preference_alignment,
        )

        results.append({
            "job_id": job.get("job_id", ""),
            "job_title": job.get("job_title", ""),
            "company": job.get("company_name", ""),
            "company_name": job.get("company_name", ""),
            "job_source": job.get("job_source", "internal"),
            "job_category": job.get("job_category", ""),
            "job_subcategory": job.get("job_subcategory", ""),
            "category_id": job.get("category_id_norm", ""),
            "location": job.get("location", ""),
            "work_type": job.get("work_type", ""),
            "employment_type": job.get("employment_type", ""),
            "experience_level_required": job.get("experience_level_required", ""),
            "salary_range_monthly_php": job.get("salary_range_monthly_php", ""),
            "job_description": job.get("job_description", ""),
            "external_job_link_optional": job.get("external_job_link_optional", ""),
            "source_dataset": job.get("source_dataset", ""),
            "match_type": match_type,
            "final_score": round(float(final_score), 4),
            "match_percentage": round(float(final_score) * 100, 2),
            "semantic_score": round(float(semantic_score), 4),
            "skill_coverage": round(float(skill_coverage), 4),
            "preference_alignment": round(float(preference_alignment), 4),
            "evidence_strength": round(float(evidence_strength), 4),
            "learning_readiness": round(float(learning_readiness), 4),
            "semantic_scoring_method": job.get("semantic_scoring_method", "fine_tuned_bi_encoder_cosine"),
            "semantic_score_raw": float(job.get("semantic_score_raw", 0.0)),
            "text_similarity": float(job.get("semantic_score_raw", 0.0)),
            "fit_now_score": round(fit_now_score, 4),
            "fit_now_percentage": round(fit_now_score * 100, 2),
            "aspiration_score": round(aspiration_score, 4),
            "aspiration_percentage": round(aspiration_score * 100, 2),
            "matched_skill_ids": skill_result["matched_skill_ids"],
            "missing_skill_ids": skill_result["missing_skill_ids"],
            "critical_missing_skill_ids": critical_missing,
            "required_skill_ids": ";".join(required_ids),
            "matched_skills": skill_result["matched_skills"],
            "missing_skills": skill_result["missing_skills"],
            "explanation": explanation,
        })

    results_df = pd.DataFrame(results)

    if results_df.empty:
        fit_now_matches = []
        aspiration_matches = []
    else:
        fit_now_pool = results_df[results_df["match_type"] == "Fit-Now"]
        aspiration_pool = results_df[results_df["match_type"] == "Aspiration"]

        all_fit_now_matches = (
            fit_now_pool
            .sort_values(["semantic_score_raw", "skill_coverage", "preference_alignment", "learning_readiness", "job_id"], ascending=[False, False, False, False, True], kind="stable")
            .to_dict(orient="records")
        )

        all_aspiration_matches = (
            aspiration_pool
            .sort_values(["semantic_score_raw", "skill_coverage", "preference_alignment", "learning_readiness", "job_id"], ascending=[False, False, False, False, True], kind="stable")
            .to_dict(orient="records")
        )
        fit_now_matches = all_fit_now_matches[:TOP_FIT_NOW]
        aspiration_matches = all_aspiration_matches[:TOP_ASPIRATION]

    if results_df.empty:
        all_fit_now_matches = []
        all_aspiration_matches = []

    prioritized_gaps = prioritize_skill_gaps(fit_now_matches + aspiration_matches)
    for gap in prioritized_gaps:
        key = _skill_key(gap["skill_name"])
        gap["skill_id"] = key if key in labels else ""
    learning_recommendations = recommend_learning_resources(
        skill_gaps=prioritized_gaps,
        preferences=preferences,
        max_recommendations=10,
    )
    top_10_scores = (
        results_df.sort_values("final_score", ascending=False)
        .head(10)
        .loc[:, [
            "job_title",
            "semantic_score",
            "skill_coverage",
            "matched_skills",
            "missing_skills",
            "final_score",
            "match_type",
        ]]
        .to_dict(orient="records")
        if not results_df.empty
        else []
    )

    scoring_methods = sorted(set(scored_jobs["semantic_scoring_method"].tolist()))
    return {
        "filename": filename,
        "resume_text_preview": resume_text[:500],
        "resume_text_for_matching": resume_text,
        "extracted_skills": final_skill_records,
        "confirmed_skills": candidate_skill_names,
        "confirmed_skill_records": final_skill_records,
        "preferences_used": preferences,
        "fit_now_matches": fit_now_matches,
        "aspiration_matches": aspiration_matches,
        "all_fit_now_matches": all_fit_now_matches,
        "all_aspiration_matches": all_aspiration_matches,
        "total_qualifying_matches": len({str(item.get("job_id") or item.get("job_title")) for item in all_fit_now_matches + all_aspiration_matches}),
        "skill_gaps": prioritized_gaps,
        "prioritized_skill_gaps": prioritized_gaps,
        "learning_recommendations": learning_recommendations,
        "model_used": "Fine-tuned all-MiniLM-L6-v2 bi-encoder with cosine similarity and canonical skill rules",
        "warnings": ["No canonical required skills were supplied for some jobs; detailed gap explanations may be limited."] if any(not clean_text(row.get("required_skill_ids", "")) and not clean_text(row.get("required_skills_for_eval", "")) for _, row in jobs_df.iterrows()) else [],
        "debug_summary": {
            "extracted_skill_count": len(candidate_skill_names),
            "extracted_skill_names": candidate_skill_names,
            "total_jobs_loaded": int(len(jobs_df)),
            "total_jobs_scored": int(len(scored_jobs)),
            "fit_now_count": len(all_fit_now_matches),
            "aspiration_count": len(all_aspiration_matches),
            "top_10_scores": top_10_scores,
        },
        "metadata": {
            "semantic_scoring_methods": scoring_methods,
            "model_version": MODEL_ID,
            "ranking_signal": "cosine_similarity",
            "score_interpretation": "Nonnegative cosine similarity percentage, not hiring probability",
            "fit_now_rules": {"min_cosine": min_cosine, "min_skill_coverage": min_coverage, "max_critical_missing_skills": 0},
            "jobs_source": get_jobs_source(),
            "learning_resources_source": get_learning_resources_source(),
            "total_jobs_scored": int(len(scored_jobs)),
        },
    }


def match_jobs(
    resume_text_for_matching: str,
    candidate_skill_ids: Optional[List[str]] = None,
    preferences: Optional[Dict[str, Any]] = None,
    top_n_retrieval: int = 100,
    top_n_output: int = 10,
) -> Dict[str, Any]:
    labels, _ = canonical_skill_lookup()
    ids = list(dict.fromkeys(clean_text(value).upper() for value in (candidate_skill_ids or []) if clean_text(value)))
    if any(value not in labels for value in ids):
        raise ValueError("Unknown confirmed skill IDs were supplied.")
    records = [{"skill_id": value, "skill_name": labels[value], "source": "confirmed_skill"} for value in ids]
    result = match_text_to_jobs(resume_text_for_matching, preferences=preferences, confirmed_skills=records)
    result["fit_now_matches"] = result["all_fit_now_matches"][:max(0, top_n_output)]
    result["aspiration_matches"] = result["all_aspiration_matches"][:max(0, top_n_output)]
    return result


def prioritize_skill_gaps(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    gap_counts = {}

    for match in matches:
        match_type = match.get("match_type", "")
        for skill in match.get("missing_skills", []):
            if skill not in gap_counts:
                gap_counts[skill] = {
                    "skill": skill,
                    "frequency": 0,
                    "appears_in_fit_now": 0,
                    "appears_in_aspiration": 0,
                }

            gap_counts[skill]["frequency"] += 1

            if match_type == "Fit-Now":
                gap_counts[skill]["appears_in_fit_now"] += 1
            else:
                gap_counts[skill]["appears_in_aspiration"] += 1

    gap_list = []

    for item in gap_counts.values():
        frequency = item["frequency"]

        if frequency >= 3:
            priority = "Critical"
        elif frequency == 2:
            priority = "High Priority"
        else:
            priority = "Moderate"

        gap_list.append({
            "skill_name": item["skill"],
            "skill": item["skill"],
            "severity": priority,
            "frequency": frequency,
            "priority": priority,
            "appears_in_top_matches": frequency,
            "appears_in_fit_now": item["appears_in_fit_now"],
            "appears_in_aspiration": item["appears_in_aspiration"],
        })

    gap_list = sorted(
        gap_list,
        key=lambda x: (
            {"Critical": 3, "High Priority": 2, "Moderate": 1}[x["priority"]],
            x["frequency"],
        ),
        reverse=True,
    )

    return gap_list[:8]
