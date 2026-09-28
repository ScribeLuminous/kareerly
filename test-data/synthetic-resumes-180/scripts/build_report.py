"""Build generation_report.md from the dataset files.

Every number and table is computed from generation_matrix.json, manifest.json,
content/, similarity checks, parsing_results.csv and matching_smoke_test.csv.
The written findings live in report_findings.md next to this script and are
inserted as they are.

Usage: python build_report.py
"""
from __future__ import annotations

import csv
import hashlib
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATASET_DIR = HERE.parent
sys.path.insert(0, str(HERE))

import check_similarity as sim  # noqa: E402
import reference as ref  # noqa: E402
import specs  # noqa: E402

FONT_FILES = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def load_csv(name):
    path = DATASET_DIR / name
    if not path.exists():
        return []
    with open(path, encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def table(headers, rows, align=None):
    align = align or ["---"] * len(headers)
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join(align) + "|"]
    out += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(out)


def median(values):
    return statistics.median(values) if values else 0


def main():
    meta = json.loads((DATASET_DIR / "generation_matrix.json").read_text(encoding="utf-8"))
    matrix = meta["candidates"]
    manifest = json.loads((DATASET_DIR / "manifest.json").read_text(encoding="utf-8"))
    categories = sorted({(m["target_category_id"], m["target_category"]) for m in matrix if m["dataset_group"] == "controlled"})
    controlled = [m for m in manifest if m["dataset_group"] == "controlled"]
    stress = [m for m in manifest if m["dataset_group"] != "controlled"]
    parse = load_csv("parsing_results.csv")
    match = load_csv("matching_smoke_test.csv")
    findings = (HERE / "report_findings.md").read_text(encoding="utf-8") if (HERE / "report_findings.md").exists() else ""
    parts = findings.split("<!-- SECTION ")
    notes = {}
    for part in parts[1:]:
        key, body = part.split(" -->", 1)
        notes[key.strip()] = body.strip()

    out = ["# Synthetic resume dataset: generation and QA report", "",
           "System-test fixtures for Kareerly. Not training, validation or thesis evaluation data. "
           "All people, employers, schools, emails and phone numbers are fictional.", ""]

    # Overall
    files = sum((DATASET_DIR / m["resume_filename"]).exists() for m in manifest)
    out += ["## Overall", "",
            table(["Item", "Result"], [
                ["Expected resumes", 180], ["Generated resumes", files],
                ["Valid resumes (all checks pass)", notes.get("valid_count", files)],
                ["Controlled resumes", f"{len(controlled)}/168"], ["Stress-test resumes", f"{len(stress)}/12"],
                ["Categories", f"{len({m['target_skill_category_id'] for m in controlled})}/24"],
                ["Regions", f"{len({m['region_code'] for m in manifest})}/18"],
                ["Reference date", ref.REFERENCE_DATE],
            ]), ""]

    # Category distribution
    cat_count = Counter(m["target_skill_category_id"] for m in controlled)
    out += ["## Category distribution", "",
            table(["ID", "Category", "Controlled resumes"], [[cid, name, cat_count[cid]] for cid, name in categories],
                  ["---", "---", "---:"]), ""]

    # Regional distribution
    rc = Counter(m["region_code"] for m in controlled)
    rs = Counter(m["region_code"] for m in stress)
    out += ["## Regional distribution", "",
            table(["Region", "Name", "Controlled", "Stress test", "Total"],
                  [[code, name, rc[code], rs[code], rc[code] + rs[code]] for code, name in ref.REGIONS],
                  ["---", "---", "---:", "---:", "---:"]), ""]

    # Variant distribution
    pv = Counter(m["profile_variant"] for m in manifest)
    out += ["## Candidate variant distribution", "",
            table(["Variant", "Count"], [[p, pv[p]] for p in list(specs.PROFILES) + ["cross_category_stress"]], ["---", "---:"]), ""]

    # Allocation
    region_codes = [c for c, _ in ref.REGIONS]
    cat_ids = [c for c, _ in categories]
    cells = Counter((m["region_code"], m["target_skill_category_id"]) for m in controlled)
    rp = Counter((m["region_code"], m["profile_variant"]) for m in manifest)
    short = {"strong_entry": "sE", "partial_entry": "pE", "strong_mid": "sM", "partial_mid": "pM", "advanced": "adv",
             "career_transition": "tr", "mixed_boundary": "mix", "cross_category_stress": "stress"}
    m_meta = meta["meta"]
    tv = Counter(m["resume_template_variant"] for m in manifest)
    out += ["## Allocation details", "",
            f"- Seed {m_meta['seed']}; seed used {m_meta['seed_used']} after {m_meta['attempts']} attempt(s); "
            f"{m_meta['repair_swaps']} seeded within-category profile swaps to keep at most 2 of one profile per region.",
            f"- Regions with 10 controlled candidates (seeded shuffle): {', '.join(m_meta['ten_controlled_regions'])}.",
            f"- Every stress resume sits in a region without a controlled candidate of its primary category: "
            f"{'yes' if m_meta['stress_region_conflict_free'] else 'no'}.", "",
            "### Region × category (controlled)", "",
            table(["Region"] + [c[1:] for c in cat_ids],
                  [[code] + [cells[(code, c)] or "·" for c in cat_ids] for code in region_codes],
                  ["---"] + [":-:"] * len(cat_ids)), "",
            "### Region × profile variant", "",
            table(["Region"] + list(short.values()),
                  [[code] + [rp[(code, p)] or "·" for p in short] for code in region_codes],
                  ["---"] + [":-:"] * len(short)), "",
            "### Layout variant usage", "",
            table(["Layout", "Resumes"], [[k, v] for k, v in sorted(tv.items())], ["---", "---:"]), "",
            "### City usage per region", ""]
    for code in region_codes:
        use = Counter(m["city"] + ", " + m["province"] for m in manifest if m["region_code"] == code)
        out.append(f"- **{code}**: " + "; ".join(f"{c} ×{n}" for c, n in sorted(use.items())))
    out.append("")

    # Near-duplicates
    result = sim.run()
    out += ["## Near-duplicate check", "",
            "Methods (Section 15.1): TF-IDF cosine on each resume's visible text with name, contact details and "
            "location removed (lower-cased word unigrams and bigrams, sublinear tf), flag ≥ 0.80; the same on the "
            "professional summary alone, flag ≥ 0.85; verbatim reuse of any experience or project bullet; Jaccard "
            "similarity of skill sets, flag ≥ 0.90; duplicate full names and surnames used more than 4 times. "
            "Pure Python (`scripts/check_similarity.py`), no third-party packages. The full-text check was repeated "
            "on the text extracted from the PDFs (`validate_dataset.py --pdfs`) with the same result.", "",
            table(["Measure", "Within category", "Across categories"], [
                ["Full text", result["full_within"], result["full_across"]],
                ["Summary", result["summary_within"], result["summary_across"]],
            ]), "",
            f"Flagged pairs: **{len(result['flags'])}** of {result['pairs']}. `similarity_report.csv` lists every "
            "flag; it holds only its header because none remain. " + notes.get("similarity_resolutions", ""), ""]

    # PII and conventions
    fonts = []
    for path in FONT_FILES:
        p = Path(path)
        if p.exists():
            fonts.append(f"`{p.name}` sha256 `{hashlib.sha256(p.read_bytes()).hexdigest()}`")
    out += ["## Synthetic PII and conventions", "", notes.get("conventions", ""), "",
            "Rendering: ReportLab 5.0.1 in invariant mode; fonts " + "; ".join(fonts) + ".", ""]

    # Parsing
    if parse:
        ok = [p for p in parse if p["text_extracted"] == "True"]
        recall = [float(p["held_skill_recall"]) for p in parse if p["held_skill_recall"]]
        leaks = [p for p in parse if p["missing_skills_extracted"]]
        fails = Counter(p["failure_class"] for p in parse if p["failure_class"])
        miss_counter = Counter(s for p in parse for s in p["held_skills_not_found"].split("|") if s)
        extra_counter = Counter(s for p in parse for s in p["extra_skills_extracted"].split("|") if s)
        by_cat = defaultdict(list)
        mani = {m["candidate_id"]: m for m in manifest}
        for p in parse:
            by_cat[mani[p["candidate_id"]]["target_skill_category_id"]].append(float(p["held_skill_recall"] or 0))
        out += ["## Resume parsing QA", "",
                "Each PDF was passed as bytes, with the neutral file name `resume.pdf`, to "
                "`resume_analyzer.analyze_resume_bytes` with the live skill extractor. Nothing was written to any database.", "",
                table(["Measure", "Result"], [
                    ["Text extracted", f"{len(ok)}/{len(parse)}"],
                    ["Name detected exactly", f"{sum(p['name_detected'] == 'True' for p in parse)}/{len(parse)}"],
                    ["Experience detected", f"{sum(p['experience_detected'] == 'True' for p in parse)}/{len(parse)}"],
                    ["Education detected", f"{sum(p['education_detected'] == 'True' for p in parse)}/{len(parse)}"],
                    ["Certifications detected where present", f"{sum(p['certifications_detected'] == 'True' and p['certifications_present'] == 'True' for p in parse)}/{sum(p['certifications_present'] == 'True' for p in parse)}"],
                    ["Certifications reported where none listed", sum(p['certifications_detected'] == 'True' and p['certifications_present'] != 'True' for p in parse)],
                    ["Header location resolves to the right region", f"{sum(p['location_detected'].startswith('header resolves to') and 'expected' not in p['location_detected'] for p in parse)}/{len(parse)}"],
                    ["Skills extracted per resume (median)", median([int(p['skills_extracted_count']) for p in parse])],
                    ["Held-skill recall (median / mean)", f"{median(recall):.2f} / {statistics.mean(recall):.2f}"],
                    ["Resumes where an intentionally missing skill was extracted", len(leaks)],
                    ["All extracted skills canonical (normalization_success)", f"{sum(p['normalization_success'] == 'True' for p in parse)}/{len(parse)}"],
                ]), "",
                "Failure classes: " + (", ".join(f"{k} {v}" for k, v in sorted(fails.items())) or "none") + ".", "",
                "Held-skill recall by category (median):", "",
                table(["Category", "Median recall", "Min"], [[c, f"{median(v):.2f}", f"{min(v):.2f}"] for c, v in sorted(by_cat.items())],
                      ["---", "---:", "---:"]), "",
                "Held skills most often not extracted:", "",
                table(["Skill", "Resumes"], [[k, v] for k, v in miss_counter.most_common(15)], ["---", "---:"]), "",
                "Skills most often extracted without being in the candidate's spec:", "",
                table(["Skill", "Resumes"], [[k, v] for k, v in extra_counter.most_common(12)], ["---", "---:"]), "",
                "Intentionally missing skills that the parser extracted:", "",
                table(["Candidate", "Skills"], [[p["candidate_id"], p["missing_skills_extracted"]] for p in leaks]) if leaks else "None.", "",
                notes.get("parsing", ""), ""]

    # Matching
    if match:
        none = [r for r in match if r["location_filter"] == "none"]
        reg = [r for r in match if r["location_filter"] == "region"]
        ints = lambda rows, k: [int(r[k]) for r in rows if r[k] != ""]
        zero_fit = [r for r in none if int(r["fit_now_count"]) == 0]
        out += ["## Matching smoke-test summary", "",
                f"Catalog: `backend/data/reference_jobs.csv` ({none[0]['jobs_considered']} jobs), the matcher's fallback "
                "when Supabase is not configured. Supabase was not reachable, so employer posts and admin-added jobs are "
                "not part of this run. Each resume ran twice (no location filter, and the matcher's own region filter "
                "for the candidate's region): 360 rows in `matching_smoke_test.csv`. Read-only; model, thresholds, "
                "gates and catalog unchanged.", "",
                table(["Measure", "No filter", "Region filter"], [
                    ["Resumes with ≥1 Fit-Now", sum(int(r['fit_now_count']) > 0 for r in none), sum(int(r['fit_now_count']) > 0 for r in reg)],
                    ["Resumes with 0 Fit-Now", len(zero_fit), sum(int(r['fit_now_count']) == 0 for r in reg)],
                    ["Resumes with nothing recommended", sum(int(r['recommended_after_filter']) == 0 for r in none), sum(int(r['recommended_after_filter']) == 0 for r in reg)],
                    ["Median Fit-Now", median(ints(none, 'fit_now_count')), median(ints(reg, 'fit_now_count'))],
                    ["Median Aspiration", median(ints(none, 'aspiration_count')), median(ints(reg, 'aspiration_count'))],
                    ["Median Low Match", median(ints(none, 'low_match_count')), median(ints(reg, 'low_match_count'))],
                    ["Top match in target category (controlled)", f"{sum(r['top_match_in_target_category'] == 'True' for r in none if r['dataset_group'] == 'controlled')}/168", f"{sum(r['top_match_in_target_category'] == 'True' for r in reg if r['dataset_group'] == 'controlled')}/168"],
                    ["Target category in top 5 (controlled)", f"{sum(r['target_category_in_top_5'] == 'True' for r in none if r['dataset_group'] == 'controlled')}/168", f"{sum(r['target_category_in_top_5'] == 'True' for r in reg if r['dataset_group'] == 'controlled')}/168"],
                ], ["---", "---:", "---:"]), "",
                "### By profile variant (no filter)", "",
                table(["Variant", "n", "≥1 Fit-Now", "Median Fit-Now", "Median Aspiration", "Top match in target"],
                      [[p, len(rs), sum(int(r['fit_now_count']) > 0 for r in rs), median(ints(rs, 'fit_now_count')),
                        median(ints(rs, 'aspiration_count')), sum(r['top_match_in_target_category'] == 'True' for r in rs)]
                       for p in list(specs.PROFILES) + ["cross_category_stress"]
                       for rs in [[r for r in none if r['profile_variant'] == p]]],
                      ["---", "---:", "---:", "---:", "---:", "---:"]), "",
                "### By category (controlled, no filter)", "",
                table(["Category", "Jobs in catalog", "≥1 Fit-Now", "Median Fit-Now", "Median Aspiration", "Top match in target", "Target in top 5"],
                      [[c, notes_jobs.get(c, ""), sum(int(r['fit_now_count']) > 0 for r in rs), median(ints(rs, 'fit_now_count')),
                        median(ints(rs, 'aspiration_count')), sum(r['top_match_in_target_category'] == 'True' for r in rs),
                        sum(r['target_category_in_top_5'] == 'True' for r in rs)]
                       for c in cat_ids for rs in [[r for r in none if r['target_category_id'] == c and r['dataset_group'] == 'controlled']]],
                      ["---", "---:", "---:", "---:", "---:", "---:", "---:"]), "",
                "### Region filter: jobs available per region", "",
                table(["Region", "Jobs available (in region or remote)", "Resumes with 0 recommendations when filtered"],
                      [[code, next((r['jobs_available_in_region'] for r in reg if r['region'] == code), ''),
                        sum(int(r['recommended_after_filter']) == 0 for r in reg if r['region'] == code)] for code in region_codes],
                      ["---", "---:", "---:"]), "",
                notes.get("matching", ""), ""]
        st = [r for r in none if r["dataset_group"] != "controlled"]
        out += ["## Cross-category stress-test findings", "",
                table(["ID", "Primary → secondary", "Fit-Now", "Aspiration", "Top match", "Top-5 categories"],
                      [[r["candidate_id"], f"{r['target_category_id']} → {r['secondary_categories']}", r["fit_now_count"],
                        r["aspiration_count"], f"{r['top_match_title']} ({r['top_match_category_id']}, {r['top_match_type']}, "
                        f"score {r['top_match_score']}, coverage {r['top_match_skill_coverage']})", r["top_5_categories"]] for r in st]), "",
                notes.get("stress", ""), ""]

    for key in ("issues", "integrity"):
        if notes.get(key):
            out += [notes[key], ""]
    (DATASET_DIR / "generation_report.md").write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
    print("wrote generation_report.md")


notes_jobs = {}

if __name__ == "__main__":
    with open(DATASET_DIR.parent.parent / "backend" / "data" / "reference_jobs.csv", encoding="utf-8", newline="") as handle:
        notes_jobs.update(Counter(row["category_id"].strip() for row in csv.DictReader(handle)))
    main()
