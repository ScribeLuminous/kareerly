# backend/app/services/matching_service.py

import io
import os
import re
import hashlib
import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, List, Any, Tuple, Optional

import numpy as np
import pandas as pd

from .learning_recommender import (
    get_learning_resources_source,
    recommend_learning_resources_for_matches,
    load_learning_resources as load_reviewed_learning_resources,
    resource_is_reviewed,
    provider_url,
    split_ids,
)
from .bi_encoder_service import MODEL_ID, MatchingModelUnavailable, build_model_input, get_bi_encoder, load_precomputed_job_vectors, score_jobs
from .match_scoring import (
    ASPIRATION,
    FIT_NOW,
    LOW_MATCH,
    MatchThresholds,
    SkillEvidence,
    match_reason,
    score_match,
)
from .resume_analyzer import extract_resume_skills, prepare_resume_text, resume_text_from_upload, split_resume_sections
from .resume_evidence import CandidateEvidence, candidate_model_inputs
from .resume_parser import (
    SUPPORTED_RESUME_EXTENSIONS,
    ResumeFileError,
    extract_docx_document,
    extract_pdf_document,
    resume_extension,
)
from .skill_extractor import SkillExtractor
from .skill_variants import any_case_variants, exact_case_skill_ids, load_skill_variants, merge_variants_into_rows
from .supabase_jobs import load_internal_jobs_dataframe
from . import taxonomy_additions
from ..learning.ranking_model import BASELINE_VERSION, active_ranker, rank_category

# ============================================================
# CONFIG
# ============================================================

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(BASE_DIR, "data")

REFERENCE_JOBS_PATH = os.path.join(DATA_DIR, "reference_jobs.csv")
SKILLS_REFERENCE_PATH = os.path.join(DATA_DIR, "skills_reference.csv")
CATEGORY_REFERENCE_PATH = os.path.join(DATA_DIR, "category_reference.csv")
LEARNING_RESOURCES_PATH = os.path.join(DATA_DIR, "learning_resources.csv")
SKILL_EVIDENCE_RELATIONS_PATH = os.path.join(DATA_DIR, "skill_evidence_relations.csv")

TOP_FIT_NOW = 10
TOP_ASPIRATION = 10
# The closest_matches lists stay in the response, always empty, for older
# clients: every related job now qualifies as Aspiration on its own merits,
# so no job is promoted into a separate list to fill an empty Fit-Now list.
CLOSEST_MATCH = "Closest Match"
# Skill gaps listed in a report; total_skill_gap_count says how many there are in all.
MAX_PRIORITIZED_GAPS = 8
# Matches whose missing skills get learning resources (the dashboard shows up to 10 per type).
LEARNING_MATCHES_PER_TYPE = 10
logger = logging.getLogger(__name__)
MAX_CONFIRMED_SKILLS = 20
JOBS_SOURCE = "reference_jobs.csv"
# Reloading every job from Supabase dominated report latency. New or edited
# employer posts appear once the cache expires or clear_reference_jobs_cache()
# is called; the bi-encoder vector cache keys on job text, so it follows along.
JOBS_CACHE_SECONDS = float(os.getenv("KAREERLY_JOBS_CACHE_SECONDS", "300"))
_jobs_cache_lock = threading.Lock()
_jobs_cache: Dict[str, Any] = {"jobs": None, "source": JOBS_SOURCE, "loaded_at": 0.0}

# Fit-Now / Aspiration thresholds and score weights live in match_scoring.py.

# Frontend career-area values are stable slugs. These mappings keep the
# taxonomy/category references on the backend while supporting the expanded
# K01-K24 job catalogue category labels.
CAREER_AREA_JOB_CATEGORIES = {
    "technology-data": {
        "software and web development",
        "data, analytics, and artificial intelligence",
        "it infrastructure and cybersecurity",
    },
    "business-office": {
        "finance and accounting",
        "office administration and records",
        "human resources and project management",
    },
    "sales-marketing-customer-service": {
        "sales and purchasing",
        "marketing and public relations",
        "customer service and retail",
    },
    "communications-creative-media": {
        "writing, language, and communications",
        "design, media, and performing arts",
    },
    "education-training": {"education and training"},
    "healthcare-wellness": {"healthcare and clinical services", "caregiving and wellness"},
    "community-social-services": {"social and community services"},
    "engineering-architecture": {"engineering and architecture"},
    "construction-maintenance": {"construction and skilled trades"},
    "manufacturing-logistics-transport": {
        "logistics, transport, and warehousing",
        "manufacturing and quality operations",
    },
    "hospitality-tourism-food-services": {"hospitality and tourism", "food service and personal care"},
    "agriculture-environment": {"agriculture, forestry, fishery, and environment"},
    "government-legal-security": {
        "public administration and government",
        "legal, security, and protective services",
    },
}

# Step 3 labels, so a preference saved as its label (the dashboard stores
# labels) still resolves to its area.
CAREER_AREA_LABELS = {
    "technology-data": "Technology & Data",
    "business-office": "Business & Office",
    "sales-marketing-customer-service": "Sales, Marketing & Customer Service",
    "communications-creative-media": "Communications & Creative Media",
    "education-training": "Education & Training",
    "healthcare-wellness": "Healthcare & Wellness",
    "community-social-services": "Community & Social Services",
    "engineering-architecture": "Engineering & Architecture",
    "construction-maintenance": "Construction & Maintenance",
    "manufacturing-logistics-transport": "Manufacturing, Logistics & Transport",
    "hospitality-tourism-food-services": "Hospitality, Tourism & Food Services",
    "agriculture-environment": "Agriculture & Environment",
    "government-legal-security": "Government, Legal & Security",
}

# Broad areas offered before the 13 above. Saved preferences keep them, and
# they still cover exactly the job categories they covered then.
LEGACY_CAREER_AREAS = {
    "education-health-community": ("education-training", "healthcare-wellness", "community-social-services"),
    "engineering-trades-operations": (
        "engineering-architecture",
        "construction-maintenance",
        "manufacturing-logistics-transport",
        "hospitality-tourism-food-services",
        "agriculture-environment",
    ),
}
LEGACY_CAREER_AREA_LABELS = {
    "education-health-community": "Education, Health & Community",
    "engineering-trades-operations": "Engineering, Trades & Operations",
}

CAREER_AREA_ALIASES = {
    "technology data business finance": "technology-data",
    "tech business finance": "technology-data",
    "business finance and office administration": "business-office",
    "sales marketing customer relations": "sales-marketing-customer-service",
    "creative media and communications": "communications-creative-media",
    "education healthcare hospitality and community services": "education-health-community",
    "engineering manufacturing agriculture logistics and field operations": "engineering-trades-operations",
    "public service legal protective services and other": "government-legal-security",
}


def _career_area_label_key(value: Any) -> str:
    """A slug or label without punctuation or "and": "Engineering, Trades & Operations" -> "engineering trades operations"."""
    words = re.findall(r"[a-z0-9]+", clean_text(value).lower())
    return " ".join(word for word in words if word != "and")


@lru_cache(maxsize=1)
def _career_area_keys() -> Dict[str, str]:
    keys = {}
    for slug, label in [*CAREER_AREA_LABELS.items(), *LEGACY_CAREER_AREA_LABELS.items()]:
        keys[_career_area_label_key(slug)] = slug
        keys[_career_area_label_key(label)] = slug
    for alias, slug in CAREER_AREA_ALIASES.items():
        keys[_career_area_label_key(alias)] = slug
    return keys


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


def normalize_for_match(value: Any) -> str:
    text = clean_text(value).lower()
    text = re.sub(r"[^a-z0-9+#.\s/-]", " ", text)
    text = re.sub(r"\s+", " ", text)
    # "E-mail" and "E mail" are "email", as in resume extraction.
    text = re.sub(r"\be[\s-]mail", "email", text)
    return text.strip()


def normalize_category_id(value: Any) -> str:
    value = "" if pd.isna(value) else str(value).strip().upper()

    match = re.search(r"K\s*0?(\d{1,2})", value)
    if match:
        number = int(match.group(1))
        if 1 <= number <= 24:
            return f"K{number:02d}"

    if value.isdigit():
        number = int(value)
        if 1 <= number <= 24:
            return f"K{number:02d}"

    return value


def normalize_career_area(value: Any) -> str:
    """The Step 3 career-area slug for a slug or label, "" when unknown. Legacy slugs are kept."""
    return _career_area_keys().get(_career_area_label_key(value), "")


def preferred_career_areas(value: Any) -> frozenset:
    """The current career areas a Step 3 answer covers: one, or several for a legacy broad area."""
    area = normalize_career_area(value)
    return frozenset(LEGACY_CAREER_AREAS.get(area, (area,) if area else ()))


@lru_cache(maxsize=1)
def _career_area_by_category_name() -> Dict[str, str]:
    # Keyed by the normalized name: normalize_for_match drops the commas that
    # names such as "Data, Analytics, and Artificial Intelligence" contain.
    return {
        normalize_for_match(category): area
        for area, categories in CAREER_AREA_JOB_CATEGORIES.items()
        for category in categories
    }


def _area_for_category_name(value: Any) -> str:
    return _career_area_by_category_name().get(normalize_for_match(value), "")


@lru_cache(maxsize=1)
def career_area_by_category_id() -> Dict[str, str]:
    """K01-K24 category codes mapped to the seven Step 3 career areas."""
    areas: Dict[str, str] = {}
    for _, row in safe_read_csv(CATEGORY_REFERENCE_PATH).iterrows():
        area = _area_for_category_name(row.get("category_name", ""))
        if area:
            areas[normalize_category_id(row.get("category_id", ""))] = area
    return areas


def job_career_area(job: Dict[str, Any]) -> str:
    """The Step 3 career area a job belongs to, or "" when it cannot be told."""
    category = job.get("job_category", "")
    area = _area_for_category_name(category) or normalize_career_area(category)
    # A legacy broad area cannot tell which current area the job belongs to.
    if area in LEGACY_CAREER_AREAS:
        area = ""
    if area:
        return area
    category_id = normalize_category_id(job.get("category_id_norm") or job.get("category_id") or "")
    return career_area_by_category_id().get(category_id, "")


# ============================================================
# RESUME FILE READING
# ============================================================

def extract_text_from_pdf(file_bytes: bytes) -> str:
    return prepare_resume_text(extract_pdf_document(file_bytes).text)


def extract_text_from_docx(file_bytes: bytes) -> str:
    # The same reader as the Step 1 analyzer, so both routes see identical text.
    return prepare_resume_text(extract_docx_document(file_bytes).text)


