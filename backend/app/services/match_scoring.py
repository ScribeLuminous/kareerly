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

Semantic similarity is a cosine between two embeddings of the fine-tuned
bi-encoder. It says how alike the resume evidence and the job text are; it is
not a probability of being hired or shortlisted, and neither is the composite
score built from it.

Categories (a job is in at most one; either list may be empty):

* Fit-Now     - decided by the resume alone: required skills are listed, the
                candidate holds at least 75% of them
                (FIT_NOW_MIN_REQUIRED_COVERAGE), every skill the employer
                explicitly marked must-have is held, and the role is
                meaningfully related to the resume (FIT_NOW_MIN_SEMANTIC).
                Career preferences never affect it.
* Aspiration  - not Fit-Now, but a realistic next step. It needs both:
                  - relevance: the role is related to the resume
                    (ASPIRATION_MIN_SEMANTIC) or sits in the career area the
                    candidate chose in Step 3, and
                  - a skill bridge: the job lists skills, the candidate
                    already holds at least one of them, and at most
                    ASPIRATION_MAX_MISSING_ESSENTIAL essential skills are
                    missing. Those missing skills are what make it
                    aspirational and are returned with the job.
* Low Match   - neither; excluded from both recommendation lists. A job in
                the chosen career area that shares no skill with the resume,
                or a related-sounding job with nothing learnable to bridge,
                is Low Match rather than being padded into Aspiration.

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

# Fit-Now: "at least 75% of the required skills" is a product definition of
# readiness. Most jobs list three required skills, so in practice the resume
# must hold all of them. On the mock-resume diagnostic (floor 0.30) this keeps
# 81 of 179 strong pairs and 1 of 4,841 weak ones as Fit-Now (50% kept 123 and
# 8), and 3 of 33 resumes have no Fit-Now job. Skill coverage decides Fit-Now;
# the semantic floor only rules out unrelated roles.
FIT_NOW_MIN_REQUIRED_COVERAGE = 0.75
FIT_NOW_MIN_SEMANTIC = 0.30
# Aspiration: new floor, the development-split F1 optimum for separating
# related roles from unrelated ones; about 3% of unrelated pairs pass it.
ASPIRATION_MIN_SEMANTIC = 0.20
ASPIRATION_MIN_MATCHED_SKILLS = 1
# More missing essential skills than this is a career change rather than a
# next step; most catalogue jobs list three to five required skills.
ASPIRATION_MAX_MISSING_ESSENTIAL = 4


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
    aspiration_max_missing_essential: int = ASPIRATION_MAX_MISSING_ESSENTIAL

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
    in_preferred_career_area: Optional[bool]
    raw_weighted_score: float
    penalty: float
    match_score: float
    match_category: str
    failed_fit_now_rules: List[str]
    failed_aspiration_rules: List[str]
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


def aspiration_failures(
    semantic: float,
    required: SkillEvidence,
    preferred: SkillEvidence,
    critical_missing_count: int,
    thresholds: MatchThresholds,
    in_preferred_career_area: Optional[bool] = None,
) -> List[str]:
    """Names of the Aspiration rules a non-Fit-Now pair fails; empty means Aspiration.

    Relevance may come from the resume (role similarity) or from the stated
    career goal (the chosen career area). The skill bridge always comes from
    the resume: a job whose requirements the candidate shares nothing with,
    or that lists no requirements to compare, cannot show a learnable path.
    """
    failures = []
    related_to_resume = semantic >= thresholds.aspiration_min_semantic
    if not (related_to_resume or in_preferred_career_area):
        failures.append("not_related")
    if required.total + preferred.total == 0:
        failures.append("no_skills_listed")
    else:
        if len(required.matched) + len(preferred.matched) < thresholds.aspiration_min_matched_skills:
            failures.append("no_shared_skill")
        if len(required.missing) + critical_missing_count > thresholds.aspiration_max_missing_essential:
            failures.append("too_many_missing_essential_skills")
    return failures


def classify(
    semantic: float,
    required: SkillEvidence,
    preferred: SkillEvidence,
    critical_missing_count: int,
    thresholds: MatchThresholds,
    in_preferred_career_area: Optional[bool] = None,
) -> str:
    if not fit_now_failures(semantic, required, critical_missing_count, thresholds):
        return FIT_NOW
    if not aspiration_failures(semantic, required, preferred, critical_missing_count, thresholds, in_preferred_career_area):
        return ASPIRATION
    return LOW_MATCH


def score_match(
    semantic_cosine: float,
    required: SkillEvidence,
    preferred: SkillEvidence,
    critical_missing_count: int = 0,
    thresholds: Optional[MatchThresholds] = None,
    in_preferred_career_area: Optional[bool] = None,
) -> MatchBreakdown:
    """Score one pair.

    ``in_preferred_career_area`` is None when the candidate chose no career area
    or the job has no known category; relevance then rests on the resume alone.
    """
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
        in_preferred_career_area=in_preferred_career_area,
        raw_weighted_score=round(raw, 4),
        penalty=round(penalty, 4),
        match_score=round(final, 4),
        match_category=classify(semantic, required, preferred, critical_missing_count, thresholds, in_preferred_career_area),
        failed_fit_now_rules=fit_now_failures(semantic, required, critical_missing_count, thresholds),
        failed_aspiration_rules=aspiration_failures(
            semantic, required, preferred, critical_missing_count, thresholds, in_preferred_career_area),
        thresholds=thresholds.as_dict(),
    )


def match_reason(
    category: str,
    matched: Sequence[str],
    missing: Sequence[str],
    required_total: int,
    in_preferred_career_area: Optional[bool] = None,
) -> str:
    """One plain-language sentence explaining the category."""
    held = f"{len(matched)} of {required_total}" if required_total else "none"
    gaps = ", ".join(list(missing)[:3])
    if category == FIT_NOW:
        tail = f" Remaining gaps: {gaps}." if gaps else ""
        return f"Your resume already covers most of the important requirements ({held} required skills).{tail}"
    if category == ASPIRATION:
        lead = ("This role is in the career area you chose and builds on skills your resume already shows"
                if in_preferred_career_area else "This role is related to your resume and builds on skills it already shows")
        coverage = f" ({held} required skills)" if required_total else ""
        tail = f" To get there: {gaps}." if gaps else " Your skills cover its requirements, but your resume shows less experience in this kind of role."
        return f"{lead}{coverage}.{tail}"
    return "This role has little overlap with your current skills and experience."
