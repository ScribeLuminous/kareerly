"""Run every synthetic resume through Kareerly's matcher, read-only.

Calls backend/app/services/matching_service.run_matching directly with the PDF
bytes and a neutral filename, exactly as the /api/matches/from-resume endpoint
does for a guest (no Supabase sync). Each resume runs twice: with no location
filter and with the matcher's own region filter set to the candidate's region.
The model, thresholds, gates and job catalog are used as they are.

Run with the backend's environment and no Supabase settings, so the matcher
uses backend/data/reference_jobs.csv and writes nothing anywhere:
    backend/.venv/bin/python test-data/synthetic-resumes-180/scripts/run_matching_smoke_test.py

Writes matching_smoke_test.csv (360 rows).
"""
from __future__ import annotations

import csv
import json
import os
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET_DIR = HERE.parent
REPO_ROOT = DATASET_DIR.parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

for key in ("SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
    if os.environ.get(key):
        raise SystemExit(f"{key} is set: unset it so the smoke test cannot reach a database")

from app.services import matching_service as ms  # noqa: E402
from app.services.ph_regions import RegionPreference  # noqa: E402

FIELDS = [
    "candidate_id", "dataset_group", "profile_variant", "target_category_id", "target_category", "primary_category",
    "secondary_categories", "region", "location_filter", "jobs_considered", "jobs_available_in_region",
    "fit_now_count", "aspiration_count", "low_match_count", "recommended_after_filter",
    "top_match_title", "top_match_category_id", "top_match_type", "top_match_score", "top_match_semantic",
    "top_match_skill_coverage", "top_match_missing_skills", "top_match_in_target_category",
    "target_category_in_top_5", "top_5_titles", "top_5_categories", "top_5_types",
    "fit_now_categories", "aspiration_categories", "extracted_skill_count", "fit_now_blockers",
]


def ranked(result: dict) -> list[dict]:
    # Fit-Now first, then Aspiration, each in the matcher's own order.
    return list(result.get("all_fit_now_matches", [])) + list(result.get("all_aspiration_matches", []))


def main() -> None:
    manifest = json.loads((DATASET_DIR / "manifest.json").read_text(encoding="utf-8"))
    jobs = ms.load_reference_jobs().to_dict(orient="records")
    source = ms.get_jobs_source()
    if source != "reference_jobs.csv":
        raise SystemExit(f"unexpected job source {source}: this smoke test must use the local CSV catalog")
    rows = []
    for m in manifest:
        cid = m["candidate_id"]
        data = (DATASET_DIR / m["resume_filename"]).read_bytes()
        region = RegionPreference("region", m["region_code"])
        available = sum(ms.job_region_status(j, region, {}) in {ms.REGION_IN_REGION, ms.REGION_REMOTE} for j in jobs)
        for label, prefs in (("none", {}), ("region", {"location_scope": "region", "region": m["region_code"]})):
            result = ms.run_matching(resume_text="", file_bytes=data, filename="resume.pdf", preferences=prefs,
                                     confirmed_skills=None, removed_skill_ids=None)
            debug = result.get("debug_summary", {})
            items = ranked(result)
            top = items[0] if items else {}
            top5 = items[:5]
            target = m["target_skill_category_id"]
            rows.append({
                "candidate_id": cid,
                "dataset_group": m["dataset_group"],
                "profile_variant": m["profile_variant"],
                "target_category_id": target,
                "target_category": m["target_skill_category"],
                "primary_category": m["primary_category"] or "",
                "secondary_categories": "|".join(m["secondary_categories"] or []),
                "region": m["region_code"],
                "location_filter": label,
                "jobs_considered": debug.get("total_jobs_scored", ""),
                "jobs_available_in_region": available if label == "region" else "",
                "fit_now_count": len(result.get("all_fit_now_matches", [])),
                "aspiration_count": len(result.get("all_aspiration_matches", [])),
                "low_match_count": debug.get("low_match_count", ""),
                "recommended_after_filter": len(items),
                "top_match_title": top.get("job_title", ""),
                "top_match_category_id": top.get("category_id", ""),
                "top_match_type": top.get("match_type", ""),
                "top_match_score": top.get("match_score", ""),
                "top_match_semantic": top.get("semantic_score", ""),
                "top_match_skill_coverage": top.get("skill_coverage", ""),
                "top_match_missing_skills": "|".join(str(s) for s in top.get("missing_skills", []) or []),
                "top_match_in_target_category": bool(top) and top.get("category_id") == target,
                "target_category_in_top_5": any(i.get("category_id") == target for i in top5),
                "top_5_titles": "|".join(i.get("job_title", "") for i in top5),
                "top_5_categories": "|".join(i.get("category_id", "") for i in top5),
                "top_5_types": "|".join(i.get("match_type", "") for i in top5),
                "fit_now_categories": "|".join(f"{k}:{v}" for k, v in sorted(Counter(i.get("category_id") for i in result.get("all_fit_now_matches", [])).items())),
                "aspiration_categories": "|".join(f"{k}:{v}" for k, v in sorted(Counter(i.get("category_id") for i in result.get("all_aspiration_matches", [])).items())),
                "extracted_skill_count": debug.get("extracted_skill_count", ""),
                "fit_now_blockers": json.dumps(debug.get("fit_now_blockers", {}), sort_keys=True),
            })
        print(f"{cid}: none={rows[-2]['fit_now_count']}/{rows[-2]['aspiration_count']} "
              f"region={rows[-1]['fit_now_count']}/{rows[-1]['aspiration_count']} top={rows[-2]['top_match_title']}", flush=True)
    with open(DATASET_DIR / "matching_smoke_test.csv", "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote matching_smoke_test.csv ({len(rows)} rows)")


if __name__ == "__main__":
    main()