def extract_resume_text(file_bytes: bytes, filename: str) -> str:
    """Text of an uploaded resume, read and prepared exactly as Step 1 reads it.

    The same function (resume_analyzer.resume_text_from_upload) produces the
    Step 1 text, so a report built from the file and one built from the Step 1
    text see the same words, tables, text boxes and OCR output included.
    """
    if resume_extension(filename) not in SUPPORTED_RESUME_EXTENSIONS:
        raise ValueError("Unsupported file format. Please upload a readable PDF, DOCX or DOC file.")

    extractor = current_skill_extractor()
    try:
        text, extraction = resume_text_from_upload(file_bytes, filename, extractor)
    except ResumeFileError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Could not read the resume file: {exc}") from exc

    if len(clean_text(text)) < 50:
        detail = " ".join(extraction.warnings)
        raise ValueError(
            detail or "The resume text is too short or unreadable. Please upload a clearer PDF, DOCX or DOC resume."
        )

    return text


_resume_text_cache: "OrderedDict[Tuple[str, str], str]" = OrderedDict()
_resume_text_cache_lock = threading.Lock()


def extract_resume_text_cached(file_bytes: bytes, filename: str) -> str:
    """Reuse the text of a file already parsed, so repeat reports skip PDF/DOCX parsing."""
    key = (hashlib.sha256(file_bytes).hexdigest(), filename.lower().rsplit(".", 1)[-1])
    with _resume_text_cache_lock:
        if key in _resume_text_cache:
            _resume_text_cache.move_to_end(key)
            return _resume_text_cache[key]
    text = extract_resume_text(file_bytes, filename)
    with _resume_text_cache_lock:
        _resume_text_cache[key] = text
        while len(_resume_text_cache) > 32:
            _resume_text_cache.popitem(last=False)
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
        # pandas 3 reads text as the "str" dtype rather than "object"; both
        # must be cleaned, or blank cells stay NaN and titles keep line breaks.
        if pd.api.types.is_object_dtype(df[col]) or pd.api.types.is_string_dtype(df[col]):
            df[col] = df[col].fillna("").apply(clean_text).astype(object)

    return df


@lru_cache(maxsize=1)
def _load_base_skills_reference() -> pd.DataFrame:
    return safe_read_csv(SKILLS_REFERENCE_PATH)


@lru_cache(maxsize=1)
def load_skills_reference() -> pd.DataFrame:
    """skills_reference.csv plus approved taxonomy additions (taxonomy_additions.py)."""
    base = _load_base_skills_reference()
    additions = _taxonomy_state["additions"]
    if additions:
        rows = taxonomy_additions.merge_reference_rows(base.to_dict(orient="records"), additions)
    else:
        rows = base.to_dict(orient="records")
    # Reviewed spellings ("Zen Desk", "GWorkspace", "O365"); see skill_variants.py.
    skills = pd.DataFrame(merge_variants_into_rows(rows)).fillna("")
    if taxonomy_additions.APPROVED_ALIASES_FIELD not in skills.columns:
        skills[taxonomy_additions.APPROVED_ALIASES_FIELD] = ""

    if "category_id" in skills.columns:
        skills["category_id_norm"] = skills["category_id"].apply(normalize_category_id)
    else:
        skills["category_id_norm"] = ""

    return skills


def load_reference_jobs() -> pd.DataFrame:
    global JOBS_SOURCE

    with _jobs_cache_lock:
        cached = _jobs_cache["jobs"]
        if cached is None or time.monotonic() - _jobs_cache["loaded_at"] >= JOBS_CACHE_SECONDS:
            cached = _load_reference_jobs_uncached()
            _jobs_cache.update(jobs=cached, source=JOBS_SOURCE, loaded_at=time.monotonic())
        JOBS_SOURCE = _jobs_cache["source"]
    # Callers add columns to the frame, so never hand out the cached object itself.
    return cached.copy()


def clear_reference_jobs_cache() -> None:
    with _jobs_cache_lock:
        _jobs_cache.update(jobs=None, loaded_at=0.0)


def _load_reference_jobs_uncached() -> pd.DataFrame:
    global JOBS_SOURCE

    supabase_jobs = load_internal_jobs_dataframe()
    if not supabase_jobs.empty:
        jobs = supabase_jobs.copy()
        JOBS_SOURCE = "supabase_internal_and_employer_jobs"
    else:
        jobs = safe_read_csv(REFERENCE_JOBS_PATH)
        JOBS_SOURCE = "reference_jobs.csv"
    return prepare_jobs(jobs)


def prepare_jobs(jobs: pd.DataFrame) -> pd.DataFrame:
    """Validate a raw job table and add the columns matching reads."""
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
        taxonomy_additions.APPROVED_ALIASES_FIELD,
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
    return SkillExtractor(SKILLS_REFERENCE_PATH, extra_rows=_taxonomy_state["additions"])


# Approved additions currently merged into the cached taxonomy. When the approved
# set changes, every cache derived from the taxonomy is rebuilt on next use.
_taxonomy_state: Dict[str, Any] = {"fingerprint": None, "additions": []}
_taxonomy_lock = threading.Lock()


def ensure_taxonomy_current() -> None:
    additions = taxonomy_additions.active_additions()
    fingerprint = taxonomy_additions.fingerprint(additions)
    with _taxonomy_lock:
        if fingerprint == _taxonomy_state["fingerprint"]:
            return
        _taxonomy_state.update(fingerprint=fingerprint, additions=additions)
        for cache in (load_skills_reference, get_skill_alias_index_cached, get_weighted_skill_extractor,
                canonical_skill_lookup, skill_id_equivalents, get_skill_labels_by_id, get_skill_categories_by_id):
            cache.cache_clear()
    if additions:
        logger.info("Skill taxonomy includes %d approved additions", len(additions))


def current_skill_extractor() -> SkillExtractor:
    """The weighted extractor over the current taxonomy, for search and extraction."""
    ensure_taxonomy_current()
    return get_weighted_skill_extractor()


def extract_skills_from_text(text: str, max_skills: Optional[int] = 30) -> List[Dict[str, Any]]:
    """Skills with evidence in the text, ranked as Step 2 ranks them; ``max_skills=None`` returns all."""
    weighted_skills = extract_resume_skills(text, get_weighted_skill_extractor(), limit=max_skills)
    if weighted_skills:
        return weighted_skills
    max_skills = max_skills or 10_000

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

# Rows added by hand with curated spellings ("MS Excel", "Adobe Photoshop") in
# related_skills. Unlike the imported ESCO labels, every one of them is a name
# people use for exactly that skill, so they identify it like the label does.
CURATED_SKILL_SOURCE = "workplace_tools_expansion_2026_09"


def _curated_aliases(row: Any) -> List[str]:
    if clean_text(row.get("source_note", "")) != CURATED_SKILL_SOURCE:
        return []
    return split_skill_list(row.get("related_skills", ""))


# "Python Programming", "Java (computer programming)": the label of a
# programming language skill is the language's name plus a generic suffix.
PROGRAMMING_LANGUAGE_LABEL = re.compile(r"^(?P<name>.+?)\s*(?:\(computer programming\)|programming)$", re.IGNORECASE)
# Only reviewed rows: auto-generated ones include languages named with
# everyday words ("Scratch", "Assembly", "Swift") that a resume uses otherwise.
REVIEWED_MAPPING_STATUSES = {"reviewed", "mapped"}


def _programming_language_names(row: Any) -> List[str]:
    """The bare language name ("Python") that resumes use for a reviewed language skill.

    Step 1 extraction finds "Python" as Python Programming, so gap calculation
    must accept the same name or a resume listing Python reports it missing
    whenever the skill falls outside the twenty confirmed in Step 2.
    """
    if clean_text(row.get("mapping_status", "")) not in REVIEWED_MAPPING_STATUSES:
        return []
    names = []
    for value in (row.get("skill_name", ""), row.get("esco_preferred_label", "")):
        match = PROGRAMMING_LANGUAGE_LABEL.match(clean_text(value))
        if match and len(match.group("name")) >= 3:
            names.append(match.group("name"))
    return names


@lru_cache(maxsize=1)
def skill_evidence_phrases() -> Dict[str, List[str]]:
    """Names that show a taxonomy skill in resume text: its label, curated spellings
    and, for a reviewed programming language, the language name alone."""
    phrases: Dict[str, List[str]] = {}
    variants = any_case_variants()
    for _, row in load_skills_reference().iterrows():
        skill_id = clean_text(row.get("skill_id", "")).upper()
        label = clean_text(row.get("skill_name", ""))
        if skill_id and label:
            phrases[skill_id] = list(dict.fromkeys([label, *_curated_aliases(row), *_programming_language_names(row),
                                                    *variants.get(skill_id, [])]))
    return phrases


@lru_cache(maxsize=1)
def related_skill_evidence() -> Dict[str, List[str]]:
    """Resume phrases that show a skill through a reviewed one-way relation.

    Each row of skill_evidence_relations.csv records why the phrase shows the
    skill (a broader practice that always includes it, such as order
    fulfillment including order processing). Relations are never reversed and
    never make two skills interchangeable.
    """
    if not os.path.exists(SKILL_EVIDENCE_RELATIONS_PATH):
        return {}
    relations: Dict[str, List[str]] = {}
    for _, row in safe_read_csv(SKILL_EVIDENCE_RELATIONS_PATH).iterrows():
        skill_id = clean_text(row.get("skill_id", "")).upper()
        phrase = clean_text(row.get("evidence_phrase", ""))
        if skill_id and phrase:
            relations.setdefault(skill_id, []).append(phrase)
    return relations


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
        aliases = [label, *_curated_aliases(row)]
        if clean_text(row.get("mapping_status", "")) == "mapped":
            aliases += [clean_text(row.get("esco_preferred_label", ""))]
            aliases += split_skill_list(row.get("esco_alternative_labels", ""))
        # Aliases approved by a reviewer through skill discovery.
        aliases += split_skill_list(row.get(taxonomy_additions.APPROVED_ALIASES_FIELD, ""))
        for alias in aliases:
            normalized = normalize_for_match(alias)
            if normalized:
                owners.setdefault(normalized, set()).add(skill_id)
    aliases = {alias: next(iter(ids)) for alias, ids in owners.items() if len(ids) == 1}
    # Canonical labels are authoritative even when an imported alias conflicts.
    for skill_id, label in labels.items():
        aliases[normalize_for_match(label)] = skill_id
    # A job requirement is a name on its own, so "CS" or "JS" there names the
    # skill; in resume text these match only in upper case (skill_variants.py).
    for item in load_skill_variants():
        if item.exact_case and item.skill_id in labels:
            aliases.setdefault(normalize_for_match(item.variant), item.skill_id)
    # A multi-word name written as one word ("MSExcel", "GoogleWorkspace").
    joined: Dict[str, set] = {}
    for alias, skill_id in aliases.items():
        compact = _compact(alias)
        if len(re.split(r"[\s/-]+", alias)) > 1 and len(compact) >= 5:
            joined.setdefault(compact, set()).add(skill_id)
    for compact, ids in joined.items():
        if len(ids) == 1:
            aliases.setdefault(compact, next(iter(ids)))
    return labels, aliases


