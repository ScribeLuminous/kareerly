# backend/app/services/matching_service.py

import io
import os
import re
import math
from functools import lru_cache
from typing import Dict, List, Any, Tuple, Optional, TYPE_CHECKING

import numpy as np
import pandas as pd
from pypdf import PdfReader
from docx import Document
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .learning_recommender import get_learning_resources_source, recommend_learning_resources
from .cross_encoder_service import CROSS_ENCODER_MODEL_NAME, get_cross_encoder
from .skill_extractor import SkillExtractor
from .supabase_jobs import load_internal_jobs_dataframe

if TYPE_CHECKING:
    from sentence_transformers import CrossEncoder


# ============================================================
# CONFIG
# ============================================================

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(BASE_DIR, "data")

REFERENCE_JOBS_PATH = os.path.join(DATA_DIR, "reference_jobs.csv")
SKILLS_REFERENCE_PATH = os.path.join(DATA_DIR, "skills_reference.csv")
LEARNING_RESOURCES_PATH = os.path.join(DATA_DIR, "learning_resources.csv")

# If jobs are small, score all jobs directly.
# If jobs are large, use TF-IDF first then Cross-Encoder reranking.
MAX_JOBS_FOR_DIRECT_CROSS_ENCODER = 200
TOP_N_FOR_RERANK = 150

TOP_FIT_NOW = 10
TOP_ASPIRATION = 10
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


def sigmoid(x: float) -> float:
    try:
        return float(1 / (1 + math.exp(-x)))
    except OverflowError:
        return 0.0 if x < 0 else 1.0


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


@lru_cache(maxsize=1)
def load_learning_resources() -> pd.DataFrame:
    if not os.path.exists(LEARNING_RESOURCES_PATH):
        return pd.DataFrame()

    resources = safe_read_csv(LEARNING_RESOURCES_PATH)
    rename_map = {
        "course_or_certification_title": "title",
        "course_or_certification_description": "description",
        "offered_by_provider": "provider",
        "external_course_or_certification_link": "url",
        "skill_ids": "matched_gap_skill_ids",
        "mapped_skill_names": "skills_youll_gain",
    }
    for source_column, target_column in rename_map.items():
        if source_column in resources.columns and target_column not in resources.columns:
            resources[target_column] = resources[source_column]

    defaults = {
        "title": "",
        "description": "",
        "provider": "",
        "provider_type": "",
        "resource_type": "",
        "level": "",
        "language": "",
        "delivery_mode": "",
        "cost_type": "",
        "estimated_duration": "",
        "matched_gap_skill_ids": "",
        "skills_youll_gain": "",
        "url": "",
        "category_name": "",
    }
    for column, default in defaults.items():
        if column not in resources.columns:
            resources[column] = default

    return resources


def load_cross_encoder() -> "CrossEncoder":
    return get_cross_encoder()


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


def build_equivalent_skill_forms(skill_name: str, alias_lookup: Dict[str, set[str]]) -> set[str]:
    normalized = normalize_for_match(skill_name)
    if not normalized:
        return set()

    forms = {normalized}
    forms.update(alias_lookup.get(normalized, set()))

    tokens = skill_tokens(skill_name)
    if len(tokens) > 1:
        forms.add(" ".join(tokens))
        for token in tokens:
            if len(token) >= 4:
                forms.add(token)

    return {form for form in forms if form}


@lru_cache(maxsize=1)
def get_skill_equivalence_lookup() -> Dict[str, set[str]]:
    alias_index, _ = get_skill_alias_index_cached()
    grouped_by_skill: Dict[str, set[str]] = {}

    for item in alias_index:
        canonical = normalize_for_match(item.get("skill_name", ""))
        alias_norm = normalize_for_match(item.get("alias", ""))
        if not canonical or not alias_norm:
            continue
        grouped_by_skill.setdefault(canonical, set()).add(alias_norm)

    equivalence_lookup: Dict[str, set[str]] = {}
    for canonical, aliases in grouped_by_skill.items():
        expanded = set(aliases)
        for alias in list(aliases):
            tokens = skill_tokens(alias)
            if len(tokens) > 1:
                expanded.add(" ".join(tokens))
                for token in tokens:
                    if len(token) >= 4:
                        expanded.add(token)
        equivalence_lookup[canonical] = expanded

    return equivalence_lookup


