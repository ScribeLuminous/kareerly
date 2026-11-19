"""Score profile fields on the 180 synthetic resumes in test-data/synthetic-resumes-180.

Their content files (content/<id>.json) hold the text each PDF was rendered
from, so they give exact expected names, contact details, jobs and education
for 10 layouts. This is a regression and generalisation check for the
extractor, not research data (see that folder's README).

    python3 test-data/resume-extraction/scripts/score_synthetic_fields.py --label after
    python3 test-data/resume-extraction/scripts/score_synthetic_fields.py --code-root /tmp/kareerly-before --label baseline

Writes reports/synthetic_<label>.json (counts only).
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import warnings
from collections import Counter
from pathlib import Path

warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from run_extraction_eval import date_matches, similar  # noqa: E402
from validate_ground_truth import DATASET, ROOT, squash  # noqa: E402

SYNTHETIC = ROOT / "test-data" / "synthetic-resumes-180"


def norm_date(value: str) -> str:
    return "present" if (value or "").lower() == "present" else (value or "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--code-root", type=Path, default=ROOT)
    parser.add_argument("--label", default="after")
    args = parser.parse_args()
    sys.path.insert(0, str(args.code_root.resolve()))
    for module in [m for m in sys.modules if m == "backend" or m.startswith("backend.")]:
        del sys.modules[module]
    from backend.app.services.resume_analyzer import analyze_resume_bytes
    from backend.app.services.skill_extractor import SkillExtractor

    extractor = SkillExtractor()
    manifest = json.loads((SYNTHETIC / "manifest.json").read_text(encoding="utf-8"))
    counts, by_layout = Counter(), {}
    for row in manifest:
        truth = json.loads((SYNTHETIC / "content" / f"{row['candidate_id']}.json").read_text(encoding="utf-8"))
        analysis = analyze_resume_bytes((SYNTHETIC / row["resume_filename"]).read_bytes(), "resume.pdf", extractor)
        profile = analysis["candidate_profile"]
        layout = row["resume_template_variant"]
        layout_counts = by_layout.setdefault(layout, Counter())

        def score(key: str, ok: bool, total: int = 1) -> None:
            counts[f"{key}_total"] += total
            counts[f"{key}_ok"] += int(ok)
            layout_counts[f"{key}_total"] += total
            layout_counts[f"{key}_ok"] += int(ok)

        score("name", squash(profile.get("full_name", "")) == squash(truth["full_name"]))
        score("email", (profile.get("email") or "").lower() == truth["email"].lower())
        score("phone", re.sub(r"\D", "", profile.get("phone") or "") == re.sub(r"\D", "", truth["phone"]))
        location = squash(profile.get("location") or "")
        score("location", bool(location) and (location in squash(truth["location"]) or squash(truth["location"]) in location))
        score("headline", bool(truth.get("headline")) and similar(profile.get("headline") or "", truth["headline"]))
        jobs = profile.get("work_experience") or []
        used = set()
        for job in truth["experience"]:
            j = next((j for j, x in enumerate(jobs) if j not in used and (similar(x.get("company", ""), job["employer"]) or similar(x.get("job_title", ""), job["title"]))), None)
            score("job_found", j is not None)
            if j is None:
                for key in ("job_title", "job_company", "job_start", "job_end"):
                    score(key, False)
                continue
            used.add(j)
            x = jobs[j]
            score("job_title", similar(x.get("job_title", ""), job["title"]))
            score("job_company", similar(x.get("company", ""), job["employer"]))
            score("job_start", date_matches(x.get("start_date", ""), norm_date(job["start"])))
            score("job_end", date_matches(x.get("end_date", ""), norm_date(job["end"])))
        counts["job_false"] += len(jobs) - len(used)
        education = profile.get("education") or []
        used = set()
        for entry in truth["education"]:
            j = next((j for j, x in enumerate(education) if j not in used and (
                similar(x.get("school_university", ""), entry["school"]) or similar(x.get("degree_program", ""), entry["credential"]))), None)
            score("edu_found", j is not None)
            if j is not None:
                used.add(j)
                end = (entry.get("end") or "")[:4]
                score("edu_year", (education[j].get("year_graduated") or "") == (end if end.isdigit() else ""))
                score("edu_school", similar(education[j].get("school_university", ""), entry["school"]))
            else:
                score("edu_year", False)
                score("edu_school", False)
    out = {"label": args.label, "resumes": len(manifest), "counts": dict(counts), "by_layout": {k: dict(v) for k, v in by_layout.items()}}
    path = DATASET / "reports" / f"synthetic_{args.label}.json"
    path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    keys = sorted({k[:-6] for k in counts if k.endswith("_total")})
    for key in keys:
        total, ok = counts[f"{key}_total"], counts[f"{key}_ok"]
        print(f"{key:12} {ok}/{total} ({100 * ok / total:.0f}%)" if total else key)
    print("job_false", counts["job_false"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
