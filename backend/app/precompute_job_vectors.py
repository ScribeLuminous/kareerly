"""Encode the job catalogue at build time so a cold start only loads vectors.

Encodes every job in ``data/reference_jobs.csv`` and, when Supabase credentials
are available to the build, every internal and employer job there too. The
vectors are keyed by the exact encoder input text, so at runtime a job that was
added or edited after the build simply misses the store and is encoded on
demand; nothing stale is ever reused.

Run from ``backend/`` (Dockerfile, Render with a ``backend`` root directory):

    python -m app.precompute_job_vectors

or from the repository root:

    python -m backend.app.precompute_job_vectors

The output defaults to ``backend/precomputed/job_vectors.npz`` and can be moved
with ``KAREERLY_JOB_VECTORS_PATH`` (set it for both the build and the service).
"""
from __future__ import annotations

import logging
import sys
import time

import pandas as pd

from .services.bi_encoder_service import encode_job_inputs, get_bi_encoder, job_vectors_path, save_job_vectors
from .services.matching_service import REFERENCE_JOBS_PATH, job_model_inputs, prepare_jobs, safe_read_csv
from .services.supabase_jobs import load_internal_jobs_dataframe

logger = logging.getLogger('kareerly.precompute_job_vectors')


def catalogue_inputs() -> list[str]:
    frames = [prepare_jobs(safe_read_csv(REFERENCE_JOBS_PATH))]
    supabase_jobs = load_internal_jobs_dataframe()
    if supabase_jobs.empty:
        logger.info('Supabase jobs unavailable at build time; encoding reference_jobs.csv only')
    else:
        frames.append(prepare_jobs(supabase_jobs))
    inputs = job_model_inputs(pd.concat(frames, ignore_index=True))
    return list(dict.fromkeys(inputs))


def main() -> int:
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')
    started = time.monotonic()
    inputs = catalogue_inputs()
    vectors = encode_job_inputs(get_bi_encoder(), inputs)
    path = job_vectors_path()
    save_job_vectors(path, inputs, vectors)
    logger.info('Wrote %d job vectors to %s in %.1fs', len(inputs), path, time.monotonic() - started)
    return 0


if __name__ == '__main__':
    sys.exit(main())
