"""Score Kareerly's resume extractor against the ground truth.

Run from the repository root (the sample files must be in private/):

    python3 test-data/resume-extraction/scripts/run_extraction_eval.py

Each sample is read by ``analyze_resume_bytes``, the function behind
``POST /api/resume/analyze``. Image samples are scored twice: as shipped (the
upload is refused) and through the existing OCR path, by wrapping the image
unchanged in an image-only PDF, which is what uploading a scanned PDF does.

Writes reports/baseline_results.json (scores and error causes per sample, no
extracted text, so no personal details) and reports/baseline_tables.md.

Every miss is given one cause, decided by fixed rules (see CAUSES).
"""
from __future__ import annotations

import argparse
import csv
import difflib
import io
import json
import logging
import platform
import re
import shutil
import subprocess
import sys
import warnings
from collections import Counter, defaultdict
from pathlib import Path

warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from validate_ground_truth import DATASET, GROUND_TRUTH, ROOT, found_in_order, squash, words  # noqa: E402

sys.path.insert(0, str(ROOT))
from backend.app.services import resume_parser  # noqa: E402
from backend.app.services.resume_analyzer import analyze_resume_bytes, split_resume_sections  # noqa: E402
from backend.app.services.resume_parser import ResumeFileError  # noqa: E402
from backend.app.services.skill_extractor import SkillExtractor  # noqa: E402

REPORTS = DATASET / "reports"

CAUSES = {
    "intake_rejected": "File intake: the upload checks refuse the file",
    "text_lost": "File parsing / OCR: the value is not in the extracted text",
    "no_extractor": "Field mapping: Kareerly has no extractor for this field",
    "section_not_detected": "Section detection: the value is in the text, but its section heading is not recognised",
    "section_boundary": "Section detection: an unrecognised heading lets a section run on into unrelated text",
    "false_heading": "Section detection: an ordinary line is taken for a heading",
    "entity_extraction": "Entity extraction: the text and section are there, but the value is wrong or missing",
    "entry_limit": "Entity extraction: only one education entry is ever returned",
    "entry_split": "Entity extraction: a date line or the wrapped half of a title is returned as an entry of its own",
    "date_normalization": "Date normalisation: the date is in the text but the extracted year is wrong",
    "skill_alias_missing": "Skill normalisation: the resume's wording is not a known alias of the skill",
    "skill_alias_present": "Skill normalisation: an alias is in the text (often an unreviewed candidate alias or a generic word Kareerly filters) but the skill was not returned",
    "skill_false_positive": "Skill normalisation: a skill was returned that the resume does not state",
}

# Fields Kareerly's analyzer does not produce today.
NOT_PRODUCED = ["headline", "email", "phone", "location", "street_address", "links", "summary", "work_experience",
                "training", "projects", "achievements", "languages", "interests", "references"]

# Kareerly heading words, by canonical section type, for a detected heading.
KAREERLY_TYPES = [("skills", ("skill", "competenc")), ("education", ("education", "academic")),
                  ("certifications", ("certif", "licens")), ("training", ("training", "course")),
                  ("experience", ("experience", "employment", "history", "internship")), ("projects", ("project",))]
SUPPORTED_TYPES = {t for t, _ in KAREERLY_TYPES}
MONTH_OR_YEAR = re.compile(r"^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|(?:19|20)\d{2})$", re.IGNORECASE)


def layout_family(category: str) -> str:
    if category.startswith(("two_column", "three_zone", "header_banner")) or "grid" in category:
        return "multi-column / sidebar"
    if "label_column" in category or "dates_left" in category or "label_block" in category:
        return "left label column"
    return "single column"


def heading_key(text: str) -> str:
    text = re.sub(r"^\W*\d+\W*", "", text or "")
    return squash(text)


def in_text(value: str, text_squashed: str, text_words: list[str]) -> bool:
    needle = squash(value)
    if not needle:
        return True
    if needle in text_squashed:
        return True
    value_words = words(value)
    return bool(value_words) and found_in_order(value_words, text_words)


