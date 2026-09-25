# backend/app/services/matching_service.py

import io
import os
import re
import hashlib
import logging
import threading
import time
from collections import OrderedDict
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
from .resume_parser import extract_text_from_docx as parse_docx_text, extract_text_from_pdf as parse_pdf_text
from .skill_extractor import SkillExtractor
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
    "education-health-community": {
        "education and training",
        "social and community services",
        "healthcare and clinical services",
        "caregiving and wellness",
    },
    "engineering-trades-operations": {
        "engineering and architecture",
        "construction and skilled trades",
        "hospitality and tourism",
        "food service and personal care",
        "logistics, transport, and warehousing",
        "manufacturing and quality operations",
        "agriculture, forestry, fishery, and environment",
    },
    "government-legal-security": {
        "public administration and government",
        "legal, security, and protective services",
    },
}

CAREER_AREA_ALIASES = {
    "technology data": "technology-data",
    "technology data business finance": "technology-data",
    "tech business finance": "technology-data",
    "business office": "business-office",
    "business finance and office administration": "business-office",
    "sales marketing customer service": "sales-marketing-customer-service",
    "sales marketing customer relations": "sales-marketing-customer-service",
    "creative media and communications": "communications-creative-media",
    "communications creative media": "communications-creative-media",
    "education health and community": "education-health-community",
    "education healthcare hospitality and community services": "education-health-community",
    "engineering trades and operations": "engineering-trades-operations",
    "engineering manufacturing agriculture logistics and field operations": "engineering-trades-operations",
    "government legal and security": "government-legal-security",
    "public service legal protective services and other": "government-legal-security",
}


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
        if 1 <= number <= 24:
            return f"K{number:02d}"

    if value.isdigit():
        number = int(value)
        if 1 <= number <= 24:
            return f"K{number:02d}"

    return value


def normalize_career_area(value: Any) -> str:
    normalized = normalize_for_match(value)
    if normalized in CAREER_AREA_JOB_CATEGORIES:
        return normalized
    return CAREER_AREA_ALIASES.get(normalized, "")


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
    if area:
        return area
    category_id = normalize_category_id(job.get("category_id_norm") or job.get("category_id") or "")
    return career_area_by_category_id().get(category_id, "")


# ============================================================
# RESUME FILE READING
# ============================================================

def extract_text_from_pdf(file_bytes: bytes) -> str:
    return clean_text(repair_letter_spaced_text(parse_pdf_text(io.BytesIO(file_bytes))))


def extract_text_from_docx(file_bytes: bytes) -> str:
    # The same reader as the Step 1 analyzer, so both routes see identical text.
    return clean_text(repair_letter_spaced_text(parse_docx_text(io.BytesIO(file_bytes))))


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
        if df[col].dtype == "object":
            df[col] = df[col].fillna("").apply(clean_text)

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
        skills = pd.DataFrame(taxonomy_additions.merge_reference_rows(base.to_dict(orient="records"), additions)).fillna("")
    else:
        skills = base.copy()
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

# Rows added by hand with curated spellings ("MS Excel", "Adobe Photoshop") in
# related_skills. Unlike the imported ESCO labels, every one of them is a name
# people use for exactly that skill, so they identify it like the label does.
CURATED_SKILL_SOURCE = "workplace_tools_expansion_2026_09"


def _curated_aliases(row: Any) -> List[str]:
    if clean_text(row.get("source_note", "")) != CURATED_SKILL_SOURCE:
        return []
    return split_skill_list(row.get("related_skills", ""))


@lru_cache(maxsize=1)
def skill_evidence_phrases() -> Dict[str, List[str]]:
    """Names that show a taxonomy skill in resume text: its label, plus curated spellings."""
    phrases: Dict[str, List[str]] = {}
    for _, row in load_skills_reference().iterrows():
        skill_id = clean_text(row.get("skill_id", "")).upper()
        label = clean_text(row.get("skill_name", ""))
        if skill_id and label:
            phrases[skill_id] = list(dict.fromkeys([label, *_curated_aliases(row)]))
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
        # "HubSpot CRM" names the taxonomy skill "HubSpot".
        key = next((aliases[variant] for variant in _phrase_variants(normalized) if variant in aliases),
            "CUSTOM:" + normalized)
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