@lru_cache(maxsize=1)
def skill_id_equivalents() -> Dict[str, str]:
    """Map auto-generated duplicate skill IDs onto the reviewed skill they copy.

    The ESCO import created rows such as SK134 "Python (computer programming)"
    for the same ESCO concept as the reviewed SK001 "Python Programming". Two
    IDs are merged only when they share an ESCO URI and one of them is an
    auto-generated review row, so a manual mapping error cannot merge two
    genuinely different skills.
    """
    by_uri: Dict[str, List[Tuple[str, str]]] = {}
    for _, row in load_skills_reference().iterrows():
        uri = clean_text(row.get("esco_skill_uri", ""))
        skill_id = clean_text(row.get("skill_id", "")).upper()
        if uri.startswith("http") and skill_id:
            by_uri.setdefault(uri, []).append((skill_id, clean_text(row.get("mapping_status", ""))))
    equivalents: Dict[str, str] = {}
    for members in by_uri.values():
        primary = [skill_id for skill_id, status in members if status != "auto_generated_review"]
        if len(primary) != 1:
            continue
        for skill_id, status in members:
            if status == "auto_generated_review":
                equivalents[skill_id] = primary[0]
    return equivalents


LEGACY_SKILL_ID = re.compile(r"SK_[A-Z0-9_]+")
TAXONOMY_SKILL_ID = re.compile(r"SK\d+")


def _skill_key(value: str) -> str:
    labels, aliases = canonical_skill_lookup()
    text = clean_text(value)
    if LEGACY_SKILL_ID.fullmatch(text.upper()):
        # Legacy job IDs such as SK_EXCEL have no taxonomy row; compare them by
        # their readable name so a candidate's "Excel" can still satisfy them.
        text = display_skill_name(text.upper(), labels)
    if text.upper() in labels:
        key = text.upper()
    else:
        normalized = normalize_for_match(text)
        # "HubSpot CRM" names the taxonomy skill "HubSpot"; "MS-Excel" and
        # "G-Suite" are "ms excel" and "g suite"; "MSExcel" is looked up joined.
        # The whole name is tried first, so a short one ("CS") is not skipped.
        spaced = re.sub(r"[\s/-]+", " ", normalized).strip()
        candidates = [normalized, *_phrase_variants(normalized), spaced, *_phrase_variants(spaced), _compact(normalized)]
        key = next((aliases[variant] for variant in candidates if variant in aliases), "CUSTOM:" + normalized)
    return skill_id_equivalents().get(key, key)


# Trailing words that only say what kind of product a named tool is: an
# employer asking for "HubSpot CRM" or "Jira software" is asking for HubSpot or
# Jira, and a resume naming the product holds the requirement.
TOOL_QUALIFIER_WORDS = {"crm", "software", "platform", "app", "online"}
# Wording around a skill name in job posts: "Proficiency in Excel",
# "Strong communication skills", "Salesforce experience".
LEADING_QUALIFIERS = (
    "working knowledge of", "hands on experience with", "hands on experience in",
    "experience with", "experience in", "experience using", "knowledge of",
    "proficiency in", "proficiency with", "proficient in", "proficient with",
    "familiarity with", "familiar with", "strong", "excellent",
)
TRAILING_QUALIFIER_WORDS = TOOL_QUALIFIER_WORDS | {"skills", "skill", "experience", "knowledge", "proficiency"}
# Longest run of resume words compared against one requirement without spaces.
MAX_COMPACT_WORDS = 4


def _compact(value: str) -> str:
    return re.sub(r"[^a-z0-9+#]", "", value)


def _phrase_variants(phrase_norm: str) -> List[str]:
    """The phrase, then shorter forms without the wording around the skill name.

    "Proficiency in MS Excel" also reads as "ms excel"; "HubSpot CRM" as
    "hubspot". A qualifier is never the whole name.
    """
    variants = [phrase_norm]
    for lead in LEADING_QUALIFIERS:
        if phrase_norm.startswith(lead + " "):
            variants.append(phrase_norm[len(lead) + 1:])
            break
    words = variants[-1].split()
    while len(words) > 1 and words[-1] in TRAILING_QUALIFIER_WORDS:
        words = words[:-1]
        variants.append(" ".join(words))
    return list(dict.fromkeys(variant for variant in variants if len(variant) >= 3))


@lru_cache(maxsize=8)
def _compact_word_runs(text_norm: str) -> frozenset:
    """Runs of up to MAX_COMPACT_WORDS resume words with the spaces removed.

    Spacing and punctuation differ between spellings of one name ("HelpScout"
    and "Help Scout", "e-commerce" and "ecommerce"). Runs start and end on word
    boundaries, so "Java" still never matches "JavaScript".
    """
    words = [_compact(word) for word in re.split(r"[\s/-]+", text_norm)]
    words = [word for word in words if word]
    return frozenset(
        "".join(words[start:end])
        for start in range(len(words))
        for end in range(start + 1, min(start + MAX_COMPACT_WORDS, len(words)) + 1)
    )


@lru_cache(maxsize=8)
def _compact_tokens(text_norm: str) -> frozenset:
    """Each space-separated resume word with hyphens and slashes removed ("e-commerce" -> "ecommerce")."""
    return frozenset(word for word in (_compact(token) for token in text_norm.split()) if word)


def _phrase_in_text(phrase: str, text_norm: str) -> bool:
    phrase_norm = normalize_for_match(phrase)
    if len(phrase_norm) < 3 or not text_norm:
        return False
    for variant in _phrase_variants(phrase_norm):
        if re.search(r"(?<![a-z0-9+#])" + re.escape(variant) + r"(?![a-z0-9+#])", text_norm):
            return True
        compact = _compact(variant)
        if len(compact) < 5:
            continue
        # A name written as several words ("Help Scout") may appear as one
        # ("HelpScout"), and the reverse for hyphens ("ecommerce"/"e-commerce").
        # A one-word name is never assembled from separate words: "a sales
        # force" is not Salesforce. Words a PDF split inside a skill name are
        # rejoined, with capitalisation checks, when the resume is read.
        if len(re.split(r"[\s/-]+", variant)) > 1:
            if compact in _compact_word_runs(text_norm):
                return True
        elif compact in _compact_tokens(text_norm):
            return True
    return False


def compute_skill_coverage(
    candidate_skills: List[str],
    required_skills: List[str],
    resume_text: str = "",
    excluded_keys: Optional[set] = None,
) -> Dict[str, Any]:
    """Coverage over canonical skill keys, each requirement counted once.

    A requirement can also be met by its name appearing in the resume text:
    Step 2 confirms at most MAX_CONFIRMED_SKILLS skills, and requirements with
    no taxonomy ID (custom names or legacy SK_* IDs) have no confirmed ID that
    could represent them at all. Taxonomy skills are checked by their canonical
    label only, never by the broad imported aliases.

    ``excluded_keys`` are skills the candidate removed in Step 2: they are
    never credited, even when the resume names them, and are reported in
    ``removed_skills`` so a gap can say so instead of "not found".
    """
    labels, _ = canonical_skill_lookup()
    excluded = excluded_keys or set()
    candidates = {_skill_key(value) for value in candidate_skills if clean_text(value)}
    required: Dict[str, str] = {}
    for value in required_skills:
        text = clean_text(value)
        if text and not (TAXONOMY_SKILL_ID.fullmatch(text.upper()) and text.upper() not in labels):
            readable = display_skill_name(text.upper(), labels) if LEGACY_SKILL_ID.fullmatch(text.upper()) else text
            key = _skill_key(text)
            required.setdefault(key, display_skill_name(key, labels, readable))
    # A requirement with no readable name (an ID missing from the taxonomy) can
    # be neither shown nor explained, so it does not count toward coverage either.
    required = {key: name for key, name in required.items() if name}
    text_norm = normalize_for_match(resume_text)
    # Related evidence may come from the resume or from a skill the candidate
    # confirmed by name ("Order Fulfillment" added in Step 2).
    profile_norm = normalize_for_match(" ".join(
        [resume_text, *map(clean_text, candidate_skills), *(display_skill_name(key, labels) for key in candidates)]
    ))
    related_credit: Dict[str, str] = {}
    basis: Dict[str, Dict[str, str]] = {}
    # Upper-case abbreviations ("CS", "CX") are read from the text as written.
    abbreviated = exact_case_skill_ids(resume_text) if resume_text else set()

    def held(key: str) -> bool:
        if key in excluded:
            return False
        if key in candidates:
            basis[required[key]] = {"kind": "held_skill", "key": key}
            return True
        phrases = skill_evidence_phrases().get(key) or [required[key]]
        # A requirement with no taxonomy ID is matched by name, which a held
        # skill can carry: "Customer Onboarding" shows a legacy SK_ONBOARDING.
        search_norm = profile_norm if key.startswith("CUSTOM:") else text_norm
        phrase = next((phrase for phrase in phrases if _phrase_in_text(phrase, search_norm)), None)
        if phrase:
            basis[required[key]] = {"kind": "resume_text", "key": key, "phrase": phrase}
            return True
        if key in abbreviated:
            basis[required[key]] = {"kind": "resume_text", "key": key, "phrase": required[key]}
            return True
        for phrase in related_skill_evidence().get(key, []):
            if _phrase_in_text(phrase, profile_norm):
                related_credit[required[key]] = phrase
                basis[required[key]] = {"kind": "related", "key": key, "phrase": phrase}
                return True
        return False

    matched = [key for key in required if held(key)]
    missing = [key for key in required if key not in matched]
    return {
        "matched_basis": basis,
        "missing_keys": missing,
        "removed_skills": sorted(required[key] for key in missing if key in excluded),
        "skill_coverage": round(len(matched) / len(required), 4) if required else 0.0,
        "matched_skills": sorted(required[key] for key in matched),
        "missing_skills": sorted(required[key] for key in missing),
        "matched_skill_ids": sorted(key for key in matched if key in labels),
        "missing_skill_ids": sorted(key for key in missing if key in labels),
        # Requirements credited through a related-skill relation, with the phrase that showed them.
        "related_skill_credit": [
            {"skill": skill, "evidence": phrase} for skill, phrase in sorted(related_credit.items())
        ],
    }


