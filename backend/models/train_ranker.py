"""Legacy TaxonomyRanker ablation model; not the primary Kareerly model.

Replaces the Cross-Encoder as the scoring model. Two claims, both testable:

  * It IS trained. Gradient boosting fits hundreds of decision trees and learns
    how much each taxonomy feature is worth. Weights are written to disk.
  * It is NOT a black box. The inputs are twenty named quantities, so a single
    prediction decomposes into readable contributions without a saliency map
    or a post-hoc story.

Backend is pluggable:

    sklearn    HistGradientBoostingClassifier, pointwise, no extra deps.
               Works out of the box, and yields a probability directly.
    lambdamart LightGBM `lambdarank` -- the standard learning-to-rank objective,
               optimises NDCG directly. Needs `brew install libomp` on macOS.

Start on sklearn. Report LambdaMART as an ablation row once libomp is present;
if it does not beat the pointwise model on your data, that is a finding too.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .config import ARTIFACT_DIR, SEED
from .features import FEATURE_NAMES

RANKER_OUT = ARTIFACT_DIR / "kareerly-ranker"


class TaxonomyRanker:
    def __init__(self, backend: str = "sklearn", **params: Any) -> None:
        self.backend = backend
        self.params = params
        self.model: Any = None
        self.feature_names: Tuple[str, ...] = FEATURE_NAMES
        self.training_summary: Dict[str, Any] = {}

    def fit(
        self,
        X: Sequence[Sequence[float]],
        y: Sequence[int],
        groups: Optional[Sequence[int]] = None,
        X_eval: Optional[Sequence[Sequence[float]]] = None,
        y_eval: Optional[Sequence[int]] = None,
    ) -> "TaxonomyRanker":
        X = np.asarray(X, dtype=float)
        y = np.asarray(y)

        if self.backend == "lambdamart":
            self._fit_lambdamart(X, y, groups)
        else:
            self._fit_sklearn(X, y, X_eval, y_eval)

        self.training_summary.update({
            "backend": self.backend,
            "n_examples": int(X.shape[0]),
            "n_features": int(X.shape[1]),
            "positive_rate": float(np.mean(y > 0)),
            "feature_names": list(self.feature_names),
        })
        return self

    def _fit_sklearn(self, X, y, X_eval, y_eval) -> None:
        from sklearn.ensemble import HistGradientBoostingClassifier

        defaults = dict(
            max_iter=300, learning_rate=0.06, max_leaf_nodes=31,
            min_samples_leaf=20, l2_regularization=1.0,
            early_stopping=True, validation_fraction=0.15,
            random_state=SEED,
        )
        defaults.update(self.params)
        self.model = HistGradientBoostingClassifier(**defaults)
        self.model.fit(X, (np.asarray(y) > 0).astype(int))
        self.training_summary["n_iter"] = int(getattr(self.model, "n_iter_", 0))

        if X_eval is not None and y_eval is not None and len(X_eval):
            probs = self.model.predict_proba(np.asarray(X_eval, dtype=float))[:, 1]
            y_eval = np.asarray(y_eval)
            if (y_eval > 0).any():
                self.training_summary["eval_mean_prob_positive"] = float(probs[y_eval > 0].mean())
            if (y_eval == 0).any():
                self.training_summary["eval_mean_prob_negative"] = float(probs[y_eval == 0].mean())

    def _fit_lambdamart(self, X, y, groups) -> None:
        try:
            import lightgbm as lgb
        except (ImportError, OSError) as exc:
            raise RuntimeError(
                "LambdaMART needs LightGBM, which needs OpenMP on macOS.\n"
                "  brew install libomp && pip install lightgbm\n"
                "Until then use backend='sklearn'."
            ) from exc

        if groups is None:
            raise ValueError("lambdamart requires `groups` (items per query).")

        defaults = dict(
            objective="lambdarank", metric="ndcg", ndcg_eval_at=[5, 10],
            n_estimators=300, learning_rate=0.06, num_leaves=31,
            min_child_samples=20, random_state=SEED, verbose=-1,
        )
        defaults.update(self.params)
        self.model = lgb.LGBMRanker(**defaults)
        self.model.fit(X, y, group=list(groups))

    def score(self, X: Sequence[Sequence[float]]) -> np.ndarray:
        X = np.asarray(X, dtype=float)
        if self.backend == "lambdamart":
            return self.model.predict(X)
        return self.model.predict_proba(X)[:, 1]

    def feature_importance(
        self, X: Sequence[Sequence[float]], y: Sequence[int], n_repeats: int = 10
    ) -> List[Dict[str, float]]:
        """Permutation importance: how much the model degrades without each
        feature. Model-agnostic, and honest about correlated inputs."""
        from sklearn.inspection import permutation_importance

        X = np.asarray(X, dtype=float)
        y = (np.asarray(y) > 0).astype(int)
        result = permutation_importance(
            self.model, X, y, n_repeats=n_repeats, random_state=SEED, scoring="roc_auc"
        )
        return sorted(
            (
                {"feature": name,
                 "importance": float(result.importances_mean[index]),
                 "std": float(result.importances_std[index])}
                for index, name in enumerate(self.feature_names)
            ),
            key=lambda item: item["importance"],
            reverse=True,
        )

    def explain(
        self, features: Dict[str, float], background: Optional[np.ndarray] = None
    ) -> List[Dict[str, Any]]:
        """Per-prediction contributions for ONE candidate-job pair."""
        vector = np.asarray(
            [[float(features.get(name, 0.0)) for name in self.feature_names]], dtype=float
        )
        base = float(self.score(vector)[0])

        try:
            import shap

            explainer = shap.TreeExplainer(self.model)
            raw = np.asarray(explainer.shap_values(vector))
            values = raw[0] if raw.ndim == 2 else raw[0][0]
            contributions = np.asarray(values).ravel().tolist()
            method = "shap"
        except Exception:
            method = "leave_one_out"
            reference = (
                background.mean(axis=0)
                if background is not None and len(background)
                else np.zeros(len(self.feature_names))
            )
            contributions = []
            for index in range(len(self.feature_names)):
                perturbed = vector.copy()
                perturbed[0, index] = reference[index]
                contributions.append(base - float(self.score(perturbed)[0]))

        rows = [
            {"feature": name,
             "value": float(features.get(name, 0.0)),
             "contribution": float(contributions[index]),
             "method": method}
            for index, name in enumerate(self.feature_names)
        ]
        return sorted(rows, key=lambda item: abs(item["contribution"]), reverse=True)

    def save(self, path: Optional[Path] = None) -> Path:
        import joblib

        path = Path(path or RANKER_OUT)
        path.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {"model": self.model, "backend": self.backend,
             "feature_names": list(self.feature_names)},
            path / "ranker.joblib",
        )
        (path / "training_summary.json").write_text(
            json.dumps(self.training_summary, indent=2), encoding="utf-8"
        )
        return path

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "TaxonomyRanker":
        import joblib

        path = Path(path or RANKER_OUT)
        payload = joblib.load(path / "ranker.joblib")
        ranker = cls(backend=payload["backend"])
        ranker.model = payload["model"]
        ranker.feature_names = tuple(payload["feature_names"])
        return ranker