def _phrase_in_text(phrase: str, text_norm: str) -> bool:
    phrase_norm = normalize_for_match(phrase)
    if len(phrase_norm) < 3 or not text_norm:
        return False
    for variant in _phrase_variants(phrase_norm):
        if re.search(r"(?<![a-z0-9+#])" + re.escape(variant) + r"(?![a-z0-9+#])", text_norm):
            return True
        compact = _compact(variant)
        if len(compact) >= 5 and compact in _compact_word_runs(text_norm):
            return True
    return False


def compute_skill_coverage(
    candidate_skills: List[str],
    required_skills: List[str],
    resume_text: str = "",
) -> Dict[str, Any]:
    """Coverage over canonical skill keys, each requirement counted once.

    A requirement can also be met by its name appearing in the resume text:
    Step 2 confirms at most MAX_CONFIRMED_SKILLS skills, and requirements with
    no taxonomy ID (custom names or legacy SK_* IDs) have no confirmed ID that
    could represent them at all. Taxonomy skills are checked by their canonical
    label only, never by the broad imported aliases.
    """
    labels, _ = canonical_skill_lookup()
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

    def held(key: str) -> bool:
        if key in candidates:
            return True
        phrases = skill_evidence_phrases().get(key) or [required[key]]
        if any(_phrase_in_text(phrase, text_norm) for phrase in phrases):
            return True
        for phrase in related_skill_evidence().get(key, []):
            if _phrase_in_text(phrase, profile_norm):
                related_credit[required[key]] = phrase
                return True
        return False

    matched = [key for key in required if held(key)]
    missing = [key for key in required if key not in matched]
    return {
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
        words = [word for word in re.split(r"[_-]+", legacy.group(1)) if word]
        return " ".join(word.upper() if len(word) <= 3 else word.capitalize() for word in words)
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
    """Monthly PHP range from "30-50", "PHP 80,000+/month" or "₱18,000-₱30,000"."""
    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", value.replace(",", ""))]
    numbers = [n * 1000 if n < 1000 else n for n in numbers]
    if not numbers:
        return None
    if len(numbers) == 1:
        return (numbers[0], float("inf")) if "+" in value else (numbers[0], numbers[0])
    return min(numbers[:2]), max(numbers[:2])


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
    preferred_career_area = normalize_career_area(preferred_industry)
    role_level = normalize_for_match(preferences.get("role_level", ""))
    target_role = normalize_for_match(preferences.get("target_role", ""))
    work_setup = normalize_for_match(preferences.get("work_setup", ""))
    salary_expectation = normalize_for_match(preferences.get("salary_expectation", ""))
    skill_to_develop = normalize_for_match(preferences.get("skill_to_develop", ""))

    def specified(value: str) -> bool:
        return (bool(value) and value not in {"any", "flexible", "unsure"}
            and "not sure" not in value and "no preference" not in value)

    # Step 3 asks for a job level; older clients send it as the target role too.
    if target_role and _role_level(target_role) and _role_level(target_role) == _role_level(role_level):
        target_role = ""

    if specified(preferred_industry):
        total += 0.25
        category_matches = bool(preferred_career_area) and job_career_area(job) == preferred_career_area
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
        wanted_salary = _salary_range(salary_expectation)
        job_salary = _salary_range(salary)
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


def bi_encoder_score_jobs(candidate_input: str, jobs_df: pd.DataFrame) -> pd.DataFrame:
    scored = jobs_df.copy()
    raw_scores = score_jobs(candidate_input, job_model_inputs(jobs_df))
    scored["semantic_score_raw"] = raw_scores
    scored["semantic_score"] = np.clip(raw_scores, 0, 1)
    scored["semantic_scoring_method"] = "fine_tuned_bi_encoder_cosine"
    return scored


def _prepare_candidate_context(
    resume_text: str,
    confirmed_skills: Optional[List[Any]] = None,
) -> tuple[str, List[Dict[str, Any]], List[str], List[str]]:
    """Prepare the same candidate evidence for internal and external jobs."""
    ensure_taxonomy_current()
    resume_text = clean_text(resume_text)
    if not resume_text:
        raise ValueError("No readable resume text was provided for matching.")
    provided_confirmed_skills = confirmed_skills is not None
    confirmed_skills = confirmed_skills or []
    if len(confirmed_skills) > MAX_CONFIRMED_SKILLS:
        raise ValueError(f"You can confirm up to {MAX_CONFIRMED_SKILLS} skills.")

    extracted_skills = extract_skills_from_text(resume_text, max_skills=30)
    confirmed_skill_records: List[Dict[str, Any]] = []
    for item in confirmed_skills:
        if isinstance(item, str):
            skill_name = clean_text(item)
            if skill_name:
                confirmed_skill_records.append({"skill_id": "", "skill_name": skill_name, "source": "confirmed_legacy_name"})
            continue
        if isinstance(item, dict):
            skill_id = clean_text(item.get("skill_id", "")).upper()
            skill_name = clean_text(item.get("skill_name", "")) or get_skill_labels_by_id().get(skill_id, "")
            if not skill_name:
                continue
            confirmed_skill_records.append({
                "skill_id": skill_id,
                "skill_name": skill_name,
                "custom_skill_name": clean_text(item.get("custom_skill_name", "")),
                "source": clean_text(item.get("source", "")) or "confirmed_skill",
                "is_standardized": bool(item.get("is_standardized", bool(skill_id))),
                "source_metadata": item.get("source_metadata", {}) if isinstance(item.get("source_metadata"), dict) else {},
            })

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
    return resume_text, final_skill_records, candidate_skill_names, candidate_keys


def _critical_skill_ids(job: Dict[str, Any], required_ids: List[str]) -> List[str]:
    """Must-have IDs that an employer singled out from the required list.

    Supabase and pasted jobs store one ID list and copy it into both fields, so
    a must-have list equal to the required list carries no extra designation;
    treating it as critical would silently demand 100% coverage.
    """
    critical = split_ids(job.get("must_have_skill_ids", ""))
    if not critical or set(critical) >= set(required_ids):
        return []
    return critical


def _score_single_normalized_job(
    *,
    resume_text: str,
    job: Dict[str, Any],
    candidate_keys: List[str],
    preferences: Dict[str, Any],
    available_learning_skills: set,
    thresholds: Optional[MatchThresholds] = None,
) -> Dict[str, Any]:
    """Score one normalized job using the production matching rules."""
    required_ids = split_ids(job.get("required_skill_ids", ""))
    required_skills = required_ids or split_skill_list(job.get("required_skills_for_eval", ""))
    skill_result = compute_skill_coverage(candidate_keys, required_skills, resume_text)
    preferred_ids = split_ids(job.get("nice_to_have_skill_ids", ""))
    preferred_skills = preferred_ids or split_skill_list(
        job.get("mapped_nice_to_have_skill_names") or job.get("nice_to_have_skills_optional", "")
    )
    preferred_result = compute_skill_coverage(candidate_keys, preferred_skills, resume_text)
    # Preferred skills that are also required are already counted once.
    preferred_matched = [name for name in preferred_result["matched_skills"] if name not in skill_result["matched_skills"]]
    preferred_missing = [name for name in preferred_result["missing_skills"] if name not in skill_result["missing_skills"]]
    critical_missing = sorted(
        skill_id for skill_id in _critical_skill_ids(job, required_ids)
        if not compute_skill_coverage(candidate_keys, [skill_id], resume_text)["matched_skills"]
    )
    # Aspiration follows the career area chosen in Step 3. Unknown on either
    # side (no preference, uncategorised job) falls back to the resume rule.
    preferred_area = normalize_career_area(preferences.get("industry", ""))
    area = job_career_area(job)
    in_preferred_area = (area == preferred_area) if preferred_area and area else None

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
        "semantic_scoring_method": job.get("semantic_scoring_method", "fine_tuned_bi_encoder_cosine"),
        "semantic_score_raw": float(job.get("semantic_score_raw", 0.0)), "text_similarity": float(job.get("semantic_score_raw", 0.0)),
        "fit_now_score": score, "fit_now_percentage": round(score * 100, 2),
        "aspiration_score": score, "aspiration_percentage": round(score * 100, 2),
        "matched_skill_ids": skill_result["matched_skill_ids"], "missing_skill_ids": skill_result["missing_skill_ids"],
        "critical_missing_skill_ids": critical_missing, "required_skill_ids": ";".join(required_ids),
        "matched_skills": skill_result["matched_skills"], "missing_skills": skill_result["missing_skills"],
        "matched_preferred_skills": preferred_matched, "missing_preferred_skills": preferred_missing,
        "related_skill_credit": skill_result["related_skill_credit"],
        "skill_requirements_available": requirements_available,
        "score_basis": "semantic_and_skills" if requirements_available else "role_similarity_only",
        "match_reason": match_reason(match_type, skill_result["matched_skills"], skill_result["missing_skills"],
            breakdown.required_skill_count, in_preferred_area),
        "match_breakdown": breakdown.as_dict(),
        "explanation": generate_match_explanation(job.get("job_title", ""), match_type, skill_result["matched_skills"],
            skill_result["missing_skills"], skill_coverage, preference_alignment, in_preferred_area,
            requirements_available=requirements_available),
    }