# Words in legacy IDs that the default casing gets wrong: short words are read
# as acronyms (CRM, HR, CNC) and longer ones capitalised (Onboarding).
LEGACY_WORD_CASING = {
    "AID": "Aid",
    "OPS": "Ops",
    "VAPT": "VAPT",
    "FASTAPI": "FastAPI",
    "JAVASCRIPT": "JavaScript",
}


def display_skill_name(skill_id: str, labels: Dict[str, str], fallback: str = "") -> str:
    """A name a candidate can read, never an identifier.

    Job postings still carry legacy IDs such as SK_CRM that have no taxonomy
    entry yet; those read as "CRM" rather than leaking the code. A canonical ID
    with no label resolves to nothing and is dropped by the caller.
    """
    label = clean_text(labels.get(skill_id, ""))
    if label:
        return label
    fallback = clean_text(fallback)
    if fallback and not re.fullmatch(r"(?:SK[_-]?[A-Z0-9_-]+|K\d{1,2})", fallback.upper()):
        return fallback
    if skill_id.startswith("CUSTOM:"):
        return skill_id.split(":", 1)[1].title()
    legacy = re.fullmatch(r"SK[_-]([A-Za-z0-9_-]+)", clean_text(skill_id))
    if legacy:
        words = [word.upper() for word in re.split(r"[_-]+", legacy.group(1)) if word]
        return " ".join(LEGACY_WORD_CASING.get(word) or (word if len(word) <= 3 else word.capitalize()) for word in words)
    return ""


def split_skill_ids(value: Any) -> List[str]:
    """Return canonical skill identifiers without inventing text equivalences."""
    text = clean_text(value).upper()
    if not text:
        return []
    return list(dict.fromkeys(re.findall(r"\b(?:SK\d+|LEX-\d+)\b", text)))


@lru_cache(maxsize=1)
def get_skill_labels_by_id() -> Dict[str, str]:
    labels: Dict[str, str] = {}
    for _, row in load_skills_reference().iterrows():
        skill_id = clean_text(row.get("skill_id", "")).upper()
        label = clean_text(row.get("skill_name", ""))
        if skill_id and label:
            labels.setdefault(skill_id, label)
    return labels


@lru_cache(maxsize=1)
def get_skill_categories_by_id() -> Dict[str, str]:
    categories: Dict[str, str] = {}
    for _, row in load_skills_reference().iterrows():
        skill_id = clean_text(row.get("skill_id", "")).upper()
        category_id = normalize_category_id(row.get("category_id", ""))
        if skill_id and category_id:
            categories.setdefault(skill_id, category_id)
    return categories


def compute_taxonomy_skill_coverage(
    candidate_skill_records: List[Dict[str, Any]],
    job: Dict[str, Any],
) -> Dict[str, Any]:
    """Compute exact coverage on canonical IDs, falling back to named skills.

    Related-skill credit is intentionally excluded from Fit-Now eligibility:
    a sibling in the taxonomy may explain an aspiration path, but it must not
    silently satisfy an employer's essential requirement.
    """
    candidate_ids = list(dict.fromkeys(
        clean_text(item.get("skill_id", "")).upper()
        for item in candidate_skill_records
        if clean_text(item.get("skill_id", ""))
    ))
    essential_ids = split_skill_ids(
        job.get("must_have_skill_ids") or job.get("required_skill_ids")
    )
    optional_ids = split_skill_ids(job.get("nice_to_have_skill_ids"))
    category_by_skill = get_skill_categories_by_id()
    candidate_categories = {
        category_by_skill.get(skill_id, "") for skill_id in candidate_ids
    }
    candidate_categories.discard("")
    job_category = normalize_category_id(job.get("category_id_norm") or job.get("category_id"))
    category_alignment = 1.0 if job_category and job_category in candidate_categories else 0.0

    labels = get_skill_labels_by_id()
    if candidate_ids and essential_ids:
        held = set(candidate_ids)
        matched_ids = [skill_id for skill_id in essential_ids if skill_id in held]
        missing_ids = [skill_id for skill_id in essential_ids if skill_id not in held]
        matched_skills = [name for skill_id in matched_ids if (name := display_skill_name(skill_id, labels))]
        missing_skills = [name for skill_id in missing_ids if (name := display_skill_name(skill_id, labels))]
        optional_matched = [skill_id for skill_id in optional_ids if skill_id in held]
        return {
            "skill_coverage": round(len(matched_ids) / len(essential_ids), 4),
            "optional_skill_coverage": round(
                len(optional_matched) / len(optional_ids), 4
            ) if optional_ids else 0.0,
            "matched_skills": matched_skills,
            "missing_skills": missing_skills,
            "matched_skill_ids": matched_ids,
            "missing_skill_ids": missing_ids,
            "category_alignment": category_alignment,
            "coverage_method": "canonical_taxonomy_skill_ids",
        }

    candidate_names = [
        clean_text(item.get("skill_name", ""))
        for item in candidate_skill_records
        if clean_text(item.get("skill_name", ""))
    ]
    essential_names = split_skill_list(job.get("required_skills_for_eval", ""))
    fallback = compute_skill_coverage(candidate_names, essential_names)
    optional_names = split_skill_list(
        job.get("mapped_nice_to_have_skill_names")
        or job.get("nice_to_have_skills_optional", "")
    )
    optional = compute_skill_coverage(candidate_names, optional_names) if optional_names else {
        "skill_coverage": 0.0
    }
    return {
        **fallback,
        "optional_skill_coverage": optional["skill_coverage"],
        "matched_skill_ids": [],
        "missing_skill_ids": [],
        "category_alignment": category_alignment,
        "coverage_method": "canonical_name_fallback",
    }


ROLE_LEVEL_TERMS = {
    "entry": ("entry", "junior", "trainee", "intern", "fresh"),
    "mid": ("mid",),
    "senior": ("senior", "lead", "manager", "supervisor", "head"),
}


def _role_level(value: str) -> str:
    for level, terms in ROLE_LEVEL_TERMS.items():
        if any(re.search(rf"\b{term}", value) for term in terms):
            return level
    return ""


def _work_setups(value: str) -> set:
    """Canonical setups named in a preference answer or a job's work type."""
    setups = set()
    if "hybrid" in value:
        setups.add("hybrid")
    if "remote" in value or "home" in value:
        setups.add("remote")
    if re.search(r"\bon ?-?site\b|\boffice only\b|\bfield", value):
        setups.add("onsite")
    # "Hybrid (mix of remote & office)" names remote only to describe hybrid.
    return {"hybrid"} if "hybrid" in setups and "remote" in setups and "/" not in value else setups


def _salary_range(value: str) -> Optional[Tuple[float, float]]:
    """Monthly PHP range from "35-50", "50+", "PHP 50,001 - more" or "₱18,000-₱30,000"."""
    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", value.replace(",", ""))]
    numbers = [n * 1000 if n < 1000 else n for n in numbers]
    if not numbers:
        return None
    if len(numbers) == 1:
        open_ended = "+" in value or re.search(r"\b(more|above|up)\b", value)
        return (numbers[0], float("inf")) if open_ended else (numbers[0], numbers[0])
    return min(numbers[:2]), max(numbers[:2])


# Step 3 answers that place no restriction on a field: job level or salary
# "I'm not sure", work setup "Flexible - no preference", and the same answers
# saved as labels or typed differently in the dashboard.
UNRESTRICTED_PREFERENCE_VALUES = {"", "any", "anything", "flexible", "unsure", "none", "n/a", "na", "open"}
UNRESTRICTED_PREFERENCE_PHRASES = ("not sure", "no preference", "flexible", "open to any", "any setup", "any level")
PREFERENCE_FIELDS = ("role_level", "work_setup", "salary_expectation")


def is_unrestricted_preference(value: Any) -> bool:
    """True when a preference answer does not restrict which jobs fit.

    An unrestricted field is left out of preference alignment entirely: it
    neither filters jobs out nor lowers any job's alignment, so the report
    rests on the career area and the resume.
    """
    text = normalize_for_match(str(value or "").replace("\u2019", "'"))
    return text in UNRESTRICTED_PREFERENCE_VALUES or any(phrase in text for phrase in UNRESTRICTED_PREFERENCE_PHRASES)


def unrestricted_preference_fields(preferences: Dict[str, Any]) -> List[str]:
    """The Step 3 fields (job level, work setup, salary) the candidate left open."""
    preferences = preferences or {}
    return [field for field in PREFERENCE_FIELDS if is_unrestricted_preference(preferences.get(field, ""))]


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
    preferred_career_areas_set = preferred_career_areas(preferred_industry)
    role_level = normalize_for_match(preferences.get("role_level", ""))
    target_role = normalize_for_match(preferences.get("target_role", ""))
    work_setup = normalize_for_match(preferences.get("work_setup", ""))
    salary_expectation = normalize_for_match(preferences.get("salary_expectation", ""))
    skill_to_develop = normalize_for_match(preferences.get("skill_to_develop", ""))

    def specified(value: str) -> bool:
        return not is_unrestricted_preference(value)

    # Step 3 asks for a job level; older clients send it as the target role too.
    if target_role and _role_level(target_role) and _role_level(target_role) == _role_level(role_level):
        target_role = ""

    if specified(preferred_industry):
        total += 0.25
        category_matches = job_career_area(job) in preferred_career_areas_set
        if category_matches or preferred_industry in job_corpus:
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
        wanted_level = _role_level(role_level)
        # "Entry to Mid Level" suits both entry and mid candidates.
        job_levels = {level for level, terms in ROLE_LEVEL_TERMS.items() if any(re.search(rf"\b{term}", experience) for term in terms)}
        if (wanted_level and wanted_level in job_levels) or (not wanted_level and role_level in experience):
            score += 0.15

    if specified(work_setup):
        total += 0.20
        wanted_setups = _work_setups(work_setup)
        if (wanted_setups and wanted_setups & _work_setups(work_type)) or (not wanted_setups and work_setup in work_type):
            score += 0.20

    if specified(salary_expectation):
        total += 0.10
        # Parsed from the raw text: normalizing turns "PHP 60,000" into "php 60 000",
        # which reads as the numbers 60 and 0.
        wanted_salary = _salary_range(clean_text(preferences.get("salary_expectation", "")).lower())
        job_salary = _salary_range(clean_text(job.get("salary_range_monthly_php", "")).lower())
        if wanted_salary and job_salary:
            if wanted_salary[0] <= job_salary[1] and job_salary[0] <= wanted_salary[1]:
                score += 0.10
        elif salary_expectation in salary:
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


