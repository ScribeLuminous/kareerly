"""Semantic retrieval and optional top-K reranking for Kareerly.

The trained bi-encoder is the primary matching model: it embeds a taxonomy-
enriched candidate profile and every taxonomy-enriched job in the same vector
space, then retrieves jobs by cosine similarity.  The Cross-Encoder is an
optional experimental stage and only reorders the retrieved shortlist.  It is
disabled by default until real Philippine relevance judgements show that it
improves the held-out ranking metrics.

Scores in this module are deliberately never min-max normalised.  Cosine
similarity is retained as the model score; the 0..1 ``semantic_score`` field is
only the fixed transformation ``(cosine + 1) / 2`` for UI compatibility and is
not described as a probability.
"""

from __future__ import annotations

import hashlib
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


BACKEND_DIR = Path(__file__).resolve().parents[2]
RETRIEVER_MODEL_PATH = (
    BACKEND_DIR
    / "trained_models"
    / "kareerly-retriever-skills-first-2026-09-10-gpu"
)
RERANKER_MODEL_PATH = BACKEND_DIR / "trained_models" / "kareerly-scorer"

DEFAULT_RETRIEVAL_TOP_K = 50
DEFAULT_RERANK_TOP_K = 20

_JOB_EMBEDDING_CACHE: Dict[str, np.ndarray] = {}


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_positive_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _clean(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return " ".join(str(value).split())


def _bounded_cosine(value: float) -> float:
    """Map cosine similarity to 0..1 without catalogue-relative scaling."""
    return min(max((float(value) + 1.0) / 2.0, 0.0), 1.0)


def build_job_semantic_text(job: Dict[str, Any]) -> str:
    """Build the same explicit, taxonomy-aware representation for every job."""
    sections = [
        f"[JOB TITLE] {_clean(job.get('job_title'))}",
        f"[CATEGORY] {_clean(job.get('job_category'))}",
        f"[SUBCATEGORY] {_clean(job.get('job_subcategory'))}",
        f"[DESCRIPTION] {_clean(job.get('job_description'))}",
        f"[ESSENTIAL SKILLS] {_clean(job.get('mapped_required_skill_names') or job.get('required_skills_comma_separated'))}",
        f"[ESSENTIAL SKILL IDS] {_clean(job.get('must_have_skill_ids') or job.get('required_skill_ids'))}",
        f"[OPTIONAL SKILLS] {_clean(job.get('mapped_nice_to_have_skill_names') or job.get('nice_to_have_skills_optional'))}",
        f"[OPTIONAL SKILL IDS] {_clean(job.get('nice_to_have_skill_ids'))}",
        f"[EXPERIENCE] {_clean(job.get('experience_level_required'))}",
        f"[WORK SETUP] {_clean(job.get('work_type'))}",
        f"[LOCATION] {_clean(job.get('location'))}",
    ]
    text = " ".join(section for section in sections if section.rsplit("]", 1)[-1].strip())
    if len(text) >= 50:
        return text
    return _clean(job.get("job_text") or job.get("job_text_for_matching"))


@lru_cache(maxsize=1)
def _load_retriever():
    from sentence_transformers import SentenceTransformer

    override = os.getenv("KAREERLY_RETRIEVER_MODEL_PATH", "").strip()
    model_path = Path(override) if override else RETRIEVER_MODEL_PATH
    if not model_path.exists():
        raise FileNotFoundError(f"Trained Kareerly retriever not found: {model_path}")
    return SentenceTransformer(str(model_path), device=os.getenv("KAREERLY_MODEL_DEVICE", "cpu"))


@lru_cache(maxsize=1)
def _load_reranker():
    from sentence_transformers import CrossEncoder

    override = os.getenv("KAREERLY_RERANKER_MODEL_PATH", "").strip()
    model_path = Path(override) if override else RERANKER_MODEL_PATH
    if not model_path.exists():
        raise FileNotFoundError(f"Trained Kareerly reranker not found: {model_path}")
    return CrossEncoder(str(model_path), device=os.getenv("KAREERLY_MODEL_DEVICE", "cpu"))


def _job_matrix(model: Any, texts: list[str]) -> np.ndarray:
    fingerprint = hashlib.sha256("\n\x1f\n".join(texts).encode("utf-8")).hexdigest()
    cached = _JOB_EMBEDDING_CACHE.get(fingerprint)
    if cached is not None:
        return cached

    matrix = np.asarray(
        model.encode(
            texts,
            batch_size=64,
            normalize_embeddings=True,
            show_progress_bar=False,
        ),
        dtype=float,
    )
    # Supabase jobs can change. Keep only a few catalogue versions in memory.
    if len(_JOB_EMBEDDING_CACHE) >= 4:
        _JOB_EMBEDDING_CACHE.pop(next(iter(_JOB_EMBEDDING_CACHE)))
    _JOB_EMBEDDING_CACHE[fingerprint] = matrix
    return matrix


def retrieve_jobs(
    candidate_text: str,
    jobs_df: pd.DataFrame,
    top_k: Optional[int] = None,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Retrieve jobs with the trained bi-encoder, with an explicit fallback."""
    if jobs_df.empty:
        return jobs_df.copy(), {
            "retrieval_method": "trained_semantic_bi_encoder_taxonomy_enriched_inputs",
            "retrieval_fallback": False,
            "retrieved_jobs": 0,
        }

    requested_top_k = top_k or _env_positive_int(
        "KAREERLY_RETRIEVAL_TOP_K", DEFAULT_RETRIEVAL_TOP_K
    )
    # For a small thesis catalogue, score all jobs so retrieval cannot hide a
    # relevant item. Once the catalogue grows, use the measured Recall@K to set K.
    effective_top_k = len(jobs_df) if len(jobs_df) <= 200 else min(requested_top_k, len(jobs_df))
    documents = [build_job_semantic_text(row) for row in jobs_df.to_dict(orient="records")]

    try:
        model = _load_retriever()
        job_vectors = _job_matrix(model, documents)
        candidate_vector = np.asarray(
            model.encode(
                [candidate_text],
                normalize_embeddings=True,
                show_progress_bar=False,
            )[0],
            dtype=float,
        )
        raw_scores = job_vectors @ candidate_vector
        method = "trained_semantic_bi_encoder_taxonomy_enriched_inputs"
        fallback = False
    except Exception as exc:
        vectorizer = TfidfVectorizer(
            lowercase=True,
            stop_words="english",
            max_features=50000,
            ngram_range=(1, 2),
        )
        matrix = vectorizer.fit_transform([candidate_text, *documents])
        raw_scores = cosine_similarity(matrix[0], matrix[1:]).flatten()
        method = "tfidf_fallback"
        fallback = True
        fallback_reason = f"{type(exc).__name__}: {exc}"

    order = np.argsort(-np.asarray(raw_scores, dtype=float))[:effective_top_k]
    retrieved = jobs_df.iloc[order].copy().reset_index(drop=True)
    ordered_raw = np.asarray(raw_scores, dtype=float)[order]
    retrieved["semantic_score_raw"] = [round(float(score), 6) for score in ordered_raw]
    retrieved["semantic_score"] = [round(_bounded_cosine(float(score)), 6) for score in ordered_raw]
    retrieved["retrieval_rank"] = list(range(1, len(retrieved) + 1))
    retrieved["semantic_scoring_method"] = method
    retrieved["semantic_document"] = [documents[index] for index in order]

    provenance: Dict[str, Any] = {
        "retrieval_method": method,
        "retrieval_fallback": fallback,
        "retrieval_top_k_requested": requested_top_k,
        "retrieval_top_k_effective": effective_top_k,
        "retrieved_jobs": len(retrieved),
    }
    if fallback:
        provenance["retrieval_fallback_reason"] = fallback_reason
    return retrieved, provenance


def rerank_jobs(
    candidate_text: str,
    retrieved_df: pd.DataFrame,
    *,
    enabled: Optional[bool] = None,
    top_k: Optional[int] = None,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Optionally reorder only the leading semantic candidates."""
    if retrieved_df.empty:
        return retrieved_df.copy(), {
            "reranking_method": "not_run_empty_pool",
            "reranked_jobs": 0,
        }

    use_reranker = (
        _env_flag("KAREERLY_ENABLE_CROSS_ENCODER_RERANKER", False)
        if enabled is None
        else enabled
    )
    if not use_reranker:
        output = retrieved_df.copy().reset_index(drop=True)
        output["pipeline_rank"] = list(range(1, len(output) + 1))
        output["reranker_score_raw"] = np.nan
        output["reranking_method"] = "disabled_until_human_validation"
        return output, {
            "reranking_method": "disabled_until_human_validation",
            "reranked_jobs": 0,
        }

    rerank_top_k = min(
        top_k or _env_positive_int("KAREERLY_RERANK_TOP_K", DEFAULT_RERANK_TOP_K),
        len(retrieved_df),
    )
    leading = retrieved_df.iloc[:rerank_top_k].copy()
    remainder = retrieved_df.iloc[rerank_top_k:].copy()

    try:
        model = _load_reranker()
        pairs = [
            [candidate_text, document]
            for document in leading["semantic_document"].astype(str).tolist()
        ]
        scores = np.asarray(
            model.predict(pairs, batch_size=16, show_progress_bar=False),
            dtype=float,
        ).reshape(-1)
        leading["reranker_score_raw"] = scores
        leading = leading.sort_values("reranker_score_raw", ascending=False)
        method = "trained_kareerly_cross_encoder_top_k"
        fallback_reason = ""
    except Exception as exc:
        leading["reranker_score_raw"] = np.nan
        method = "reranker_unavailable_dense_order_preserved"
        fallback_reason = f"{type(exc).__name__}: {exc}"

    remainder["reranker_score_raw"] = np.nan
    output = pd.concat([leading, remainder], ignore_index=True)
    output["pipeline_rank"] = list(range(1, len(output) + 1))
    output["reranking_method"] = method
    provenance = {
        "reranking_method": method,
        "reranked_jobs": rerank_top_k if not fallback_reason else 0,
        "reranking_top_k": rerank_top_k,
    }
    if fallback_reason:
        provenance["reranking_fallback_reason"] = fallback_reason
    return output, provenance


def semantic_match_candidates(
    candidate_text: str,
    jobs_df: pd.DataFrame,
    *,
    retrieval_top_k: Optional[int] = None,
    reranker_enabled: Optional[bool] = None,
    reranker_top_k: Optional[int] = None,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    retrieved, retrieval_state = retrieve_jobs(candidate_text, jobs_df, retrieval_top_k)
    ranked, reranking_state = rerank_jobs(
        candidate_text,
        retrieved,
        enabled=reranker_enabled,
        top_k=reranker_top_k,
    )
    return ranked, {**retrieval_state, **reranking_state}
