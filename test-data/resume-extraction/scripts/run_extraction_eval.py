"""Score Kareerly's resume extractor against the ground truth.

Run from the repository root (the sample files must be in private/):

    python3 test-data/resume-extraction/scripts/run_extraction_eval.py --label after

``--code-root`` scores another checkout of Kareerly (for example a git
worktree of an earlier commit) with the same rules and the same samples, so
before-and-after figures are comparable:

    git worktree add /tmp/kareerly-before <commit>
    python3 test-data/resume-extraction/scripts/run_extraction_eval.py --code-root /tmp/kareerly-before --label baseline

Each sample is read by ``analyze_resume_bytes``, the function behind
``POST /api/resume/analyze``. Images are scored twice: as that code ships
("as_shipped": an older parser refuses them at upload) and through text
recognition ("ocr_path": read directly when the code accepts images, else
wrapped unchanged in an image-only PDF, as a scanned PDF upload would be).

Writes reports/<label>_results.json (scores and error causes per sample, no
extracted text, so no personal details) and reports/<label>_tables.md.
Every miss is given one cause, decided by fixed rules (see CAUSES).
"""
from __future__ import annotations

import argparse
import csv
import difflib
import hashlib
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
    "false_value": "Entity extraction: a value is returned that the resume does not contain",
    "date_normalization": "Date normalisation: the date is in the text but the extracted date is wrong",
    "skill_alias_missing": "Skill normalisation: the resume's wording is not a known alias of the skill",
    "skill_alias_present": "Skill normalisation: an alias is in the text (often an unreviewed candidate alias or a generic word Kareerly filters) but the skill was not returned",
    "skill_false_positive": "Skill normalisation: a skill was returned that the resume does not state",
}

# Profile fields scored when the code under test returns them (an older parser
# does not, and every one present in a resume is then a "no_extractor" miss).
NEW_FIELDS = ["headline", "email", "phone", "location", "links", "summary", "work_experience", "training", "projects",
              "achievements", "languages", "interests", "references"]
NEVER_EXTRACTED = ["street_address"]  # stored only as a digest; not extracted by design

KAREERLY_TYPES = [("skills", ("skill", "competenc")), ("education", ("education", "academic")),
                  ("certifications", ("certif", "licens")), ("training", ("training", "course")),
                  ("experience", ("experience", "employment", "history", "internship")), ("projects", ("project",))]
SUPPORTED_TYPES = {t for t, _ in KAREERLY_TYPES}
MONTH_OR_YEAR = re.compile(r"^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|(?:19|20)\d{2})$", re.IGNORECASE)


def sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def layout_family(category: str) -> str:
    if category.startswith(("two_column", "three_zone", "header_banner")) or "grid" in category:
        return "multi-column / sidebar"
    if "label_column" in category or "dates_left" in category or "label_block" in category:
        return "left label column"
    return "single column"


def heading_key(text: str) -> str:
    return squash(re.sub(r"^\W*\d+\W*", "", text or ""))


def in_text(value: str, text_squashed: str, text_words: list) -> bool:
    needle = squash(value)
    if not needle or needle in text_squashed:
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
    """Looser match for titles and list items: one contains the other (8+ letters), or 80% alike."""
    a, b = squash(a), squash(b)
    return (min(len(a), len(b)) >= 8 and (a in b or b in a)) or difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def token_f1(a: str, b: str) -> float:
    x, y = Counter(words(a)), Counter(words(b))
    common = sum((x & y).values())
    if not common:
        return 0.0
    precision, recall = common / sum(x.values()), common / sum(y.values())
    return 2 * precision * recall / (precision + recall)


def date_matches(extracted: str, expected: str) -> bool:
    if not expected:
        return True
    extracted = (extracted or "").lower()
    return extracted == expected or (len(expected) == 4 and extracted[:4] == expected)


def language_tokens(values) -> set:
    tokens = set()
    for value in values or []:
        for part in re.split(r"[;,/]|\band\b", str(value).lower()):
            if part.strip():
                tokens.add(part.strip())
    return tokens


def image_as_pdf(data: bytes) -> bytes:
    from PIL import Image
    image = Image.open(io.BytesIO(data)).convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, "PDF", resolution=image.size[0] / 8.5)
    return buffer.getvalue()


