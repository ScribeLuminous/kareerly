"""Interpretable match features derived from the K13 taxonomy.

This module is the answer to "the cross-encoder is a black box". It replaces an
opaque text-pair score with roughly twenty named quantities, each of which a
candidate can read and check:

    essential_coverage        0.75    "you have 3 of the 4 required skills"
    partial_credit_share      0.22    "one of those was a related skill, not exact"
    experience_gap_years     -1.0     "the post asks for 3 years, you have 2"
    work_setup_match          0.0     "you want remote, this role is onsite"

A gradient-boosted ranker over these features is still a *trained model* -- it
learns how much each signal is worth -- but nothing about the decision is
hidden, because the inputs are already the explanation.

Taxonomic partial credit is what makes this competitive with an encoder. A
candidate who knows JavaScript but not Python is not a zero against a Python
requirement; they are a 0.60, because the taxonomy places both under
SG-K01-01. That is the semantic generalisation people reach for BERT to get,
obtained here from structure you already control.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .taxonomy import RELATEDNESS, Taxonomy

SENIORITY_ORDER = {"intern": 0, "entry": 1, "mid": 2, "senior": 3, "manager": 4}
EDUCATION_ORDER = {
    "": 0, "high school": 1, "vocational": 2, "tesda": 2,
    "associate": 3, "bachelor": 4, "master": 5, "doctorate": 6,
}

#: Order matters for reporting: these are the columns of the model matrix.
FEATURE_NAMES: Tuple[str, ...] = (
    "essential_coverage",
    "essential_exact_rate",
    "partial_credit_share",
    "optional_coverage",
    "required_skill_count",
    "unmet_essential_count",
    "rare_skill_coverage",
    "category_alignment",
    "subcategory_overlap",
    "parent_group_overlap",
    "breadth_ratio",
    "experience_gap_years",
    "meets_experience",
    "seniority_distance",
    "education_gap",
    "region_match",
    "work_setup_match",
    "salary_overlap",
    "gap_closability",
    "lexical_similarity",
    # These neural signals are retained for ablation of the legacy 22-feature
    # ranker. Feature attribution is post-hoc explanation and must not be used
    # to claim that a gradient-boosted model is inherently transparent.
    "dense_similarity",
    "cross_encoder_score",
)


@dataclass
class CandidateProfile:
    skill_ids: List[str] = field(default_factory=list)
    years_experience: float = 0.0
    education: str = ""
    region: str = ""
    preferred_work_setup: str = ""
    salary_expectation: float = 0.0
    preferred_k13: List[str] = field(default_factory=list)
    text: str = ""


@dataclass
class JobPosting:
    job_id: str = ""
    essential_skill_ids: List[str] = field(default_factory=list)
    optional_skill_ids: List[str] = field(default_factory=list)
    k13_id: str = ""
    seniority: str = ""
    required_years: float = 0.0
    required_education: str = ""
    region: str = ""
    work_setup: str = ""
    salary_min: float = 0.0
    salary_max: float = 0.0
    text: str = ""


@dataclass
class RequirementTrace:
    """Per-requirement record. This is what the UI renders as the explanation."""
    required_skill_id: str
    required_label: str
    credit: float
    relation: str
    matched_skill_id: str
    matched_label: str
    idf: float

    @property
    def is_gap(self) -> bool:
        return self.credit < 1.0


def _education_rank(value: str) -> int:
    text = str(value or "").lower()
    for key in sorted(EDUCATION_ORDER, key=len, reverse=True):
        if key and key in text:
            return EDUCATION_ORDER[key]
    return 0


def _safe_ratio(numerator: float, denominator: float) -> float:
    return float(numerator / denominator) if denominator else 0.0


class FeatureExtractor:
    """Computes the feature vector and the trace that explains it."""

    def __init__(
        self,
        taxonomy: Taxonomy,
        skill_document_frequency: Optional[Dict[str, int]] = None,
        corpus_size: int = 0,
        lexical_scorer: Optional[Any] = None,
        dense_scorer: Optional[Any] = None,
        cross_encoder_scorer: Optional[Any] = None,
    ) -> None:
        self.taxonomy = taxonomy
        self.document_frequency = skill_document_frequency or {}
        self.corpus_size = corpus_size or max(len(self.document_frequency), 1)
        self.lexical_scorer = lexical_scorer
        self.dense_scorer = dense_scorer
        self.cross_encoder_scorer = cross_encoder_scorer

    # ---- IDF -------------------------------------------------------------

    def idf(self, skill_id: str) -> float:
        """Rare requirements should count for more than ubiquitous ones."""
        frequency = self.document_frequency.get(skill_id, 0)
        return math.log(1.0 + self.corpus_size / (1.0 + frequency))

    @classmethod
    def fit_document_frequency(cls, jobs: Sequence[JobPosting]) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for job in jobs:
            for skill_id in set(job.essential_skill_ids) | set(job.optional_skill_ids):
                counts[skill_id] = counts.get(skill_id, 0) + 1
        return counts

    # ---- traces ----------------------------------------------------------

    def trace(
        self, candidate: CandidateProfile, required: Sequence[str]
    ) -> List[RequirementTrace]:
        held = list(dict.fromkeys(candidate.skill_ids))
        traces: List[RequirementTrace] = []

        for skill_id in dict.fromkeys(required):
            credit, matched, relation = self.taxonomy.best_match(skill_id, held)
            traces.append(RequirementTrace(
                required_skill_id=skill_id,
                required_label=self._label(skill_id),
                credit=credit,
                relation=relation,
                matched_skill_id=matched,
                matched_label=self._label(matched) if matched else "",
                idf=self.idf(skill_id),
            ))
        return traces

    def _label(self, skill_id: str) -> str:
        skill = self.taxonomy.skills.get(skill_id)
        return skill.label if skill else skill_id

    # ---- features --------------------------------------------------------

    def extract(
        self,
        candidate: CandidateProfile,
        job: JobPosting,
        learning_available: Optional[Set[str]] = None,
    ) -> Tuple[Dict[str, float], List[RequirementTrace]]:
        traces = self.trace(candidate, job.essential_skill_ids)
        optional_traces = self.trace(candidate, job.optional_skill_ids)
        held = set(candidate.skill_ids)

        # --- skill coverage, IDF-weighted ---------------------------------
        weight_total = sum(trace.idf for trace in traces)
        weighted_credit = sum(trace.credit * trace.idf for trace in traces)
        essential_coverage = _safe_ratio(weighted_credit, weight_total)

        exact = [t for t in traces if t.relation == "exact"]
        partial = [t for t in traces if 0.0 < t.credit < 1.0]
        essential_exact_rate = _safe_ratio(len(exact), len(traces))
        partial_credit_share = _safe_ratio(
            sum(t.credit for t in partial), max(weighted_credit, 1e-9)
        )

        optional_weight = sum(t.idf for t in optional_traces)
        optional_coverage = _safe_ratio(
            sum(t.credit * t.idf for t in optional_traces), optional_weight
        )

        # Rare requirements only. If a candidate covers the distinctive skills,
        # missing a ubiquitous one matters far less.
        rare = [t for t in traces if t.idf >= 1.5]
        rare_skill_coverage = _safe_ratio(
            sum(t.credit for t in rare), len(rare)
        ) if rare else essential_coverage

        unmet = [t for t in traces if t.credit < 0.6]

        # --- taxonomy structure -------------------------------------------
        candidate_categories = {
            self.taxonomy.category_of(skill_id) for skill_id in held
        } - {""}
        category_alignment = 1.0 if job.k13_id and job.k13_id in candidate_categories else 0.0

        job_groups = {
            self.taxonomy.skills[s].parent_group_id
            for s in job.essential_skill_ids if s in self.taxonomy.skills
        } - {""}
        candidate_groups = {
            self.taxonomy.skills[s].parent_group_id
            for s in held if s in self.taxonomy.skills
        } - {""}
        parent_group_overlap = _safe_ratio(
            len(job_groups & candidate_groups), len(job_groups)
        )

        job_subs = {
            self.taxonomy.skills[s].subcategory
            for s in job.essential_skill_ids if s in self.taxonomy.skills
        } - {""}
        candidate_subs = {
            self.taxonomy.skills[s].subcategory
            for s in held if s in self.taxonomy.skills
        } - {""}
        subcategory_overlap = _safe_ratio(len(job_subs & candidate_subs), len(job_subs))

        # --- structured fields --------------------------------------------
        experience_gap = float(candidate.years_experience) - float(job.required_years)
        seniority_distance = abs(
            SENIORITY_ORDER.get(job.seniority, 1)
            - min(4, int(candidate.years_experience // 3))
        )
        education_gap = _education_rank(candidate.education) - _education_rank(job.required_education)

        region_match = 1.0 if (
            candidate.region and job.region and candidate.region == job.region
        ) else 0.0

        setup_pref = str(candidate.preferred_work_setup or "").lower()
        work_setup_match = 1.0 if (
            not setup_pref or setup_pref in {"any", "flexible"}
            or setup_pref == str(job.work_setup or "").lower()
        ) else 0.0

        if candidate.salary_expectation and job.salary_max:
            salary_overlap = 1.0 if job.salary_max >= candidate.salary_expectation else max(
                0.0, 1.0 - (candidate.salary_expectation - job.salary_max) / max(candidate.salary_expectation, 1.0)
            )
        else:
            salary_overlap = 0.5  # unstated on one side; neutral rather than punitive

        # --- reachability ---------------------------------------------------
        if unmet and learning_available is not None:
            gap_closability = _safe_ratio(
                sum(1 for t in unmet if t.required_skill_id in learning_available), len(unmet)
            )
        else:
            gap_closability = 1.0 if not unmet else 0.5

        lexical_similarity = dense_similarity = cross_encoder_score = 0.0
        if self.lexical_scorer is not None:
            lexical_similarity = float(self.lexical_scorer(candidate.text, job.text))
        if self.dense_scorer is not None:
            dense_similarity = float(self.dense_scorer(candidate.text, job.text))
        if self.cross_encoder_scorer is not None:
            cross_encoder_score = float(self.cross_encoder_scorer(candidate.text, job.text))

        features = {
            "essential_coverage": essential_coverage,
            "essential_exact_rate": essential_exact_rate,
            "partial_credit_share": partial_credit_share,
            "optional_coverage": optional_coverage,
            "required_skill_count": float(len(traces)),
            "unmet_essential_count": float(len(unmet)),
            "rare_skill_coverage": rare_skill_coverage,
            "category_alignment": category_alignment,
            "subcategory_overlap": subcategory_overlap,
            "parent_group_overlap": parent_group_overlap,
            "breadth_ratio": _safe_ratio(len(held), max(len(traces), 1)),
            "experience_gap_years": experience_gap,
            "meets_experience": 1.0 if experience_gap >= 0 else 0.0,
            "seniority_distance": float(seniority_distance),
            "education_gap": float(education_gap),
            "region_match": region_match,
            "work_setup_match": work_setup_match,
            "salary_overlap": salary_overlap,
            "gap_closability": gap_closability,
            "lexical_similarity": lexical_similarity,
            "dense_similarity": dense_similarity,
            "cross_encoder_score": cross_encoder_score,
        }
        return features, traces

    def vector(self, features: Dict[str, float]) -> List[float]:
        return [float(features.get(name, 0.0)) for name in FEATURE_NAMES]


def gaps_from_traces(
    traces: Sequence[RequirementTrace], threshold: float = 1.0
) -> List[RequirementTrace]:
    """Requirements not fully met, most valuable first (IDF x shortfall)."""
    gaps = [t for t in traces if t.credit < threshold]
    return sorted(gaps, key=lambda t: t.idf * (1.0 - t.credit), reverse=True)
