"""Parse every synthetic resume with Kareerly's own resume analyser.

Calls backend/app/services/resume_analyzer.analyze_resume_bytes directly with
the PDF bytes and a neutral filename ("resume.pdf"), so neither the real file
name, the folder nor any manifest field reaches the parser. Nothing is written
to Supabase or any other database. The manifest is read only afterwards, to
score what the parser found.

Run with the backend's environment (it needs the backend requirements):
    backend/.venv/bin/python test-data/synthetic-resumes-180/scripts/run_parsing_smoke_test.py

Writes parsing_results.csv.
"""
from __future__ import annotations

import csv
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET_DIR = HERE.parent
REPO_ROOT = DATASET_DIR.parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

for key in ("SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
    if os.environ.get(key):
        raise SystemExit(f"{key} is set: unset it so the smoke test cannot reach a database")

from app.services import matching_service as ms  # noqa: E402
from app.services.ph_regions import resolve_single_region  # noqa: E402
from app.services.resume_analyzer import analyze_resume_bytes  # noqa: E402

FIELDS = [
    "candidate_id", "resume_filename", "dataset_group", "profile_variant", "text_extracted", "raw_text_length",
    "name_detected", "sections_detected", "skills_extracted_count", "held_skills_expected", "held_skills_found",
    "held_skill_recall", "held_skills_not_found", "missing_skills_extracted", "extra_skills_extracted",
    "education_detected", "experience_detected", "certifications_present", "certifications_detected",
    "location_detected", "normalization_success", "failure_class", "warnings",
]


def main() -> None:
    manifest = {m["candidate_id"]: m for m in json.loads((DATASET_DIR / "manifest.json").read_text(encoding="utf-8"))}
    matrix = {m["candidate_id"]: m for m in json.loads((DATASET_DIR / "generation_matrix.json").read_text(encoding="utf-8"))["candidates"]}
    labels = ms.get_skill_labels_by_id()
    extractor = ms.current_skill_extractor()
    rows = []
    for cid in sorted(manifest):
        m, r = manifest[cid], matrix[cid]
        content = json.loads((DATASET_DIR / "content" / f"{cid}.json").read_text(encoding="utf-8"))
        data = (DATASET_DIR / m["resume_filename"]).read_bytes()
        warnings = []
        try:
            result = analyze_resume_bytes(file_bytes=data, filename="resume.pdf", skill_extractor=extractor)
        except Exception as exc:  # recorded, never hidden
            rows.append({"candidate_id": cid, "resume_filename": m["resume_filename"], "dataset_group": m["dataset_group"],
                         "profile_variant": m["profile_variant"], "text_extracted": False,
                         "failure_class": "parser_error", "warnings": f"{type(exc).__name__}: {exc}"})
            continue
        profile = result.get("candidate_profile", {})
        found = [s.get("skill_id") for s in profile.get("skills", []) if s.get("skill_id")]
        held = r["core_skill_ids"] + r["supporting_skill_ids"] + r["adjacent_skill_ids"]
        missing = r["intentionally_missing_skill_ids"]
        held_found = [s for s in held if s in found]
        not_found = [s for s in held if s not in found]
        missing_found = [s for s in missing if s in found]
        extra = [s for s in found if s not in held and s not in missing]
        sections = result.get("sections_detected", {})
        warnings += [str(w) for w in result.get("warnings", []) + result.get("extraction_warnings", [])]
        text_ok = result.get("raw_text_length", 0) > 300
        recall = len(held_found) / len(held) if held else 0.0
        region = resolve_single_region(content["location"])
        if not text_ok:
            failure = "parser_or_extraction"
        elif not sections.get("experience") or not sections.get("education"):
            failure = "resume_structure_or_section_detection"
        elif recall < 0.5:
            failure = "normalization_low_recall"
        else:
            failure = ""
        rows.append({
            "candidate_id": cid,
            "resume_filename": m["resume_filename"],
            "dataset_group": m["dataset_group"],
            "profile_variant": m["profile_variant"],
            "text_extracted": text_ok,
            "raw_text_length": result.get("raw_text_length", 0),
            "name_detected": profile.get("full_name", "") == content["full_name"],
            "sections_detected": "|".join(k for k, v in sorted(sections.items()) if v),
            "skills_extracted_count": len(found),
            "held_skills_expected": len(held),
            "held_skills_found": len(held_found),
            "held_skill_recall": round(recall, 3),
            "held_skills_not_found": "|".join(f"{s}:{labels.get(s, s)}" for s in not_found),
            "missing_skills_extracted": "|".join(f"{s}:{labels.get(s, s)}" for s in missing_found),
            "extra_skills_extracted": "|".join(f"{s}:{labels.get(s, s)}" for s in extra),
            "education_detected": bool(profile.get("education") or profile.get("education_indicators")),
            "experience_detected": bool(sections.get("experience") or profile.get("experience_indicators")),
            "certifications_present": bool(content.get("certifications")),
            "certifications_detected": bool(profile.get("certifications") or profile.get("certification_indicators")),
            # The parser has no location field; this is what ph_regions makes of the header location.
            "location_detected": f"header resolves to {region}" if region == m["region_code"] else f"header resolves to {region or 'none'} (expected {m['region_code']})",
            "normalization_success": all(s in labels for s in found),
            "failure_class": failure,
            "warnings": " | ".join(warnings),
        })
        print(f"{cid}: {len(found)} skills, recall {recall:.2f}, missing-extracted {len(missing_found)}", flush=True)
    with open(DATASET_DIR / "parsing_results.csv", "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in FIELDS})
    print(f"wrote parsing_results.csv ({len(rows)} rows)")


if __name__ == "__main__":
    main()