def job_model_inputs(jobs_df: pd.DataFrame) -> List[str]:
    """Encoder inputs for prepared jobs; the build-time vector store uses the same text."""
    return [build_model_input(clean_text(row.get("job_description", "")),
        title=clean_text(row.get("job_title", "")),
        skill_names=split_skill_list(row.get("required_skills_for_eval", ""))) for _, row in jobs_df.iterrows()]


SEMANTIC_SCORING_METHOD = "fine_tuned_bi_encoder_cosine_max_over_resume_sections"
# The maximum of many section cosines is higher than one cosine even for an
# unrelated job (about +0.08 on average on the mock-resume diagnostic), and the
# Fit-Now and Aspiration floors were calibrated on the single profile input.
# A section therefore counts only by how far it beats this offset:
#     semantic = max(profile cosine, best section cosine - offset)
# 0.125 was chosen on the development split of
# scripts/diagnose_match_distribution.py so that unrelated ("weak") pairs pass
# the 0.20 and 0.30 floors about as often as before (held-out split: 9.9% vs
# 9.4%, 2.5% vs 2.4%) with strong-pair recall unchanged; see docs/matching-diagnosis.md.
SECTION_EVIDENCE_OFFSET = 0.125


def section_evidence_offset() -> float:
    try:
        value = float(os.getenv("KAREERLY_SECTION_EVIDENCE_OFFSET", str(SECTION_EVIDENCE_OFFSET)))
    except (TypeError, ValueError):
        return SECTION_EVIDENCE_OFFSET
    return min(max(value, 0.0), 1.0)


def bi_encoder_score_jobs(candidate: Any, jobs_df: pd.DataFrame) -> pd.DataFrame:
    """Role similarity of each job with the resume, read section by section.

    ``candidate`` is a CandidateEvidence (see resume_evidence.py) or a single
    model input. Every evidence input is compared with every job; each job
    keeps the profile cosine or its best section cosine less
    SECTION_EVIDENCE_OFFSET, whichever is higher, and the section that gave it.
    The rationale is in resume_evidence.py. The value is a cosine similarity,
    not a probability.
    """
    evidence = candidate if isinstance(candidate, CandidateEvidence) else CandidateEvidence(
        inputs=[str(candidate)], sections=["profile_summary"], chunk_count=0, truncated=False)
    scored = jobs_df.copy()
    raw = np.asarray(score_jobs(evidence.inputs, job_model_inputs(jobs_df)), dtype=float)
    # A test double may answer with one row for every input.
    matrix = raw.reshape(1, -1) if raw.ndim == 1 else raw
    matrix = matrix.copy()
    # Section inputs are offset before the maximum; see SECTION_EVIDENCE_OFFSET.
    matrix[1:] -= section_evidence_offset()
    best = matrix.argmax(axis=0)
    raw_scores = matrix[best, np.arange(matrix.shape[1])]
    scored["semantic_score_raw"] = raw_scores
    scored["semantic_score"] = np.clip(raw_scores, 0, 1)
    scored["semantic_profile_score_raw"] = matrix[0]
    scored["semantic_evidence_section"] = [
        evidence.sections[index] if index < len(evidence.sections) else "profile_summary" for index in best]
    scored["semantic_scoring_method"] = SEMANTIC_SCORING_METHOD
    return scored


# How a held skill was shown, for per-job evidence.
EVIDENCE_CONFIRMED = "confirmed_in_skill_review"
EVIDENCE_RESUME = "found_in_resume"
# Why a requirement is missing. "Not found" is not proof the candidate lacks
# it; only a skill the candidate removed in Step 2 is a stated absence.
MISSING_NOT_FOUND = "not_found_in_resume"
MISSING_REMOVED = "removed_by_candidate"


