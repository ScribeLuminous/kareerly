"""Build supervised training pairs from an unlabelled job corpus.

The problem this solves: you have jobs, you have no interaction data, and
hand-labelling enough (resume, job, relevant?) triples to train on is out of
scope. ConFit v2 (Yu et al., ACL Findings 2025) addresses exactly this with
"hypothetical resume embedding" -- generate the resume of an ideal candidate
for each job and use that as the positive.

This module does the deterministic version of that idea, so the training set
is reproducible from a seed rather than dependent on an LLM API:

    positive = pseudo-resume rendered from the job's own ESCO essential skills,
               its PSOC-informed occupation, and a seniority-consistent history

Two safeguards stop the model learning a string-matching shortcut:

  1. LABEL SWAP. The job text carries ESCO *preferred* labels; the pseudo-resume
     carries ESCO *alternative* labels for the same skill URI. "Python
     (computer programming)" in the job becomes "Python programming" in the
     resume. Exact overlap is broken, so the model must learn that the two
     denote the same competence.
  2. STOCHASTIC DROPOUT. A random subset of skills is withheld from each
     pseudo-resume, and section order is shuffled. A real candidate never
     matches every requirement; a model trained on perfect matches learns a
     threshold that does not exist in deployment.

Hard negatives are mined with BM25 from the same corpus, which produces
lexically close but semantically wrong jobs -- the pairs the model most needs
to separate. Runner-up mining is ConFit v2's other contribution.

IMPORTANT -- leakage boundary. Pseudo-resumes are JOB-CONDITIONED and are
training data only. The evaluation resumes are generated separately from PSOC
occupation profiles with controlled demographics, conditioned on no job in the
corpus. The two sets must never be mixed. See `evaluate.py`.
"""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

from .config import (
    HARD_NEGATIVES_PER_POSITIVE,
    LABELLED_JOBS,
    NEGATIVE_MAX_SIMILARITY,
    PAIRS_DEV,
    PAIRS_TRAIN,
    SEED,
)

SENIORITY_HISTORY = {
    "intern": [("OJT / Practicum", 0)],
    "entry": [("Junior {role}", 1), ("Intern, {role}", 0)],
    "mid": [("{role}", 3), ("Junior {role}", 2)],
    "senior": [("Senior {role}", 4), ("{role}", 3), ("Junior {role}", 2)],
    "manager": [("{role} Manager", 3), ("Senior {role}", 4), ("{role}", 2)],
    "": [("{role}", 2)],
}

EDUCATION_BY_SENIORITY = {
    "intern": "Currently completing a bachelor's degree",
    "entry": "Bachelor's degree",
    "mid": "Bachelor's degree",
    "senior": "Bachelor's degree",
    "manager": "Bachelor's degree, with continuing professional education",
    "": "Bachelor's degree",
}


