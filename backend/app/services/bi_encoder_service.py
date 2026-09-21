"""The thesis's shared fine-tuned MiniLM encoder and frozen input representation."""
from __future__ import annotations

import json
import hashlib
import logging
import os
import re
import threading
from functools import lru_cache
from pathlib import Path
from collections import OrderedDict
from typing import Sequence

import numpy as np

DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[2] / 'trained_models' / 'kareerly-bi-encoder'
MODEL_ID = 'kareerly-skills-first-minilm-2026-09-10'
logger = logging.getLogger(__name__)
_lock = threading.Lock()
_job_vectors: OrderedDict = OrderedDict()


class MatchingModelUnavailable(RuntimeError):
    pass


def model_path() -> Path:
    return Path(os.getenv('KAREERLY_BI_ENCODER_MODEL_PATH') or DEFAULT_MODEL_PATH).resolve()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


@lru_cache(maxsize=1)
def input_features() -> dict:
    try:
        return json.loads((model_path() / 'input_features.json').read_text())
    except (OSError, ValueError) as exc:
        raise MatchingModelUnavailable('The fine-tuned matching checkpoint is incomplete. Deploy backend/trained_models/kareerly-bi-encoder with its input_features.json.') from exc


@lru_cache(maxsize=1)
def get_bi_encoder():
    path = model_path()
    if not (path / 'model.safetensors').is_file() or not (path / 'modules.json').is_file():
        raise MatchingModelUnavailable('The fine-tuned matching model is missing. Deploy backend/trained_models/kareerly-bi-encoder or configure KAREERLY_BI_ENCODER_MODEL_PATH.')
    try:
        provenance = json.loads((path / 'provenance.json').read_text())
        if _file_sha256(path / 'model.safetensors') != provenance['weight_sha256']:
            raise ValueError('Model checkpoint checksum mismatch')
        if _file_sha256(path / 'input_features.json') != provenance['feature_sha256']:
            raise ValueError('Model input feature checksum mismatch')
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(str(path), device='cpu', local_files_only=True)
        model.max_seq_length = 256
        return model
    except Exception as exc:
        logger.exception('Fine-tuned bi-encoder failed to load')
        raise MatchingModelUnavailable('The fine-tuned matching model could not load. Check the backend model files and sentence-transformers dependencies.') from exc


def _normalize(value: str) -> str:
    value = re.sub(r"[’'`]+", "'", str(value or '').lower())
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9+#.'\s]", ' ', value)).strip()


@lru_cache(maxsize=1)
def _skill_trie() -> dict:
    trie = {}
    for alias, skill_id in input_features()['aliases'].items():
        words = _normalize(alias).split()
        if len(alias) < 3 or not words:
            continue
        node = trie
        for word in words:
            node = node.setdefault(word, {})
        node['$'] = skill_id
    return trie


def build_model_input(text: str, *, title: str = '', skill_names: Sequence[str] = ()) -> str:
    """Match training: role, <=32 IDF-ordered skills, redacted <=1400-char evidence."""
    words = _normalize(' '.join([text, *skill_names])).split()
    trie = _skill_trie()
    found = set()
    i = 0
    while i < len(words):
        node = trie
        j = i
        best = None
        while j < len(words) and words[j] in node:
            node = node[words[j]]
            j += 1
            if '$' in node:
                best = (node['$'], j)
        if best:
            found.add(best[0])
            i = best[1]
        else:
            i += 1
    features = input_features()
    # Sorted ID order preserves the training extractor's tie order.
    top = sorted(sorted(found), key=lambda value: -features['idf'][value])[:32]
    skills = '; '.join(features['labels'][value] for value in top)
    evidence = re.sub(r'https?://\S+|www\.\S+', '[URL]', text, flags=re.I)
    evidence = re.sub(r'(?<!\w)(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)', '[PHONE]', evidence)
    evidence = re.sub(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b', '[EMAIL]', evidence)
    return f'[ROLE] {title} [SKILLS] {skills} [EVIDENCE] {evidence[:1400]}'.strip()


def score_jobs(candidate_input: str, job_inputs: Sequence[str]) -> np.ndarray:
    if not job_inputs:
        return np.asarray([], dtype=float)
    # Inputs are part of the cache key, so changed/employer-created jobs invalidate it.
    key = (str(model_path()), tuple(job_inputs))
    try:
        with _lock:
            model = get_bi_encoder()
            vectors = _job_vectors.get(key)
            if vectors is None:
                # The catalogue is small enough to encode in moderately large
                # batches. This reduces warmup and cold-cache report latency
                # without changing the model or ranking behavior.
                batch_size = max(1, int(os.getenv('KAREERLY_ENCODER_BATCH_SIZE', '32')))
                vectors = np.asarray(model.encode(list(job_inputs), batch_size=batch_size, normalize_embeddings=True, show_progress_bar=False), dtype=np.float32)
                _job_vectors[key] = vectors
                while len(_job_vectors) > 2:
                    _job_vectors.popitem(last=False)
            _job_vectors.move_to_end(key)
            query = np.asarray(model.encode([candidate_input], batch_size=1, normalize_embeddings=True, show_progress_bar=False), dtype=float)[0]
        # Explicit normalization also supports test doubles and protects against drift.
        norms = np.linalg.norm(vectors, axis=1) * np.linalg.norm(query)
        scores = np.divide(vectors @ query, norms, out=np.zeros(len(vectors)), where=norms > 0)
        if len(scores) != len(job_inputs) or not np.isfinite(scores).all():
            raise ValueError('Invalid bi-encoder scores')
        return np.clip(scores, -1, 1)
    except MatchingModelUnavailable:
        raise
    except Exception as exc:
        logger.exception('Bi-encoder inference failed')
        raise MatchingModelUnavailable('The fine-tuned matching model could not score jobs. Check the backend logs and model files.') from exc