def similar(a: str, b: str) -> bool:
    a, b = squash(a), squash(b)
    if not a or not b:
        return False
    if (a in b or b in a) and min(len(a), len(b)) >= 0.7 * max(len(a), len(b)):
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.85


def overlaps(a: str, b: str) -> bool:
    """Looser match for certification titles: one contains the other, at least 8 letters long."""
    a, b = squash(a), squash(b)
    return min(len(a), len(b)) >= 8 and (a in b or b in a) or difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def image_as_pdf(data: bytes) -> bytes:
    from PIL import Image
    image = Image.open(io.BytesIO(data)).convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, "PDF", resolution=image.size[0] / 8.5)
    return buffer.getvalue()


def load_aliases() -> dict[str, list[str]]:
    aliases: dict[str, list[str]] = defaultdict(list)
    with open(ROOT / "backend" / "data" / "skills_reference.csv", newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            aliases[row["skill_id"]].append(row["skill_name"])
    with open(ROOT / "backend" / "data" / "skill_aliases.csv", newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["status"] != "excluded":
                aliases[row["skill_id"]].append(row["alias"])
    return aliases


def alias_in_text(skill_id: str, aliases: dict[str, list[str]], text: str) -> bool:
    lowered = " " + re.sub(r"[^a-z0-9+#]+", " ", text.lower()) + " "
    for alias in aliases.get(skill_id, []):
        alias_norm = re.sub(r"[^a-z0-9+#]+", " ", alias.lower()).strip()
        if alias_norm and f" {alias_norm} " in lowered:
            return True
    return False


def score_sample(gt: dict, analysis: dict | None, aliases: dict[str, list[str]], rejected: bool) -> dict:
    """Scores and causes for one sample. ``analysis`` is None when the upload is refused."""
    fields = gt["fields"]
    full = gt["annotation"]["level"] == "full"
    out: dict = {"fields": {}, "errors": []}

    def err(field: str, cause: str, detail: str = "") -> None:
        out["errors"].append({"field": field, "cause": cause, "detail": detail})

    if rejected:
        text, profile, detected = "", {}, []
    else:
        text = analysis["normalized_for_matching"]["resume_text_for_matching"]
        profile = analysis["candidate_profile"]

        detected = [h for h, _ in split_resume_sections(text) if h not in ("profile", "resume")]
    text_sq, text_words = squash(text), words(text)

    def lost(value: str) -> bool:
        return not in_text(value, text_sq, text_words)

    # ---- sections (all samples)
    gt_headed = [s for s in gt["sections"] if s.get("heading")]
    detected_keys = [heading_key(h) for h in detected]
    gt_keys = {heading_key(s["heading"]) for s in gt_headed}
    hits = [s for s in gt_headed if heading_key(s["heading"]) in detected_keys]
    supported = [s for s in gt_headed if s["type"] in SUPPORTED_TYPES]
    supported_hits = [s for s in supported if heading_key(s["heading"]) in detected_keys]
    false_headings = [h for h in detected if heading_key(h) not in gt_keys]
    out["sections"] = {"gt": len(gt_headed), "found": len(hits), "gt_supported": len(supported),
                       "found_supported": len(supported_hits), "detected": len(detected),
                       "false_headings": len(false_headings)}
    for s in gt_headed:
        if s in hits:
            continue
        cause = "intake_rejected" if rejected else ("text_lost" if lost(s["heading"]) else "section_not_detected")
        err("sections", cause, f"{s['type']}")
    for _ in false_headings:
        err("sections", "false_heading")

    # ---- skills (all samples)
    found_ids = set() if rejected else set(analysis["normalized_for_matching"]["all_skill_ids"])
    expected = set(gt["skills"]["expected_skill_ids"])
    acceptable = set(gt["skills"]["acceptable_skill_ids"])
    tp = expected & found_ids
    fp = found_ids - expected - acceptable
    # English Communication (SK031) is expected whenever English is listed as a
    # language, an annotation rule Kareerly's vocabulary does not share.
    out["skills"] = {"expected": len(expected), "found": len(tp), "false_positives": len(fp),
                     "acceptable_found": len(found_ids & acceptable), "returned": len(found_ids),
                     "expected_without_sk031": len(expected - {"SK031"}), "found_without_sk031": len(tp - {"SK031"})}
    for skill_id in sorted(expected - found_ids):
        if rejected:
            err("skills", "intake_rejected", skill_id)
        else:
            err("skills", "skill_alias_present" if alias_in_text(skill_id, aliases, text) else "skill_alias_missing", skill_id)
    for skill_id in sorted(fp):
        err("skills", "skill_false_positive", skill_id)

    # ---- certifications: Kareerly's list mixes certifications and training,
    # so it is scored against both.
    extracted_certs = [] if rejected else profile.get("certifications", [])
    pool = [("certifications", e) for e in fields["certifications"].get("entries", []) or []] + \
           [("training", e) for e in fields["training"].get("entries", []) or []]
    pairs = []
    for i, ex in enumerate(extracted_certs):
        for j, (_, e) in enumerate(pool):
            if j not in {p[1] for p in pairs} and overlaps(ex.get("title", ""), e["title"]):
                pairs.append((i, j))
                break
    matched_extracted, matched_pool = {i for i, _ in pairs}, {j for _, j in pairs}
    year_ok = sum(1 for i, j in pairs
                  if ((pool[j][1].get("year") or pool[j][1].get("date") or "")[:4]) == (extracted_certs[i].get("year") or ""))
    out["certifications"] = {"gt": len(pool) if full else 0, "found": len(matched_pool) if full else 0,
                             "returned": len(extracted_certs), "false_entries": len(extracted_certs) - len(matched_extracted),
                             "year_correct": year_ok if full else 0}
    if full:
        sections_found = {s["type"] for s in hits}
        for j, (kind, e) in enumerate(pool):
            if j in matched_pool:
                continue
            if rejected:
                cause = "intake_rejected"
            elif lost(e["title"]):
                cause = "text_lost"
            elif e.get("section", "").lower() in ("profile",):
                cause = "entity_extraction"
            elif not ({"certifications", "training"} & sections_found):
                cause = "section_not_detected"
            else:
                cause = "entity_extraction"
            err("certifications", cause, kind)
    pool_titles = [squash(e["title"]) for _, e in pool]
    for i, ex in enumerate(extracted_certs):
        if i in matched_extracted:
            continue
        title = squash(ex.get("title", ""))
        # A date line or the wrapped half of a real title, made into an entry of its own.
        if MONTH_OR_YEAR.match(ex.get("title", "").strip()) or (title and any(title in t for t in pool_titles)):
            err("certifications", "entry_split")
        else:
            err("certifications", "section_boundary")

    if not full:
        # Placeholder templates: only sections, false positives and the name check below.
        out["name"] = None
        return out

    # ---- name
    name_gt = fields["full_name"]["value"]
    name_ex = "" if rejected else profile.get("full_name", "")
    name_ok = squash(name_ex) == squash(name_gt)
    out["name"] = name_ok
    if not name_ok:
        err("full_name", "intake_rejected" if rejected else ("text_lost" if lost(name_gt) else "entity_extraction"))

    # ---- education
    gt_edu = fields["education"].get("entries", []) or []
    ex_edu = [] if rejected else profile.get("education", [])
    edu_scores = {"gt": len(gt_edu), "matched": 0, "degree_program": 0, "school_university": 0,
                  "year_graduated": 0, "highest_educational_attainment": 0, "false_entries": 0}
    matched_gt = set()
    for ex in ex_edu:
        best = None
        for j, e in enumerate(gt_edu):
            if j in matched_gt:
                continue
            if similar(ex.get("school_university", ""), e["school_university"] or "") or similar(ex.get("degree_program", ""), e["degree_program"] or ""):
                best = j
                break
        if best is None:
            edu_scores["false_entries"] += 1
            err("education", "entity_extraction", "entry matches no education entry")
            continue
        matched_gt.add(best)
        e = gt_edu[best]
        edu_scores["matched"] += 1
        for key in ("degree_program", "school_university"):
            if similar(ex.get(key, ""), e[key] or ""):
                edu_scores[key] += 1
            else:
                err(f"education.{key}", "text_lost" if lost(e[key] or "") else "entity_extraction")
        if (ex.get("year_graduated") or "") == (e["year_graduated"] or ""):
            edu_scores["year_graduated"] += 1
        else:
            year_written = e["year_graduated"] or ""
            err("education.year_graduated", "text_lost" if year_written and year_written not in text else "date_normalization")
        if (ex.get("highest_educational_attainment") or "") == (e["highest_educational_attainment"] or ""):
            edu_scores["highest_educational_attainment"] += 1
        else:
            err("education.highest_educational_attainment", "entity_extraction")
    for j, e in enumerate(gt_edu):
        if j in matched_gt:
            continue
        if rejected:
            cause = "intake_rejected"
        elif ex_edu:
            cause = "entry_limit"
        elif lost(e["degree_program"] or "") and lost(e["school_university"] or ""):
            cause = "text_lost"
        else:
            cause = "entity_extraction"
        err("education", cause, "entry not returned")
    out["education"] = edu_scores

    # ---- fields with no extractor: present in the resume, never returned.
    for name in NOT_PRODUCED:
        status = fields[name]["status"]
        if status == "present":
            out["fields"][name] = "not_produced"
            err(name, "intake_rejected" if rejected else "no_extractor")
        else:
            out["fields"][name] = status

    # ---- text coverage: is each annotated value in the extracted text at all?
    values = []
    for e in fields["work_experience"].get("entries", []) or []:
        values += [("job_title", e["job_title"]), ("company", e["company"]), ("date", e["dates_as_written"])]
    for e in gt_edu:
        values += [("degree", e["degree_program"]), ("school", e["school_university"]), ("date", e["dates_as_written"])]
    for e in fields["certifications"].get("entries", []) or []:
        values += [("certification", e["title"])]
    for e in fields["achievements"].get("entries", []) or []:
        values += [("achievement", e["text"])]
    values += [("skill", v) for v in fields["skills_stated"].get("values", []) or []]
    values += [("name", name_gt)]
    coverage = Counter()
    for kind, value in values:
        if not value:
            continue
        coverage[f"{kind}_total"] += 1
        if not rejected and not lost(value):
            coverage[f"{kind}_found"] += 1
    out["text_coverage"] = dict(coverage)
    return out


def ratio(found: int, total: int) -> str:
    return f"{found}/{total} ({100 * found / total:.0f}%)" if total else "–"


def aggregate(results: dict, manifest: dict, sample_ids: list[str], mode: str) -> dict:
    agg = Counter()
    causes = Counter()
    for sid in sample_ids:
        r = results[sid][mode]
        full = manifest[sid]["ground_truth"] == "full"
        agg["samples"] += 1
        for k, v in r["sections"].items():
            agg[f"sec_{k}"] += v
        for k, v in r["skills"].items():
            agg[f"skill_{k}"] += v
        for k, v in r["certifications"].items():
            agg[f"cert_{k}"] += v
        if full:
            agg["full_samples"] += 1
            agg["name_ok"] += 1 if r["name"] else 0
            for k, v in r["education"].items():
                agg[f"edu_{k}"] += v
            for k, v in r["text_coverage"].items():
                agg[f"cov_{k}"] += v
            for name, status in r["fields"].items():
                if status == "not_produced":
                    agg[f"present_{name}"] += 1
        else:
            agg["template_skill_fp"] += r["skills"]["false_positives"]
            agg["template_cert_fp"] += r["certifications"]["false_entries"]
        for e in r["errors"]:
            causes[e["cause"]] += 1
    agg_dict = dict(agg)
    agg_dict["causes"] = dict(causes)
    return agg_dict


def tables(results: dict, manifest: dict, env: dict) -> str:
    ids = sorted(results)
    full_ids = [s for s in ids if manifest[s]["ground_truth"] == "full"]
    lines = ["# Baseline tables (generated)", "",
             f"Generated by `scripts/run_extraction_eval.py`; parser `{env['parser_version']}`, "
             f"Tesseract `{env['tesseract']}`. Do not edit by hand.", ""]

    def block(title: str, mode: str, subset: list[str]) -> None:
        a = aggregate(results, manifest, subset, mode)
        lines.extend([f"## {title}", "",
                      "| Measure | Result |", "|---|---|",
                      f"| Samples | {a['samples']} ({a.get('full_samples', 0)} fully annotated) |",
                      f"| Name correct | {ratio(a.get('name_ok', 0), a.get('full_samples', 0))} |",
                      f"| Education entries returned and matched | {ratio(a.get('edu_matched', 0), a.get('edu_gt', 0))} |",
                      f"| — degree / programme correct | {ratio(a.get('edu_degree_program', 0), a.get('edu_gt', 0))} |",
                      f"| — school correct | {ratio(a.get('edu_school_university', 0), a.get('edu_gt', 0))} |",
                      f"| — graduation year correct | {ratio(a.get('edu_year_graduated', 0), a.get('edu_gt', 0))} |",
                      f"| — education level correct | {ratio(a.get('edu_highest_educational_attainment', 0), a.get('edu_gt', 0))} |",
                      f"| Education entries that match nothing | {a.get('edu_false_entries', 0)} |",
                      f"| Certifications and training found | {ratio(a.get('cert_found', 0), a.get('cert_gt', 0))} |",
                      f"| — year correct | {ratio(a.get('cert_year_correct', 0), a.get('cert_found', 0))} |",
                      f"| Certification entries returned that are not certifications or training | {a.get('cert_false_entries', 0)} of {a.get('cert_returned', 0)} |",
                      f"| Expected skills found (recall) | {ratio(a.get('skill_found', 0), a.get('skill_expected', 0))} |",
                      f"| — without English Communication (SK031) | {ratio(a.get('skill_found_without_sk031', 0), a.get('skill_expected_without_sk031', 0))} |",
                      f"| Skills returned that the resume does not state | {a.get('skill_false_positives', 0)} of {a.get('skill_returned', 0)} |",
                      f"| Section headings recognised (all) | {ratio(a.get('sec_found', 0), a.get('sec_gt', 0))} |",
                      f"| Section headings recognised (types Kareerly looks for) | {ratio(a.get('sec_found_supported', 0), a.get('sec_gt_supported', 0))} |",
                      f"| Lines wrongly taken as headings | {a.get('sec_false_headings', 0)} |",
                      ""])
        produced = [(n, a.get(f"present_{n}", 0)) for n in NOT_PRODUCED if a.get(f"present_{n}", 0)]
        if produced:
            lines.extend(["Fields present in these resumes that Kareerly does not extract (0% recall): " +
                          ", ".join(f"{n} ({c})" for n, c in produced) + ".", ""])
        lines.extend(["| Cause of misses | Count |", "|---|---|"] +
                      [f"| {CAUSES[c]} | {n} |" for c, n in sorted(a["causes"].items(), key=lambda kv: -kv[1])] + [""])

    block("All 40 samples, images as shipped (refused at upload)", "as_shipped", ids)
    block("All 40 samples, images through the OCR path", "ocr_path", ids)
    for split in ("dev", "test"):
        block(f"{split} split, images through the OCR path", "ocr_path", [s for s in ids if manifest[s]["split"] == split])

    by_field = Counter()
    for s in ids:
        for e in results[s]["ocr_path"]["errors"]:
            by_field[(e["field"].split(".")[0], e["cause"])] += 1
    field_names = sorted({f for f, _ in by_field})
    cause_names = [c for c in CAUSES if any(by_field[(f, c)] for f in field_names)]
    lines.extend(["## Misses by field and cause (all 40, OCR path)", "",
                  "| Field | " + " | ".join(cause_names) + " |", "|---|" + "---|" * len(cause_names)])
    for f in field_names:
        lines.append(f"| {f} | " + " | ".join(str(by_field[(f, c)] or "") for c in cause_names) + " |")
    lines.extend(["", "Cause codes: " + "; ".join(f"`{c}` = {CAUSES[c]}" for c in cause_names) + ".", ""])

    lines.extend(["## By format and layout (OCR path)", "",
                  "| Group | Samples | Name | Education matched | Certs/training found | Skill recall | Skill false positives | Headings recognised |",
                  "|---|---|---|---|---|---|---|---|"])
    groups = defaultdict(list)
    for s in ids:
        groups["format: " + manifest[s]["file_format"].upper()].append(s)
        groups["layout: " + layout_family(manifest[s]["layout_category"])].append(s)
    for g in sorted(groups):
        a = aggregate(results, manifest, groups[g], "ocr_path")
        lines.append(f"| {g} | {a['samples']} | {ratio(a.get('name_ok', 0), a.get('full_samples', 0))} | "
                     f"{ratio(a.get('edu_matched', 0), a.get('edu_gt', 0))} | {ratio(a.get('cert_found', 0), a.get('cert_gt', 0))} | "
                     f"{ratio(a.get('skill_found', 0), a.get('skill_expected', 0))} | {a.get('skill_false_positives', 0)} | "
                     f"{ratio(a.get('sec_found', 0), a.get('sec_gt', 0))} |")
    lines.append("")

    lines.extend(["## Text coverage: is the value in the extracted text at all? (OCR path, full annotations)", "",
                  "Separates text lost by file reading or OCR from values that are in the text but not extracted.", "",
                  "| Value | PDF / DOCX text layer | JPG through OCR | JPG, raw Tesseract (before Kareerly's OCR clean-up) |", "|---|---|---|---|"])
    text_ids = [s for s in full_ids if manifest[s]["file_format"] != "jpg"]
    jpg_ids = [s for s in full_ids if manifest[s]["file_format"] == "jpg"]
    a_text = aggregate(results, manifest, text_ids, "ocr_path")
    a_jpg = aggregate(results, manifest, jpg_ids, "ocr_path")
    raw = Counter()
    for s in jpg_ids:
        raw.update(results[s].get("raw_tesseract_coverage", {}))
    for kind in ("name", "job_title", "company", "date", "degree", "school", "certification", "achievement", "skill"):
        lines.append(f"| {kind.replace('_', ' ')} | {ratio(a_text.get(f'cov_{kind}_found', 0), a_text.get(f'cov_{kind}_total', 0))} | "
                     f"{ratio(a_jpg.get(f'cov_{kind}_found', 0), a_jpg.get(f'cov_{kind}_total', 0))} | "
                     f"{ratio(raw.get(f'{kind}_found', 0), raw.get(f'{kind}_total', 0))} |")
    lines.append("")

    lines.extend(["## Per sample (OCR path)", "",
                  "| ID | Split | Format | Layout | Name | Edu matched | Certs/training | Cert junk | Skills found | Skill FP | Headings |",
                  "|---|---|---|---|---|---|---|---|---|---|---|"])
    for s in ids:
        r = results[s]["ocr_path"]
        name = "–" if r["name"] is None else ("yes" if r["name"] else "**no**")
        edu = f"{r['education']['matched']}/{r['education']['gt']}" if "education" in r else "–"
        cert = f"{r['certifications']['found']}/{r['certifications']['gt']}" if r["certifications"]["gt"] else "–"
        lines.append(f"| {s} | {manifest[s]['split']} | {manifest[s]['file_format'].upper()} | {layout_family(manifest[s]['layout_category'])} | "
                     f"{name} | {edu} | {cert} | {r['certifications']['false_entries']} | "
                     f"{r['skills']['found']}/{r['skills']['expected']} | {r['skills']['false_positives']} | "
                     f"{r['sections']['found']}/{r['sections']['gt']} |")
    lines.append("")
    return "\n".join(lines)


def raw_tesseract_coverage(gt: dict, image_path: Path) -> dict:
    """Text coverage of Tesseract's own output, before Kareerly's _ocr_lines clean-up."""
    if not shutil.which("tesseract"):
        return {}
    result = subprocess.run(["tesseract", str(image_path), "stdout", "-l", "eng", "--psm", "3"],
                            capture_output=True, timeout=120, check=False)
    fake = {"normalized_for_matching": {"resume_text_for_matching": result.stdout.decode("utf-8", "replace"),
                                        "all_skill_ids": []},
            "candidate_profile": {"education": [], "certifications": []}}
    return score_sample(gt, fake, {}, rejected=False)["text_coverage"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", type=Path, default=REPORTS)
    args = parser.parse_args()
    with open(DATASET / "manifest.csv", newline="", encoding="utf-8") as handle:
        manifest = {row["sample_id"]: row for row in csv.DictReader(handle)}
    missing = [s for s, row in manifest.items() if not (DATASET / row["file_name"]).exists()]
    if missing:
        print("Sample files missing from private/:", ", ".join(missing))
        return 1
    tesseract = subprocess.run(["tesseract", "--version"], capture_output=True, check=False).stdout.decode().splitlines()[0] \
        if shutil.which("tesseract") else "not installed"
    env = {"parser_version": resume_parser.RESUME_PARSER_VERSION, "tesseract": tesseract,
           "python": platform.python_version(), "skill_extractor": "SkillExtractor() from the repository CSVs; "
           "approved taxonomy additions stored in Supabase are not loaded"}
    extractor = SkillExtractor()
    aliases = load_aliases()
    results = {}
    for sid, row in sorted(manifest.items()):
        gt = json.loads((GROUND_TRUTH / f"{sid}.json").read_text(encoding="utf-8"))
        path = DATASET / row["file_name"]
        data = path.read_bytes()
        entry = {}
        try:
            analysis = analyze_resume_bytes(data, path.name, extractor)
            entry["as_shipped"] = score_sample(gt, analysis, aliases, rejected=False)
            entry["ocr_path"] = entry["as_shipped"]
        except ResumeFileError:
            entry["as_shipped"] = score_sample(gt, None, aliases, rejected=True)
            analysis = analyze_resume_bytes(image_as_pdf(data), path.stem + ".pdf", extractor)
            entry["ocr_path"] = score_sample(gt, analysis, aliases, rejected=False)
            entry["raw_tesseract_coverage"] = raw_tesseract_coverage(gt, path)
        entry["extraction"] = {k: analysis["extraction"][k] for k in ("method", "ocr_status", "multi_column_pages", "pages_read")}
        results[sid] = entry
        print(sid, "done", flush=True)
    args.output.mkdir(parents=True, exist_ok=True)
    payload = {"environment": env, "causes": CAUSES,
               "summary": {mode: aggregate(results, manifest, sorted(results), mode) for mode in ("as_shipped", "ocr_path")},
               "samples": results}
    (args.output / "baseline_results.json").write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    (args.output / "baseline_tables.md").write_text(tables(results, manifest, env), encoding="utf-8")
    print("wrote", args.output / "baseline_results.json", "and baseline_tables.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
