"""D1 — Djinni Recruitment Dataset loader and distant-supervision pair builder.

    Drushchak, N. & Romanyshyn, M. (2024). Introducing the Djinni Recruitment
    Dataset: A Corpus of Anonymized CVs and Job Postings. Proceedings of the
    Third Ukrainian NLP Workshop (UNLP) @ LREC-COLING 2024, pp. 8-13. MIT licence.

Why this replaces the synthetic pseudo-resumes:

  * 210,250 real English CVs and 141,897 real job postings, not templates.
  * Anonymized *by the publishers*, so under the Philippine Data Privacy Act it
    is no longer personal information and the research exception is not even
    load-bearing.
  * MIT licensed and peer-reviewed, so it is citable and redistributable.

The dataset ships no match labels, which is the usual person-job fit problem.
We construct positives by DISTANT SUPERVISION over three attributes that exist
on both sides of the corpus:

    1. Primary Keyword  — 41 shared specialisations covering 99.9% of both sides
    2. Experience       — candidate years >= the job's stated requirement
    3. English level    — candidate level >= the job's stated requirement

A pair passing all three is a plausible positive: same specialisation, meets
the stated thresholds. This is weak supervision and must be described as such,
but it is grounded in real platform data rather than invented.

Negatives are deliberately graded, because random negatives teach nothing:

    near_miss   same specialisation, fails a threshold  (hardest)
    bm25        lexically similar, different keyword    (hard)
    random      different specialisation                (easy, few)

LIMITATION TO STATE IN CHAPTER 3. Djinni is the Ukrainian IT labour market. All
41 categories are technology-adjacent; there is no agriculture, healthcare,
hospitality, or skilled-trades coverage. It is the TRAINING corpus. Adaptation
and evaluation happen on the Philippine corpus, and per-family results should be
reported so the transfer gap is visible rather than hidden.
"""

from __future__ import annotations

import json
import random
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .config import PAIRS_DEV, PAIRS_TRAIN, SEED

CANDIDATES_DATASET = "lang-uk/recruitment-dataset-candidate-profiles-english"
JOBS_DATASET = "lang-uk/recruitment-dataset-job-descriptions-english"

#: Ordinal. A candidate satisfies a job if their level is at least the job's.
ENGLISH_LEVELS = {"basic": 0, "pre": 1, "intermediate": 2, "upper": 3, "fluent": 4}

#: Job "Exp Years" is a small closed vocabulary, not a number.
EXPERIENCE_REQUIRED = {"no_exp": 0.0, "1y": 1.0, "2y": 2.0, "3y": 3.0, "5y": 5.0}

MIN_CV_CHARS = 200
MIN_JOB_CHARS = 200

#: Borderline band. Pairs inside it are discarded rather than labelled negative,
#: because a 3.0-year candidate "failing" a 3y posting is an artefact.
EXPERIENCE_MARGIN_YEARS = 1.0
ENGLISH_MARGIN_BANDS = 1


def english_rank(value: Any) -> int:
    return ENGLISH_LEVELS.get(str(value or "").strip().lower(), -1)


def required_years(value: Any) -> float:
    return EXPERIENCE_REQUIRED.get(str(value or "").strip().lower(), 0.0)


