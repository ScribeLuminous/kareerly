"""Legacy taxonomy-ranker experiment; not the live Kareerly matching path.

Pipeline, end to end:

    resume text
      -> extract_skills()      taxonomy aliases, longest-match, span occupancy
      -> FeatureExtractor      ~20 named features per candidate-job pair
      -> TaxonomyRanker        trained GBDT; falls back to coverage if untrained
      -> explain()             per-feature contributions + per-skill trace
      -> gaps + courses        IDF x shortfall, then resource lookup

Nothing here produces a number without a reason. The score is a function of
named features; each feature is arithmetic over the K13 taxonomy; each required
skill carries a trace saying whether it was met exactly, met by a related skill
in the same parent group, or not met at all.

The live application uses the trained semantic bi-encoder in
``semantic_matching.py`` and applies taxonomy evidence as deterministic
eligibility and explanation. This module remains available only for ablation.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from models import taxonomy as tx  # noqa: E402
from models.alias_expansion import apply_supplement  # noqa: E402
from models.features import (  # noqa: E402
    CandidateProfile,
    FeatureExtractor,
    JobPosting,
    RequirementTrace,
    gaps_from_traces,
)
from models.crosswalk import Crosswalk, load_crosswalk  # noqa: E402
from models.train_ranker import RANKER_OUT, TaxonomyRanker  # noqa: E402

REFERENCE_DIR = BACKEND_DIR / "data" / "corpus" / "reference"
DERIVED_ALIASES = REFERENCE_DIR / "derived_aliases_accepted.csv"
#: Hand-resolved cases the rules cannot settle -- chiefly aliases that are
#: ambiguous only because the Skills Master contains duplicate rows.
ALIAS_OVERRIDES = REFERENCE_DIR / "alias_overrides.csv"

_WORD = re.compile(r"[a-z0-9+#.]+")


# ============================================================
# SKILL EXTRACTION
# ============================================================

def extract_skills(
    text: str,
    taxonomy: tx.Taxonomy,
    max_skills: int = 40,
) -> List[Dict[str, Any]]:
    """Longest-match alias lookup with span occupancy.

    Occupancy is what stops 'data' firing inside 'data security': once a
    character range is consumed by a longer alias, no shorter alias may claim
    it. The old extractor lacked this and produced overlapping junk skills.
    """
    normalized = tx.normalize(text)
    if not normalized:
        return []

    padded = f" {normalized} "
    consumed: List[Tuple[int, int]] = []
    found: Dict[str, Dict[str, Any]] = {}

    def overlaps(start: int, end: int) -> bool:
        return any(start < taken_end and end > taken_start
                   for taken_start, taken_end in consumed)

    for alias in taxonomy.longest_aliases():
        if len(found) >= max_skills:
            break
        pattern = r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])"
        for match in re.finditer(pattern, padded):
            start, end = match.span()
            if overlaps(start, end):
                continue
            consumed.append((start, end))

            skill_id = taxonomy.alias_to_skill[alias]
            skill = taxonomy.skills.get(skill_id)
            if not skill:
                continue

            record = found.setdefault(skill_id, {
                "skill_id": skill_id,
                "label": skill.label,
                "k13_id": skill.k13_id,
                "subcategory": skill.subcategory,
                "parent_group_id": skill.parent_group_id,
                "matched_aliases": [],
                "mentions": 0,
                "alias_approval": taxonomy.alias_flags.get(alias, ""),
            })
            record["mentions"] += 1
            if alias not in record["matched_aliases"]:
                record["matched_aliases"].append(alias)

    return sorted(found.values(), key=lambda item: -item["mentions"])[:max_skills]


# ============================================================
# MATCHER
# ============================================================

class TaxonomyMatcher:
    def __init__(
        self,
        taxonomy: Optional[tx.Taxonomy] = None,
        ranker: Optional[TaxonomyRanker] = None,
        jobs: Optional[Sequence[JobPosting]] = None,
        learning_available: Optional[Set[str]] = None,
        use_derived_aliases: bool = True,
    ) -> None:
        self.taxonomy = taxonomy or tx.load()
        if use_derived_aliases:
            self.derived_alias_count = (
                apply_supplement(self.taxonomy, DERIVED_ALIASES)
                + apply_supplement(self.taxonomy, ALIAS_OVERRIDES)
            )
        else:
            self.derived_alias_count = 0

        self.jobs: List[JobPosting] = list(jobs or [])
        self.learning_available = learning_available or set()

        self.extractor = FeatureExtractor(
            self.taxonomy,
            FeatureExtractor.fit_document_frequency(self.jobs) if self.jobs else {},
            corpus_size=len(self.jobs) or 1,
        )

        if ranker is not None:
            self.ranker = ranker
            self.scoring_method = f"trained_ranker_{ranker.backend}"
        elif (RANKER_OUT / "ranker.joblib").exists():
            self.ranker = TaxonomyRanker.load()
            self.scoring_method = f"trained_ranker_{self.ranker.backend}"
        else:
            self.ranker = None
            self.scoring_method = "coverage_fallback_untrained"

    # ---- profile -------------------------------------------------------

    def build_profile(
        self,
        resume_text: str,
        years_experience: float = 0.0,
        education: str = "",
        region: str = "",
        preferred_work_setup: str = "",
        salary_expectation: float = 0.0,
        confirmed_skill_ids: Optional[Sequence[str]] = None,
    ) -> Tuple[CandidateProfile, List[Dict[str, Any]]]:
        extracted = extract_skills(resume_text, self.taxonomy)
        skill_ids = [item["skill_id"] for item in extracted]
        if confirmed_skill_ids:
            skill_ids = list(dict.fromkeys(list(confirmed_skill_ids) + skill_ids))

        profile = CandidateProfile(
            skill_ids=skill_ids,
            years_experience=years_experience,
            education=education,
            region=region,
            preferred_work_setup=preferred_work_setup,
            salary_expectation=salary_expectation,
            text=resume_text,
        )
        return profile, extracted

    # ---- scoring -------------------------------------------------------

    def score_one(
        self, profile: CandidateProfile, job: JobPosting
    ) -> Dict[str, Any]:
        features, traces = self.extractor.extract(
            profile, job, learning_available=self.learning_available
        )
        vector = self.extractor.vector(features)

        if self.ranker is not None:
            score = float(self.ranker.score([vector])[0])
            contributions = self.ranker.explain(features)[:6]
        else:
            # Untrained fallback: essential coverage is still a defensible score
            # and is exactly what the model is learning to weight.
            score = float(features["essential_coverage"])
            contributions = [
                {"feature": "essential_coverage", "value": score,
                 "contribution": score, "method": "untrained_fallback"}
            ]

        gaps = gaps_from_traces(traces)
        return {
            "job_id": job.job_id,
            "score": round(score, 4),
            "match_percentage": round(score * 100, 2),
            "scoring_method": self.scoring_method,
            "features": {k: round(v, 4) for k, v in features.items()},
            "why": contributions,
            "skill_trace": [
                {
                    "required_skill_id": t.required_skill_id,
                    "required_label": t.required_label,
                    "credit": round(t.credit, 2),
                    "relation": t.relation,
                    "matched_skill_id": t.matched_skill_id,
                    "matched_label": t.matched_label,
                    "status": (
                        "met" if t.credit >= 1.0
                        else "partial" if t.credit > 0
                        else "gap"
                    ),
                }
                for t in traces
            ],
            "gaps": [
                {
                    "skill_id": t.required_skill_id,
                    "label": t.required_label,
                    "shortfall": round(1.0 - t.credit, 2),
                    "priority_value": round(t.idf * (1.0 - t.credit), 4),
                    "closest_held": t.matched_label,
                    "has_learning_resource": t.required_skill_id in self.learning_available,
                }
                for t in gaps
            ],
            "explanation": self._sentence(job, traces, features),
        }

    def _sentence(
        self,
        job: JobPosting,
        traces: Sequence[RequirementTrace],
        features: Dict[str, float],
    ) -> str:
        met = [t.required_label for t in traces if t.credit >= 1.0]
        partial = [t for t in traces if 0 < t.credit < 1.0]
        missing = [t.required_label for t in traces if t.credit == 0]

        parts: List[str] = []
        if met:
            parts.append(f"You already have {', '.join(met[:3])}.")
        if partial:
            first = partial[0]
            parts.append(
                f"Your {first.matched_label} is closely related to "
                f"{first.required_label}, which counts as partial credit."
            )
        if missing:
            parts.append(f"Still missing: {', '.join(missing[:3])}.")
        if features.get("experience_gap_years", 0) < 0:
            parts.append(
                f"The role asks for about {abs(features['experience_gap_years']):.0f} "
                f"more year(s) of experience than your profile shows."
            )
        if not features.get("work_setup_match", 1.0):
            parts.append("The work setup does not match your stated preference.")
        return " ".join(parts) or "No requirement data available for this role."

    # ---- ranking -------------------------------------------------------

    def match(
        self,
        profile: CandidateProfile,
        top_n: int = 10,
        floor: float = 0.0,
    ) -> List[Dict[str, Any]]:
        scored = [self.score_one(profile, job) for job in self.jobs]
        scored = [item for item in scored if item["score"] >= floor]
        return sorted(scored, key=lambda item: item["score"], reverse=True)[:top_n]

    def prioritise_gaps(
        self, matches: Sequence[Dict[str, Any]], max_gaps: int = 8
    ) -> List[Dict[str, Any]]:
        """Aggregate gaps across the target set, weighted by match quality.

        A gap is worth what it costs you across the roles you are actually
        pursuing -- not how often it appears in an unfiltered list.
        """
        pooled: Dict[str, Dict[str, Any]] = {}

        for match in matches:
            weight = float(match["score"])
            for gap in match["gaps"]:
                bucket = pooled.setdefault(gap["skill_id"], {
                    "skill_id": gap["skill_id"],
                    "label": gap["label"],
                    "value": 0.0,
                    "affected_jobs": [],
                    "has_learning_resource": gap["has_learning_resource"],
                })
                bucket["value"] += gap["priority_value"] * weight
                if match["job_id"] not in bucket["affected_jobs"]:
                    bucket["affected_jobs"].append(match["job_id"])

        ranked = sorted(pooled.values(), key=lambda item: item["value"], reverse=True)
        for item in ranked:
            item["value"] = round(item["value"], 4)
            item["affected_job_count"] = len(item["affected_jobs"])
        return ranked[:max_gaps]


def job_from_record(
    record: Dict[str, Any],
    crosswalk: Optional[Crosswalk] = None,
) -> Tuple[JobPosting, Dict[str, Any]]:
    """Adapt a labelled-corpus record to the matcher's job shape.

    The corpus tags requirements with ESCO ids; the taxonomy speaks SK###.
    Without translation every requirement silently becomes an unfillable gap,
    so a crosswalk is required rather than optional.

    Returns (job, provenance). `provenance` reports how much of the job the
    taxonomy could actually express -- a job whose requirements are mostly
    unmapped is one this system cannot honestly assess, and the caller needs to
    know that rather than see a confident-looking low score.
    """
    crosswalk = crosswalk or load_crosswalk()

    # `skills` is the taxonomy-linked key written by the current pipeline;
    # `esco_skills` is the legacy ESCO-linked key, kept readable so older
    # corpora still load (and still route through the crosswalk).
    raw_skills = record.get("skills") or record.get("esco_skills", [])

    raw_essential, raw_optional = [], []
    for skill in raw_skills:
        target = raw_essential if skill.get("relation_type") == "essential" else raw_optional
        identifier = skill.get("skill_id") or skill.get("skill_uri", "")
        if identifier:
            target.append(identifier)

    essential_t = crosswalk.to_kareerly(raw_essential)
    optional_t = crosswalk.to_kareerly(raw_optional)
    essential, optional = essential_t.kareerly_ids, optional_t.kareerly_ids

    total_raw = len(raw_essential) + len(raw_optional)
    total_mapped = len(essential) + len(optional)
    provenance = {
        "job_id": record.get("job_id", ""),
        "requirements_in_corpus": total_raw,
        "requirements_mapped": total_mapped,
        "requirements_unmapped": total_raw - total_mapped,
        "taxonomy_coverage": round(total_mapped / total_raw, 4) if total_raw else 0.0,
        "unmapped_esco_ids": (essential_t.unmapped_esco + optional_t.unmapped_esco)[:20],
        "assessable": bool(essential) and (total_mapped / total_raw >= 0.5 if total_raw else False),
    }

    return JobPosting(
        job_id=record.get("job_id", ""),
        essential_skill_ids=essential,
        optional_skill_ids=optional,
        k13_id=record.get("k13_id", ""),
        seniority=record.get("seniority", ""),
        required_years=float(record.get("required_years", 0) or 0),
        required_education=record.get("required_education", ""),
        region=record.get("region", ""),
        work_setup=record.get("work_setup", ""),
        salary_min=float(record.get("salary_min_php") or 0),
        salary_max=float(record.get("salary_max_php") or 0),
        text=f"{record.get('title','')} {record.get('description','')}",
    ), provenance


def jobs_from_corpus(
    path: Path,
    crosswalk: Optional[Crosswalk] = None,
    require_assessable: bool = True,
) -> Tuple[List[JobPosting], List[Dict[str, Any]]]:
    """Load a labelled corpus, translating ids and reporting what was lost.

    `require_assessable=True` keeps only jobs where at least half the
    requirements survived translation and at least one essential skill did.
    Scoring the rest would produce confident-looking numbers about jobs the
    taxonomy cannot read.
    """
    crosswalk = crosswalk or load_crosswalk()
    jobs: List[JobPosting] = []
    provenance: List[Dict[str, Any]] = []

    with Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            job, record_provenance = job_from_record(json.loads(line), crosswalk)
            provenance.append(record_provenance)
            if not require_assessable or record_provenance["assessable"]:
                jobs.append(job)

    return jobs, provenance
