"""Weak supervision for training TaxonomyRanker on Philippine data.

Why this exists. Djinni gave the retriever real training signal because its
labels come from data OUTSIDE the feature set: Primary Keyword, years, English
level are structured fields distinct from anything the ranker later reads as a
feature. The first attempt at a Philippine-trained ranker (the quarantined
`_kareerly-ranker.FIXTURE-DO-NOT-USE`) violated that separation: relevance was
DEFINED as essential_coverage >= threshold, then essential_coverage was fed to
the ranker as a feature, so it "learned" to reproduce its own label
definition. That produced the identical-99.97%-for-everything failure.

DEAD FIELDS. `JobPosting.required_years` and `.required_education` are read by
FeatureExtractor but are never populated by pipeline/label.py -- confirmed 0 of
69 jobs carry either. Djinni's exact rule (specialisation + experience +
English) is therefore unavailable here; this module substitutes a comparable
categorical criterion that is equally external to the feature set.

THE RULE. Every Kareerly synthetic resume is generated FROM a specific K13
parent skill group (recorded in resume_manifest.json as `occupation_group`,
the group's human-readable subcategory name). Every PH fixture job's essential
skills were likewise drawn from one dominant parent group. Matching on that
group identity is a categorical equality test -- structurally the same move as
Djinni's "same Primary Keyword" -- and is NOT the same quantity as
`parent_group_overlap` (a continuous fraction over held skills) or
`essential_coverage` (a continuous IDF-weighted score), so the ranker cannot
trivially reconstruct the label from either feature.

    positive    resume's occupation_group == job's dominant subcategory
    near_miss   same K13 category, different subcategory      (hard negative)
    random      different K13 category                        (easy negative)

LIMITATION TO STATE. This is weaker than Djinni's rule: it uses one categorical
criterion instead of three, because two of the three fields this corpus would
need are dead. Treat this ranker as a PILOT, not a substitute for training on
human-judged pairs.
"""

from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from models.features import CandidateProfile, FeatureExtractor, JobPosting


def job_dominant_subcategory(job: JobPosting, taxonomy) -> str:
    """Mode of subcategory across the job's essential skills."""
    names = [
        taxonomy.skills[sid].subcategory
        for sid in job.essential_skill_ids
        if sid in taxonomy.skills and taxonomy.skills[sid].subcategory
    ]
    if not names:
        return ""
    return Counter(names).most_common(1)[0][0]


def build_labels(
    resumes: Dict[str, str],
    manifest: Sequence[Dict[str, Any]],
    jobs: Sequence[JobPosting],
    taxonomy,
    rng: random.Random,
    positives_per_resume: int = 2,
    near_miss_per_resume: int = 2,
    random_per_resume: int = 2,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    manifest_by_id = {m["resume_id"]: m for m in manifest}
    job_subcat = {j.job_id: job_dominant_subcategory(j, taxonomy) for j in jobs}
    job_k13 = {j.job_id: j.k13_id for j in jobs}

    by_subcat: Dict[str, List[str]] = {}
    by_k13: Dict[str, List[str]] = {}
    for j in jobs:
        subcat = job_subcat[j.job_id]
        if subcat:
            by_subcat.setdefault(subcat, []).append(j.job_id)
        by_k13.setdefault(job_k13[j.job_id], []).append(j.job_id)

    rows: List[Dict[str, Any]] = []
    stats = {"positive": 0, "near_miss": 0, "random_negative": 0,
             "resumes_with_no_matching_job": 0}

    for resume_id in resumes:
        spec = manifest_by_id.get(resume_id)
        if not spec:
            continue
        target_subcat = spec["occupation_group"]
        target_k13 = spec["k13_id"]

        positives = [j for j in by_subcat.get(target_subcat, [])]
        if not positives:
            stats["resumes_with_no_matching_job"] += 1
            continue

        for job_id in rng.sample(positives, min(len(positives), positives_per_resume)):
            rows.append({"resume_id": resume_id, "job_id": job_id, "label": 1, "kind": "positive"})
            stats["positive"] += 1

        near_miss_pool = [j for j in by_k13.get(target_k13, []) if j not in positives]
        for job_id in rng.sample(near_miss_pool, min(len(near_miss_pool), near_miss_per_resume)):
            rows.append({"resume_id": resume_id, "job_id": job_id, "label": 0, "kind": "near_miss"})
            stats["near_miss"] += 1

        other_pool = [j for j in job_k13 if job_k13[j] != target_k13]
        for job_id in rng.sample(other_pool, min(len(other_pool), random_per_resume)):
            rows.append({"resume_id": resume_id, "job_id": job_id, "label": 0, "kind": "random_negative"})
            stats["random_negative"] += 1

    return rows, stats


def extract_feature_matrix(
    rows: Sequence[Dict[str, Any]],
    resumes: Dict[str, str],
    manifest: Sequence[Dict[str, Any]],
    jobs: Sequence[JobPosting],
    taxonomy,
) -> Tuple[List[List[float]], List[int], List[str], List[Dict[str, float]]]:
    from models.features import FEATURE_NAMES

    manifest_by_id = {m["resume_id"]: m for m in manifest}
    jobs_by_id = {j.job_id: j for j in jobs}
    extractor = FeatureExtractor(
        taxonomy, FeatureExtractor.fit_document_frequency(jobs), corpus_size=len(jobs) or 1
    )

    X: List[List[float]] = []
    y: List[int] = []
    groups: List[str] = []
    raw_features: List[Dict[str, float]] = []

    for row in rows:
        spec = manifest_by_id[row["resume_id"]]
        job = jobs_by_id.get(row["job_id"])
        if job is None:
            continue
        profile = CandidateProfile(
            skill_ids=spec["skill_ids"], years_experience=spec["years_experience"],
            education=spec["education_level"], region=spec["region"],
            text=resumes[row["resume_id"]],
        )
        features, _ = extractor.extract(profile, job)
        X.append([features.get(name, 0.0) for name in FEATURE_NAMES])
        y.append(row["label"])
        groups.append(row["resume_id"])
        raw_features.append(features)

    return X, y, groups, raw_features