def candidate_text(row: Dict[str, Any]) -> str:
    """Resume side. Uses the real CV text plus the structured self-description."""
    parts = [
        f"Position sought: {row.get('Position','')}.",
        f"Specialisation: {row.get('Primary Keyword','')}.",
        f"Experience: {row.get('Experience Years','')} years.",
        f"English: {row.get('English Level','')}.",
    ]
    for field in ("Highlights", "Moreinfo", "Looking For", "CV"):
        value = str(row.get(field) or "").strip()
        if value:
            parts.append(value)
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def posting_text(row: Dict[str, Any]) -> str:
    parts = [
        f"Job title: {row.get('Position','')}.",
        f"Specialisation: {row.get('Primary Keyword','')}.",
        f"Experience required: {row.get('Exp Years','')}.",
        f"English required: {row.get('English Level','')}.",
        str(row.get("Long Description") or ""),
    ]
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def compatibility(candidate: Dict[str, Any], job: Dict[str, Any]) -> str:
    """Three-way verdict, not binary.

    Distant supervision over thresholds has an obvious failure mode: a candidate
    with exactly 3.0 years "fails" a 3y posting by a rounding artefact, and
    calling that a NEGATIVE teaches the model something false. Borderline pairs
    are therefore returned as "grey" and excluded from training entirely --
    neither positive nor negative. Only clear failures become hard negatives.

    Returns one of: "positive", "grey", "negative".
    """
    if str(candidate.get("Primary Keyword") or "") != str(job.get("Primary Keyword") or ""):
        return "negative"

    have = candidate.get("Experience Years")
    need = required_years(job.get("Exp Years"))
    if have is None:
        return "grey"
    have = float(have)

    cand_english = english_rank(candidate.get("English Level"))
    job_english = english_rank(job.get("English Level"))
    english_gap = (job_english - cand_english) if (job_english >= 0 and cand_english >= 0) else 0

    if have >= need and english_gap <= 0:
        return "positive"
    # Within one year, or one English band, is noise rather than a real mismatch.
    if have >= need - EXPERIENCE_MARGIN_YEARS and english_gap <= ENGLISH_MARGIN_BANDS:
        return "grey"
    return "negative"


def is_compatible(candidate: Dict[str, Any], job: Dict[str, Any]) -> Tuple[bool, str]:
    """Binary view, kept for callers that only need positive/not-positive."""
    if str(candidate.get("Primary Keyword") or "") != str(job.get("Primary Keyword") or ""):
        return False, "different_specialisation"

    have = candidate.get("Experience Years")
    need = required_years(job.get("Exp Years"))
    if have is None or float(have) < need:
        return False, "insufficient_experience"

    cand_english = english_rank(candidate.get("English Level"))
    job_english = english_rank(job.get("English Level"))
    if job_english >= 0 and cand_english >= 0 and cand_english < job_english:
        return False, "insufficient_english"

    return True, ""


def _tokenize(text: str) -> List[str]:
    return re.findall(r"[a-z0-9+#]+", str(text).lower())


