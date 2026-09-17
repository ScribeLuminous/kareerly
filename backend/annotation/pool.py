"""TREC-style pooling.

Judging every (resume, job) pair is impossible: 200 resumes x 3,000 jobs is
600,000 decisions. Pooling is the standard answer -- take the top-K from each
system under comparison, union them, and judge only the union. Anything no
system retrieved is assumed non-relevant, which is a known and accepted
approximation in IR evaluation.

Two design rules that matter for the thesis, both implemented here:

  BLINDING. `contributed_by` records which system found a pair and at what
  rank, but the annotation view never shows it. If an annotator can tell that
  a pair came from your proposed system, the evaluation is compromised.

  SHUFFLING. Pool items are presented in a seeded random order, not in any
  system's ranking order, so position bias cannot systematically favour one run.

Depth: prefer more resumes judged shallowly over few resumes judged deeply.
Webber et al. found wide-and-shallow more reliable at equal cost, and the topic
count is what drives statistical power.
"""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from .schema import PoolItem


def _pool_id(resume_id: str, job_id: str) -> str:
    return hashlib.sha1(f"{resume_id}|{job_id}".encode("utf-8")).hexdigest()[:16]


def build_pool(
    runs: Mapping[str, Mapping[str, Sequence[str]]],
    resumes: Mapping[str, str],
    jobs: Mapping[str, Mapping[str, str]],
    depth: int = 10,
    max_per_resume: Optional[int] = None,
    seed: int = 20260824,
) -> List[PoolItem]:
    """Union the top-`depth` of every run.

    runs    system_name -> resume_id -> ranked job_ids
    resumes resume_id   -> resume text
    jobs    job_id      -> {"title": ..., "text": ...}
    """
    rng = random.Random(seed)
    by_resume: Dict[str, Dict[str, Dict[str, int]]] = {}

    for system, per_resume in runs.items():
        for resume_id, ranked in per_resume.items():
            if resume_id not in resumes:
                continue
            bucket = by_resume.setdefault(resume_id, {})
            for rank, job_id in enumerate(ranked[:depth], start=1):
                if job_id not in jobs:
                    continue
                bucket.setdefault(job_id, {})[system] = rank

    items: List[PoolItem] = []
    for resume_id, job_map in by_resume.items():
        job_ids = list(job_map)
        rng.shuffle(job_ids)
        if max_per_resume:
            # Keep the pairs the most systems agreed on, then fill randomly.
            job_ids.sort(key=lambda j: -len(job_map[j]))
            job_ids = job_ids[:max_per_resume]
            rng.shuffle(job_ids)

        for job_id in job_ids:
            job = jobs[job_id]
            items.append(PoolItem(
                pool_id=_pool_id(resume_id, job_id),
                resume_id=resume_id,
                job_id=job_id,
                resume_text=resumes[resume_id],
                job_title=str(job.get("title", "")),
                job_text=str(job.get("text", "")),
                contributed_by=job_map[job_id],
            ))

    rng.shuffle(items)
    return items


def assign(
    items: Sequence[PoolItem],
    annotators: Sequence[str],
    overlap_fraction: float = 0.15,
    seed: int = 20260824,
) -> Dict[str, List[str]]:
    """Split the pool across annotators, with a shared overlap for agreement.

    The overlap is what lets you report Cohen's kappa. Without it you have
    labels but no evidence that they mean the same thing to two people, and a
    panel is entitled to ask.
    """
    if not annotators:
        raise ValueError("Need at least one annotator.")

    rng = random.Random(seed)
    pool_ids = [item.pool_id for item in items]
    rng.shuffle(pool_ids)

    overlap_count = int(len(pool_ids) * overlap_fraction) if len(annotators) > 1 else 0
    overlap = pool_ids[:overlap_count]
    remaining = pool_ids[overlap_count:]

    assignments: Dict[str, List[str]] = {name: list(overlap) for name in annotators}
    for index, pool_id in enumerate(remaining):
        assignments[annotators[index % len(annotators)]].append(pool_id)

    for name in assignments:
        rng.shuffle(assignments[name])
    return assignments


def write_pool(items: Sequence[PoolItem], path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for item in items:
            handle.write(item.to_json() + "\n")
    return len(items)


def read_pool(path: Path) -> List[PoolItem]:
    items: List[PoolItem] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                items.append(PoolItem.from_dict(json.loads(line)))
    return items


def pool_statistics(items: Sequence[PoolItem]) -> Dict[str, Any]:
    resumes = {item.resume_id for item in items}
    systems: Dict[str, int] = {}
    unique_to_system: Dict[str, int] = {}

    for item in items:
        for system in item.contributed_by:
            systems[system] = systems.get(system, 0) + 1
        if len(item.contributed_by) == 1:
            only = next(iter(item.contributed_by))
            unique_to_system[only] = unique_to_system.get(only, 0) + 1

    return {
        "pool_size": len(items),
        "resumes": len(resumes),
        "mean_depth_per_resume": round(len(items) / max(len(resumes), 1), 2),
        "contributions_by_system": systems,
        "unique_contributions_by_system": unique_to_system,
    }
