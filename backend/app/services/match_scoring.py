"""Deterministic match scoring and Fit-Now / Aspiration classification.

This module is the single place where a candidate-job pair becomes a score and
a category. Both the catalogue matcher and the pasted external-job analysis go
through :func:`score_match`, so the two paths cannot drift apart.

Signals (all on 0..1):

* semantic similarity      - fine-tuned bi-encoder cosine, negative values clipped to 0
* required skill coverage  - matched / total required canonical skills
* preferred skill coverage - matched / total preferred (nice-to-have) skills

Composite score::

    score = (W_SEM * semantic + W_REQ * required + W_PREF * preferred) / (sum of weights used)
            - penalty for explicitly critical skills that are missing

A component with no data (no required or no preferred skills listed) is left
out and the remaining weights are renormalised, so a job is neither rewarded
nor rejected for missing skill data.

Categories:

* Fit-Now     - required skills are listed, most of them are held, the role is
                semantically aligned and no explicitly critical skill is missing.
* Aspiration  - not Fit-Now, but the role is semantically related and the
                candidate already holds at least one of its skills, so the gap
                is identifiable and learnable.
* Low Match   - neither; excluded from the recommendation lists.

Threshold values were calibrated on the development split of the mock-resume
diagnostic (``scripts/diagnose_match_distribution.py``); see
``docs/matching-diagnosis.md`` for the evidence. Environment variables override
them for experiments without code changes.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Sequence

FIT_NOW = "Fit-Now"
ASPIRATION = "Aspiration"
LOW_MATCH = "Low Match"

# Composite weights. Skills carry the majority of the weight because Kareerly
# is a skills-based matcher; semantic similarity supplies role context.
MATCH_WEIGHT_SEMANTIC = 0.45
MATCH_WEIGHT_REQUIRED_SKILLS = 0.45
MATCH_WEIGHT_PREFERRED_SKILLS = 0.10

# Only skills an employer designates as critical, separately from the general
# required list, are penalised beyond their effect on coverage.
CRITICAL_MISSING_PENALTY = 0.10
MAX_CRITICAL_PENALTY = 0.20

# Fit-Now: "at least half of the required skills" is a product definition of
# readiness (a 0.34-0.60 sweep changed dev F1 by under 0.02). The 0.45 semantic
# floor is unchanged from the previous release: on the development split its F1
# is within 0.03 of the best value (0.40) and it ties on the held-out split.
FIT_NOW_MIN_REQUIRED_COVERAGE = 0.50
FIT_NOW_MIN_SEMANTIC = 0.45
# Aspiration: new floor, the development-split F1 optimum for separating
# related roles from unrelated ones; about 3% of unrelated pairs pass it.
ASPIRATION_MIN_SEMANTIC = 0.20
ASPIRATION_MIN_MATCHED_SKILLS = 1


def _configured(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    if not 0.0 <= value <= 1.0:
        raise RuntimeError(f"{name} must be between zero and one.")
    return value


@dataclass(frozen=True)
class MatchThresholds:
    fit_now_min_semantic: float
    fit_now_min_required_coverage: float
    aspiration_min_semantic: float
    aspiration_min_matched_skills: int = ASPIRATION_MIN_MATCHED_SKILLS

    @classmethod
    def from_env(cls) -> "MatchThresholds":
        # Environment names predate this module and are kept for deployments.
        return cls(
            fit_now_min_semantic=_configured("KAREERLY_FIT_NOW_MIN_COSINE", FIT_NOW_MIN_SEMANTIC),
            fit_now_min_required_coverage=_configured("KAREERLY_FIT_NOW_MIN_COVERAGE", FIT_NOW_MIN_REQUIRED_COVERAGE),
            aspiration_min_semantic=_configured("KAREERLY_ASPIRATION_MIN_COSINE", ASPIRATION_MIN_SEMANTIC),
        )

    def as_dict(self) -> Dict[str, float]:
        return asdict(self)


@dataclass(frozen=True)
class SkillEvidence:
    """Skill comparison for one side of a job (required or preferred)."""

    matched: List[str] = field(default_factory=list)
    missing: List[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.matched) + len(self.missing)

    @property
    def coverage(self) -> Optional[float]:
        return round(len(self.matched) / self.total, 4) if self.total else None


@dataclass(frozen=True)
class MatchBreakdown:
    semantic_similarity: float
    semantic_similarity_raw: float
    required_skill_coverage: Optional[float]
    preferred_skill_coverage: Optional[float]
    matched_required_count: int
    required_skill_count: int
    matched_preferred_count: int
    preferred_skill_count: int
    critical_missing_count: int
    raw_weighted_score: float
    penalty: float
    match_score: float
    match_category: str
    failed_fit_now_rules: List[str]
    thresholds: Dict[str, float]

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


def composite_score(
    semantic: float,
    required_coverage: Optional[float],
    preferred_coverage: Optional[float],
) -> float:
    parts = [(MATCH_WEIGHT_SEMANTIC, semantic)]
    if required_coverage is not None:
        parts.append((MATCH_WEIGHT_REQUIRED_SKILLS, required_coverage))
    if preferred_coverage is not None:
        parts.append((MATCH_WEIGHT_PREFERRED_SKILLS, preferred_coverage))
    return sum(weight * value for weight, value in parts) / sum(weight for weight, _ in parts)


def critical_penalty(critical_missing_count: int) -> float:
    return min(MAX_CRITICAL_PENALTY, CRITICAL_MISSING_PENALTY * max(0, critical_missing_count))


def fit_now_failures(
    semantic: float,
    required: SkillEvidence,
    critical_missing_count: int,
    thresholds: MatchThresholds,
) -> List[str]:
    """Names of the Fit-Now rules the pair fails; empty means Fit-Now."""
    failures = []
    if required.total == 0:
        failures.append("no_required_skills_listed")
    elif (required.coverage or 0.0) < thresholds.fit_now_min_required_coverage:
        failures.append("required_skill_coverage")
    if semantic < thresholds.fit_now_min_semantic:
        failures.append("semantic_similarity")
    if critical_missing_count:
        failures.append("critical_skill_missing")
    return failures


def classify(
    semantic: float,
    required: SkillEvidence,
    preferred: SkillEvidence,
    critical_missing_count: int,
    thresholds: MatchThresholds,
) -> str:
    if not fit_now_failures(semantic, required, critical_missing_count, thresholds):
        return FIT_NOW
    held = len(required.matched) + len(preferred.matched)
    # A job with no listed skills cannot show a gap, so relevance alone decides.
    has_skill_bridge = held >= thresholds.aspiration_min_matched_skills or (required.total + preferred.total) == 0
    if semantic >= thresholds.aspiration_min_semantic and has_skill_bridge:
        return ASPIRATION
    return LOW_MATCH


def score_match(
    semantic_cosine: float,
    required: SkillEvidence,
    preferred: SkillEvidence,
    critical_missing_count: int = 0,
    thresholds: Optional[MatchThresholds] = None,
) -> MatchBreakdown:
    thresholds = thresholds or MatchThresholds.from_env()
    raw_cosine = float(semantic_cosine)
    semantic = min(max(raw_cosine, 0.0), 1.0)
    raw = composite_score(semantic, required.coverage, preferred.coverage)
    penalty = critical_penalty(critical_missing_count)
    final = min(max(raw - penalty, 0.0), 1.0)
    return MatchBreakdown(
        semantic_similarity=round(semantic, 4),
        semantic_similarity_raw=round(raw_cosine, 6),
        required_skill_coverage=required.coverage,
        preferred_skill_coverage=preferred.coverage,
        matched_required_count=len(required.matched),
        required_skill_count=required.total,
        matched_preferred_count=len(preferred.matched),
        preferred_skill_count=preferred.total,
        critical_missing_count=critical_missing_count,
        raw_weighted_score=round(raw, 4),
        penalty=round(penalty, 4),
        match_score=round(final, 4),
        match_category=classify(semantic, required, preferred, critical_missing_count, thresholds),
        failed_fit_now_rules=fit_now_failures(semantic, required, critical_missing_count, thresholds),
        thresholds=thresholds.as_dict(),
    )


def match_reason(category: str, matched: Sequence[str], missing: Sequence[str], required_total: int) -> str:
    """One plain-language sentence explaining the category."""
    held = f"{len(matched)} of {required_total}" if required_total else "none"
    gaps = ", ".join(list(missing)[:3])
    if category == FIT_NOW:
        tail = f" Remaining gaps: {gaps}." if gaps else ""
        return f"You already match most of the important requirements ({held} required skills).{tail}"
    if category == ASPIRATION:
        tail = f" The main gaps are {gaps}." if gaps else ""
        return f"You are directionally suited to this role ({held} required skills).{tail}"
    return "This role has little overlap with your current skills and experience."