def _clean_role(title: str) -> str:
    role = re.sub(r"\b(senior|junior|sr\.?|jr\.?|lead|entry[- ]level|i{1,3}|[0-9]+)\b",
                  " ", str(title), flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", role).strip() or "Specialist"


def _alt_label_for(skill: Dict[str, Any], rng: random.Random) -> str:
    """Prefer an ESCO alternative label so the resume does not echo the job."""
    from pipeline import esco

    record = esco.load_skills().get(skill.get("skill_uri", ""), {})
    alternatives = [label for label in record.get("alt_labels", []) if label.strip()]
    if alternatives:
        return rng.choice(alternatives)
    return skill.get("preferred_label", "") or skill.get("matched_span", "")


@dataclass
class Pair:
    query: str            # the (pseudo-)resume side
    positive: str         # the job text it should match
    negatives: List[str]
    job_id: str
    meta: Dict[str, Any]

    def to_json(self) -> str:
        return json.dumps({
            "query": self.query,
            "positive": self.positive,
            "negatives": self.negatives,
            "job_id": self.job_id,
            "meta": self.meta,
        }, ensure_ascii=False)


def job_text(job: Dict[str, Any], use_preferred_labels: bool = True) -> str:
    """Canonical job side. Preferred ESCO labels, so the resume side can differ."""
    skills = job.get("esco_skills", [])
    essential = [s for s in skills if s.get("relation_type") == "essential"]
    optional = [s for s in skills if s.get("relation_type") != "essential"]

    def render(items: Sequence[Dict[str, Any]]) -> str:
        return "; ".join(
            s.get("preferred_label") or s.get("matched_span", "") for s in items if s
        )

    parts = [
        f"Job title: {job.get('title','')}.",
        f"Location: {job.get('location_raw','')} ({job.get('region','')}).",
    ]
    if job.get("seniority"):
        parts.append(f"Seniority: {job['seniority']}.")
    if job.get("work_setup"):
        parts.append(f"Work setup: {job['work_setup']}.")
    if essential:
        parts.append(f"Required competences: {render(essential)}.")
    if optional:
        parts.append(f"Preferred competences: {render(optional)}.")
    parts.append(f"Description: {job.get('description','')}")

    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def pseudo_resume(job: Dict[str, Any], rng: random.Random) -> Tuple[str, Dict[str, Any]]:
    """Render the resume of a plausible strong candidate for this job."""
    role = _clean_role(job.get("title", ""))
    seniority = job.get("seniority", "") or ""
    skills = [s for s in job.get("esco_skills", []) if s.get("skill_uri")]

    # Stochastic dropout: keep 55-95% of skills. Nobody matches everything.
    keep_ratio = rng.uniform(0.55, 0.95)
    keep_count = max(1, int(round(len(skills) * keep_ratio))) if skills else 0
    kept = rng.sample(skills, keep_count) if keep_count else []

    # Label swap: express kept skills with ESCO alt-labels.
    skill_phrases = []
    for skill in kept:
        label = _alt_label_for(skill, rng)
        if label:
            skill_phrases.append(label)
    rng.shuffle(skill_phrases)

    history_template = SENIORITY_HISTORY.get(seniority, SENIORITY_HISTORY[""])
    history_lines = []
    for template, years in history_template:
        position = template.format(role=role)
        span = f"{years} year{'s' if years != 1 else ''}" if years else "6 months"
        history_lines.append(f"{position} — {span}")

    sections = [
        ("SKILLS", ", ".join(skill_phrases) if skill_phrases else "General office skills"),
        ("EXPERIENCE", " | ".join(history_lines)),
        ("EDUCATION", EDUCATION_BY_SENIORITY.get(seniority, EDUCATION_BY_SENIORITY[""])),
    ]
    rng.shuffle(sections)

    text = " ".join(f"{heading}: {body}." for heading, body in sections)

    meta = {
        "generator": "deterministic_pseudo_resume_v1",
        "role": role,
        "seniority": seniority,
        "skills_in_job": len(skills),
        "skills_kept": len(kept),
        "keep_ratio": round(keep_ratio, 3),
        "label_swapped": True,
    }
    return re.sub(r"\s+", " ", text).strip(), meta


class BM25Miner:
    """Mine lexically-close but wrong jobs. These are the informative negatives."""

    def __init__(self, corpus_texts: List[str]) -> None:
        from rank_bm25 import BM25Okapi

        self.texts = corpus_texts
        self.tokenized = [self._tokenize(text) for text in corpus_texts]
        self.index = BM25Okapi(self.tokenized)

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        return re.findall(r"[a-z0-9+#]+", str(text).lower())

    def mine(self, query: str, exclude_index: int, count: int) -> List[int]:
        scores = self.index.get_scores(self._tokenize(query))
        order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        picked: List[int] = []
        for index in order:
            if index == exclude_index:
                continue
            picked.append(index)
            if len(picked) >= count:
                break
        return picked


def _load_jobs(path: Path) -> List[Dict[str, Any]]:
    jobs = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                jobs.append(json.loads(line))
    return jobs


def build_pairs(
    jobs_path: Optional[Path] = None,
    train_out: Optional[Path] = None,
    dev_out: Optional[Path] = None,
    dev_fraction: float = 0.15,
    resumes_per_job: int = 2,
    seed: int = SEED,
) -> Dict[str, int]:
    jobs_path = jobs_path or LABELLED_JOBS
    train_out = train_out or PAIRS_TRAIN
    dev_out = dev_out or PAIRS_DEV

    jobs = _load_jobs(jobs_path)
    if len(jobs) < 4:
        raise ValueError(
            f"Only {len(jobs)} labelled jobs. Run the corpus pipeline first — "
            f"contrastive training needs a few hundred at minimum."
        )

    rng = random.Random(seed)
    texts = [job_text(job) for job in jobs]
    miner = BM25Miner(texts)

    # Split by JOB, not by pair, so no job appears on both sides of the split.
    indices = list(range(len(jobs)))
    rng.shuffle(indices)
    dev_cutoff = max(1, int(len(indices) * dev_fraction))
    dev_indices = set(indices[:dev_cutoff])

    counts = {"jobs": len(jobs), "train_pairs": 0, "dev_pairs": 0, "negatives": 0}

    with train_out.open("w", encoding="utf-8") as train_handle, \
         dev_out.open("w", encoding="utf-8") as dev_handle:

        for job_index, job in enumerate(jobs):
            for replicate in range(resumes_per_job):
                resume, meta = pseudo_resume(job, rng)
                negative_indices = miner.mine(
                    resume, job_index, HARD_NEGATIVES_PER_POSITIVE
                )
                negatives = [texts[i] for i in negative_indices]
                meta["replicate"] = replicate
                meta["negative_job_ids"] = [jobs[i].get("job_id", "") for i in negative_indices]

                pair = Pair(
                    query=resume,
                    positive=texts[job_index],
                    negatives=negatives,
                    job_id=job.get("job_id", ""),
                    meta=meta,
                )

                if job_index in dev_indices:
                    dev_handle.write(pair.to_json() + "\n")
                    counts["dev_pairs"] += 1
                else:
                    train_handle.write(pair.to_json() + "\n")
                    counts["train_pairs"] += 1
                counts["negatives"] += len(negatives)

    return counts