def load_aliases(root: Path) -> dict:
    aliases = defaultdict(list)
    with open(root / "backend" / "data" / "skills_reference.csv", newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            aliases[row["skill_id"]].append(row["skill_name"])
    with open(root / "backend" / "data" / "skill_aliases.csv", newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["status"] != "excluded":
                aliases[row["skill_id"]].append(row["alias"])
    return aliases


def alias_in_text(skill_id: str, aliases: dict, text: str) -> bool:
    lowered = " " + re.sub(r"[^a-z0-9+#]+", " ", text.lower()) + " "
    return any(
        (norm := re.sub(r"[^a-z0-9+#]+", " ", alias.lower()).strip()) and f" {norm} " in lowered
        for alias in aliases.get(skill_id, [])
    )


class Scorer:
    def __init__(self, gt: dict, analysis, aliases: dict, rejected: bool, split_sections):
        self.gt, self.fields, self.aliases, self.rejected = gt, gt["fields"], aliases, rejected
        self.full = gt["annotation"]["level"] == "full"
        self.text = "" if rejected else analysis["normalized_for_matching"]["resume_text_for_matching"]
        self.profile = {} if rejected else analysis["candidate_profile"]
        self.all_skill_ids = set() if rejected else set(analysis["normalized_for_matching"]["all_skill_ids"])
        self.detected = [] if rejected else [h for h, _ in split_sections(self.text) if h not in ("profile", "resume")]
        self.text_sq, self.text_words = squash(self.text), words(self.text)
        self.out = {"fields": {}, "errors": []}

    def err(self, field: str, cause: str, detail: str = "") -> None:
        self.out["errors"].append({"field": field, "cause": cause, "detail": detail})

    def lost(self, value: str) -> bool:
        return not in_text(value, self.text_sq, self.text_words)

    def miss_cause(self, value: str) -> str:
        if self.rejected:
            return "intake_rejected"
        return "text_lost" if value and self.lost(value) else "entity_extraction"

    def record(self, name: str, annotated: int, correct: int, false: int = 0) -> None:
        self.out["fields"][name] = {"annotated": annotated, "correct": correct, "false": false}

    # -------------------------------------------------- shared measures
    def sections(self) -> None:
        gt_headed = [s for s in self.gt["sections"] if s.get("heading")]
        detected_keys = [heading_key(h) for h in self.detected]
        gt_keys = {heading_key(s["heading"]) for s in gt_headed}
        hits = [s for s in gt_headed if heading_key(s["heading"]) in detected_keys]
        supported = [s for s in gt_headed if s["type"] in SUPPORTED_TYPES]
        false_headings = [h for h in self.detected if heading_key(h) not in gt_keys]
        self.hits = hits
        self.out["sections"] = {"gt": len(gt_headed), "found": len(hits), "gt_supported": len(supported),
                                "found_supported": sum(1 for s in supported if s in hits),
                                "detected": len(self.detected), "false_headings": len(false_headings)}
        for s in gt_headed:
            if s not in hits:
                self.err("sections", "intake_rejected" if self.rejected else ("text_lost" if self.lost(s["heading"]) else "section_not_detected"), s["type"])
        for _ in false_headings:
            self.err("sections", "false_heading")

    def skills(self) -> None:
        expected = set(self.gt["skills"]["expected_skill_ids"])
        acceptable = set(self.gt["skills"]["acceptable_skill_ids"])
        found = self.all_skill_ids
        tp, fp = expected & found, found - expected - acceptable
        self.out["skills"] = {"expected": len(expected), "found": len(tp), "false_positives": len(fp),
                              "returned": len(found), "expected_without_sk031": len(expected - {"SK031"}),
                              "found_without_sk031": len(tp - {"SK031"})}
        for skill_id in sorted(expected - found):
            cause = "intake_rejected" if self.rejected else ("skill_alias_present" if alias_in_text(skill_id, self.aliases, self.text) else "skill_alias_missing")
            self.err("skills", cause, skill_id)
        for skill_id in sorted(fp):
            self.err("skills", "skill_false_positive", skill_id)

    def certifications(self) -> None:
        """Kareerly's certification list holds certifications and trainings, so it is scored against both."""
        extracted = [] if self.rejected else self.profile.get("certifications", [])
        pool = [e for e in self.fields["certifications"].get("entries", []) or []] + \
               [e for e in self.fields["training"].get("entries", []) or []]
        pairs = []
        for i, ex in enumerate(extracted):
            for j, e in enumerate(pool):
                if j not in {p[1] for p in pairs} and overlaps(ex.get("title", ""), e["title"]):
                    pairs.append((i, j))
                    break
        matched_ex, matched_pool = {i for i, _ in pairs}, {j for _, j in pairs}
        year_ok = sum(1 for i, j in pairs if (pool[j].get("year") or pool[j].get("date") or "")[:4] == (extracted[i].get("year") or ""))
        self.out["certifications"] = {"gt": len(pool) if self.full else 0, "found": len(matched_pool) if self.full else 0,
                                      "returned": len(extracted), "false_entries": len(extracted) - len(matched_ex),
                                      "year_correct": year_ok if self.full else 0}
        if self.full:
            detected_types = {s["type"] for s in self.hits}
            for j, e in enumerate(pool):
                if j in matched_pool:
                    continue
                if self.rejected:
                    cause = "intake_rejected"
                elif self.lost(e["title"]):
                    cause = "text_lost"
                elif not ({"certifications", "training"} & detected_types) and str(e.get("section", "")).lower() != "profile":
                    cause = "section_not_detected"
                else:
                    cause = "entity_extraction"
                self.err("certifications", cause)
        titles = [squash(e["title"]) for e in pool]
        for i, ex in enumerate(extracted):
            if i in matched_ex:
                continue
            title = squash(ex.get("title", ""))
            split = MONTH_OR_YEAR.match(ex.get("title", "").strip()) or (title and any(title in t for t in titles))
            self.err("certifications", "entry_split" if split else "section_boundary")

    # -------------------------------------------------- full annotations only
    def name(self) -> None:
        expected = self.fields["full_name"]["value"]
        ok = squash(self.profile.get("full_name", "")) == squash(expected)
        self.out["name"] = ok
        self.record("full_name", 1, int(ok))
        if not ok:
            self.err("full_name", self.miss_cause(expected))

    def education(self) -> None:
        gt_edu = self.fields["education"].get("entries", []) or []
        ex_edu = [] if self.rejected else self.profile.get("education", [])
        scores = Counter(gt=len(gt_edu))
        matched = set()
        for ex in ex_edu:
            best = next((j for j, e in enumerate(gt_edu) if j not in matched and (
                similar(ex.get("school_university", ""), e["school_university"] or "")
                or similar(ex.get("degree_program", ""), e["degree_program"] or ""))), None)
            if best is None:
                scores["false_entries"] += 1
                self.err("education", "false_value", "entry matches no education entry")
                continue
            matched.add(best)
            e = gt_edu[best]
            scores["matched"] += 1
            for key in ("degree_program", "school_university"):
                if similar(ex.get(key, ""), e[key] or "") or (not e[key] and not ex.get(key)):
                    scores[key] += 1
                else:
                    self.err(f"education.{key}", "text_lost" if e[key] and self.lost(e[key]) else "entity_extraction")
            if (ex.get("year_graduated") or "") == (e["year_graduated"] or ""):
                scores["year_graduated"] += 1
            else:
                year = e["year_graduated"] or ""
                self.err("education.year_graduated", "text_lost" if year and year not in self.text else "date_normalization")
            if (ex.get("highest_educational_attainment") or "") == (e["highest_educational_attainment"] or ""):
                scores["highest_educational_attainment"] += 1
            else:
                self.err("education.highest_educational_attainment", "entity_extraction")
        for j, e in enumerate(gt_edu):
            if j in matched:
                continue
            if self.rejected:
                cause = "intake_rejected"
            elif ex_edu and len(ex_edu) == 1:
                cause = "entry_limit"
            elif self.lost(e["degree_program"] or "") and self.lost(e["school_university"] or ""):
                cause = "text_lost"
            else:
                cause = "entity_extraction"
            self.err("education", cause, "entry not returned")
        self.out["education"] = dict(scores)

    def new_fields(self) -> None:
        produced = set(self.profile)
        for name in NEW_FIELDS + NEVER_EXTRACTED:
            gt = self.fields[name]
            status = gt["status"]
            if name not in produced or name in NEVER_EXTRACTED or self.rejected:
                if status == "present" and not (name == "links" and not gt.get("sha256")) and name != "training":
                    # Counted in the same units as when the field is produced: items for lists.
                    items = len(language_tokens(gt.get("values"))) if name == "languages" else \
                        len(gt.get("entries") or gt.get("values") or [None])
                    self.out["fields"][name] = {"annotated": items, "correct": 0, "false": 0, "not_produced": True}
                    for _ in range(items):
                        self.err(name, "intake_rejected" if self.rejected else "no_extractor")
                continue
            if name == "training":
                continue  # scored with certifications: Kareerly's list holds both
            getattr(self, f"_score_{name}")(gt, self.profile.get(name))

    def _scalar(self, name: str, gt: dict, ok, extracted, expected_text: str = "") -> None:
        if gt["status"] == "present":
            self.record(name, 1, int(bool(ok)), int(bool(extracted) and not ok))
            if not ok:
                self.err(name, self.miss_cause(expected_text) if not extracted else "entity_extraction")
        elif gt["status"] == "absent":
            self.record(name, 0, 0, int(bool(extracted)))
            if extracted:
                self.err(name, "false_value")

    def _score_headline(self, gt, value):
        self._scalar("headline", gt, gt.get("value") and similar(value or "", gt["value"]), value, gt.get("value", ""))

    def _score_email(self, gt, value):
        ok = gt["status"] == "present" and value and sha((value or "").strip().lower()) == gt["sha256"]
        self._scalar("email", gt, ok, value)

    def _score_phone(self, gt, value):
        if gt["status"] == "masked":
            return
        ok = gt["status"] == "present" and value and sha(re.sub(r"\D", "", value)) == gt["sha256"]
        self._scalar("phone", gt, ok, value)

    def _score_location(self, gt, value):
        expected = gt.get("value", "")
        a, b = squash(value or ""), squash(expected)
        ok = bool(a and b and (a in b or b in a) and min(len(a), len(b)) >= 4)
        self._scalar("location", gt, ok, value, expected)

    def _score_links(self, gt, value):
        if gt["status"] == "present" and not gt.get("sha256"):
            return  # link labels only ("LinkedIn", "Resume Templates"): no address to find
        found = {sha(re.sub(r"^(https?://)?(www\.)?", "", v.lower()).rstrip("/")) for v in value or []}
        expected = set(gt.get("sha256") or [])
        ok = bool(expected) and expected <= found
        self._scalar("links", gt, ok, value)

    def _score_summary(self, gt, value):
        expected = gt.get("value", "")
        self._scalar("summary", gt, expected and token_f1(value or "", expected) >= 0.8, value, expected)

    def _score_references(self, gt, value):
        self._scalar("references", gt, gt.get("value") and value == gt["value"], value)

    def _list(self, name: str, expected: list, extracted: list, match) -> None:
        used, correct = set(), 0
        for e in expected:
            j = next((j for j, x in enumerate(extracted) if j not in used and match(x, e)), None)
            if j is None:
                self.err(name, self.miss_cause(e if isinstance(e, str) else ""))
            else:
                used.add(j)
                correct += 1
        false = len(extracted) - len(used)
        for _ in range(false):
            self.err(name, "false_value")
        self.record(name, len(expected), correct, false)

    def _score_languages(self, gt, value):
        expected = sorted(language_tokens(gt.get("values")))
        self._list("languages", expected, sorted(language_tokens(value)), lambda x, e: x == e)

    def _score_interests(self, gt, value):
        self._list("interests", gt.get("values") or [], value or [], lambda x, e: squash(x) == squash(e))

    def _score_achievements(self, gt, value):
        self._list("achievements", [e["text"] for e in gt.get("entries") or []], [x["text"] for x in value or []], overlaps)

    def _score_projects(self, gt, value):
        self._list("projects", [e["name"] for e in gt.get("entries") or []], [x["name"] for x in value or []], overlaps)

    def _score_work_experience(self, gt, value):
        expected = gt.get("entries") or []
        extracted = value or []
        used = set()
        counts = Counter(annotated=len(expected))
        for e in expected:
            j = next((j for j, x in enumerate(extracted) if j not in used and (
                similar(x.get("company", ""), e["company"]) or (similar(x.get("job_title", ""), e["job_title"])
                and date_matches(x.get("start_date", ""), e["start_date"])))), None)
            if j is None:
                self.err("work_experience", self.miss_cause(e["company"]), "entry not returned")
                continue
            used.add(j)
            x = extracted[j]
            counts["matched"] += 1
            for key, ok in (("job_title", similar(x.get("job_title", ""), e["job_title"])),
                            ("company", similar(x.get("company", ""), e["company"])),
                            ("start_date", date_matches(x.get("start_date", ""), e["start_date"])),
                            ("end_date", date_matches(x.get("end_date", ""), e["end_date"]))):
                counts[key] += int(ok)
                if not ok:
                    self.err(f"work_experience.{key}", "date_normalization" if key.endswith("date") else "entity_extraction")
            if e.get("location"):
                counts["location_annotated"] += 1
                counts["location"] += int(similar(x.get("location", ""), e["location"]))
        counts["false_entries"] = len(extracted) - len(used)
        for _ in range(counts["false_entries"]):
            self.err("work_experience", "false_value", "entry matches no job")
        self.out["work_experience"] = dict(counts)
        self.record("work_experience", len(expected), counts["matched"], counts["false_entries"])

    def run(self) -> dict:
        self.sections()
        self.skills()
        self.certifications()
        if not self.full:
            self.out["name"] = None
            return self.out
        self.name()
        self.education()
        self.new_fields()
        self.text_coverage()
        return self.out

    def text_coverage(self) -> None:
        values = []
        for e in self.fields["work_experience"].get("entries", []) or []:
            values += [("job_title", e["job_title"]), ("company", e["company"]), ("date", e["dates_as_written"])]
        for e in self.fields["education"].get("entries", []) or []:
            values += [("degree", e["degree_program"]), ("school", e["school_university"]), ("date", e["dates_as_written"])]
        values += [("certification", e["title"]) for e in self.fields["certifications"].get("entries", []) or []]
        values += [("achievement", e["text"]) for e in self.fields["achievements"].get("entries", []) or []]
        values += [("skill", v) for v in self.fields["skills_stated"].get("values", []) or []]
        values += [("name", self.fields["full_name"]["value"])]
        coverage = Counter()
        for kind, value in values:
            if value:
                coverage[f"{kind}_total"] += 1
                if not self.rejected and not self.lost(value):
                    coverage[f"{kind}_found"] += 1
        self.out["text_coverage"] = dict(coverage)


# ------------------------------------------------------------------ reporting

def ratio(found: int, total: int) -> str:
    return f"{found}/{total} ({100 * found / total:.0f}%)" if total else "–"


def aggregate(results: dict, manifest: dict, ids: list, mode: str) -> dict:
    agg, causes, fields = Counter(), Counter(), defaultdict(Counter)
    for sid in ids:
        r = results[sid][mode]
        agg["samples"] += 1
        for group in ("sections", "skills", "certifications"):
            for k, v in r[group].items():
                agg[f"{group}_{k}"] += v
        if manifest[sid]["ground_truth"] == "full":
            agg["full_samples"] += 1
            agg["name_ok"] += int(bool(r["name"]))
            for k, v in r.get("education", {}).items():
                agg[f"edu_{k}"] += v
            for k, v in r.get("work_experience", {}).items():
                agg[f"work_{k}"] += v
            for k, v in r.get("text_coverage", {}).items():
                agg[f"cov_{k}"] += v
            for name, counts in r["fields"].items():
                fields[name].update({k: v for k, v in counts.items() if isinstance(v, (int, bool))})
        for e in r["errors"]:
            causes[e["cause"]] += 1
    out = dict(agg)
    out["causes"] = dict(causes)
    out["fields"] = {k: dict(v) for k, v in fields.items()}
    return out


FIELD_ROWS = [("full_name", "Name"), ("email", "Email"), ("phone", "Phone (masked numbers not scored)"), ("location", "Location"),
              ("links", "Links (printed addresses)"), ("headline", "Headline"), ("summary", "Summary / objective"),
              ("work_experience", "Work-history entries"), ("achievements", "Achievements"), ("projects", "Projects"),
              ("languages", "Languages"), ("interests", "Interests"), ("references", "References"),
              ("street_address", "Street address (not extracted by design)")]


def summary_block(title: str, a: dict) -> list:
    lines = [f"## {title}", "", "| Measure | Result |", "|---|---|",
             f"| Samples | {a['samples']} ({a.get('full_samples', 0)} fully annotated) |"]
    f = a["fields"]
    for key, label in FIELD_ROWS:
        counts = f.get(key, {})
        if not counts.get("annotated") and not counts.get("false"):
            continue
        extra = " — not extracted" if counts.get("not_produced") else ""
        false = f"; {counts.get('false', 0)} returned where the resume has none or a wrong extra" if counts.get("false") else ""
        lines.append(f"| {label} | {ratio(counts.get('correct', 0), counts.get('annotated', 0))}{extra}{false} |")
    lines += [
        f"| — job title | {ratio(a.get('work_job_title', 0), a.get('work_annotated', 0))} |",
        f"| — company | {ratio(a.get('work_company', 0), a.get('work_annotated', 0))} |",
        f"| — start date | {ratio(a.get('work_start_date', 0), a.get('work_annotated', 0))} |",
        f"| — end date | {ratio(a.get('work_end_date', 0), a.get('work_annotated', 0))} |",
        f"| — location | {ratio(a.get('work_location', 0), a.get('work_location_annotated', 0))} |",
        f"| Education entries returned and matched | {ratio(a.get('edu_matched', 0), a.get('edu_gt', 0))} |",
        f"| — degree / programme | {ratio(a.get('edu_degree_program', 0), a.get('edu_gt', 0))} |",
        f"| — school | {ratio(a.get('edu_school_university', 0), a.get('edu_gt', 0))} |",
        f"| — graduation year | {ratio(a.get('edu_year_graduated', 0), a.get('edu_gt', 0))} |",
        f"| — education level | {ratio(a.get('edu_highest_educational_attainment', 0), a.get('edu_gt', 0))} |",
        f"| Education entries that match nothing | {a.get('edu_false_entries', 0)} |",
        f"| Certifications and training found | {ratio(a.get('certifications_found', 0), a.get('certifications_gt', 0))} |",
        f"| — year correct | {ratio(a.get('certifications_year_correct', 0), a.get('certifications_found', 0))} |",
        f"| Certification entries that are not certifications or training | {a.get('certifications_false_entries', 0)} of {a.get('certifications_returned', 0)} |",
        f"| Expected skills found (recall) | {ratio(a.get('skills_found', 0), a.get('skills_expected', 0))} |",
        f"| — without English Communication (SK031) | {ratio(a.get('skills_found_without_sk031', 0), a.get('skills_expected_without_sk031', 0))} |",
        f"| Skills returned that the resume does not state | {a.get('skills_false_positives', 0)} of {a.get('skills_returned', 0)} |",
        f"| Section headings recognised (all) | {ratio(a.get('sections_found', 0), a.get('sections_gt', 0))} |",
        f"| Section headings recognised (kinds Kareerly read before) | {ratio(a.get('sections_found_supported', 0), a.get('sections_gt_supported', 0))} |",
        f"| Lines wrongly taken as headings | {a.get('sections_false_headings', 0)} |",
        "", "| Cause of misses | Count |", "|---|---|",
    ]
    lines += [f"| {CAUSES[c]} | {n} |" for c, n in sorted(a["causes"].items(), key=lambda kv: -kv[1])]
    return lines + [""]


def tables(results: dict, manifest: dict, env: dict) -> str:
    ids = sorted(results)
    full_ids = [s for s in ids if manifest[s]["ground_truth"] == "full"]
    lines = ["# Extraction tables (generated)", "",
             f"Generated by `scripts/run_extraction_eval.py`; parser `{env['parser_version']}`, Tesseract `{env['tesseract']}`. "
             "Do not edit by hand.", ""]
    lines += summary_block("All 40 samples, images as shipped", aggregate(results, manifest, ids, "as_shipped"))
    lines += summary_block("All 40 samples, images through OCR", aggregate(results, manifest, ids, "ocr_path"))
    for split in ("dev", "test"):
        lines += summary_block(f"{split} split, images through OCR",
                               aggregate(results, manifest, [s for s in ids if manifest[s]["split"] == split], "ocr_path"))
    by_field = Counter()
    for s in ids:
        for e in results[s]["ocr_path"]["errors"]:
            by_field[(e["field"].split(".")[0], e["cause"])] += 1
    names = sorted({f for f, _ in by_field})
    cause_names = [c for c in CAUSES if any(by_field[(f, c)] for f in names)]
    lines += ["## Misses by field and cause (all 40, images through OCR)", "",
              "| Field | " + " | ".join(cause_names) + " |", "|---|" + "---|" * len(cause_names)]
    lines += [f"| {f} | " + " | ".join(str(by_field[(f, c)] or "") for c in cause_names) + " |" for f in names]
    lines += ["", "Cause codes: " + "; ".join(f"`{c}` = {CAUSES[c]}" for c in cause_names) + ".", ""]

    lines += ["## By format and layout (images through OCR)", "",
              "| Group | Samples | Name | Work entries | Education matched | Certs/training found | Skill recall | Skill false positives | Headings recognised |",
              "|---|---|---|---|---|---|---|---|---|"]
    groups = defaultdict(list)
    for s in ids:
        groups["format: " + manifest[s]["file_format"].upper()].append(s)
        groups["layout: " + layout_family(manifest[s]["layout_category"])].append(s)
    for g in sorted(groups):
        a = aggregate(results, manifest, groups[g], "ocr_path")
        work = a["fields"].get("work_experience", {})
        lines.append(f"| {g} | {a['samples']} | {ratio(a.get('name_ok', 0), a.get('full_samples', 0))} | "
                     f"{ratio(work.get('correct', 0), work.get('annotated', 0))} | {ratio(a.get('edu_matched', 0), a.get('edu_gt', 0))} | "
                     f"{ratio(a.get('certifications_found', 0), a.get('certifications_gt', 0))} | "
                     f"{ratio(a.get('skills_found', 0), a.get('skills_expected', 0))} | {a.get('skills_false_positives', 0)} | "
                     f"{ratio(a.get('sections_found', 0), a.get('sections_gt', 0))} |")
    lines.append("")

    text_ids = [s for s in full_ids if manifest[s]["file_format"] != "jpg"]
    jpg_ids = [s for s in full_ids if manifest[s]["file_format"] == "jpg"]
    a_text, a_jpg = aggregate(results, manifest, text_ids, "ocr_path"), aggregate(results, manifest, jpg_ids, "ocr_path")
    raw = Counter()
    for s in jpg_ids:
        raw.update(results[s].get("raw_tesseract_coverage", {}))
    lines += ["## Text coverage: is the value in the extracted text at all? (full annotations)", "",
              "| Value | PDF / DOCX text layer | JPG through OCR | JPG, raw Tesseract |", "|---|---|---|---|"]
    for kind in ("name", "job_title", "company", "date", "degree", "school", "certification", "achievement", "skill"):
        lines.append(f"| {kind.replace('_', ' ')} | {ratio(a_text.get(f'cov_{kind}_found', 0), a_text.get(f'cov_{kind}_total', 0))} | "
                     f"{ratio(a_jpg.get(f'cov_{kind}_found', 0), a_jpg.get(f'cov_{kind}_total', 0))} | "
                     f"{ratio(raw.get(f'{kind}_found', 0), raw.get(f'{kind}_total', 0))} |")
    lines.append("")

    lines += ["## Per sample (images through OCR)", "",
              "| ID | Split | Format | Layout | Name | Work entries | Edu matched | Certs/training | Cert junk | Skills found | Skill FP | Headings |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for s in ids:
        r = results[s]["ocr_path"]
        name = "–" if r["name"] is None else ("yes" if r["name"] else "**no**")
        work = r["fields"].get("work_experience", {})
        work_text = f"{work.get('correct', 0)}/{work.get('annotated', 0)}" if work.get("annotated") else "–"
        edu = f"{r['education'].get('matched', 0)}/{r['education'].get('gt', 0)}" if "education" in r else "–"
        cert = f"{r['certifications']['found']}/{r['certifications']['gt']}" if r["certifications"]["gt"] else "–"
        lines.append(f"| {s} | {manifest[s]['split']} | {manifest[s]['file_format'].upper()} | {layout_family(manifest[s]['layout_category'])} | "
                     f"{name} | {work_text} | {edu} | {cert} | {r['certifications']['false_entries']} | "
                     f"{r['skills']['found']}/{r['skills']['expected']} | {r['skills']['false_positives']} | "
                     f"{r['sections']['found']}/{r['sections']['gt']} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--code-root", type=Path, default=ROOT, help="Kareerly checkout whose extractor is scored")
    parser.add_argument("--label", default="after", help="output name prefix (baseline, after, ...)")
    parser.add_argument("--output", type=Path, default=REPORTS)
    args = parser.parse_args()
    code_root = args.code_root.resolve()
    sys.path.insert(0, str(code_root))
    for module in [m for m in sys.modules if m == "backend" or m.startswith("backend.")]:
        del sys.modules[module]
    from backend.app.services import resume_parser
    from backend.app.services.resume_analyzer import analyze_resume_bytes, split_resume_sections
    from backend.app.services.resume_parser import ResumeFileError
    from backend.app.services.skill_extractor import SkillExtractor

    with open(DATASET / "manifest.csv", newline="", encoding="utf-8") as handle:
        manifest = {row["sample_id"]: row for row in csv.DictReader(handle)}
    missing = [s for s, row in manifest.items() if not (DATASET / row["file_name"]).exists()]
    if missing:
        print("Sample files missing from private/:", ", ".join(missing))
        return 1
    tesseract = subprocess.run(["tesseract", "--version"], capture_output=True, check=False).stdout.decode().splitlines()[0] \
        if shutil.which("tesseract") else "not installed"
    env = {"parser_version": resume_parser.RESUME_PARSER_VERSION, "tesseract": tesseract, "python": platform.python_version(),
           "skill_extractor": "SkillExtractor() from the repository CSVs; approved taxonomy additions stored in Supabase are not loaded"}
    extractor = SkillExtractor()
    aliases = load_aliases(code_root)
    results = {}
    for sid, row in sorted(manifest.items()):
        gt = json.loads((GROUND_TRUTH / f"{sid}.json").read_text(encoding="utf-8"))
        path = DATASET / row["file_name"]
        data = path.read_bytes()
        entry = {}
        try:
            analysis = analyze_resume_bytes(data, path.name, extractor)
            entry["as_shipped"] = Scorer(gt, analysis, aliases, False, split_resume_sections).run()
            entry["ocr_path"] = entry["as_shipped"]
        except ResumeFileError:
            entry["as_shipped"] = Scorer(gt, None, aliases, True, split_resume_sections).run()
            analysis = analyze_resume_bytes(image_as_pdf(data), path.stem + ".pdf", extractor)
            entry["ocr_path"] = Scorer(gt, analysis, aliases, False, split_resume_sections).run()
        if path.suffix.lower() in {".jpg", ".jpeg", ".png"} and shutil.which("tesseract"):
            raw = subprocess.run(["tesseract", str(path), "stdout", "-l", "eng", "--psm", "3"], capture_output=True, timeout=120, check=False)
            fake = {"normalized_for_matching": {"resume_text_for_matching": raw.stdout.decode("utf-8", "replace"), "all_skill_ids": []},
                    "candidate_profile": {}}
            entry["raw_tesseract_coverage"] = Scorer(gt, fake, {}, False, split_resume_sections).run().get("text_coverage", {})
        entry["extraction"] = {k: analysis["extraction"].get(k) for k in ("method", "ocr_status", "multi_column_pages", "pages_read")}
        results[sid] = entry
    args.output.mkdir(parents=True, exist_ok=True)
    payload = {"environment": env, "causes": CAUSES,
               "summary": {mode: aggregate(results, manifest, sorted(results), mode) for mode in ("as_shipped", "ocr_path")},
               "samples": results}
    (args.output / f"{args.label}_results.json").write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    (args.output / f"{args.label}_tables.md").write_text(tables(results, manifest, env), encoding="utf-8")
    print("wrote", args.output / f"{args.label}_results.json", "and", f"{args.label}_tables.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
