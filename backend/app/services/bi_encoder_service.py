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
# Written at build time by `python -m app.precompute_job_vectors`; not committed.
DEFAULT_JOB_VECTORS_PATH = Path(__file__).resolve().parents[2] / 'precomputed' / 'job_vectors.npz'
MODEL_ID = 'kareerly-skills-first-minilm-2026-09-10'
# Enough for every catalogue job several times over; each vector is ~1.5 KB.
MAX_CACHED_JOB_VECTORS = 20_000
logger = logging.getLogger(__name__)
_lock = threading.Lock()
# Job input text hash -> normalized vector, shared by every catalogue version.
_job_vectors: OrderedDict = OrderedDict()


class MatchingModelUnavailable(RuntimeError):
    pass


def model_path() -> Path:
    return Path(os.getenv('KAREERLY_BI_ENCODER_MODEL_PATH') or DEFAULT_MODEL_PATH).resolve()


def job_vectors_path() -> Path:
    return Path(os.getenv('KAREERLY_JOB_VECTORS_PATH') or DEFAULT_JOB_VECTORS_PATH).resolve()


def job_input_key(job_input: str) -> str:
    return hashlib.sha256(job_input.encode('utf-8')).hexdigest()


def _checkpoint_identity() -> tuple[str, str]:
    """Model ID and weight checksum, read from provenance without rehashing the weights."""
    provenance = json.loads((model_path() / 'provenance.json').read_text())
    return MODEL_ID, provenance['weight_sha256']


def save_job_vectors(path: Path, job_inputs: Sequence[str], vectors: np.ndarray) -> None:
    model_id, weight_sha256 = _checkpoint_identity()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('wb') as file:
        np.savez(
            file,
            keys=np.asarray([job_input_key(value) for value in job_inputs]),
            vectors=np.asarray(vectors, dtype=np.float32),
            model_id=np.asarray(model_id),
            weight_sha256=np.asarray(weight_sha256),
        )


@lru_cache(maxsize=1)
def load_precomputed_job_vectors() -> int:
    """Seed the job-vector cache from the build-time store; returns how many loaded.

    A missing, unreadable or stale store (built for other weights) is skipped with
    a log line: matching then encodes jobs on demand, as it would without a store.
    """
    path = job_vectors_path()
    if not path.is_file():
        logger.info('No precomputed job vectors at %s; jobs will be encoded on demand', path)
        return 0
    try:
        with np.load(path, allow_pickle=False) as store:
            identity = (str(store['model_id']), str(store['weight_sha256']))
            if identity != _checkpoint_identity():
                logger.warning('Ignoring precomputed job vectors at %s: built for a different checkpoint', path)
                return 0
            keys, vectors = store['keys'], store['vectors']
    except (OSError, ValueError, KeyError) as exc:
        logger.warning('Ignoring unreadable precomputed job vectors at %s: %s', path, exc)
        return 0
    with _lock:
        for key, vector in zip(keys.tolist(), vectors):
            _job_vectors.setdefault(key, vector)
    logger.info('Loaded %d precomputed job vectors from %s', len(keys), path)
    return len(keys)


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


def encode_job_inputs(model, job_inputs: Sequence[str]) -> np.ndarray:
    # Catalogue encoding is the peak-memory point on small hosted instances.
    # Keep the default batch small; this changes only inference memory/latency,
    # not the embeddings or ranking rules.
    batch_size = max(1, int(os.getenv('KAREERLY_ENCODER_BATCH_SIZE', '4')))
    return np.asarray(model.encode(list(job_inputs), batch_size=batch_size, normalize_embeddings=True, show_progress_bar=False), dtype=np.float32)


def score_jobs(candidate_input: str, job_inputs: Sequence[str]) -> np.ndarray:
    if not job_inputs:
        return np.asarray([], dtype=float)
    # Vectors are cached per job input text, so an edited job re-encodes only
    # itself. The model is fixed for the process, and the build-time store is
    # checked against the checkpoint before it seeds this cache.
    keys = [job_input_key(value) for value in job_inputs]
    try:
        load_precomputed_job_vectors()
        with _lock:
            model = get_bi_encoder()
            missing = {key: value for key, value in zip(keys, job_inputs) if key not in _job_vectors}
            if missing:
                vectors = encode_job_inputs(model, list(missing.values()))
                _job_vectors.update(zip(missing, vectors))
            for key in keys:
                _job_vectors.move_to_end(key)
            while len(_job_vectors) > max(MAX_CACHED_JOB_VECTORS, len(keys)):
                _job_vectors.popitem(last=False)
            vectors = np.stack([_job_vectors[key] for key in keys])
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
