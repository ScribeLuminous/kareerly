"""Turn judgements into the three artefacts downstream code needs.

    qrels.jsonl          -> models/evaluate.py   (nDCG, P@k, Recall@k, MRR)
    judged_logits.jsonl  -> models/calibrate.py  (Platt scaling, ECE)
    ranker_training.npz  -> models/train_ranker.py (features + graded labels)

Adjudication: when several annotators judged the same pair, the exported grade
is the median (ties round toward the lower grade, which is the conservative
choice for a system that should not overclaim). Every disagreement is retained
in the audit file rather than being silently averaged away.
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .schema import RELEVANT_AT
from .store import JudgementStore


def adjudicate(store: JudgementStore) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """(resume_id, job_id) -> {grade, n_annotators, disagreed, grades}"""
    grouped: Dict[Tuple[str, str], List[int]] = {}
    for judgement in store.latest().values():
        grouped.setdefault(
            (judgement.resume_id, judgement.job_id), []
        ).append(judgement.grade)

    adjudicated: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for key, grades in grouped.items():
        # median_low: with two annotators split 1/2, take 1 rather than 1.5.
        final = int(statistics.median_low(sorted(grades)))
        adjudicated[key] = {
            "grade": final,
            "n_annotators": len(grades),
            "disagreed": len(set(grades)) > 1,
            "grades": sorted(grades),
        }
    return adjudicated


def write_qrels(store: JudgementStore, path: Path) -> Dict[str, Any]:
    adjudicated = adjudicate(store)
    path.parent.mkdir(parents=True, exist_ok=True)

    disagreements = 0
    with path.open("w", encoding="utf-8") as handle:
        for (resume_id, job_id), record in sorted(adjudicated.items()):
            handle.write(json.dumps({
                "resume_id": resume_id,
                "job_id": job_id,
                "grade": record["grade"],
                "n_annotators": record["n_annotators"],
                "disagreed": record["disagreed"],
            }) + "\n")
            disagreements += int(record["disagreed"])

    resumes = {resume_id for resume_id, _ in adjudicated}
    relevant = sum(1 for r in adjudicated.values() if r["grade"] >= RELEVANT_AT)

    return {
        "path": str(path),
        "pairs": len(adjudicated),
        "resumes": len(resumes),
        "relevant_pairs": relevant,
        "relevant_rate": round(relevant / len(adjudicated), 4) if adjudicated else 0.0,
        "multi_judged": sum(1 for r in adjudicated.values() if r["n_annotators"] > 1),
        "disagreements": disagreements,
    }


def write_calibration_set(
    store: JudgementStore,
    scores: Dict[Tuple[str, str], float],
    path: Path,
) -> Dict[str, Any]:
    """Join adjudicated grades to raw model scores.

    `scores` maps (resume_id, job_id) -> the model's RAW score (a cross-encoder
    logit, or a ranker margin). Raw, not normalised -- calibration exists to
    map the raw scale onto probability, so normalising first defeats it.
    """
    adjudicated = adjudicate(store)
    path.parent.mkdir(parents=True, exist_ok=True)

    written = missing = 0
    with path.open("w", encoding="utf-8") as handle:
        for key, record in sorted(adjudicated.items()):
            if key not in scores:
                missing += 1
                continue
            handle.write(json.dumps({
                "resume_id": key[0],
                "job_id": key[1],
                "logit": float(scores[key]),
                "grade": record["grade"],
            }) + "\n")
            written += 1

    return {"path": str(path), "written": written, "missing_scores": missing}


def write_ranker_training(
    store: JudgementStore,
    features: Dict[Tuple[str, str], Dict[str, float]],
    path: Path,
    feature_names: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Feature matrix + graded labels + query groups, for the taxonomy ranker.

    Groups are contiguous runs of one resume, which is what a listwise ranking
    objective needs to know where one query ends and the next begins.
    """
    import numpy as np

    from models.features import FEATURE_NAMES

    names = list(feature_names or FEATURE_NAMES)
    adjudicated = adjudicate(store)

    rows: List[List[float]] = []
    labels: List[int] = []
    resume_ids: List[str] = []
    missing = 0

    for (resume_id, job_id), record in sorted(adjudicated.items()):
        vector = features.get((resume_id, job_id))
        if vector is None:
            missing += 1
            continue
        rows.append([float(vector.get(name, 0.0)) for name in names])
        labels.append(record["grade"])
        resume_ids.append(resume_id)

    if not rows:
        raise ValueError(
            "No judged pair had features. Check that the (resume_id, job_id) keys "
            "in `features` match those in the judgement store."
        )

    # Contiguous group sizes, in the order rows were written.
    groups: List[int] = []
    current = resume_ids[0]
    count = 0
    for resume_id in resume_ids:
        if resume_id != current:
            groups.append(count)
            current, count = resume_id, 0
        count += 1
    groups.append(count)

    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        path,
        X=np.asarray(rows, dtype=float),
        y=np.asarray(labels, dtype=int),
        groups=np.asarray(groups, dtype=int),
        resume_ids=np.asarray(resume_ids),
        feature_names=np.asarray(names),
    )

    return {
        "path": str(path),
        "examples": len(rows),
        "queries": len(groups),
        "features": len(names),
        "missing_features": missing,
        "label_distribution": {
            grade: labels.count(grade) for grade in sorted(set(labels))
        },
    }
