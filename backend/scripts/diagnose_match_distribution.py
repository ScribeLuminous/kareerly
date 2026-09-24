"""Score-distribution diagnostic for the production job matcher.

Runs every mock Philippine resume in ``backend/evaluation/sample_resumes``
against every catalogue job through the *production* matching functions and
reports, per candidate-job pair, the intermediate signals that decide the
category (cosine, required/preferred coverage, must-have gaps, final score,
category). Pairs are grouped with metadata labels that never touch the model or
skill coverage (``evaluation/match_diagnostic_labels.csv``):

* strong   - job title belongs to the resume's stated target-role family
* moderate - not strong, same career area as the resume
* weak     - different career area

These are weak metadata labels for diagnosis and calibration, not human
relevance judgements. Resumes are split deterministically: odd pages form the
development (calibration) split and even pages the held-out check split.

Usage (from the repository root):

    backend/.venv/bin/python -m backend.scripts.diagnose_match_distribution \
        --output /tmp/kareerly-diagnostics \
        [--baseline-model sentence-transformers/all-MiniLM-L6-v2] \
        [--must-have-mode all-required]

To inspect one candidate instead of the whole diagnostic set:

    backend/.venv/bin/python -m backend.scripts.diagnose_match_distribution \
        --inspect-resume path/to/resume.pdf [--job-id JOB-001] [--top 10]

``--baseline-model`` accepts a local path or a Hugging Face ID (needs network
access) and repeats the cosine analysis with the unchanged pretrained model.
``--must-have-mode all-required`` reproduces how Supabase and pasted jobs are
mapped (every required skill is also a must-have).
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import numpy as np
import pandas as pd

from backend.app.services import bi_encoder_service as encoder
from backend.app.services import matching_service as matching

BACKEND_DIR = Path(__file__).resolve().parents[1]
RESUME_DIR = BACKEND_DIR / "evaluation" / "sample_resumes"
LABELS_PATH = BACKEND_DIR / "evaluation" / "match_diagnostic_labels.csv"
GROUPS = ("strong", "moderate", "weak")


def load_resumes() -> pd.DataFrame:
    labels = pd.read_csv(LABELS_PATH)
    rows = []
    for record in labels.to_dict(orient="records"):
        path = RESUME_DIR / f"Kareerly_Mock_Resumes_PH.docx-pages-{record['resume_page']}.pdf"
        rows.append({**record, "resume_text": matching.extract_text_from_pdf(path.read_bytes())})
    frame = pd.DataFrame(rows)
    frame["split"] = np.where(frame["resume_page"] % 2 == 1, "dev", "check")
    return frame


def job_career_area(job_category: str) -> str:
    normalized = matching.normalize_for_match(job_category)
    for area, categories in matching.CAREER_AREA_JOB_CATEGORIES.items():
        if normalized in {matching.normalize_for_match(category) for category in categories}:
            return area
    return ""


def label_pair(resume: Dict[str, Any], job: Dict[str, Any]) -> str:
    title = matching.normalize_for_match(job.get("job_title", ""))
    if re.search(resume["strong_title_pattern"], title):
        return "strong"
    if job_career_area(job.get("job_category", "")) == resume["career_area"]:
        return "moderate"
    return "weak"


def job_model_inputs(jobs: pd.DataFrame) -> List[str]:
    return [
        encoder.build_model_input(
            matching.clean_text(row.get("job_description", "")),
            title=matching.clean_text(row.get("job_title", "")),
            skill_names=matching.split_skill_list(row.get("required_skills_for_eval", "")),
        )
        for row in jobs.to_dict(orient="records")
    ]


def sentence_transformer_scorer(model_name: str) -> Callable[[str, List[str]], np.ndarray]:
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(model_name, device="cpu")
    model.max_seq_length = 256
    cache: Dict[int, np.ndarray] = {}

    def score(candidate_input: str, job_inputs: List[str]) -> np.ndarray:
        key = hash(tuple(job_inputs))
        if key not in cache:
            cache[key] = model.encode(job_inputs, batch_size=16, normalize_embeddings=True, show_progress_bar=False)
        query = model.encode([candidate_input], normalize_embeddings=True, show_progress_bar=False)[0]
        return np.clip(cache[key] @ query, -1, 1)

    return score


def tfidf_scorer(job_inputs: List[str]) -> Callable[[str, List[str]], np.ndarray]:
    from sklearn.feature_extraction.text import TfidfVectorizer

    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True)
    matrix = vectorizer.fit_transform(job_inputs)

    def score(candidate_input: str, _job_inputs: List[str]) -> np.ndarray:
        return (matrix @ vectorizer.transform([candidate_input]).T).toarray().ravel()

    return score


def auc(positive: np.ndarray, negative: np.ndarray) -> Optional[float]:
    """Probability a random positive outscores a random negative (ties count half)."""
    if len(positive) == 0 or len(negative) == 0:
        return None
    greater = (positive[:, None] > negative[None, :]).mean()
    ties = (positive[:, None] == negative[None, :]).mean()
    return round(float(greater + 0.5 * ties), 4)


def describe(values: np.ndarray) -> Dict[str, float]:
    if len(values) == 0:
        return {"n": 0}
    q = np.quantile(values, [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0])
    return {
        "n": int(len(values)), "mean": round(float(values.mean()), 4),
        "min": round(float(q[0]), 4), "p10": round(float(q[1]), 4), "p25": round(float(q[2]), 4),
        "median": round(float(q[3]), 4), "p75": round(float(q[4]), 4), "p90": round(float(q[5]), 4),
        "max": round(float(q[6]), 4),
    }


def separation(frame: pd.DataFrame, column: str) -> Dict[str, Any]:
    groups = {name: frame.loc[frame["label"] == name, column].astype(float).to_numpy() for name in GROUPS}
    return {
        "distribution": {name: describe(values) for name, values in groups.items()},
        "auc_strong_vs_moderate": auc(groups["strong"], groups["moderate"]),
        "auc_strong_vs_weak": auc(groups["strong"], groups["weak"]),
        "auc_moderate_vs_weak": auc(groups["moderate"], groups["weak"]),
    }


def retrieval_metrics(frame: pd.DataFrame, column: str, k: int = 10) -> Dict[str, float]:
    """Precision/Recall/MRR use strong as relevant; NDCG uses graded gains (2/1/0)."""
    gains = {"strong": 2, "moderate": 1, "weak": 0}
    precision, recall, ndcg, mrr = [], [], [], []
    for _, group in frame.groupby("resume_page"):
        ranked = group.sort_values([column, "job_id"], ascending=[False, True])
        relevant_total = int((group["label"] == "strong").sum())
        if relevant_total == 0:
            continue
        top = ranked.head(k)["label"].tolist()
        hits = [label == "strong" for label in top]
        precision.append(sum(hits) / k)
        recall.append(sum(hits) / relevant_total)
        first = next((i for i, hit in enumerate(hits) if hit), None)
        mrr.append(0.0 if first is None else 1.0 / (first + 1))
        dcg = sum(gains[label] / np.log2(i + 2) for i, label in enumerate(top))
        ideal = sorted((gains[label] for label in group["label"]), reverse=True)[:k]
        idcg = sum(g / np.log2(i + 2) for i, g in enumerate(ideal))
        ndcg.append(dcg / idcg if idcg else 0.0)
    return {
        f"precision@{k}": round(float(np.mean(precision)), 4),
        f"recall@{k}": round(float(np.mean(recall)), 4),
        f"ndcg@{k}": round(float(np.mean(ndcg)), 4),
        f"mrr@{k}": round(float(np.mean(mrr)), 4),
        "queries": len(precision),
    }


def run(output: Path, baseline_model: Optional[str], must_have_mode: str) -> Dict[str, Any]:
    matching.clear_reference_jobs_cache()
    with _patched_supabase_off():
        jobs = matching.load_reference_jobs()
    if must_have_mode == "all-required":
        jobs["must_have_skill_ids"] = jobs["required_skill_ids"]
    resumes = load_resumes()
    job_inputs = job_model_inputs(jobs)
    available_learning = matching.reviewed_learning_skill_ids()

    scorers: Dict[str, Callable[[str, List[str]], np.ndarray]] = {
        "tfidf": tfidf_scorer(job_inputs),
    }
    if baseline_model:
        scorers["pretrained"] = sentence_transformer_scorer(baseline_model)

    rows: List[Dict[str, Any]] = []
    for resume in resumes.to_dict(orient="records"):
        text, _records, skill_names, candidate_keys = matching._prepare_candidate_context(resume["resume_text"], None)
        candidate_input = encoder.build_model_input(text, skill_names=skill_names)
        scored = matching.bi_encoder_score_jobs(candidate_input, jobs)
        other_scores = {name: scorer(candidate_input, job_inputs) for name, scorer in scorers.items()}
        for index, job in enumerate(scored.to_dict(orient="records")):
            result = matching._score_single_normalized_job(
                resume_text=text, job=job, candidate_keys=candidate_keys,
                preferences={}, available_learning_skills=available_learning,
            )
            breakdown = result.get("match_breakdown", {})
            rows.append({
                "resume_page": resume["resume_page"], "split": resume["split"],
                "target_role": resume["target_role"], "candidate_skill_count": len(skill_names),
                "job_id": job["job_id"], "job_title": job["job_title"], "job_category": job["job_category"],
                "label": label_pair(resume, job),
                "model": encoder.MODEL_ID,
                "cosine_finetuned": float(job["semantic_score_raw"]),
                **{f"cosine_{name}": float(values[index]) for name, values in other_scores.items()},
                "required_skill_count": len(matching.split_ids(job.get("required_skill_ids", ""))),
                "matched_required": len(result["matched_skills"]),
                "missing_required": len(result["missing_skills"]),
                "required_coverage": result["skill_coverage"],
                "preferred_coverage": breakdown.get("preferred_skill_coverage", np.nan),
                "critical_missing": len(result.get("critical_missing_skill_ids", [])),
                "penalty": breakdown.get("penalty", 0.0),
                "raw_weighted_score": breakdown.get("raw_weighted_score", np.nan),
                "final_score": result["final_score"],
                "match_type": result["match_type"],
                "failed_fit_now_rules": "; ".join(breakdown.get("failed_fit_now_rules", [])),
                "matched_skills": "; ".join(result["matched_skills"]),
                "missing_skills": "; ".join(result["missing_skills"]),
            })

    frame = pd.DataFrame(rows)
    output.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output / "pair_breakdown.csv", index=False)

    score_columns = [c for c in frame.columns if c.startswith("cosine_")] + ["required_coverage", "final_score"]
    summary: Dict[str, Any] = {
        "model_version": encoder.MODEL_ID,
        "must_have_mode": must_have_mode,
        "jobs": int(len(jobs)), "resumes": int(len(resumes)), "pairs": int(len(frame)),
        "label_counts": frame["label"].value_counts().to_dict(),
        "separation": {column: separation(frame, column) for column in score_columns},
        "retrieval_all_resumes": {column: retrieval_metrics(frame, column) for column in score_columns},
        "category_by_label": {
            label: frame.loc[frame["label"] == label, "match_type"].value_counts().to_dict()
            for label in GROUPS
        },
        "fit_now_per_resume": frame[frame["match_type"] == "Fit-Now"].groupby("resume_page").size().reindex(
            resumes["resume_page"], fill_value=0).describe().round(3).to_dict(),
        "gate_failures_for_strong_pairs": gate_failures(frame[frame["label"] == "strong"]),
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary


def gate_failures(frame: pd.DataFrame) -> Dict[str, int]:
    """Which Fit-Now rule blocked each strong pair (a pair can fail several)."""
    rules = frame["failed_fit_now_rules"].fillna("").str.split("; ")
    counts = {"pairs": int(len(frame)), "no_candidate_skill_matched": int((frame["matched_required"] == 0).sum())}
    for rule in sorted({name for names in rules for name in names if name}):
        counts[rule] = int(rules.apply(lambda names: rule in names).sum())
    return counts


class _patched_supabase_off:
    """Diagnostics use the versioned CSV catalogue, never live Supabase rows."""

    def __enter__(self):
        self._original = matching.load_internal_jobs_dataframe
        matching.load_internal_jobs_dataframe = lambda *args, **kwargs: pd.DataFrame()

    def __exit__(self, *exc):
        matching.load_internal_jobs_dataframe = self._original


def inspect(resume_path: Path, job_id: str = "", top: int = 10) -> List[Dict[str, Any]]:
    """Candidate -> job breakdown for one resume, highest composite score first."""
    data = resume_path.read_bytes()
    text = data.decode("utf-8") if resume_path.suffix.lower() == ".txt" else matching.extract_resume_text(data, resume_path.name)
    matching.clear_reference_jobs_cache()
    with _patched_supabase_off():
        jobs = matching.load_reference_jobs()
    if job_id:
        jobs = jobs[jobs["job_id"].astype(str) == job_id].reset_index(drop=True)
    text, _records, skill_names, candidate_keys = matching._prepare_candidate_context(text, None)
    scored = matching.bi_encoder_score_jobs(encoder.build_model_input(text, skill_names=skill_names), jobs)
    available_learning = matching.reviewed_learning_skill_ids()
    rows = []
    for job in scored.to_dict(orient="records"):
        result = matching._score_single_normalized_job(
            resume_text=text, job=job, candidate_keys=candidate_keys,
            preferences={}, available_learning_skills=available_learning,
        )
        rows.append({
            "candidate": resume_path.name, "candidate_skills": skill_names,
            "job_id": result["job_id"], "job_title": result["job_title"], "model": encoder.MODEL_ID,
            "matched_skills": result["matched_skills"], "missing_skills": result["missing_skills"],
            "matched_preferred_skills": result["matched_preferred_skills"],
            "critical_missing_skill_ids": result["critical_missing_skill_ids"],
            "match_reason": result["match_reason"], **result["match_breakdown"],
        })
    rows.sort(key=lambda row: (-row["match_score"], str(row["job_id"])))
    return rows[:top]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--baseline-model", default="", help="Pretrained model path or ID for comparison")
    parser.add_argument("--must-have-mode", choices=["csv", "all-required"], default="csv")
    parser.add_argument("--inspect-resume", type=Path, help="Print the breakdown for one PDF, DOCX or TXT resume")
    parser.add_argument("--job-id", default="")
    parser.add_argument("--top", type=int, default=10)
    args = parser.parse_args()
    if args.inspect_resume:
        print(json.dumps(inspect(args.inspect_resume, args.job_id, args.top), indent=2))
        return
    if not args.output:
        parser.error("--output is required unless --inspect-resume is used")
    summary = run(args.output, args.baseline_model or None, args.must_have_mode)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
