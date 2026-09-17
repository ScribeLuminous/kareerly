"""Inter-annotator agreement.

Cohen's kappa on the overlap set. This is the number that answers "do your
labels mean the same thing to two different people", and it is the standard
defence when a panel asks how trustworthy the ground truth is.

Reported three ways, because they say different things:

    kappa (3-grade, unweighted)  strict: 1 vs 2 counts as full disagreement
    kappa (quadratic weighted)   treats 0-vs-2 as worse than 1-vs-2
    kappa (binary at RELEVANT_AT) agreement on the decision metrics actually use
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from .schema import RELEVANT_AT
from .store import JudgementStore


def _confusion(pairs: Sequence[Tuple[int, int]], labels: Sequence[int]) -> List[List[int]]:
    index = {label: position for position, label in enumerate(labels)}
    matrix = [[0] * len(labels) for _ in labels]
    for a, b in pairs:
        if a in index and b in index:
            matrix[index[a]][index[b]] += 1
    return matrix


def cohens_kappa(
    pairs: Sequence[Tuple[int, int]],
    labels: Sequence[int] = (0, 1, 2),
    weights: Optional[str] = None,
) -> float:
    """weights: None (unweighted) or "quadratic"."""
    if not pairs:
        return float("nan")

    matrix = _confusion(pairs, labels)
    n = sum(sum(row) for row in matrix)
    if not n:
        return float("nan")

    size = len(labels)
    row_totals = [sum(row) for row in matrix]
    col_totals = [sum(matrix[r][c] for r in range(size)) for c in range(size)]

    if weights == "quadratic":
        denominator = (size - 1) ** 2 or 1
        weight = [[((r - c) ** 2) / denominator for c in range(size)] for r in range(size)]
    else:
        weight = [[0.0 if r == c else 1.0 for c in range(size)] for r in range(size)]

    observed = sum(
        weight[r][c] * matrix[r][c] for r in range(size) for c in range(size)
    ) / n
    expected = sum(
        weight[r][c] * row_totals[r] * col_totals[c] for r in range(size) for c in range(size)
    ) / (n * n)

    if expected == 0:
        return 1.0 if observed == 0 else 0.0
    return 1.0 - observed / expected


def interpret(kappa: float) -> str:
    """Landis & Koch bands. State the band, not just the number."""
    if kappa != kappa:
        return "undefined (no overlap)"
    if kappa < 0.00:
        return "poor"
    if kappa < 0.21:
        return "slight"
    if kappa < 0.41:
        return "fair"
    if kappa < 0.61:
        return "moderate"
    if kappa < 0.81:
        return "substantial"
    return "almost perfect"


def pairwise_agreement(store: JudgementStore) -> List[Dict[str, Any]]:
    """Every annotator pair that shares judged items."""
    latest = store.latest()
    by_annotator: Dict[str, Dict[str, int]] = {}
    for (annotator, pool_id), judgement in latest.items():
        by_annotator.setdefault(annotator, {})[pool_id] = judgement.grade

    names = sorted(by_annotator)
    results: List[Dict[str, Any]] = []

    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            shared = sorted(set(by_annotator[a]) & set(by_annotator[b]))
            if not shared:
                continue

            graded = [(by_annotator[a][p], by_annotator[b][p]) for p in shared]
            binary = [
                (1 if x >= RELEVANT_AT else 0, 1 if y >= RELEVANT_AT else 0)
                for x, y in graded
            ]
            exact = sum(1 for x, y in graded if x == y) / len(graded)

            unweighted = cohens_kappa(graded)
            results.append({
                "annotator_a": a,
                "annotator_b": b,
                "overlap": len(shared),
                "raw_agreement": round(exact, 4),
                "kappa_unweighted": round(unweighted, 4),
                "kappa_quadratic": round(cohens_kappa(graded, weights="quadratic"), 4),
                "kappa_binary": round(cohens_kappa(binary, labels=(0, 1)), 4),
                "interpretation": interpret(unweighted),
                "disagreements": [
                    {"pool_id": p, a: by_annotator[a][p], b: by_annotator[b][p]}
                    for p in shared if by_annotator[a][p] != by_annotator[b][p]
                ][:20],
            })
    return results
