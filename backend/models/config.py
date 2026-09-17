"""Configuration for Kareerly's trained-model experiments.

    M1  SkillTagger    token classification  -> skill spans        (train_tagger)
    M2  MatchRetriever taxonomy-aware semantic bi-encoder           (primary)
    M3  MatchScorer    cross-encoder top-K reranker                 (experimental)

M2 generates the matches. M3 may reorder M2's shortlist only after held-out
human judgements show an improvement. Eligibility, gap valuation and course
selection remain deterministic so explanations can trace to taxonomy evidence.
"""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
CORPUS_DIR = BACKEND_DIR / "data" / "corpus"

LABELLED_JOBS = CORPUS_DIR / "labelled" / "jobs.jsonl"
TRAIN_DIR = CORPUS_DIR / "training"
ARTIFACT_DIR = BACKEND_DIR / "trained_models"
EVAL_DIR = CORPUS_DIR / "evaluation"

for _d in (TRAIN_DIR, ARTIFACT_DIR, EVAL_DIR):
    _d.mkdir(parents=True, exist_ok=True)

PAIRS_TRAIN = TRAIN_DIR / "pairs_train.jsonl"
PAIRS_DEV = TRAIN_DIR / "pairs_dev.jsonl"

RETRIEVER_BASE = os.getenv("KAREERLY_RETRIEVER_BASE", "sentence-transformers/all-MiniLM-L6-v2")
SCORER_BASE = os.getenv("KAREERLY_SCORER_BASE", "cross-encoder/ms-marco-MiniLM-L-6-v2")

RETRIEVER_OUT = ARTIFACT_DIR / "kareerly-retriever"
SCORER_OUT = ARTIFACT_DIR / "kareerly-scorer"
CALIBRATION_OUT = ARTIFACT_DIR / "calibration.json"

# Negatives per positive when mining with BM25.
HARD_NEGATIVES_PER_POSITIVE = 4
# Skip a mined negative this similar to the positive -- probably a true duplicate.
NEGATIVE_MAX_SIMILARITY = 0.92

SEED = 20260823