def analyze_candidate_job_match(
    resume_text: str,
    job: Dict[str, Any],
    *,
    preferences: Optional[Dict[str, Any]] = None,
    confirmed_skills: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    """Run one internal or pasted job through the shared production matcher."""
    resume_text, skill_records, candidate_skill_names, candidate_keys = _prepare_candidate_context(resume_text, confirmed_skills)
    normalized_job = dict(job)
    normalized_job.setdefault("job_description", "")
    normalized_job.setdefault("job_title", "")
    normalized_job.setdefault("required_skills_for_eval", "")
    candidate_input = build_model_input(resume_text, skill_names=candidate_skill_names)
    scored = bi_encoder_score_jobs(candidate_input, pd.DataFrame([normalized_job])).iloc[0].to_dict()
    scored_match = _score_single_normalized_job(
        resume_text=resume_text,
        job=scored,
        candidate_keys=candidate_keys,
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
        },
        "learning_recommendations": recommend_learning_resources_for_matches([scored_match], preferences=preferences or {}),
        "candidate_skill_records": skill_records,
        "metadata": {"model_version": MODEL_ID, "matching_source": "shared_kareerly_matching_service"},
    }


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
    in_preferred_career_area: Optional[bool] = None,
    *,
    requirements_available: bool = True,
) -> str:
    if not requirements_available:
        basis = "is in the career area you chose" if in_preferred_career_area else "is related to your resume"
        return (
            f"This role is showing as {match_type} because it {basis}. The posting for {job_title} lists no skills "
            "Kareerly can compare with your resume, so its score reflects role similarity only and no skill gaps are shown."
        )
    matched_text = ", ".join(matched_skills[:5]) if matched_skills else "some related resume evidence"
    missing_text = ", ".join(missing_skills[:5]) if missing_skills else "no major required skills"

    if match_type == FIT_NOW:
        return (
            f"This role is showing as {match_type} because your resume already reflects relevant experience for "
            f"{job_title}, including skills such as {matched_text}. "
            f"The main areas to strengthen next are {missing_text}."
        )
    if match_type == LOW_MATCH:
        return (
            f"This role is showing as a {match_type} because your current skills cover little of what "
            f"{job_title} requires. Its core requirements include {missing_text}."
        )
    if in_preferred_career_area:
        held_text = f"Your resume already shows {matched_text}. " if matched_skills else ""
        return (
            f"This role is showing as {match_type} because it is in the career area you chose. "
            f"{held_text}The skills to build next for {job_title} are {missing_text}."
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
    return match_text_to_jobs(extract_resume_text_cached(file_bytes, filename), filename=filename,
        preferences=preferences, confirmed_skills=confirmed_skills)


def match_text_to_jobs(
    resume_text: str,
    *,
    filename: str = "",
    preferences: Optional[Dict[str, Any]] = None,
    confirmed_skills: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    started_at = time.perf_counter()
    preferences = preferences or {}
    resume_text, final_skill_records, candidate_skill_names, candidate_keys = _prepare_candidate_context(
        resume_text, confirmed_skills
    )
    labels, _ = canonical_skill_lookup()
    resume_evidence_text = build_model_input(resume_text, skill_names=candidate_skill_names)
    jobs_df = load_reference_jobs()
    scored_jobs = bi_encoder_score_jobs(resume_evidence_text, jobs_df)
    available_learning_skills = reviewed_learning_skill_ids()
    thresholds = MatchThresholds.from_env()

    results = [
        _score_single_normalized_job(
            resume_text=resume_text,
            job=row.to_dict(),
            candidate_keys=candidate_keys,
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
    ranker = active_ranker()
    all_fit_now_matches = rank_category([item for item in results if item["match_type"] == FIT_NOW], FIT_NOW, ranker)
    all_aspiration_matches = rank_category(
        [item for item in results if item["match_type"] == ASPIRATION], ASPIRATION, ranker)
    applied_ranker_version = next(
        (item["ranker_version"] for item in all_fit_now_matches + all_aspiration_matches), ranker.version)
    fit_now_matches = all_fit_now_matches[:TOP_FIT_NOW]
    aspiration_matches = all_aspiration_matches[:TOP_ASPIRATION]

    prioritized_gaps = prioritize_skill_gaps(fit_now_matches + aspiration_matches)
    for gap in prioritized_gaps:
        key = _skill_key(gap["skill_name"])
        gap["skill_id"] = key if key in labels else ""
    # Cover every missing skill of the jobs the dashboard can show, so the
    # learning page has resources for whichever job the candidate focuses on.
    learning_recommendations = recommend_learning_resources_for_matches(
        all_fit_now_matches[:LEARNING_MATCHES_PER_TYPE] + all_aspiration_matches[:LEARNING_MATCHES_PER_TYPE],
        preferences=preferences,
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
            "match_breakdown",
        ]]
        .to_dict(orient="records")
        if not results_df.empty
        else []
    )

    # Why jobs missed Fit-Now, counted per rule, so an empty Fit-Now list can be
    # explained from the response (or the log) without rerunning anything.
    fit_now_blockers: Dict[str, int] = {}
    for item in results:
        for rule in item["match_breakdown"]["failed_fit_now_rules"]:
            fit_now_blockers[rule] = fit_now_blockers.get(rule, 0) + 1
    logger.info(
        "Job matching finished",
        extra={"jobs_scored": len(results), "fit_now": len(all_fit_now_matches),
            "aspiration": len(all_aspiration_matches), "fit_now_blockers": fit_now_blockers},
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
            "low_match_count": int((results_df["match_type"] == LOW_MATCH).sum()) if not results_df.empty else 0,
            "preferred_career_area": normalize_career_area(preferences.get("industry", "")),
            "fit_now_blockers": fit_now_blockers,
            "elapsed_ms": round((time.perf_counter() - started_at) * 1000, 1),
            "top_10_scores": top_10_scores,
        },
        "metadata": {
            "semantic_scoring_methods": scoring_methods,
            "model_version": MODEL_ID,
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
                "basis": "preferred_career_area" if normalize_career_area(preferences.get("industry", "")) else "resume_relatedness",
                # Used only when no career area is known for the candidate or the job.
                "min_cosine": thresholds.aspiration_min_semantic,
                "min_matched_skills": thresholds.aspiration_min_matched_skills,
            },
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

    # An empty list means the caller did not provide usable confirmed skills.
    # Preserve the normal resume-extraction path instead of treating the
    # candidate as explicitly skill-less. Without this fallback the text route
    # can never produce Fit-Now matches and often produces no matches at all.
    if not ids:
        result = match_text_to_jobs(
            resume_text_for_matching,
            preferences=preferences,
            confirmed_skills=None,
        )
        result["fit_now_matches"] = result["all_fit_now_matches"][:max(0, top_n_output)]
        result["aspiration_matches"] = result["all_aspiration_matches"][:max(0, top_n_output)]
        return result

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
            # Share of the compared matches missing the skill, stated here so
            # clients never have to guess the denominator.
            "matches_compared": len(matches),
            "missing_percentage": round(100 * frequency / len(matches), 1),
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


def warm_matching_caches() -> None:
    """Load the encoder and the build-time job vectors during startup.

    Encoding the complete internal and employer catalogue can take several minutes
    on a small deployment and holds the scoring lock while it runs, so startup
    never encodes jobs. Jobs missing from the build-time store (added or edited
    since the build) are encoded lazily by the first request that needs them.
    """
    get_bi_encoder()
    load_precomputed_job_vectors()