@dataclass
class CandidateContext:
    """What matching knows about the candidate, shared by every job it scores."""

    resume_text: str
    # The Step 2 list: confirmed skills, or the first twenty extracted.
    skill_records: List[Dict[str, Any]]
    skill_names: List[str]
    # Every skill held: confirmed ones plus resume evidence not removed in Step 2.
    held_values: List[str]
    removed_keys: set
    removed_skill_ids: List[str]
    evidence: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    sections: List[Tuple[str, str]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._normalized_sections = [(heading, normalize_for_match(body)) for heading, body in self.sections]

    def section_of(self, phrase: str) -> str:
        """The resume section whose text names ``phrase``, or ""."""
        for heading, body_norm in self._normalized_sections:
            if _phrase_in_text(phrase, body_norm):
                return heading
        return ""


def _confirmed_skill_records(confirmed_skills: List[Any]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for item in confirmed_skills:
        if isinstance(item, str):
            skill_name = clean_text(item)
            if skill_name:
                records.append({"skill_id": "", "skill_name": skill_name, "source": "confirmed_legacy_name"})
            continue
        if isinstance(item, dict):
            skill_id = clean_text(item.get("skill_id", "")).upper()
            skill_name = clean_text(item.get("skill_name", "")) or get_skill_labels_by_id().get(skill_id, "")
            if not skill_name:
                continue
            records.append({
                "skill_id": skill_id,
                "skill_name": skill_name,
                "custom_skill_name": clean_text(item.get("custom_skill_name", "")),
                "source": clean_text(item.get("source", "")) or "confirmed_skill",
                "is_standardized": bool(item.get("is_standardized", bool(skill_id))),
                "source_metadata": item.get("source_metadata", {}) if isinstance(item.get("source_metadata"), dict) else {},
            })
    return records


def _prepare_candidate_context(
    resume_text: str,
    confirmed_skills: Optional[List[Any]] = None,
    removed_skill_ids: Optional[List[str]] = None,
) -> CandidateContext:
    """Prepare the same candidate evidence for internal and external jobs.

    Skills come from the whole resume, not only the twenty Step 2 shows:

    * confirmed skills (Step 2) are held, including ones the candidate added;
    * every other skill the resume shows is held too, so a skill ranked below
      the twentieth is never reported missing;
    * a skill the candidate removed in Step 2 is not held, even though the
      resume names it. Clients send those as ``removed_skill_ids``. A skill
      merely absent from ``confirmed_skills`` is not treated as removed: older
      clients and saved dashboards send lists that may predate the resume
      text, and guessing a removal would report a documented skill missing.
    """
    ensure_taxonomy_current()
    resume_text = prepare_resume_text(resume_text)
    if not clean_text(resume_text):
        raise ValueError("No readable resume text was provided for matching.")
    provided_confirmed_skills = confirmed_skills is not None
    confirmed_skills = confirmed_skills or []
    if len(confirmed_skills) > MAX_CONFIRMED_SKILLS:
        raise ValueError(f"You can confirm up to {MAX_CONFIRMED_SKILLS} skills.")

    resume_skills = [
        skill for skill in extract_skills_from_text(resume_text, max_skills=None)
        if clean_text(skill.get("skill_name", ""))
    ]

    if provided_confirmed_skills:
        final_skill_records = _confirmed_skill_records(confirmed_skills)[:MAX_CONFIRMED_SKILLS]
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
            for skill in resume_skills
        ][:MAX_CONFIRMED_SKILLS]

    labels, _ = canonical_skill_lookup()
    for skill in final_skill_records:
        skill_id = clean_text(skill.get("skill_id", "")).upper()
        if skill_id:
            if skill_id not in labels:
                raise ValueError(f"Unknown confirmed skill ID: {skill_id}")
            skill["skill_name"] = labels[skill_id]
    candidate_skill_names = list(dict.fromkeys(skill["skill_name"] for skill in final_skill_records))

    confirmed_keys = {_skill_key(skill.get("skill_id") or skill["skill_name"]) for skill in final_skill_records}
    removed = [clean_text(value).upper() for value in (removed_skill_ids or []) if clean_text(value)]
    # A skill both confirmed and listed as removed stays confirmed.
    removed_keys = {_skill_key(value) for value in removed} - confirmed_keys

    evidence: Dict[str, Dict[str, Any]] = {}
    for skill in final_skill_records:
        value = skill.get("skill_id") or skill["skill_name"]
        evidence.setdefault(_skill_key(value), {
            "value": value, "skill_id": skill.get("skill_id", ""), "skill_name": skill["skill_name"],
            "source": EVIDENCE_CONFIRMED, "matched_text": "", "source_section": "", "evidence_text": "",
        })
    for skill in resume_skills:
        skill_id = clean_text(skill.get("skill_id", "")).upper()
        key = _skill_key(skill_id or skill["skill_name"])
        if key in removed_keys:
            continue
        found = {
            "matched_text": clean_text(skill.get("matched_text", "")),
            "source_section": clean_text(skill.get("source_section", "")),
            "evidence_text": clean_text(skill.get("evidence_text", "")),
        }
        if key in evidence:
            if not evidence[key]["matched_text"]:
                evidence[key].update(found)
            continue
        evidence[key] = {"value": skill_id or skill["skill_name"], "skill_id": skill_id,
            "skill_name": clean_text(skill.get("skill_name", "")), "source": EVIDENCE_RESUME, **found}

    return CandidateContext(
        resume_text=resume_text,
        skill_records=final_skill_records,
        skill_names=candidate_skill_names,
        held_values=[item["value"] for item in evidence.values()],
        removed_keys=removed_keys,
        removed_skill_ids=sorted(key for key in removed_keys if key in labels),
        evidence=evidence,
        sections=split_resume_sections(resume_text),
    )


def _critical_skill_ids(job: Dict[str, Any], required_ids: List[str]) -> List[str]:
    """Must-have IDs that an employer explicitly designated.

    Supabase and pasted jobs store one ID list and copy it into both fields, so
    a must-have list equal to the required list carries no extra designation;
    treating it as critical would silently demand 100% coverage. Any other
    must-have list is an explicit designation, and each skill in it must be
    held for Fit-Now.
    """
    critical = split_ids(job.get("must_have_skill_ids", ""))
    if not critical or set(critical) == set(required_ids):
        return []
    return critical


def _matched_skill_evidence(
    context: CandidateContext,
    coverage: Dict[str, Any],
    requirement: str,
) -> List[Dict[str, Any]]:
    """For each met requirement, the resume evidence (or confirmation) behind it."""
    labels, _ = canonical_skill_lookup()
    items = []
    for name in coverage["matched_skills"]:
        basis = coverage["matched_basis"].get(name, {})
        key = basis.get("key", "")
        held = context.evidence.get(key) if basis.get("kind") == "held_skill" else None
        if held:
            source, phrase, section, snippet = held["source"], held["matched_text"], held["source_section"], held["evidence_text"]
        else:
            phrase = basis.get("phrase", name)
            source = "related_resume_evidence" if basis.get("kind") == "related" else EVIDENCE_RESUME
            section, snippet = context.section_of(phrase), ""
        items.append({
            "skill": name,
            "skill_id": key if key in labels else "",
            "requirement": requirement,
            "source": source,
            "matched_text": phrase,
            "source_section": section if section != "full_text" else "",
            "evidence_text": snippet,
        })
    return items


def _missing_skill_status(coverage: Dict[str, Any], requirement: str) -> List[Dict[str, Any]]:
    return [
        {"skill": name, "requirement": requirement,
         "status": MISSING_REMOVED if name in coverage["removed_skills"] else MISSING_NOT_FOUND}
        for name in coverage["missing_skills"]
    ]


def _describe_evidence(item: Dict[str, Any]) -> str:
    if item["source"] == EVIDENCE_CONFIRMED and not item["matched_text"]:
        return f"{item['skill']} (confirmed in your skill review)"
    where = f" in your {item['source_section']} section" if item["source_section"] and item["source_section"] not in {"resume", "profile"} else ""
    phrase = item["matched_text"]
    if item["source"] == "related_resume_evidence":
        return f"{item['skill']} (shown by \"{phrase}\"{where})"
    if phrase and normalize_for_match(phrase) != normalize_for_match(item["skill"]):
        return f"{item['skill']} (\"{phrase}\"{where})"
    return f"{item['skill']}{' (' + where.strip() + ')' if where else ''}"


def grounded_explanation(
    job_title: str,
    match_type: str,
    matched_evidence: List[Dict[str, Any]],
    missing_status: List[Dict[str, Any]],
    semantic_section: str,
    in_preferred_career_area: Optional[bool],
    requirements_available: bool,
) -> str:
    """An explanation that quotes the resume evidence behind the match.

    Missing skills are described as not found in the resume, never as skills
    the candidate lacks, unless the candidate removed them in Step 2.
    """
    if not requirements_available:
        return (f"The posting for {job_title} lists no skills Kareerly can compare with your resume, "
                "so its score reflects role similarity only and no skill evidence or gaps can be shown.")
    essential = [item for item in matched_evidence if item["requirement"] == "essential"]
    shown = essential or matched_evidence
    parts = []
    if shown:
        parts.append("Your resume shows " + "; ".join(_describe_evidence(item) for item in shown[:4]) + ".")
    if semantic_section and semantic_section not in {"profile_summary", "resume", "profile", "full_text"}:
        parts.append(f"Its closest match in your resume is your {semantic_section} section.")
    not_found = [item["skill"] for item in missing_status if item["requirement"] == "essential" and item["status"] == MISSING_NOT_FOUND]
    removed = [item["skill"] for item in missing_status if item["requirement"] == "essential" and item["status"] == MISSING_REMOVED]
    optional = [item["skill"] for item in missing_status if item["requirement"] == "preferred"]
    if match_type == FIT_NOW:
        lead = f"{job_title} is a Fit-Now match: your resume covers its must-have skills and most of its required skills."
    elif match_type == ASPIRATION:
        basis = "is in the career area you chose" if in_preferred_career_area else "is related to your experience"
        lead = f"{job_title} is an Aspiration: it {basis} and builds on skills you already have."
    else:
        lead = f"{job_title} has little overlap with your resume."
    if not_found:
        parts.append("Required skills not found in your resume: " + ", ".join(not_found[:5]) + ".")
    if removed:
        parts.append("Required skills you removed from your skill list: " + ", ".join(removed[:5]) + ".")
    if optional:
        parts.append("Nice-to-have skills not found: " + ", ".join(optional[:3]) + ".")
    return " ".join([lead, *parts])


def _score_single_normalized_job(
    *,
    context: CandidateContext,
    job: Dict[str, Any],
    preferences: Dict[str, Any],
    available_learning_skills: set,
    thresholds: Optional[MatchThresholds] = None,
) -> Dict[str, Any]:
    """Score one normalized job using the production matching rules."""
    resume_text = context.resume_text
    required_ids = split_ids(job.get("required_skill_ids", ""))
    critical_ids = _critical_skill_ids(job, required_ids)
    # Essential = required plus any must-have not repeated in the required list.
    essential_ids = required_ids + [skill_id for skill_id in critical_ids if skill_id not in required_ids]
    required_skills = essential_ids or split_skill_list(job.get("required_skills_for_eval", ""))
    skill_result = compute_skill_coverage(context.held_values, required_skills, resume_text, context.removed_keys)
    preferred_ids = split_ids(job.get("nice_to_have_skill_ids", ""))
    preferred_skills = preferred_ids or split_skill_list(
        job.get("mapped_nice_to_have_skill_names") or job.get("nice_to_have_skills_optional", "")
    )
    preferred_result = compute_skill_coverage(context.held_values, preferred_skills, resume_text, context.removed_keys)
    # Preferred skills that are also required are already counted once.
    preferred_matched = [name for name in preferred_result["matched_skills"] if name not in skill_result["matched_skills"]]
    preferred_missing = [name for name in preferred_result["missing_skills"] if name not in skill_result["missing_skills"]]
    preferred_result = {**preferred_result, "matched_skills": preferred_matched, "missing_skills": preferred_missing}
    labels, _ = canonical_skill_lookup()
    missing_keys = set(skill_result["missing_keys"])
    critical_missing = sorted(skill_id for skill_id in critical_ids if _skill_key(skill_id) in missing_keys)
    # Relevance to the stated career goal: the job is in the chosen area.
    # Unknown on either side (no preference, uncategorised job) leaves it None.
    preferred_areas = preferred_career_areas(preferences.get("industry", ""))
    area = job_career_area(job)
    in_preferred_area = (area in preferred_areas) if preferred_areas and area else None

    breakdown = score_match(
        float(job.get("semantic_score_raw", job.get("semantic_score", 0.0))),
        SkillEvidence(skill_result["matched_skills"], skill_result["missing_skills"]),
        SkillEvidence(preferred_matched, preferred_missing),
        critical_missing_count=len(critical_missing),
        thresholds=thresholds,
        in_preferred_career_area=in_preferred_area,
    )
    match_type = breakdown.match_category
    score = breakdown.match_score
    # With no comparable skill requirement the score is role similarity alone,
    # and there are no matched or missing skills to report.
    requirements_available = breakdown.required_skill_count + breakdown.preferred_skill_count > 0
    semantic_score = breakdown.semantic_similarity
    skill_coverage = float(skill_result["skill_coverage"])
    preference_alignment = compute_preference_alignment(job, preferences)
    evidence_strength = compute_evidence_strength(resume_text=resume_text, matched_skills=skill_result["matched_skills"])
    learning_readiness = compute_learning_readiness(skill_result["missing_skills"], available_learning_skills)
    matched_evidence = (_matched_skill_evidence(context, skill_result, "essential")
        + _matched_skill_evidence(context, preferred_result, "preferred"))
    missing_status = _missing_skill_status(skill_result, "essential") + _missing_skill_status(preferred_result, "preferred")
    semantic_section = clean_text(job.get("semantic_evidence_section", ""))
    return {
        "job_id": job.get("job_id", ""), "job_title": job.get("job_title", ""),
        "company": job.get("company_name", ""), "company_name": job.get("company_name", ""),
        "job_source": job.get("job_source", "internal"), "job_category": job.get("job_category", ""),
        "job_subcategory": job.get("job_subcategory", ""), "category_id": job.get("category_id_norm", ""),
        "career_area": area, "in_preferred_career_area": in_preferred_area,
        "location": job.get("location", ""), "work_type": job.get("work_type", ""),
        "employment_type": job.get("employment_type", ""), "experience_level_required": job.get("experience_level_required", ""),
        "salary_range_monthly_php": job.get("salary_range_monthly_php", ""), "job_description": job.get("job_description", ""),
        "external_job_link_optional": job.get("external_job_link_optional", ""), "source_dataset": job.get("source_dataset", ""),
        "match_type": match_type, "match_category": match_type,
        "final_score": score, "match_score": score, "match_percentage": round(score * 100, 2),
        "semantic_score": semantic_score, "semantic_similarity": semantic_score, "skill_coverage": round(skill_coverage, 4),
        "required_skill_coverage": breakdown.required_skill_coverage,
        "preferred_skill_coverage": breakdown.preferred_skill_coverage,
        "preference_alignment": round(float(preference_alignment), 4), "evidence_strength": round(float(evidence_strength), 4),
        "learning_readiness": round(float(learning_readiness), 4),
        "semantic_scoring_method": job.get("semantic_scoring_method", SEMANTIC_SCORING_METHOD),
        "semantic_score_raw": float(job.get("semantic_score_raw", 0.0)), "text_similarity": float(job.get("semantic_score_raw", 0.0)),
        # The resume section whose evidence was most similar to this job, and
        # the cosine the opening of the resume alone would have given.
        "semantic_evidence_section": semantic_section,
        "semantic_score_profile_only": round(float(job.get("semantic_profile_score_raw", job.get("semantic_score_raw", 0.0))), 4),
        "fit_now_score": score, "fit_now_percentage": round(score * 100, 2),
        "aspiration_score": score, "aspiration_percentage": round(score * 100, 2),
        "matched_skill_ids": skill_result["matched_skill_ids"], "missing_skill_ids": skill_result["missing_skill_ids"],
        "critical_missing_skill_ids": critical_missing, "required_skill_ids": ";".join(required_ids),
        "matched_skills": skill_result["matched_skills"], "missing_skills": skill_result["missing_skills"],
        # Essential = required and must-have skills; preferred = nice-to-have.
        "missing_essential_skills": skill_result["missing_skills"],
        "missing_must_have_skills": [display_skill_name(skill_id, labels) for skill_id in critical_missing],
        "matched_preferred_skills": preferred_matched, "missing_preferred_skills": preferred_missing,
        # The requirements that make an Aspiration job aspirational.
        "aspiration_gap_skills": skill_result["missing_skills"] if match_type == ASPIRATION else [],
        "matched_skill_evidence": matched_evidence,
        "missing_skill_status": missing_status,
        "related_skill_credit": skill_result["related_skill_credit"],
        "skill_requirements_available": requirements_available,
        "score_basis": "semantic_and_skills" if requirements_available else "role_similarity_only",
        "score_interpretation": "Similarity of your resume to the job and share of its skills you hold; not a probability of being hired.",
        "match_reason": match_reason(match_type, skill_result["matched_skills"], skill_result["missing_skills"],
            breakdown.required_skill_count, in_preferred_area),
        "match_breakdown": breakdown.as_dict(),
        "explanation": grounded_explanation(job.get("job_title", ""), match_type, matched_evidence, missing_status,
            semantic_section, in_preferred_area, requirements_available),
    }


def analyze_candidate_job_match(
    resume_text: str,
    job: Dict[str, Any],
    *,
    preferences: Optional[Dict[str, Any]] = None,
    confirmed_skills: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    """Run one internal or pasted job through the shared production matcher."""
    context = _prepare_candidate_context(resume_text, confirmed_skills)
    normalized_job = dict(job)
    normalized_job.setdefault("job_description", "")
    normalized_job.setdefault("job_title", "")
    normalized_job.setdefault("required_skills_for_eval", "")
    candidate_evidence = candidate_model_inputs(context.resume_text, skill_names=context.skill_names)
    scored = bi_encoder_score_jobs(candidate_evidence, pd.DataFrame([normalized_job])).iloc[0].to_dict()
    scored_match = _score_single_normalized_job(
        context=context,
        job=scored,
        preferences=preferences or {},
        available_learning_skills=reviewed_learning_skill_ids(),
    )
    return {
        "match": {
            "match_percentage": scored_match["match_percentage"], "semantic_similarity": scored_match["semantic_score"],
            "skill_coverage": scored_match["skill_coverage"], "match_type": scored_match["match_type"],
            "preference_alignment": scored_match["preference_alignment"], "matched_skills": scored_match["matched_skills"],
            "missing_skills": scored_match["missing_skills"], "matched_skill_ids": scored_match["matched_skill_ids"],
            "missing_skill_ids": scored_match["missing_skill_ids"],
            "match_score": scored_match["match_score"], "match_category": scored_match["match_category"],
            "required_skill_coverage": scored_match["required_skill_coverage"],
            "preferred_skill_coverage": scored_match["preferred_skill_coverage"],
            "match_reason": scored_match["match_reason"], "match_breakdown": scored_match["match_breakdown"],
            "missing_preferred_skills": scored_match["missing_preferred_skills"],
            "matched_skill_evidence": scored_match["matched_skill_evidence"],
            "missing_skill_status": scored_match["missing_skill_status"],
            "explanation": scored_match["explanation"],
        },
        "learning_recommendations": recommend_learning_resources_for_matches([scored_match], preferences=preferences or {}),
        "candidate_skill_records": context.skill_records,
        "metadata": {"model_version": MODEL_ID, "matching_source": "shared_kareerly_matching_service"},
    }


# ============================================================
# JOB MATCHING MAIN FUNCTION
# ============================================================

def match_resume_to_jobs(
    file_bytes: bytes,
    filename: str,
    preferences: Optional[Dict[str, Any]] = None,
    confirmed_skills: Optional[List[Any]] = None,
    removed_skill_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return match_text_to_jobs(extract_resume_text_cached(file_bytes, filename), filename=filename,
        preferences=preferences, confirmed_skills=confirmed_skills, removed_skill_ids=removed_skill_ids)


def catalog_status(state: str, jobs_available: int = 0, source: str = "") -> Dict[str, Any]:
    messages = {
        "available": "",
        "empty": (
            "There are no active job postings to compare with your resume right now, so no matches are shown. "
            "Your skills are kept; run matching again once new jobs are posted."
        ),
        "unavailable": (
            "The job catalogue could not be loaded, so no matches could be calculated. "
            "This is a temporary problem on our side; please try again shortly."
        ),
    }
    return {"state": state, "jobs_available": int(jobs_available), "source": source, "message": messages[state]}


def _recommendation_notice(catalog: Dict[str, Any], fit_now: List[Dict[str, Any]], aspiration: List[Dict[str, Any]]) -> str:
    if catalog["state"] != "available":
        return catalog["message"]
    if not fit_now and not aspiration:
        return ("None of the available jobs is related closely enough to your resume or chosen career area, "
                "with skills you already share, to recommend. Adding skills your resume shows but Kareerly missed, "
                "or choosing a different career area, may change this.")
    if not fit_now:
        return ("No job meets every Fit-Now requirement yet. The Aspiration list shows related roles "
                "and the specific skills each one still needs.")
    return ""


def match_text_to_jobs(
    resume_text: str,
    *,
    filename: str = "",
    preferences: Optional[Dict[str, Any]] = None,
    confirmed_skills: Optional[List[Any]] = None,
    removed_skill_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    started_at = time.perf_counter()
    preferences = preferences or {}
    context = _prepare_candidate_context(resume_text, confirmed_skills, removed_skill_ids)
    resume_text = context.resume_text
    final_skill_records, candidate_skill_names = context.skill_records, context.skill_names
    labels, _ = canonical_skill_lookup()
    candidate_evidence = candidate_model_inputs(resume_text, skill_names=candidate_skill_names)
    try:
        jobs_df = load_reference_jobs()
        jobs_source = get_jobs_source()
    except (OSError, ValueError, pd.errors.ParserError):
        # Neither Supabase nor the bundled catalogue could be read. Say so
        # instead of failing the request or inventing results.
        logger.exception("Job catalogue could not be loaded")
        jobs_df, jobs_source = pd.DataFrame(), "unavailable"
        catalog = catalog_status("unavailable", source=jobs_source)
    else:
        catalog = catalog_status("available" if len(jobs_df) else "empty", len(jobs_df), jobs_source)
    thresholds = MatchThresholds.from_env()

    if jobs_df.empty:
        scored_jobs = pd.DataFrame()
        results: List[Dict[str, Any]] = []
    else:
        scored_jobs = bi_encoder_score_jobs(candidate_evidence, jobs_df)
        available_learning_skills = reviewed_learning_skill_ids()
        results = [
            _score_single_normalized_job(
                context=context,
                job=row.to_dict(),
                preferences=preferences,
                available_learning_skills=available_learning_skills,
                thresholds=thresholds,
            )
            for _, row in scored_jobs.iterrows()
        ]

    results_df = pd.DataFrame(results)

    # Low Match jobs are scored (see debug_summary) but never recommended.
    # Categories are final here; the ranker only orders jobs inside each list:
    # Fit-Now by match score, Aspiration by preference alignment then match
    # score (shared tie-breakers after). An active feedback model adds a
    # bounded adjustment to that primary key; see learning/ranking_model.py.
    # Either list may be empty and both may be full; nothing is moved between
    # them to reach a count.
    ranker = active_ranker()
    all_fit_now_matches = rank_category([item for item in results if item["match_type"] == FIT_NOW], FIT_NOW, ranker)
    all_aspiration_matches = rank_category([item for item in results if item["match_type"] == ASPIRATION], ASPIRATION, ranker)
    applied_ranker_version = next(
        (item["ranker_version"] for item in all_fit_now_matches + all_aspiration_matches), ranker.version)
    fit_now_matches = all_fit_now_matches[:TOP_FIT_NOW]
    aspiration_matches = all_aspiration_matches[:TOP_ASPIRATION]

    # Gaps come only from the jobs returned, never from every job scored.
    # Count every distinct gap before capping the list, so the report can say
    # how many there are rather than how many fit in the list.
    all_gaps = prioritize_skill_gaps(fit_now_matches + aspiration_matches, limit=None)
    prioritized_gaps = all_gaps[:MAX_PRIORITIZED_GAPS]
    # Cover every missing skill of the jobs the dashboard can show, so the
    # learning page has resources for whichever job the candidate focuses on.
    learning_recommendations = recommend_learning_resources_for_matches(
        all_fit_now_matches[:LEARNING_MATCHES_PER_TYPE] + all_aspiration_matches[:LEARNING_MATCHES_PER_TYPE],
        preferences=preferences,
    ) if fit_now_matches or aspiration_matches else []
    top_10_scores = (
        results_df.sort_values("final_score", ascending=False)
        .head(10)
        .loc[:, [
            "job_title",
            "semantic_score",
            "semantic_evidence_section",
            "skill_coverage",
            "matched_skills",
            "missing_skills",
            "final_score",
            "match_type",
            "match_breakdown",
        ]]
        .to_dict(orient="records")
        if not results_df.empty
        else []
    )

    # Why jobs missed Fit-Now and Aspiration, counted per rule, so an empty
    # list can be explained from the response (or the log) without rerunning.
    fit_now_blockers: Dict[str, int] = {}
    aspiration_blockers: Dict[str, int] = {}
    for item in results:
        for rule in item["match_breakdown"]["failed_fit_now_rules"]:
            fit_now_blockers[rule] = fit_now_blockers.get(rule, 0) + 1
        if item["match_type"] == LOW_MATCH:
            for rule in item["match_breakdown"]["failed_aspiration_rules"]:
                aspiration_blockers[rule] = aspiration_blockers.get(rule, 0) + 1
    logger.info(
        "Job matching finished",
        extra={"jobs_scored": len(results), "fit_now": len(all_fit_now_matches),
            "aspiration": len(all_aspiration_matches), "fit_now_blockers": fit_now_blockers,
            "aspiration_blockers": aspiration_blockers, "catalog_state": catalog["state"],
            "evidence_inputs": len(candidate_evidence.inputs)},
    )

    scoring_methods = sorted(set(scored_jobs["semantic_scoring_method"].tolist())) if not scored_jobs.empty else []
    return {
        "filename": filename,
        "resume_text_preview": resume_text[:500],
        "resume_text_for_matching": resume_text,
        "extracted_skills": final_skill_records,
        "confirmed_skills": candidate_skill_names,
        "confirmed_skill_records": final_skill_records,
        # Every skill counted as held, and where it came from.
        "resume_skill_evidence": [
            {key: value for key, value in item.items() if key != "value"} for item in context.evidence.values()
        ],
        "removed_skill_ids": context.removed_skill_ids,
        "preferences_used": preferences,
        "catalog_status": catalog,
        "recommendation_notice": _recommendation_notice(catalog, all_fit_now_matches, all_aspiration_matches),
        "fit_now_matches": fit_now_matches,
        "aspiration_matches": aspiration_matches,
        "closest_matches": [],
        "all_fit_now_matches": all_fit_now_matches,
        "all_aspiration_matches": all_aspiration_matches,
        "all_closest_matches": [],
        "total_qualifying_matches": len({str(item.get("job_id") or item.get("job_title"))
            for item in all_fit_now_matches + all_aspiration_matches}),
        "skill_gaps": prioritized_gaps,
        "total_skill_gap_count": len(all_gaps),
        "prioritized_skill_gaps": prioritized_gaps,
        "learning_recommendations": learning_recommendations,
        "model_used": "Fine-tuned all-MiniLM-L6-v2 bi-encoder (cosine, best resume section) with canonical skill rules",
        "warnings": ["No canonical required skills were supplied for some jobs; detailed gap explanations may be limited."] if any(not clean_text(row.get("required_skill_ids", "")) and not clean_text(row.get("required_skills_for_eval", "")) for _, row in jobs_df.iterrows()) else [],
        "debug_summary": {
            "extracted_skill_count": len(candidate_skill_names),
            "extracted_skill_names": candidate_skill_names,
            "held_skill_count": len(context.held_values),
            "total_jobs_loaded": int(len(jobs_df)),
            "total_jobs_scored": int(len(scored_jobs)),
            "fit_now_count": len(all_fit_now_matches),
            "closest_count": 0,
            "aspiration_count": len(all_aspiration_matches),
            "low_match_count": int((results_df["match_type"] == LOW_MATCH).sum()) if not results_df.empty else 0,
            "preferred_career_area": normalize_career_area(preferences.get("industry", "")),
            # Fields left open ("I'm not sure", "Flexible - no preference") that
            # did not filter or lower any job.
            "unrestricted_preferences": unrestricted_preference_fields(preferences),
            "fit_now_blockers": fit_now_blockers,
            "aspiration_blockers": aspiration_blockers,
            "resume_evidence_inputs": len(candidate_evidence.inputs),
            "resume_evidence_truncated": candidate_evidence.truncated,
            "elapsed_ms": round((time.perf_counter() - started_at) * 1000, 1),
            "top_10_scores": top_10_scores,
        },
        "metadata": {
            "semantic_scoring_methods": scoring_methods,
            "model_version": MODEL_ID,
            "semantic_aggregation": "max(profile cosine, best resume-section cosine - section offset)",
            "section_evidence_offset": section_evidence_offset(),
            "ranking_signal": "composite_match_score" if applied_ranker_version == BASELINE_VERSION
                else "composite_match_score_with_feedback_adjustment",
            "ranker_version": applied_ranker_version,
            "ranker_fallback_reason": ranker.fallback_reason
                or ("ranker_error" if applied_ranker_version == BASELINE_VERSION and not ranker.is_baseline else ""),
            "score_interpretation": "Weighted semantic similarity and skill coverage percentage, not hiring probability",
            "ranking_interpretation": "Order within Fit-Now and Aspiration may include a small adjustment learned from candidates' good/bad match ratings; it never moves a job between lists and does not change the percentage.",
            "fit_now_rules": {
                "min_cosine": thresholds.fit_now_min_semantic,
                "min_skill_coverage": thresholds.fit_now_min_required_coverage,
                "max_critical_missing_skills": 0,
            },
            "aspiration_rules": {
                "relevance": "min_cosine to the resume, or the job is in the chosen career area",
                "min_cosine": thresholds.aspiration_min_semantic,
                # Held required skills; preferred ones count only when a job lists no required skills.
                "min_matched_skills": thresholds.aspiration_min_matched_skills,
                "skill_bridge": "required skills held (preferred only when none are required)",
                "max_missing_essential_skills": thresholds.aspiration_max_missing_essential,
            },
            "jobs_source": jobs_source,
            "learning_resources_source": get_learning_resources_source(),
            "total_jobs_scored": int(len(scored_jobs)),
        },
    }


def run_matching(
    *,
    resume_text: str = "",
    file_bytes: Optional[bytes] = None,
    filename: str = "",
    preferences: Optional[Dict[str, Any]] = None,
    confirmed_skills: Optional[List[Any]] = None,
    candidate_skill_ids: Optional[List[str]] = None,
    removed_skill_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """The one matching entry point for onboarding, the dashboard and uploads.

    Text from Step 1 is used when sent; otherwise the file is read exactly as
    Step 1 reads it. Confirmed skill records win over bare skill IDs; with
    neither, the resume's own extracted skills are used (the text fallback).
    """
    text = clean_text(resume_text)
    if text:
        text = resume_text
    elif file_bytes is not None:
        text = extract_resume_text_cached(file_bytes, filename)
    else:
        raise ValueError("No readable resume text was provided for matching.")
    records: Optional[List[Any]] = list(confirmed_skills) if confirmed_skills else None
    if records is None and candidate_skill_ids:
        labels, _ = canonical_skill_lookup()
        ids = list(dict.fromkeys(clean_text(value).upper() for value in candidate_skill_ids if clean_text(value)))
        if any(value not in labels for value in ids):
            raise ValueError("Unknown confirmed skill IDs were supplied.")
        records = [{"skill_id": value, "skill_name": labels[value], "source": "confirmed_skill"} for value in ids] or None
    return match_text_to_jobs(text, filename=filename, preferences=preferences,
        confirmed_skills=records, removed_skill_ids=removed_skill_ids)


def match_jobs(
    resume_text_for_matching: str,
    candidate_skill_ids: Optional[List[str]] = None,
    preferences: Optional[Dict[str, Any]] = None,
    top_n_retrieval: int = 100,
    top_n_output: int = 10,
    removed_skill_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    # An empty ID list means the caller did not provide usable confirmed
    # skills; the resume's own extracted skills are used instead.
    result = run_matching(resume_text=resume_text_for_matching, preferences=preferences,
        candidate_skill_ids=candidate_skill_ids, removed_skill_ids=removed_skill_ids)
    result["fit_now_matches"] = result["all_fit_now_matches"][:max(0, top_n_output)]
    result["aspiration_matches"] = result["all_aspiration_matches"][:max(0, top_n_output)]
    result["closest_matches"] = []
    return result


GAP_ESSENTIAL = "essential"
GAP_OPTIONAL = "optional"


def prioritize_skill_gaps(
    matches: List[Dict[str, Any]],
    limit: Optional[int] = MAX_PRIORITIZED_GAPS,
) -> List[Dict[str, Any]]:
    """Missing skills of the given (returned) matches, essential gaps first.

    A gap is essential when at least one of the jobs requires it (required or
    must-have) and optional when the jobs only prefer it. Within each group,
    must-have gaps and then the most common gaps come first. Each gap lists
    the jobs it affects. ``limit=None`` returns every gap.
    """
    labels, _ = canonical_skill_lookup()
    gap_counts: Dict[str, Dict[str, Any]] = {}

    for match in matches:
        match_type = match.get("match_type", "")
        essential = match.get("missing_essential_skills", match.get("missing_skills", [])) or []
        optional = match.get("missing_preferred_skills", []) or []
        must_have = set(match.get("missing_must_have_skills", []) or [])
        removed = {item.get("skill") for item in match.get("missing_skill_status", []) or []
                   if item.get("status") == MISSING_REMOVED}
        for gap_type, skills in ((GAP_ESSENTIAL, essential), (GAP_OPTIONAL, optional)):
            for skill in skills:
                item = gap_counts.setdefault(skill, {
                    "skill": skill, "essential": 0, "optional": 0, "must_have": 0, "removed": False,
                    "appears_in_fit_now": 0, "appears_in_aspiration": 0, "affected_jobs": [],
                })
                item[gap_type] += 1
                item["must_have"] += int(skill in must_have)
                item["removed"] = item["removed"] or skill in removed
                if match_type == FIT_NOW:
                    item["appears_in_fit_now"] += 1
                else:
                    item["appears_in_aspiration"] += 1
                item["affected_jobs"].append({
                    "job_id": match.get("job_id", ""), "job_title": match.get("job_title", ""),
                    "match_type": match_type, "requirement": gap_type,
                })

    gap_list = []
    for item in gap_counts.values():
        frequency = len(item["affected_jobs"])
        gap_type = GAP_ESSENTIAL if item["essential"] else GAP_OPTIONAL
        if gap_type == GAP_OPTIONAL:
            priority = "Moderate"
        elif item["must_have"] or item["essential"] >= 3:
            priority = "Critical"
        elif item["essential"] == 2:
            priority = "High Priority"
        else:
            priority = "Moderate"
        key = _skill_key(item["skill"])
        gap_list.append({
            "skill_name": item["skill"],
            "skill": item["skill"],
            "skill_id": key if key in labels else "",
            "gap_type": gap_type,
            "is_essential": gap_type == GAP_ESSENTIAL,
            "is_must_have": bool(item["must_have"]),
            # "not_found_in_resume" does not mean the candidate lacks the skill.
            "evidence_status": MISSING_REMOVED if item["removed"] else MISSING_NOT_FOUND,
            "severity": priority,
            "frequency": frequency,
            "priority": priority,
            "essential_job_count": item["essential"],
            "optional_job_count": item["optional"],
            "appears_in_top_matches": frequency,
            # Share of the compared matches missing the skill, stated here so
            # clients never have to guess the denominator.
            "matches_compared": len(matches),
            "missing_percentage": round(100 * frequency / len(matches), 1),
            "appears_in_fit_now": item["appears_in_fit_now"],
            "appears_in_closest": 0,
            "appears_in_aspiration": item["appears_in_aspiration"],
            # Titles, as other gap producers and the dashboard read them;
            # affected_job_details carries the IDs and requirement type.
            "affected_jobs": list(dict.fromkeys(job["job_title"] for job in item["affected_jobs"])),
            "related_jobs": list(dict.fromkeys(job["job_title"] for job in item["affected_jobs"])),
            "affected_job_details": item["affected_jobs"],
        })

    gap_list.sort(key=lambda gap: (
        gap["gap_type"] != GAP_ESSENTIAL,
        not gap["is_must_have"],
        -gap["essential_job_count"],
        -gap["frequency"],
        gap["skill_name"].lower(),
    ))
    return gap_list if limit is None else gap_list[:limit]


def warm_matching_caches() -> None:
    """Load the encoder and the build-time job vectors during startup.

    Encoding the complete internal and employer catalogue can take several minutes
    on a small deployment and holds the scoring lock while it runs, so startup
    never encodes jobs. Jobs missing from the build-time store (added or edited
    since the build) are encoded lazily by the first request that needs them.
    """
    get_bi_encoder()
    load_precomputed_job_vectors()