# ============================================================
# RULE-BASED SCORING
# ============================================================

def compute_skill_coverage(candidate_skills: List[str], required_skills: List[str]) -> Dict[str, Any]:
    alias_lookup = get_skill_equivalence_lookup()

    candidate_norm_map = {}
    for skill in candidate_skills:
        cleaned = clean_text(skill)
        normalized = normalize_for_match(cleaned)
        if not cleaned or not normalized:
            continue
        candidate_norm_map[normalized] = cleaned

    required_norm_map = {}
    for skill in required_skills:
        cleaned = clean_text(skill)
        normalized = normalize_for_match(cleaned)
        if not cleaned or not normalized:
            continue
        required_norm_map[normalized] = cleaned

    candidate_set = set(candidate_norm_map.keys())
    required_set = set(required_norm_map.keys())

    if not required_set:
        return {
            "skill_coverage": 0.0,
            "matched_skills": [],
            "missing_skills": [],
        }

    matched_skills: List[str] = []
    missing_skills: List[str] = []

    for required_norm, required_label in required_norm_map.items():
        required_forms = build_equivalent_skill_forms(required_label, alias_lookup)
        is_match = False

        for candidate_norm, candidate_label in candidate_norm_map.items():
            candidate_forms = build_equivalent_skill_forms(candidate_label, alias_lookup)
            required_single = next(iter(required_forms)) if len(required_forms) == 1 else ""
            candidate_single = next(iter(candidate_forms)) if len(candidate_forms) == 1 else ""

            if required_norm == candidate_norm:
                is_match = True
                break

            if required_forms.intersection(candidate_forms):
                is_match = True
                break

            if (
                required_single
                and candidate_single
                and required_single in candidate_single
                and len(required_single) >= 5
            ):
                is_match = True
                break

            if (
                required_single
                and candidate_single
                and candidate_single in required_single
                and len(candidate_single) >= 5
            ):
                is_match = True
                break

        if is_match:
            matched_skills.append(required_label)
        else:
            missing_skills.append(required_label)

    coverage = len(matched_skills) / len(required_set)

    return {
        "skill_coverage": round(float(coverage), 4),
        "matched_skills": sorted(dict.fromkeys(matched_skills)),
        "missing_skills": sorted(dict.fromkeys(missing_skills)),
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

    if preferred_industry and preferred_industry not in ["not sure", "any", "flexible"]:
        total += 0.25
        if preferred_industry in job_corpus:
            score += 0.25
        else:
            score += 0.25 * token_overlap(preferred_industry, job_corpus)

    if target_role and target_role not in ["not sure", "any"]:
        total += 0.30
        if target_role in job_title or target_role in job_description:
            score += 0.30
        else:
            score += 0.30 * token_overlap(target_role, f"{job_title} {job_description}")

    if role_level and role_level not in ["not sure", "any"]:
        total += 0.15
        if role_level in experience:
            score += 0.15

    if work_setup and work_setup not in ["not sure", "any", "flexible"]:
        total += 0.20
        if work_setup in work_type:
            score += 0.20

    if salary_expectation and salary_expectation not in ["not sure", "any"]:
        total += 0.10
        if salary_expectation in salary:
            score += 0.10

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


def compute_learning_readiness(missing_skills: List[str]) -> float:
    resources = load_learning_resources()

    if resources.empty or not missing_skills:
        return 0.0

    resource_text_columns = [
        col for col in resources.columns
        if any(keyword in col.lower() for keyword in ["skill", "title", "description", "course"])
    ]

    if not resource_text_columns:
        return 0.0

    combined_resource_text = (
        resources[resource_text_columns]
        .astype(str)
        .agg(" ".join, axis=1)
        .apply(normalize_for_match)
        .tolist()
    )

    missing_norm = [normalize_for_match(skill) for skill in missing_skills]

    covered_count = 0

    for skill in missing_norm:
        if any(skill in resource_text for resource_text in combined_resource_text):
            covered_count += 1

    return round(covered_count / len(missing_norm), 4)


def build_candidate_profile_text(
    resume_text: str,
    extracted_skills: List[Dict[str, Any]],
    preferences: Dict[str, Any],
) -> str:
    skill_names = [clean_text(skill["skill_name"]) for skill in extracted_skills if clean_text(skill.get("skill_name", ""))]
    resume_excerpt = clean_text(resume_text[:1200])

    profile_sections = []

    if skill_names:
        profile_sections.append(
            "Candidate confirmed and extracted skills: " + ", ".join(skill_names)
        )

    profile_sections.append(
        "Candidate target preferences: "
        f"Industry {preferences.get('industry', '')}; "
        f"Target role {preferences.get('target_role', '')}; "
        f"Role level {preferences.get('role_level', '')}; "
        f"Work setup {preferences.get('work_setup', '')}; "
        f"Salary expectation {preferences.get('salary_expectation', '')}; "
        f"Skill to develop {preferences.get('skill_to_develop', '')}."
    )

    if resume_excerpt:
        profile_sections.append("Resume evidence summary: " + resume_excerpt)

    return clean_text(" ".join(profile_sections))


# ============================================================
# RETRIEVAL AND CROSS-ENCODER SCORING
# ============================================================

def tfidf_prefilter(candidate_profile_text: str, jobs_df: pd.DataFrame, top_n: int) -> pd.DataFrame:
    if len(jobs_df) <= top_n:
        return jobs_df.copy()

    documents = [candidate_profile_text] + jobs_df["job_text"].astype(str).tolist()

    vectorizer = TfidfVectorizer(
        lowercase=True,
        stop_words="english",
        max_features=50000,
        ngram_range=(1, 2),
    )

    matrix = vectorizer.fit_transform(documents)

    candidate_vector = matrix[0]
    job_vectors = matrix[1:]

    scores = cosine_similarity(candidate_vector, job_vectors).flatten()

    temp = jobs_df.copy()
    temp["tfidf_prefilter_score"] = scores

    temp = temp.sort_values("tfidf_prefilter_score", ascending=False).head(top_n)

    return temp.reset_index(drop=True)


def merge_candidate_job_pools(*job_pools: pd.DataFrame) -> pd.DataFrame:
    non_empty_pools = [pool for pool in job_pools if pool is not None and not pool.empty]
    if not non_empty_pools:
        return pd.DataFrame()

    merged = pd.concat(non_empty_pools, ignore_index=True)

    if "job_id" in merged.columns and merged["job_id"].astype(str).str.strip().any():
        merged = merged.drop_duplicates(subset=["job_id"], keep="first")
    elif "job_title" in merged.columns:
        merged = merged.drop_duplicates(subset=["job_title"], keep="first")
    else:
        merged = merged.drop_duplicates(keep="first")

    return merged.reset_index(drop=True)


def cross_encoder_score_jobs(candidate_profile_text: str, jobs_df: pd.DataFrame) -> pd.DataFrame:
    scoring_method = "cross_encoder_bert"
    try:
        model = load_cross_encoder()

        pairs = [
            [candidate_profile_text, job_text]
            for job_text in jobs_df["job_text"].astype(str).tolist()
        ]

        raw_scores = model.predict(
            pairs,
            batch_size=16,
            show_progress_bar=False,
        )

        raw_scores = np.asarray(raw_scores, dtype=float)
        if raw_scores.size == 0:
            normalized_scores = raw_scores
        else:
            min_score = float(np.min(raw_scores))
            max_score = float(np.max(raw_scores))
            if max_score - min_score > 1e-9:
                normalized_scores = (raw_scores - min_score) / (max_score - min_score)
            else:
                normalized_scores = np.asarray([sigmoid(float(x)) for x in raw_scores], dtype=float)
    except Exception as exc:
        # Keep local/dev matching usable when the Cross-Encoder model is unavailable.
        # Production should cache/install CROSS_ENCODER_MODEL_NAME so this remains BERT-backed.
        scoring_method = "tfidf_semantic_fallback"
        documents = [candidate_profile_text] + jobs_df["job_text"].astype(str).tolist()
        vectorizer = TfidfVectorizer(
            lowercase=True,
            stop_words="english",
            max_features=50000,
            ngram_range=(1, 2),
        )
        matrix = vectorizer.fit_transform(documents)
        raw_scores = cosine_similarity(matrix[0], matrix[1:]).flatten()
        if raw_scores.size == 0:
            normalized_scores = raw_scores
        else:
            max_score = float(np.max(raw_scores))
            normalized_scores = raw_scores / max_score if max_score > 1e-9 else raw_scores

    scored = jobs_df.copy()
    scored["semantic_score_raw"] = raw_scores
    scored["semantic_score"] = [round(float(x), 4) for x in normalized_scores]
    scored["semantic_scoring_method"] = scoring_method

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
    preferences = preferences or {}
    confirmed_skills = confirmed_skills or []

    resume_text = extract_resume_text(file_bytes, filename)

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

    if confirmed_skill_records:
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

    candidate_skill_names = list(dict.fromkeys([skill["skill_name"] for skill in final_skill_records if clean_text(skill.get("skill_name", ""))]))

    resume_evidence_text = build_candidate_profile_text(
        resume_text=resume_text,
        extracted_skills=[{"skill_name": name} for name in candidate_skill_names],
        preferences={},
    )
    aspiration_retrieval_text = build_candidate_profile_text(
        resume_text=resume_text,
        extracted_skills=[{"skill_name": name} for name in candidate_skill_names],
        preferences=preferences,
    )

    jobs_df = load_reference_jobs()

    if len(jobs_df) > MAX_JOBS_FOR_DIRECT_CROSS_ENCODER:
        fit_now_candidate_jobs = tfidf_prefilter(
            candidate_profile_text=resume_evidence_text,
            jobs_df=jobs_df,
            top_n=TOP_N_FOR_RERANK,
        )
        aspiration_candidate_jobs = tfidf_prefilter(
            candidate_profile_text=aspiration_retrieval_text,
            jobs_df=jobs_df,
            top_n=TOP_N_FOR_RERANK,
        )
        candidate_jobs = merge_candidate_job_pools(
            fit_now_candidate_jobs,
            aspiration_candidate_jobs,
        )
    else:
        candidate_jobs = jobs_df.copy()

    scored_jobs = cross_encoder_score_jobs(resume_evidence_text, candidate_jobs)

    results = []

    for _, row in scored_jobs.iterrows():
        job = row.to_dict()

        required_skills = split_skill_list(job.get("required_skills_for_eval", ""))

        skill_result = compute_skill_coverage(
            candidate_skills=candidate_skill_names,
            required_skills=required_skills,
        )

        preference_alignment = compute_preference_alignment(job, preferences)

        evidence_strength = compute_evidence_strength(
            resume_text=resume_text,
            matched_skills=skill_result["matched_skills"],
        )

        learning_readiness = compute_learning_readiness(skill_result["missing_skills"])

        semantic_score = float(job.get("semantic_score", 0.0))
        skill_coverage = float(skill_result["skill_coverage"])

        fit_now_score = (
            0.55 * semantic_score +
            0.25 * skill_coverage +
            0.15 * evidence_strength +
            0.05 * preference_alignment
        )

        aspiration_score = (
            0.60 * preference_alignment +
            0.20 * semantic_score +
            0.10 * skill_coverage +
            0.10 * learning_readiness
        )

        missing_count = len(skill_result["missing_skills"])

        has_meaningful_skill_match = len(skill_result["matched_skills"]) >= 1
        is_fit_now = (
            has_meaningful_skill_match
            and skill_coverage >= 0.25
            and missing_count <= 8
            and (
                semantic_score >= 0.35
                or skill_coverage >= 0.50
                or evidence_strength >= 0.50
            )
        )

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
            "job_category": job.get("job_category", ""),
            "job_subcategory": job.get("job_subcategory", ""),
            "category_id": job.get("category_id_norm", ""),
            "location": job.get("location", ""),
            "work_type": job.get("work_type", ""),
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
            "semantic_scoring_method": job.get("semantic_scoring_method", "cross_encoder_bert"),
            "matched_skills": skill_result["matched_skills"],
            "missing_skills": skill_result["missing_skills"],
            "explanation": explanation,
        })

    results_df = pd.DataFrame(results)

    if results_df.empty:
        fit_now_matches = []
        aspiration_matches = []
    else:
        if not (results_df["match_type"] == "Fit-Now").any():
            results_df["fit_now_candidate_score"] = (
                0.55 * results_df["semantic_score"].astype(float)
                + 0.25 * results_df["skill_coverage"].astype(float)
                + 0.15 * results_df["evidence_strength"].astype(float)
                + 0.05 * results_df["preference_alignment"].astype(float)
            )
            matched_skill_counts = results_df["matched_skills"].apply(
                lambda skills: len(skills) if isinstance(skills, list) else 0
            )
            fallback_mask = (
                (matched_skill_counts >= 1)
                | (results_df["semantic_score"] >= 0.10)
                | (results_df["evidence_strength"] >= 0.35)
            )
            fallback_pool = results_df[fallback_mask]
            if fallback_pool.empty:
                fallback_pool = results_df

            fallback_indices = (
                fallback_pool
                .sort_values(
                    ["fit_now_candidate_score", "skill_coverage", "semantic_score", "evidence_strength"],
                    ascending=False,
                )
                .head(min(5, TOP_FIT_NOW))
                .index
            )
            if len(fallback_indices) > 0:
                results_df.loc[fallback_indices, "match_type"] = "Fit-Now"
                results_df.loc[fallback_indices, "final_score"] = results_df.loc[fallback_indices].apply(
                    lambda row: round(
                        float(
                            0.55 * row["semantic_score"]
                            + 0.25 * row["skill_coverage"]
                            + 0.15 * row["evidence_strength"]
                            + 0.05 * row["preference_alignment"]
                        ),
                        4,
                    ),
                    axis=1,
                )
                results_df.loc[fallback_indices, "match_percentage"] = (results_df.loc[fallback_indices, "final_score"] * 100).round(2)
                results_df.loc[fallback_indices, "explanation"] = results_df.loc[fallback_indices].apply(
                    lambda row: generate_match_explanation(
                        job_title=str(row.get("job_title", "")),
                        match_type="Fit-Now",
                        matched_skills=row.get("matched_skills", []) if isinstance(row.get("matched_skills", []), list) else [],
                        missing_skills=row.get("missing_skills", []) if isinstance(row.get("missing_skills", []), list) else [],
                        skill_coverage=float(row.get("skill_coverage", 0.0)),
                        preference_alignment=float(row.get("preference_alignment", 0.0)),
                    ),
                    axis=1,
                )

        fit_now_pool = results_df[
            (results_df["match_type"] == "Fit-Now")
            & (results_df["final_score"].astype(float) > 0.01)
        ]
        aspiration_pool = results_df[
            (results_df["match_type"] == "Aspiration")
            & (results_df["final_score"].astype(float) > 0.01)
        ]

        all_fit_now_matches = (
            fit_now_pool
            .sort_values("final_score", ascending=False)
            .to_dict(orient="records")
        )

        all_aspiration_matches = (
            aspiration_pool
            .sort_values("final_score", ascending=False)
            .to_dict(orient="records")
        )
        fit_now_matches = all_fit_now_matches[:TOP_FIT_NOW]
        aspiration_matches = all_aspiration_matches[:TOP_ASPIRATION]

    if results_df.empty:
        all_fit_now_matches = []
        all_aspiration_matches = []

    prioritized_gaps = prioritize_skill_gaps(fit_now_matches + aspiration_matches)
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

    return {
        "filename": filename,
        "resume_text_preview": resume_text[:500],
        "resume_text_for_matching": resume_evidence_text,
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
        "model_used": "Pre-trained Cross-Encoder BERT semantic scoring with rule-based skill coverage and preference alignment",
        "debug_summary": {
            "extracted_skill_count": len(candidate_skill_names),
            "extracted_skill_names": candidate_skill_names,
            "total_jobs_loaded": int(len(jobs_df)),
            "total_jobs_scored": int(len(scored_jobs)),
            "fit_now_count": len(fit_now_matches),
            "aspiration_count": len(aspiration_matches),
            "top_10_scores": top_10_scores,
        },
        "metadata": {
            "jobs_source": get_jobs_source(),
            "learning_resources_source": get_learning_resources_source(),
            "total_jobs_scored": int(len(scored_jobs)),
        },
    }


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
