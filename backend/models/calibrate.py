"""Platt calibration — turning a ranking score into an absolute probability.

A cross-encoder logit is monotone in relevance but has no fixed meaning: -10.2
is "irrelevant" for one model and mid-range for another. v1 handled this with
min-max normalisation across the corpus, which guarantees the top job scores
1.000 no matter how bad it is. A resume containing only "I like walking my dog"
scored a 100% match against Personal Grooming Services Assistant on a raw logit
of -10.227 (sigmoid = 0.00004).

Platt scaling fits a one-dimensional logistic on held-out judged pairs:

    P(relevant | z) = sigmoid( (z - z0) / T )

z0 and T are learned from data, not chosen. The resulting number is comparable
across candidates, across runs, and against a fixed threshold — which is what
makes "no strong matches" an answer the system is allowed to give.

Reported alongside: Expected Calibration Error and the reliability curve, which
is the single strongest before/after figure available for the manuscript.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .config import CALIBRATION_OUT


def fit_platt(logits: Sequence[float], labels: Sequence[int]) -> Dict[str, float]:
    """Fit P(relevant) = sigmoid((z - z0)/T) by logistic regression on z."""
    from sklearn.linear_model import LogisticRegression

    z = np.asarray(logits, dtype=float).reshape(-1, 1)
    y = np.asarray(labels, dtype=int)

    if len(set(y.tolist())) < 2:
        raise ValueError(
            "Calibration needs both relevant and non-relevant judgements. "
            "Your dev pool contains only one class."
        )

    model = LogisticRegression(solver="lbfgs", C=1e6)  # near-unregularised: 2 params
    model.fit(z, y)

    slope = float(model.coef_[0][0])
    intercept = float(model.intercept_[0])

    # sigmoid(slope*z + intercept) == sigmoid((z - z0)/T)
    temperature = 1.0 / slope if abs(slope) > 1e-9 else float("inf")
    z0 = -intercept / slope if abs(slope) > 1e-9 else 0.0

    return {"slope": slope, "intercept": intercept, "temperature": temperature, "z0": z0}


def apply_platt(logits: Sequence[float], params: Dict[str, float]) -> np.ndarray:
    z = np.asarray(logits, dtype=float)
    return 1.0 / (1.0 + np.exp(-(params["slope"] * z + params["intercept"])))


def expected_calibration_error(
    probabilities: Sequence[float], labels: Sequence[int], bins: int = 10
) -> Tuple[float, List[Dict[str, float]]]:
    """ECE plus the per-bin data needed to draw a reliability diagram."""
    p = np.asarray(probabilities, dtype=float)
    y = np.asarray(labels, dtype=int)
    edges = np.linspace(0.0, 1.0, bins + 1)

    ece = 0.0
    curve: List[Dict[str, float]] = []

    for lower, upper in zip(edges[:-1], edges[1:]):
        mask = (p > lower) & (p <= upper) if lower > 0 else (p >= lower) & (p <= upper)
        count = int(mask.sum())
        if not count:
            curve.append({"bin_lower": float(lower), "bin_upper": float(upper),
                          "count": 0, "confidence": 0.0, "accuracy": 0.0})
            continue
        confidence = float(p[mask].mean())
        accuracy = float(y[mask].mean())
        ece += (count / len(p)) * abs(accuracy - confidence)
        curve.append({"bin_lower": float(lower), "bin_upper": float(upper),
                      "count": count, "confidence": confidence, "accuracy": accuracy})

    return float(ece), curve


def minmax_baseline(logits: Sequence[float]) -> np.ndarray:
    """The v1 behaviour, kept so the manuscript can report it as a baseline."""
    z = np.asarray(logits, dtype=float)
    if z.size == 0:
        return z
    lo, hi = float(z.min()), float(z.max())
    return (z - lo) / (hi - lo) if hi - lo > 1e-9 else np.full_like(z, 0.5)


def calibrate(
    logits: Sequence[float],
    labels: Sequence[int],
    out_path: Optional[Path] = None,
    bins: int = 10,
) -> Dict[str, Any]:
    """Fit, evaluate, and persist. Compares against the v1 min-max baseline."""
    out_path = Path(out_path or CALIBRATION_OUT)

    params = fit_platt(logits, labels)
    calibrated = apply_platt(logits, params)
    baseline = minmax_baseline(logits)

    ece_calibrated, curve_calibrated = expected_calibration_error(calibrated, labels, bins)
    ece_baseline, curve_baseline = expected_calibration_error(baseline, labels, bins)

    report = {
        "params": params,
        "n_pairs": len(logits),
        "positive_rate": float(np.mean(labels)),
        "calibrated": {"ece": ece_calibrated, "reliability_curve": curve_calibrated},
        "minmax_baseline": {"ece": ece_baseline, "reliability_curve": curve_baseline},
        "ece_improvement": ece_baseline - ece_calibrated,
        "note": (
            "P(relevant|z) = sigmoid((z - z0)/T). Report both curves; the min-max "
            "row is the v1 behaviour and is expected to be badly miscalibrated."
        ),
    }
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def load(path: Optional[Path] = None) -> Dict[str, float]:
    path = Path(path or CALIBRATION_OUT)
    if not path.exists():
        raise FileNotFoundError(
            f"No calibration at {path}. Run `python -m models.cli calibrate` after "
            f"you have human relevance judgements."
        )
    return json.loads(path.read_text(encoding="utf-8"))["params"]