def build_pairs(
    train_out: Optional[Path] = None,
    dev_out: Optional[Path] = None,
    max_pairs: int = 20000,
    dev_fraction: float = 0.15,
    near_miss_negatives: int = 2,
    lexical_negatives: int = 2,
    categories: Optional[Sequence[str]] = None,
    lexical_pool_size: int = 20000,
    seed: int = SEED,
) -> Dict[str, Any]:
    """Two passes. Pass 1 selects candidates and their positives/near-misses.
    Pass 2 mines lexical negatives for every query in ONE sparse matrix product
    -- scoring each query against the whole pool individually is O(queries x
    pool) Python-level work and does not finish at this corpus size.
    """
    import numpy as np
    from datasets import load_dataset
    from sklearn.feature_extraction.text import TfidfVectorizer

    train_out = Path(train_out or PAIRS_TRAIN)
    dev_out = Path(dev_out or PAIRS_DEV)
    rng = random.Random(seed)

    candidates = load_dataset(CANDIDATES_DATASET, split="train")
    jobs = load_dataset(JOBS_DATASET, split="train")

    jobs_by_keyword: Dict[str, List[Dict[str, Any]]] = {}
    for row in jobs:
        if len(str(row.get("Long Description") or "")) < MIN_JOB_CHARS:
            continue
        keyword = str(row.get("Primary Keyword") or "")
        if categories and keyword not in categories:
            continue
        jobs_by_keyword.setdefault(keyword, []).append(dict(row))

    if not jobs_by_keyword:
        raise ValueError("No jobs matched the requested categories.")

    stats: Dict[str, Any] = {
        "candidates_seen": 0, "pairs": 0, "train_pairs": 0, "dev_pairs": 0,
        "rejected_no_keyword": 0, "rejected_short_cv": 0,
        "rejected_no_compatible_job": 0,
        "near_miss_negatives": 0, "lexical_negatives": 0, "grey_discarded": 0,
        "categories": sorted(jobs_by_keyword),
        "job_pool": sum(len(v) for v in jobs_by_keyword.values()),
    }

    # ---- pass 1: positives and near-miss negatives -------------------------
    staged: List[Dict[str, Any]] = []
    order = list(range(len(candidates)))
    rng.shuffle(order)

    for index in order:
        if len(staged) >= max_pairs:
            break

        candidate = dict(candidates[index])
        stats["candidates_seen"] += 1

        keyword = str(candidate.get("Primary Keyword") or "")
        if keyword not in jobs_by_keyword:
            stats["rejected_no_keyword"] += 1
            continue
        if len(str(candidate.get("CV") or "")) < MIN_CV_CHARS:
            stats["rejected_short_cv"] += 1
            continue

        same_keyword = jobs_by_keyword[keyword]
        sample = rng.sample(same_keyword, min(len(same_keyword), 40))

        verdicts = [(job, compatibility(candidate, job)) for job in sample]
        compatible = [job for job, verdict in verdicts if verdict == "positive"]
        near_misses = [job for job, verdict in verdicts if verdict == "negative"]
        stats["grey_discarded"] += sum(1 for _, verdict in verdicts if verdict == "grey")

        if not compatible:
            stats["rejected_no_compatible_job"] += 1
            continue

        positive = rng.choice(compatible)
        negatives = [
            posting_text(job)
            for job in rng.sample(near_misses, min(len(near_misses), near_miss_negatives))
        ]
        stats["near_miss_negatives"] += len(negatives)

        staged.append({
            "query": candidate_text(candidate),
            "positive": posting_text(positive),
            "negatives": negatives,
            "job_id": str(positive.get("id", "")),
            "keyword": keyword,
            "meta": {
                "source": "djinni",
                "supervision": "distant_keyword_experience_english",
                "candidate_id": str(candidate.get("id", "")),
                "primary_keyword": keyword,
                "candidate_years": candidate.get("Experience Years"),
                "job_exp_required": positive.get("Exp Years"),
                "candidate_english": candidate.get("English Level"),
                "job_english": positive.get("English Level"),
                "compatible_jobs_in_sample": len(compatible),
            },
        })

    if not staged:
        raise ValueError("No pairs survived the compatibility rule.")

    # ---- pass 2: lexical negatives, batched --------------------------------
    if lexical_negatives > 0:
        pool: List[Dict[str, Any]] = [j for rows in jobs_by_keyword.values() for j in rows]
        if len(pool) > lexical_pool_size:
            pool = rng.sample(pool, lexical_pool_size)
        pool_texts = [posting_text(job) for job in pool]
        pool_keywords = [str(job.get("Primary Keyword") or "") for job in pool]

        vectorizer = TfidfVectorizer(
            lowercase=True, stop_words="english", max_features=60000, ngram_range=(1, 2)
        )
        pool_matrix = vectorizer.fit_transform(pool_texts)
        query_matrix = vectorizer.transform([item["query"] for item in staged])

        block = 512
        for start in range(0, query_matrix.shape[0], block):
            similarity = (query_matrix[start:start + block] @ pool_matrix.T).toarray()
            for offset, row in enumerate(similarity):
                item = staged[start + offset]
                taken = 0
                for pool_index in np.argsort(-row):
                    if taken >= lexical_negatives:
                        break
                    if pool_keywords[pool_index] == item["keyword"]:
                        continue
                    item["negatives"].append(pool_texts[pool_index])
                    taken += 1
                stats["lexical_negatives"] += taken

    # ---- write -------------------------------------------------------------
    with train_out.open("w", encoding="utf-8") as train_handle, \
         dev_out.open("w", encoding="utf-8") as dev_handle:
        for item in staged:
            item.pop("keyword", None)
            line = json.dumps(item, ensure_ascii=False) + "\n"
            if rng.random() < dev_fraction:
                dev_handle.write(line)
                stats["dev_pairs"] += 1
            else:
                train_handle.write(line)
                stats["train_pairs"] += 1
            stats["pairs"] += 1

    return stats
