"""Legacy 22-feature scoring experiment used only for ablation.

The live Kareerly path is ``app.services.bi_encoder_service`` (the fine-tuned
bi-encoder) with deterministic scoring in ``app.services.matching_service``;
it uses no Cross-Encoder. This module is kept so the former GBDT proposal can be compared in
Chapter 4 without being confused with the deployed algorithm.

Historical experimental design:

    STAGE 1  RETRIEVE   M2 bi-encoder over the whole corpus -> top-K
                        Opaque, but no decision is made here. Retrieval only
                        affects what the ranker gets to see; nothing is
                        accepted or rejected, so recall is the only concern.

    STAGE 2  RERANK     TaxonomyRanker over 22 features -> ordered shortlist
                        This is the decision, and it is interpretable by
                        construction. The neural signals from stage 1 and from
                        the cross-encoder enter here as two feature columns
                        among twenty-two, so their influence is learned,
                        bounded, and reportable via permutation importance.

    STAGE 3  CALIBRATE  Platt on the ranker score -> absolute P(fit)
                        Comparable across candidates and against a fixed
                        threshold, which is what lets the system answer
                        "no strong matches" instead of always finding ten.

Reranking, calibration and the K13 taxonomy are not alternatives. Reranking is
the *stage*; the taxonomy supplies the *features*; calibration converts the
*output*. Only the choice of reranker model was ever in question, and a
gradient-boosted ranker over named features answers it without a black box in
the decision path.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .calibrate import apply_platt, load as load_calibration
from .features import (
    FEATURE_NAMES,
    CandidateProfile,
    FeatureExtractor,
    JobPosting,
    gaps_from_traces,
)
from .train_ranker import RANKER_OUT, TaxonomyRanker


@dataclass
class ScoredJob:
    job_id: str
    score: float                 # calibrated P(fit) when calibration is fitted
    raw_score: float             # ranker output before calibration
    rank: int
    retrieval_rank: Optional[int]
    features: Dict[str, float]
    why: List[Dict[str, Any]]
    skill_trace: List[Dict[str, Any]]
    gaps: List[Dict[str, Any]]
    stage_provenance: Dict[str, Any] = field(default_factory=dict)


class ScoringPipeline:
    def __init__(
        self,
        taxonomy,
        jobs: Sequence[JobPosting],
        job_texts: Optional[Dict[str, str]] = None,
        ranker: Optional[TaxonomyRanker] = None,
        use_dense: bool = True,
        use_cross_encoder: bool = True,
        learning_available: Optional[set] = None,
    ) -> None:
        from .scorers import build_scorers

        self.taxonomy = taxonomy
        self.jobs = list(jobs)
        self.job_texts = job_texts or {j.job_id: j.text for j in self.jobs}
        self.learning_available = learning_available or set()

        scorers = build_scorers(use_dense=use_dense, use_cross_encoder=use_cross_encoder)
        self.dense_scorer = scorers["dense_scorer"]
        self.extractor = FeatureExtractor(
            taxonomy,
            FeatureExtractor.fit_document_frequency(self.jobs),
            corpus_size=len(self.jobs) or 1,
            **scorers,
        )

        if ranker is not None:
            self.ranker, self.ranker_state = ranker, "supplied"
        elif (RANKER_OUT / "ranker.joblib").exists():
            self.ranker, self.ranker_state = TaxonomyRanker.load(), "trained"
        else:
            self.ranker, self.ranker_state = None, "untrained_fallback"

        try:
            self.calibration = load_calibration()
            self.calibration_state = "fitted"
        except FileNotFoundError:
            self.calibration = None
            self.calibration_state = "uncalibrated"

        self._job_matrix = None

    # ---- stage 1 ---------------------------------------------------------

    def retrieve(self, profile: CandidateProfile, top_k: int = 50) -> List[Tuple[int, int]]:
        """Return [(job_index, retrieval_rank)]. Falls back to the full corpus."""
        if self.dense_scorer is None or not profile.text:
            return [(i, None) for i in range(len(self.jobs))]

        model = self.dense_scorer.model
        if self._job_matrix is None:
            self._job_matrix = model.encode(
                [self.job_texts.get(j.job_id, j.text) for j in self.jobs],
                batch_size=64, normalize_embeddings=True, show_progress_bar=False,
            )
        query = model.encode(
            [profile.text], normalize_embeddings=True, show_progress_bar=False
        )[0]
        order = np.argsort(-(self._job_matrix @ query))[:top_k]
        return [(int(i), rank + 1) for rank, i in enumerate(order)]

    # ---- stages 2 and 3 --------------------------------------------------

    def score(
        self,
        profile: CandidateProfile,
        top_k_retrieval: int = 50,
        top_n: int = 10,
        floor: float = 0.0,
    ) -> List[ScoredJob]:
        shortlist = self.retrieve(profile, top_k_retrieval)

        rows, meta = [], []
        for job_index, retrieval_rank in shortlist:
            job = self.jobs[job_index]
            features, traces = self.extractor.extract(
                profile, job, learning_available=self.learning_available
            )
            rows.append(self.extractor.vector(features))
            meta.append((job, retrieval_rank, features, traces))

        if not rows:
            return []

        if self.ranker is not None:
            raw = self.ranker.score(rows)
        else:
            # Untrained: essential coverage is the signal the ranker is
            # learning to weight, so it is the honest stand-in.
            raw = np.array([f["essential_coverage"] for _, _, f, _ in meta])

        calibrated = (
            apply_platt(raw, self.calibration) if self.calibration is not None
            else np.asarray(raw, dtype=float)
        )

        scored: List[ScoredJob] = []
        for position, (job, retrieval_rank, features, traces) in enumerate(meta):
            if float(calibrated[position]) < floor:
                continue
            scored.append(ScoredJob(
                job_id=job.job_id,
                score=round(float(calibrated[position]), 4),
                raw_score=round(float(raw[position]), 4),
                rank=0,
                retrieval_rank=retrieval_rank,
                features={k: round(v, 4) for k, v in features.items()},
                why=(self.ranker.explain(features)[:6] if self.ranker else
                     [{"feature": "essential_coverage",
                       "value": features["essential_coverage"],
                       "contribution": features["essential_coverage"],
                       "method": "untrained_fallback"}]),
                skill_trace=[{
                    "required_label": t.required_label, "credit": round(t.credit, 2),
                    "relation": t.relation, "matched_label": t.matched_label,
                    "status": "met" if t.credit >= 1 else "partial" if t.credit > 0 else "gap",
                } for t in traces],
                gaps=[{
                    "skill_id": t.required_skill_id, "label": t.required_label,
                    "priority_value": round(t.idf * (1 - t.credit), 4),
                } for t in gaps_from_traces(traces)],
                stage_provenance={
                    "retrieval": "m2_bi_encoder" if self.dense_scorer else "full_corpus_scan",
                    "reranker": self.ranker_state,
                    "calibration": self.calibration_state,
                },
            ))

        scored.sort(key=lambda s: s.score, reverse=True)
        for rank, item in enumerate(scored[:top_n], start=1):
            item.rank = rank
        return scored[:top_n]

    def state(self) -> Dict[str, Any]:
        return {
            "stage_1_retrieval": "m2_bi_encoder" if self.dense_scorer else "MISSING (full scan)",
            "stage_2_reranker": self.ranker_state,
            "stage_3_calibration": self.calibration_state,
            "features": len(FEATURE_NAMES),
            "corpus_size": len(self.jobs),
            "usable_for_results": (
                self.ranker_state == "trained" and self.calibration_state == "fitted"
            ),
        }
