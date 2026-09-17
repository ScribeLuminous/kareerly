"""Ranking metrics and the ablation harness.

Answers the panel's question directly: RQ2 and RQ3 are measured here, against
a stated ground truth, with every configuration reported as its own row.

Metrics are computed from graded judgements (0 / 1 / 2) held in a qrels file:

    {"resume_id": "R001", "job_id": "jooble-123", "grade": 2}

That file is produced by the pooled-judgement protocol, not by this module.
No qrels, no metrics — which is the point. A system that always returns ten
matches and never has to be right against a reference cannot be evaluated.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple


def dcg(grades: Sequence[float]) -> float:
    return sum(grade / math.log2(index + 2) for index, grade in enumerate(grades))


def ndcg_at_k(ranked_grades: Sequence[float], ideal_grades: Sequence[float], k: int) -> float:
    actual = dcg(ranked_grades[:k])
    ideal = dcg(sorted(ideal_grades, reverse=True)[:k])
    return actual / ideal if ideal > 0 else 0.0


def precision_at_k(ranked_grades: Sequence[float], k: int, threshold: float = 1.0) -> float:
    top = ranked_grades[:k]
    return sum(1 for grade in top if grade >= threshold) / k if k else 0.0


def recall_at_k(
    ranked_grades: Sequence[float], all_grades: Sequence[float], k: int, threshold: float = 1.0
) -> float:
    total_relevant = sum(1 for grade in all_grades if grade >= threshold)
    if not total_relevant:
        return 0.0
    return sum(1 for grade in ranked_grades[:k] if grade >= threshold) / total_relevant


def mrr_at_k(ranked_grades: Sequence[float], k: int, threshold: float = 1.0) -> float:
    for index, grade in enumerate(ranked_grades[:k]):
        if grade >= threshold:
            return 1.0 / (index + 1)
    return 0.0


def load_qrels(path: Path) -> Dict[str, Dict[str, float]]:
    """resume_id -> {job_id: grade}"""
    qrels: Dict[str, Dict[str, float]] = defaultdict(dict)
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = json.loads(line)
            qrels[record["resume_id"]][record["job_id"]] = float(record.get("grade", 0))
    return dict(qrels)


def evaluate_run(
    run: Dict[str, List[str]],
    qrels: Dict[str, Dict[str, float]],
    ks: Sequence[int] = (1, 3, 5, 10),
    threshold: float = 1.0,
) -> Dict[str, float]:
    """`run` maps resume_id -> ranked list of job_ids. Unjudged jobs score 0."""
    totals: Dict[str, List[float]] = defaultdict(list)

    for resume_id, ranked_job_ids in run.items():
        judged = qrels.get(resume_id)
        if not judged:
            continue

        ranked_grades = [judged.get(job_id, 0.0) for job_id in ranked_job_ids]
        all_grades = list(judged.values())

        for k in ks:
            totals[f"nDCG@{k}"].append(ndcg_at_k(ranked_grades, all_grades, k))
            totals[f"P@{k}"].append(precision_at_k(ranked_grades, k, threshold))
            totals[f"Recall@{k}"].append(recall_at_k(ranked_grades, all_grades, k, threshold))
        totals["MRR@10"].append(mrr_at_k(ranked_grades, 10, threshold))

    return {
        metric: (sum(values) / len(values) if values else 0.0)
        for metric, values in sorted(totals.items())
    }


def skill_extraction_prf(
    predicted: Dict[str, Sequence[str]],
    expected: Dict[str, Sequence[str]],
) -> Dict[str, float]:
    """Micro-averaged precision / recall / F1 over skill ids. Answers RQ1."""
    true_positive = false_positive = false_negative = 0

    for resume_id, gold_ids in expected.items():
        gold = {str(item).strip().upper() for item in gold_ids if str(item).strip()}
        got = {str(item).strip().upper() for item in predicted.get(resume_id, [])}
        true_positive += len(gold & got)
        false_positive += len(got - gold)
        false_negative += len(gold - got)

    precision = true_positive / (true_positive + false_positive) if (true_positive + false_positive) else 0.0
    recall = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0

    return {"precision": precision, "recall": recall, "f1": f1,
            "tp": true_positive, "fp": false_positive, "fn": false_negative}


def gap_coverage_rate(gaps: Sequence[Dict[str, Any]]) -> float:
    """Share of prioritised gaps with at least one recommended resource. RQ3."""
    if not gaps:
        return 0.0
    covered = sum(1 for gap in gaps if gap.get("recommended_learning_resources"))
    return covered / len(gaps)


def ablation_table(
    runs: Dict[str, Dict[str, List[str]]],
    qrels: Dict[str, Dict[str, float]],
    ks: Sequence[int] = (1, 5, 10),
) -> str:
    """One row per configuration. This is the core of the results chapter."""
    results = {name: evaluate_run(run, qrels, ks) for name, run in runs.items()}
    if not results:
        return "No runs to compare."

    metrics = sorted(next(iter(results.values())).keys())
    header = "| Configuration | " + " | ".join(metrics) + " |"
    divider = "|---|" + "---:|" * len(metrics)
    lines = [header, divider]

    for name, scores in results.items():
        cells = " | ".join(f"{scores[metric]:.4f}" for metric in metrics)
        lines.append(f"| {name} | {cells} |")

    return "\n".join(lines)
