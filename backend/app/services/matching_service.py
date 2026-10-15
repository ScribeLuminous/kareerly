# backend/app/services/matching_service.py

import io
import json
import os
import re
import hashlib
import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, List, Any, Tuple, Optional, Sequence

import numpy as np
import pandas as pd

from .learning_recommender import (
    get_learning_resources_source,
    recommend_learning_resources_by_skill,
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
from .skill_variants import (
    any_case_variants, exact_case_skill_ids, merge_variants_into_rows, remove_excluded_aliases,
)
from .supabase_jobs import load_internal_jobs_dataframe
from .ph_regions import RegionPreference, region_preference, regions_in_location
from . import skill_gap_config as gap_config, skill_resolver, taxonomy_additions
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
CAREER_AREA_SKILLS_PATH = os.path.join(DATA_DIR, "career_area_skills.json")
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
    # A missing cell in a job table (None, NaN) is empty, never the text "nan".
    if value is None or (isinstance(value, float) and value != value):
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
def _career_area_rules() -> Dict[str, Any]:
    with open(CAREER_AREA_SKILLS_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def career_area_skills() -> Dict[str, List[Dict[str, str]]]:
    """Each Step 3 career area's skills: the one skill-to-area mapping.

    Step 3 reads it from GET /api/career-areas for its "Your confirmed skills
    here" labels and its job-level lock, so they and the backend's lock agree.
    """
    return _career_area_rules()["areas"]


def job_level_thresholds() -> Dict[str, int]:
    """Confirmed skills in the chosen area needed to open mid-level and senior."""
    return _career_area_rules()["level_thresholds"]


def career_area_skill_ids(value: Any) -> frozenset:
    """The skill IDs of a Step 3 answer's area (every covered area for a legacy one)."""
    areas = career_area_skills()
    return frozenset(skill["id"] for area in preferred_career_areas(value) for skill in areas.get(area, []))


JOB_LEVEL_ORDER = ("entry", "mid", "senior")
JOB_LEVEL_LOCK_REASON = "too_few_confirmed_skills_in_career_area"
# Fields a client sends the Step 3 job level in; target_role may also be free text.
JOB_LEVEL_FIELDS = ("role_level", "role", "target_role", "job_level")


def _skills_phrase(count: int) -> str:
    return f"{count} confirmed skill{'' if count == 1 else 's'}"


def job_level_lock_message(max_level: str, count: int, label: str) -> str:
    """The report line for results limited by the job-level lock."""
    if max_level == "entry":
        reason = f"no confirmed skills in {label} yet" if count == 0 else f"only {_skills_phrase(count)} in {label}"
        return f"Results are limited to entry-level roles because you have {reason}."
    senior = job_level_thresholds()["senior"]
    return (f"Results are limited to mid-level roles because you have {_skills_phrase(count)} in {label}; "
            f"senior roles need {senior}.")


def gate_job_level(preferences: Dict[str, Any], skill_records: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """Stage 1 constraint gate: cap the job level by confirmed skills in the chosen area.

    Fewer than ``level_thresholds["mid"]`` confirmed skills in the area opens
    entry-level only, fewer than ``level_thresholds["senior"]`` opens up to
    mid-level, and more opens every level. "I'm not sure" is always open. A
    level above the cap is lowered to the highest open level, whatever the
    client sent. Returns the preferences to match with and, when the cap
    limits the results, why (else None).
    """
    preferences = preferences or {}
    area = normalize_career_area(preferences.get("industry", ""))
    area_skill_ids = career_area_skill_ids(area)
    if not area_skill_ids:
        return preferences, None
    held = {clean_text(record.get("skill_id", "")).upper() for record in skill_records}
    count = len(held & area_skill_ids)
    thresholds = job_level_thresholds()
    if count >= thresholds["senior"]:
        return preferences, None
    max_level = "mid" if count >= thresholds["mid"] else "entry"
    requested = clean_text(preferences.get("role_level", ""))
    if is_unrestricted_preference(requested):
        return preferences, None

    def above_cap(value: str) -> bool:
        level = _role_level(normalize_for_match(value))
        return not level or JOB_LEVEL_ORDER.index(level) > JOB_LEVEL_ORDER.index(max_level)

    overridden = above_cap(requested)
    if not overridden and max_level != "entry":
        return preferences, None
    gated = dict(preferences)
    if overridden:
        for key in JOB_LEVEL_FIELDS:
            value = clean_text(gated.get(key, ""))
            # The level answer is replaced; a free-text target role is kept.
            if value and (value == requested or (_role_level(normalize_for_match(value)) and above_cap(value))):
                gated[key] = max_level
    label = CAREER_AREA_LABELS.get(area) or LEGACY_CAREER_AREA_LABELS.get(area, area)
    return gated, {
        "applied": True,
        "reason": JOB_LEVEL_LOCK_REASON,
        "career_area": area,
        "career_area_label": label,
        "confirmed_skill_count": count,
        "max_level": max_level,
        "requested_level": requested,
        "applied_level": max_level if overridden else _role_level(normalize_for_match(requested)),
        "overridden": overridden,
        "message": job_level_lock_message(max_level, count, label),
    }


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


# Old grouped labels an alias maps to one area for a Step 3 answer, but which
# cover more than one area when a job carries them.
GROUPED_JOB_LABEL_AREAS = {
    "tech business finance": ("technology-data", "business-office"),
    "technology data business finance": ("technology-data", "business-office"),
}

# Words too general to tell career areas apart ("Customer Service" and "Social
# and Community Services" share "service").
_AREA_WORD_STOPWORDS = frozenset({"and", "the", "of", "other", "general", "service", "services", "related"})


def _area_words(value: Any) -> set:
    return {
        word[:-1] if len(word) > 4 and word.endswith("s") and not word.endswith("ss") else word
        for word in re.findall(r"[a-z]+", clean_text(value).lower())
        if word not in _AREA_WORD_STOPWORDS
    }


@lru_cache(maxsize=1)
def _career_area_vocabulary() -> Dict[str, set]:
    """Each area's words: its Step 3 label and the K01-K24 category names it covers."""
    return {
        area: _area_words(CAREER_AREA_LABELS[area]) | set().union(*(_area_words(name) for name in categories))
        for area, categories in CAREER_AREA_JOB_CATEGORIES.items()
    }


def _areas_named_by(value: Any, candidates: Sequence[str]) -> List[str]:
    """The candidate areas whose words best cover a free-form category label.

    Supabase jobs may carry grouped labels such as "Sales/Marketing/Customer",
    which name no single K01-K24 category but only one area's words.
    """
    words = _area_words(value)
    if not words:
        return []
    vocabulary = _career_area_vocabulary()
    scores = {area: len(words & vocabulary[area]) for area in candidates}
    best = max(scores.values(), default=0)
    return [area for area in candidates if best and scores[area] == best]


@lru_cache(maxsize=1)
def _reference_area_classifier():
    """TF-IDF centroids of the labelled reference catalogue, one per career area."""
    from sklearn.feature_extraction.text import TfidfVectorizer

    jobs = safe_read_csv(REFERENCE_JOBS_PATH)
    texts, areas = [], []
    for _, row in jobs.iterrows():
        area = _area_for_category_name(row.get("job_category", "")) or career_area_by_category_id().get(
            normalize_category_id(row.get("category_id", "")), "")
        if area:
            texts.append(_area_classifier_text(row))
            areas.append(area)
    if not texts:
        return None
    vectorizer = TfidfVectorizer(stop_words="english", sublinear_tf=True, ngram_range=(1, 2), min_df=1)
    matrix = vectorizer.fit_transform(texts)
    labels = np.array(areas)
    centroids = {}
    for area in sorted(set(areas)):
        centroid = np.asarray(matrix[labels == area].mean(axis=0)).ravel()
        norm = np.linalg.norm(centroid)
        if norm:
            centroids[area] = centroid / norm
    return vectorizer, centroids


def _area_classifier_text(job: Any) -> str:
    title = clean_text(job.get("job_title", ""))
    # The title and subcategory say most about the kind of work; repeat them.
    return " ".join([title, title, clean_text(job.get("job_subcategory", "")), clean_text(job.get("job_description", ""))])


def _closest_area(job: Dict[str, Any], candidates: Sequence[str]) -> str:
    """The candidate area whose reference jobs the job reads most like, "" when none is alike."""
    classifier = _reference_area_classifier()
    if classifier is None:
        return ""
    vectorizer, centroids = classifier
    vector = vectorizer.transform([_area_classifier_text(job)]).toarray().ravel()
    norm = np.linalg.norm(vector)
    if not norm:
        return ""
    similarities = {area: float(centroids[area] @ vector) / norm for area in candidates if area in centroids}
    best = max(similarities, key=similarities.get, default="")
    return best if best and similarities[best] > 0 else ""


def job_career_area(job: Dict[str, Any]) -> str:
    """The Step 3 career area a job belongs to, or "" when it cannot be told.

    A K01-K24 category name or code decides. Otherwise the category label is
    read as words (Supabase jobs use grouped labels such as
    "Sales/Marketing/Customer" or "Engineering/Trades/Operations"). A label
    that spans several areas is settled by the subcategory, then by which
    area's reference jobs the title and description read most like.
    """
    category = job.get("job_category", "")
    grouped = GROUPED_JOB_LABEL_AREAS.get(_career_area_label_key(category), ())
    area = "" if grouped else (_area_for_category_name(category) or normalize_career_area(category))
    if area and area not in LEGACY_CAREER_AREAS:
        return area
    category_id = normalize_category_id(job.get("category_id_norm") or job.get("category_id") or "")
    by_id = career_area_by_category_id().get(category_id, "")
    if by_id:
        return by_id

    candidates = (list(grouped) or (list(LEGACY_CAREER_AREAS[area]) if area else [])
                  or _areas_named_by(category, list(CAREER_AREA_JOB_CATEGORIES)))
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        return ""
    narrowed = _areas_named_by(job.get("job_subcategory", ""), candidates)
    if len(narrowed) == 1:
        return narrowed[0]
    return _closest_area(job, narrowed or candidates)


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
    # Labels that name something else ("XPath" on SQL) are removed; see skill_alias_exclusions.csv.
    skills = pd.DataFrame(remove_excluded_aliases(merge_variants_into_rows(rows))).fillna("")
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
        for cache in (load_skills_reference, get_weighted_skill_extractor,
                skill_vocabulary, skill_id_equivalents, get_skill_labels_by_id, get_skill_categories_by_id,
                _spaced_spellings, resource_skill_evidence, course_evidence_extractor):
            cache.cache_clear()
    if additions:
        logger.info("Skill taxonomy includes %d approved additions", len(additions))


def current_skill_extractor() -> SkillExtractor:
    """The weighted extractor over the current taxonomy, for search and extraction."""
    ensure_taxonomy_current()
    return get_weighted_skill_extractor()


def extract_skills_from_text(text: str, max_skills: Optional[int] = 30) -> List[Dict[str, Any]]:
    """Skills with evidence in the text, ranked as Step 2 ranks them; ``max_skills=None`` returns all.

    The shared extractor is the only way skills are found in text; there is no
    broader fallback (see skill_resolver).
    """
    return extract_resume_skills(text, get_weighted_skill_extractor(), limit=max_skills)


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
def skill_vocabulary() -> skill_resolver.SkillVocabulary:
    """The shared skill vocabulary (skill_resolver) over the current taxonomy.

    Resume extraction builds the same vocabulary from the same rows, so a name
    means the same skill in a resume, a job requirement, a typed skill, a
    pasted job and a course description.
    """
    rows = load_skills_reference().to_dict(orient="records")
    approved = {clean_text(row.get("skill_id", "")).upper(): skill_resolver.split_list(row.get(taxonomy_additions.APPROVED_ALIASES_FIELD, ""))
                for row in rows}
    return skill_resolver.build_vocabulary(rows, extra_verified=approved)


def skill_evidence_phrases() -> Dict[str, List[str]]:
    """Verified names that show a taxonomy skill in resume text, label first."""
    return skill_vocabulary().evidence_names


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


def canonical_skill_lookup() -> Tuple[Dict[str, str], Dict[str, str]]:
    """Canonical labels, and verified names (skill_resolver.normalize) to the one skill each names."""
    vocabulary = skill_vocabulary()
    return vocabulary.labels, vocabulary.resolve_aliases


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
    labels, _ = canonical_skill_lookup()
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
        candidates = [normalized, *_phrase_variants(normalized), spaced, *_phrase_variants(spaced)]
        vocabulary = skill_vocabulary()
        key = next((skill_id for variant in candidates if (skill_id := vocabulary.resolve(variant))), "CUSTOM:" + normalized)
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


def resume_names_role(job_title: Any, resume_text: str) -> bool:
    """Whether the resume names the job's title ("Executive Assistant") as written.

    Only titles of two or more words count, without a qualifier in brackets
    ("Customer Service Representative (Voice)"); a single word such as
    "Assistant" says nothing about the kind of work.
    """
    title = normalize_for_match(re.sub(r"\([^)]*\)", " ", clean_text(job_title)))
    if len(title.split()) < 2:
        return False
    return _phrase_in_text(title, normalize_for_match(resume_text), strip_qualifiers=False)


def _phrase_in_text(phrase: str, text_norm: str, strip_qualifiers: bool = True) -> bool:
    """Whether ``phrase`` appears in the normalized text.

    ``strip_qualifiers`` also tries the phrase without requirement wording
    ("Salesforce experience" -> "salesforce"). It is off for a taxonomy skill's
    own names, where those words are part of the name: "Customer Experience"
    is not "customer", nor "Office software" "office".
    """
    phrase_norm = normalize_for_match(phrase)
    if len(phrase_norm) < 3 or not text_norm:
        return False
    for variant in (_phrase_variants(phrase_norm) if strip_qualifiers else [phrase_norm]):
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


@lru_cache(maxsize=1)
def _spaced_spellings() -> Tuple[Tuple[str, str], ...]:
    """(skill ID, normalized spelling) for reviewed spellings that split a one-word name.

    "Java Script" is JavaScript and "Zen Desk" is Zendesk; their parts mean
    nothing on their own. A qualified name ("HubSpot CRM") is not listed: its
    "CRM" still names the practice.
    """
    phrases = skill_evidence_phrases()
    spellings = set()
    for skill_id, values in any_case_variants().items():
        one_word_names = {_compact(normalize_for_match(name)) for name in phrases.get(skill_id, []) if " " not in name.strip()}
        for value in values:
            spelling = normalize_for_match(value)
            if re.search(r"[\s/-]", spelling) and _compact(spelling) in one_word_names:
                spellings.add((skill_id, spelling))
    return tuple(sorted(spellings, key=lambda item: -len(item[1])))


def _without_other_spellings(text_norm: str, key: str) -> str:
    """The text with other skills' spaced spellings blanked out.

    "Java Script" is a reviewed spelling of JavaScript, so its "java" does not
    show the Java language, just as resume extraction reads the longer name.
    """
    for skill_id, spelling in _spaced_spellings():
        if skill_id != key and spelling in text_norm:
            text_norm = re.sub(r"(?<![a-z0-9+#])" + re.escape(spelling) + r"(?![a-z0-9+#])", " | ", text_norm)
    return text_norm


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
        search_norm = _without_other_spellings(profile_norm if key.startswith("CUSTOM:") else text_norm, key)
        # A custom requirement name may carry wording ("Salesforce experience");
        # a taxonomy skill's names are matched whole.
        custom = key.startswith("CUSTOM:")
        phrase = next((phrase for phrase in phrases if _phrase_in_text(phrase, search_norm, strip_qualifiers=custom)), None)
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


def preference_conflicts(job: Dict[str, Any], preferences: Dict[str, Any]) -> List[str]:
    """Step 3 answers the job clearly fails: "job_level", "work_setup", "salary".

    Only a stated answer and a job that states the same field can conflict:
    "I'm not sure" or "Flexible" answers, and jobs with no level, setup or
    salary listed (or one that cannot be read), never exclude a job.
    """
    preferences = preferences or {}
    conflicts = []
    role_level = normalize_for_match(preferences.get("role_level", ""))
    if role_level and not is_unrestricted_preference(role_level):
        wanted = _role_level(role_level)
        experience = normalize_for_match(job.get("experience_level_required", ""))
        levels = {level for level, terms in ROLE_LEVEL_TERMS.items() if any(re.search(rf"\b{term}", experience) for term in terms)}
        if wanted and levels and wanted not in levels:
            conflicts.append("job_level")
    work_setup = normalize_for_match(preferences.get("work_setup", ""))
    if work_setup and not is_unrestricted_preference(work_setup):
        wanted_setups = _work_setups(work_setup)
        job_setups = _work_setups(normalize_for_match(job.get("work_type", "")))
        if wanted_setups and job_setups and not wanted_setups & job_setups:
            conflicts.append("work_setup")
    salary = clean_text(preferences.get("salary_expectation", "") or preferences.get("salary", ""))
    if salary and not is_unrestricted_preference(salary):
        wanted_salary = _salary_range(salary.lower())
        job_salary = _salary_range(clean_text(job.get("salary_range_monthly_php", "")).lower())
        if wanted_salary and job_salary and not (wanted_salary[0] <= job_salary[1] and job_salary[0] <= wanted_salary[1]):
            conflicts.append("salary")
    return conflicts


# Why a job is or is not eligible under an active region filter.
REGION_IN_REGION = "in_region"
REGION_REMOTE = "remote_allowed"
REGION_OUT = "out_of_region"
REGION_UNKNOWN = "region_unknown"


def candidate_allows_remote(preferences: Dict[str, Any]) -> bool:
    """True when the work setup answer leaves room for fully remote work."""
    work_setup = normalize_for_match((preferences or {}).get("work_setup", ""))
    return is_unrestricted_preference(work_setup) or "remote" in _work_setups(work_setup)


def job_region_status(job: Dict[str, Any], region: RegionPreference, preferences: Dict[str, Any]) -> str:
    """How a job stands against the candidate's region filter.

    A job in the chosen region is eligible. A remote job is eligible wherever
    it is based when the candidate's work setup allows remote work. Otherwise a
    job in another region, and a job whose location names no region
    ("Philippines", blank), is not: its region cannot be confirmed.
    """
    job_regions = regions_in_location(job.get("location", ""))
    if region.region in job_regions:
        return REGION_IN_REGION
    if "remote" in _work_setups(normalize_for_match(job.get("work_type", ""))) and candidate_allows_remote(preferences):
        return REGION_REMOTE
    return REGION_OUT if job_regions else REGION_UNKNOWN


def apply_region_filter(
    results: List[Dict[str, Any]], region: RegionPreference, preferences: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Keep the recommendable jobs the region filter allows; scores are untouched.

    Only Fit-Now and Aspiration jobs are counted. Excluded jobs are never
    brought back to fill a short list; only an empty Fit-Now list may take
    one, the job closest to the resume (closest_fit_now_job).
    """
    counts = {REGION_IN_REGION: 0, REGION_REMOTE: 0, REGION_OUT: 0, REGION_UNKNOWN: 0}
    if not region.active:
        return results, counts
    kept = []
    for item in results:
        if item["match_type"] == LOW_MATCH:
            kept.append(item)
            continue
        status = job_region_status(item, region, preferences)
        counts[status] += 1
        if status in {REGION_IN_REGION, REGION_REMOTE}:
            kept.append({**item, "region_filter_status": status})
    return kept, counts


PREFERENCE_NOUNS = {"job_level": "level", "work_setup": "work setup", "salary": "salary"}


def preference_mismatch_notes(job: Dict[str, Any], preferences: Dict[str, Any], conflicts: List[str]) -> List[str]:
    """Each conflicting Step 3 answer in words: what the job offers, what was chosen."""
    preferences = preferences or {}
    values = {
        "job_level": (job.get("experience_level_required", ""), preferences.get("role_level", "")),
        "work_setup": (job.get("work_type", ""), preferences.get("work_setup", "")),
        "salary": (job.get("salary_range_monthly_php", ""),
                   preferences.get("salary_expectation", "") or preferences.get("salary", "")),
    }
    notes = []
    for name in conflicts:
        offered, chosen = (clean_text(value) for value in values[name])
        notes.append(f"{PREFERENCE_NOUNS[name]} {offered} (you chose {chosen})")
    return notes


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


@lru_cache(maxsize=1)
def course_evidence_extractor() -> SkillExtractor:
    """The shared extractor over every skill, reviewed or not, for reading course text."""
    ensure_taxonomy_current()
    return SkillExtractor(SKILLS_REFERENCE_PATH, extra_rows=_taxonomy_state["additions"], include_inactive=True)


@lru_cache(maxsize=4096)
def resource_skill_evidence(text: str) -> frozenset:
    """Taxonomy skills a learning resource's own text names, read like a resume.

    A catalog skill mapping is trusted only for skills listed here (or when a
    reviewer verified the resource); see learning_recommender._prepare_resources.
    """
    equivalents = skill_id_equivalents()
    found = set()
    for item in course_evidence_extractor().extract_skills(text, limit=None):
        skill_id = clean_text(item.get("skill_id", "")).upper()
        if skill_id:
            found.add(equivalents.get(skill_id, skill_id))
    return frozenset(found)


def learning_skill_id(value: str) -> str:
    """A missing skill's taxonomy ID as matching resolves it, or "" for a named-only skill."""
    labels, _ = canonical_skill_lookup()
    key = _skill_key(value)
    return key if key in labels else ""


def learning_recommendations_for(matches: List[Dict[str, Any]], preferences: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Learning resources for the matches' gaps, resolved exactly as the matches were."""
    equivalents = skill_id_equivalents()
    return recommend_learning_resources_for_matches(
        matches, preferences=preferences or {}, skill_evidence=resource_skill_evidence,
        resolve_skill_id=learning_skill_id, canonical_id=lambda skill_id: equivalents.get(skill_id, skill_id))


def learning_by_skill_for(skills: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Courses keyed by skill for aggregated gaps, resolved exactly as the matches were."""
    equivalents = skill_id_equivalents()
    return recommend_learning_resources_by_skill(
        skills, skill_evidence=resource_skill_evidence,
        canonical_id=lambda skill_id: equivalents.get(skill_id, skill_id))


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
    mismatch_notes: Sequence[str] = (),
    closest_fit_now: bool = False,
) -> str:
    """An explanation that quotes the resume evidence behind the match.

    Missing skills are described as not found in the resume, never as skills
    the candidate lacks, unless the candidate removed them in Step 2.
    ``closest_fit_now``: listed as Fit-Now only as the job closest to the resume.
    """
    if not requirements_available:
        note = (f" It differs from your Step 3 choices: {'; '.join(mismatch_notes)}."
                if match_type == ASPIRATION and mismatch_notes else "")
        return (f"The posting for {job_title} lists no skills Kareerly can compare with your resume, "
                f"so its score reflects role similarity only and no skill evidence or gaps can be shown.{note}")
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
    if match_type == FIT_NOW and closest_fit_now:
        lead = (f"No job meets every Fit-Now requirement yet; {job_title} is the closest to your resume, "
                "so it is shown as your best Fit-Now option.")
    elif match_type == FIT_NOW:
        lead = f"{job_title} is a Fit-Now match: your resume covers its must-have skills and most of its required skills."
    elif match_type == ASPIRATION:
        if in_preferred_career_area:
            lead = f"{job_title} is an Aspiration: it is in the career area you chose in Step 3."
        else:
            lead = f"{job_title} is an Aspiration: it is related to your experience and shares skills with it."
        if not shown:
            # Membership follows Step 3; the resume only shows how far there is to go.
            parts.insert(0, "Your resume does not show any of its listed skills yet, so every one is a step toward it.")
    else:
        lead = f"{job_title} has little overlap with your resume."
    if match_type == ASPIRATION and mismatch_notes:
        parts.append("It differs from your Step 3 choices: " + "; ".join(mismatch_notes) + ".")
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

    # Step 3 answers the job does not fit. They never remove an Aspiration
    # job; preference alignment orders the list and the explanation says so.
    conflicts = preference_conflicts(job, preferences)
    breakdown = score_match(
        float(job.get("semantic_score_raw", job.get("semantic_score", 0.0))),
        SkillEvidence(skill_result["matched_skills"], skill_result["missing_skills"]),
        SkillEvidence(preferred_matched, preferred_missing),
        critical_missing_count=len(critical_missing),
        thresholds=thresholds,
        in_preferred_career_area=in_preferred_area,
        role_held=resume_names_role(job.get("job_title", ""), resume_text),
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
        "psoc_unit_code": job.get("psoc_unit_code", ""), "psoc_title": job.get("psoc_title", ""),
        "company": job.get("company_name", ""), "company_name": job.get("company_name", ""),
        "job_source": job.get("job_source", "internal"), "job_category": job.get("job_category", ""),
        "job_subcategory": job.get("job_subcategory", ""), "category_id": job.get("category_id_norm", ""),
        "career_area": area, "in_preferred_career_area": in_preferred_area,
        # Step 3 answers this job does not fit (job_level, work_setup, salary),
        # and the same in words ("On-site work (you chose remote)").
        "preference_conflicts": conflicts,
        "preference_mismatch_notes": preference_mismatch_notes(job, preferences, conflicts),
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
            semantic_section, in_preferred_area, requirements_available,
            preference_mismatch_notes(job, preferences, conflicts)),
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
        "learning_recommendations": learning_recommendations_for([scored_match], preferences),
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


def closest_fit_now_job(
    results: List[Dict[str, Any]], region: RegionPreference, preferences: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """The job to list as Fit-Now when no allowed job passes the Fit-Now rules.

    Fit-Now reads the resume, so the candidate always sees the job closest to
    it, whatever the Step 3 answers: one that passes every Fit-Now rule first,
    then one the region filter allows, then the highest match score (resume
    similarity and skill coverage only), required coverage and similarity.
    It is marked ``fit_now_fallback``; its failed rules stay in the breakdown
    and its explanation says it is the closest rather than a full Fit-Now.
    None only when there is no job to compare.
    """
    def region_status(item: Dict[str, Any]) -> str:
        return job_region_status(item, region, preferences) if region.active else ""

    def key(item: Dict[str, Any]) -> Tuple:
        return (
            item["match_type"] == FIT_NOW,
            region_status(item) in {"", REGION_IN_REGION, REGION_REMOTE},
            float(item.get("match_score") or 0.0),
            float(item.get("required_skill_coverage") or 0.0),
            float(item.get("semantic_score") or 0.0),
        )

    if not results:
        return None
    # Highest key first; the job ID breaks a full tie so the choice is stable.
    best = sorted(sorted(results, key=lambda item: str(item.get("job_id", ""))), key=key, reverse=True)[0]
    closest = best["match_type"] != FIT_NOW
    status = region_status(best)
    item = {**best, "match_type": FIT_NOW, "match_category": FIT_NOW, "aspiration_gap_skills": [],
            "fit_now_fallback": True,
            "fit_now_fallback_reason": "closest_to_resume" if closest else "outside_region_filter"}
    if status:
        item["region_filter_status"] = status
    if closest:
        item["match_reason"] = match_reason(FIT_NOW, item["matched_skills"], item["missing_skills"],
            item["match_breakdown"]["required_skill_count"], item["in_preferred_career_area"], closest_fit_now=True)
        item["explanation"] = grounded_explanation(item["job_title"], FIT_NOW, item["matched_skill_evidence"],
            item["missing_skill_status"], item["semantic_evidence_section"], item["in_preferred_career_area"],
            item["skill_requirements_available"], closest_fit_now=True)
    if status not in {"", REGION_IN_REGION, REGION_REMOTE}:
        item["explanation"] += " It is outside the region you chose, where no job meets every Fit-Now requirement."
    return item


def _recommendation_notice(
    catalog: Dict[str, Any], fit_now: List[Dict[str, Any]], aspiration: List[Dict[str, Any]],
    location_filter: Optional[Dict[str, Any]] = None,
) -> str:
    if catalog["state"] != "available":
        return catalog["message"]
    location_filter = location_filter or {}
    fallback = next((item for item in fit_now if item.get("fit_now_fallback")), None)
    if fallback:
        region_name = location_filter.get("region_name") or "the region you chose"
        if fallback["fit_now_fallback_reason"] == "closest_to_resume":
            notice = ("No job meets every Fit-Now requirement yet. Fit-Now shows the job closest to your resume "
                      "and the skills it still needs.")
            if fallback.get("region_filter_status") in {REGION_OUT, REGION_UNKNOWN}:
                notice += f" It is outside {region_name}, which has no job to compare."
        else:
            notice = (f"No job in {region_name} meets every Fit-Now requirement. "
                      "Fit-Now shows the closest job to your resume from outside it.")
        if aspiration:
            notice += " The Aspiration list shows roles in the career area you chose."
        elif location_filter.get("active"):
            notice += (" No Aspiration role was found in that region; choosing another region or "
                       "\"Anywhere in the Philippines\" may show more.")
        else:
            notice += (" None fits the career area you chose in Step 3; choosing another career area may show "
                       "Aspiration roles.")
        return notice
    if location_filter.get("active") and not fit_now and not aspiration:
        return (f"No matching jobs were found in {location_filter['region_name']}. "
                "Jobs whose region could not be confirmed are not shown while a region filter is on. "
                "Choose another region or \"Anywhere in the Philippines\" to see more.")
    if not fit_now and not aspiration:
        return ("None of the available jobs is a Fit-Now match for your resume, and none fits the career area "
                "and preferences you chose in Step 3. Choosing another career area, or answering \"not sure\" "
                "where you are flexible on job level, work setup or salary, may show more.")
    if not fit_now:
        return ("No job meets every Fit-Now requirement yet. The Aspiration list shows roles in the career area "
                "you chose and the specific skills each one still needs.")
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
    # Checked first: a region filter without a usable region is the caller's
    # error, never a reason to guess one or to drop the filter.
    region = region_preference(preferences)
    context = _prepare_candidate_context(resume_text, confirmed_skills, removed_skill_ids)
    # Stage 1, constraint gating: the client's job level is never trusted for
    # a career area the candidate has no confirmed skills in.
    preferences, job_level_lock = gate_job_level(preferences, context.skill_records)
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
    # Aspiration may be empty; Fit-Now is never empty while there are jobs
    # (see closest_fit_now_job). Nothing else is moved between lists.
    # The region filter narrows which jobs may be recommended before the top
    # Fit-Now and Aspiration jobs are chosen; it never changes a score.
    eligible_results, region_counts = apply_region_filter(results, region, preferences)
    location_filter = {
        **region.as_dict(),
        "remote_allowed": candidate_allows_remote(preferences),
        "jobs_in_region": region_counts[REGION_IN_REGION],
        "remote_jobs_included": region_counts[REGION_REMOTE],
        "excluded_out_of_region": region_counts[REGION_OUT],
        "excluded_region_unknown": region_counts[REGION_UNKNOWN],
    }
    ranker = active_ranker()
    fit_now_pool = [item for item in eligible_results if item["match_type"] == FIT_NOW]
    # Fit-Now reads the resume: whatever the Step 3 answers, it lists at least
    # the job closest to the resume. That job is not listed again as Aspiration.
    fallback = None if fit_now_pool else closest_fit_now_job(results, region, preferences)
    if fallback:
        fit_now_pool = [fallback]
    fallback_ids = {fallback["job_id"]} if fallback else set()
    all_fit_now_matches = rank_category(fit_now_pool, FIT_NOW, ranker)
    all_aspiration_matches = rank_category([item for item in eligible_results
        if item["match_type"] == ASPIRATION and item["job_id"] not in fallback_ids], ASPIRATION, ranker)
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
    learning_recommendations = learning_recommendations_for(
        all_fit_now_matches[:LEARNING_MATCHES_PER_TYPE] + all_aspiration_matches[:LEARNING_MATCHES_PER_TYPE],
        preferences,
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
        "job_level_lock": job_level_lock,
        "catalog_status": catalog,
        "location_filter": location_filter,
        "recommendation_notice": _recommendation_notice(catalog, all_fit_now_matches, all_aspiration_matches, location_filter),
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
            # The job listed as Fit-Now because none passed every rule, or None.
            "fit_now_fallback": ({"job_id": fallback["job_id"], "reason": fallback["fit_now_fallback_reason"],
                "scored_as": next(item["match_type"] for item in results if item["job_id"] == fallback["job_id"])}
                if fallback else None),
            "closest_count": 0,
            "aspiration_count": len(all_aspiration_matches),
            "low_match_count": sum(1 for item in results
                if item["match_type"] == LOW_MATCH and item["job_id"] not in fallback_ids),
            "preferred_career_area": normalize_career_area(preferences.get("industry", "")),
            # Fields left open ("I'm not sure", "Flexible - no preference") that
            # did not filter or lower any job.
            "unrestricted_preferences": unrestricted_preference_fields(preferences),
            "location_filter": location_filter,
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
                "fallback": "when no allowed job passes, the job closest to the resume is listed, whatever the preferences",
            },
            "aspiration_rules": {
                "basis": "Step 3 career area",
                "ordering": "preference alignment (job level, work setup, salary fit first), then match score",
                "resume_role": "score, order and skill gaps only",
                # Used only when no career area is known for the candidate or the job.
                "fallback_min_cosine": thresholds.aspiration_min_semantic,
                "fallback_min_matched_skills": thresholds.aspiration_min_matched_skills,
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
    """Missing skills of the given (returned) matches, in the Skills page's tiers and order.

    Gaps are grouped by canonical skill ID, so two spellings of one skill are
    one gap. A gap is essential when at least one of the jobs requires it
    (required or must-have) and optional when the jobs only prefer it. The
    tier and order follow skill_gap_config: required by 2+ jobs, then required
    by 1 or nice to have for 2+, then nice to have for 1; within a tier, the
    most jobs first, then the highest match %. Each gap lists the jobs it
    affects. ``limit=None`` returns every gap.
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
        counted = set()
        for gap_type, skills in ((GAP_ESSENTIAL, essential), (GAP_OPTIONAL, optional)):
            for skill in skills:
                key = _skill_key(skill)
                if key in counted:
                    continue
                counted.add(key)
                item = gap_counts.setdefault(key, {
                    "skill": display_skill_name(key, labels, skill), "essential": 0, "optional": 0,
                    "must_have": 0, "removed": False, "best_match_pct": 0.0,
                    "appears_in_fit_now": 0, "appears_in_aspiration": 0, "affected_jobs": [],
                })
                item[gap_type] += 1
                item["must_have"] += int(skill in must_have)
                item["removed"] = item["removed"] or skill in removed
                item["best_match_pct"] = max(item["best_match_pct"], float(match.get("match_percentage") or 0.0))
                if match_type == FIT_NOW:
                    item["appears_in_fit_now"] += 1
                else:
                    item["appears_in_aspiration"] += 1
                item["affected_jobs"].append({
                    "job_id": match.get("job_id", ""), "job_title": match.get("job_title", ""),
                    "match_type": match_type, "requirement": gap_type,
                })

    gap_list = []
    for key, item in gap_counts.items():
        frequency = len(item["affected_jobs"])
        gap_type = GAP_ESSENTIAL if item["essential"] else GAP_OPTIONAL
        tier = gap_config.assign_tier(item["essential"], item["optional"])
        gap_list.append({
            "skill_name": item["skill"],
            "skill": item["skill"],
            "skill_id": key if key in labels else "",
            "gap_type": gap_type,
            "is_essential": gap_type == GAP_ESSENTIAL,
            "is_must_have": bool(item["must_have"]),
            # "not_found_in_resume" does not mean the candidate lacks the skill.
            "evidence_status": MISSING_REMOVED if item["removed"] else MISSING_NOT_FOUND,
            "tier": tier,
            # The tier's label, where older clients read a priority.
            "severity": gap_config.TIER_LABELS[tier],
            "priority": gap_config.TIER_LABELS[tier],
            "frequency": frequency,
            "best_match_pct": round(item["best_match_pct"], 2),
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

    gap_list.sort(key=lambda gap: gap_config.skill_sort_key(
        gap["tier"], gap["frequency"], gap["best_match_pct"], gap["skill_name"]))
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
