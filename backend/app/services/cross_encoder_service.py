from __future__ import annotations

import os
from functools import lru_cache
from typing import Sequence

import numpy as np


CROSS_ENCODER_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"


@lru_cache(maxsize=1)
def get_cross_encoder():
    """Load one shared Cross-Encoder instance for job and resource ranking."""
    try:
        from sentence_transformers import CrossEncoder
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "sentence-transformers is required for Cross-Encoder ranking."
        ) from exc

    allow_download = os.getenv(
        "KAREERLY_CROSS_ENCODER_ALLOW_DOWNLOAD", ""
    ).strip().lower() in {"1", "true", "yes"}
    return CrossEncoder(
        CROSS_ENCODER_MODEL_NAME,
        local_files_only=not allow_download,
    )


def score_text_pairs(
    query_text: str,
    document_texts: Sequence[str],
    *,
    batch_size: int = 16,
) -> np.ndarray:
    if not document_texts:
        return np.asarray([], dtype=float)
    pairs = [[query_text, str(document)] for document in document_texts]
    return np.asarray(
        get_cross_encoder().predict(
            pairs,
            batch_size=batch_size,
            show_progress_bar=False,
        ),
        dtype=float,
    )
