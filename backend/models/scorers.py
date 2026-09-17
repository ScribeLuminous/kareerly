"""Neural signal providers for the feature layer.

These wrap the trained models so their output becomes a FEATURE COLUMN rather
than the decision itself. The distinction is the whole point of the design: a
cross-encoder that emits the final score is a black box; a cross-encoder that
contributes one of twenty-two inputs, whose weight is learned and whose
influence permutation importance reports as a number, is an instrument.

Both are cached per (resume, job) pair because reranking scores the same
shortlist repeatedly during evaluation and ablation.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .config import RETRIEVER_OUT, SCORER_OUT


def _key(a: str, b: str) -> str:
    return hashlib.sha1(f"{a[:2000]}||{b[:2000]}".encode("utf-8")).hexdigest()[:20]


class DenseScorer:
    """Cosine similarity from the trained bi-encoder (M2)."""

    def __init__(self, model_path: Optional[Path] = None, device: str = "cpu") -> None:
        from sentence_transformers import SentenceTransformer

        path = Path(model_path or RETRIEVER_OUT)
        if not path.exists():
            raise FileNotFoundError(f"No trained retriever at {path}")
        self.model = SentenceTransformer(str(path), device=device)
        self._cache: Dict[str, float] = {}

    def __call__(self, resume_text: str, job_text: str) -> float:
        key = _key(resume_text, job_text)
        if key not in self._cache:
            vectors = self.model.encode(
                [resume_text, job_text], normalize_embeddings=True, show_progress_bar=False
            )
            self._cache[key] = float(vectors[0] @ vectors[1])
        return self._cache[key]


class CrossEncoderScorer:
    """Raw logit from the cross-encoder (M3). Deliberately NOT normalised.

    Min-max normalising here is what produced "100% match" for a nonsense
    resume in v1. The ranker consumes the raw logit; calibration happens once,
    at the end, on the ranker's own output.
    """

    def __init__(self, model_path: Optional[Path] = None, device: str = "cpu") -> None:
        from sentence_transformers import CrossEncoder

        path = Path(model_path or SCORER_OUT)
        if not path.exists():
            raise FileNotFoundError(f"No trained scorer at {path}")
        self.model = CrossEncoder(str(path), device=device)
        self._cache: Dict[str, float] = {}

    def __call__(self, resume_text: str, job_text: str) -> float:
        key = _key(resume_text, job_text)
        if key not in self._cache:
            self._cache[key] = float(
                self.model.predict([[resume_text, job_text]], show_progress_bar=False)[0]
            )
        return self._cache[key]


def build_scorers(
    use_dense: bool = True,
    use_cross_encoder: bool = True,
) -> Dict[str, Optional[Callable[[str, str], float]]]:
    """Load whichever neural signals are available; degrade quietly if not.

    A missing model yields None, the feature stays 0.0, and the ablation is
    simply the run without that column -- which is exactly the comparison the
    results chapter needs anyway.
    """
    scorers: Dict[str, Optional[Callable[[str, str], float]]] = {
        "dense_scorer": None, "cross_encoder_scorer": None
    }
    if use_dense:
        try:
            scorers["dense_scorer"] = DenseScorer()
        except Exception as exc:
            print(f"  dense scorer unavailable ({type(exc).__name__}); feature will be 0.0")
    if use_cross_encoder:
        try:
            scorers["cross_encoder_scorer"] = CrossEncoderScorer()
        except Exception as exc:
            print(f"  cross-encoder unavailable ({type(exc).__name__}); feature will be 0.0")
    return scorers
