"""Check the ground-truth annotations in test-data/resume-extraction/ground_truth.

Run from the repository root:

    python3 test-data/resume-extraction/scripts/validate_ground_truth.py

Structure, enums, dates and skill IDs are always checked. When the sample files
are present in private/ (they are git-ignored), every annotated text value must
also appear in the document, and the email and phone digests must match a
value printed in it. Image samples are checked against Tesseract output, when
Tesseract is installed, as warnings only: OCR misreads would otherwise read as
annotation errors.

Exit status 1 when any error is found.
"""
from __future__ import annotations

import csv
import difflib
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATASET = ROOT / "test-data" / "resume-extraction"
GROUND_TRUTH = DATASET / "ground_truth"
PRIVATE = DATASET / "private"
sys.path.insert(0, str(ROOT))

FIELDS = ["full_name", "headline", "email", "phone", "location", "street_address", "links", "personal_details",
          "summary", "work_experience", "education", "skills_stated", "certifications", "training", "projects",
          "achievements", "languages", "interests", "references"]
STATUSES = {"present", "absent", "placeholder", "masked"}
SECTION_TYPES = {"contact", "personal_details", "summary", "skills", "experience", "education", "certifications",
                 "training", "projects", "achievements", "languages", "interests", "references", "links"}
PERSONAL_ITEMS = {"date_of_birth", "place_of_birth", "nationality", "driving_license"}
DATE = re.compile(r"^\d{4}(-(0[1-9]|1[0-2]))?$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def load_reference() -> tuple[set[str], list[str]]:
    with open(ROOT / "backend" / "data" / "skills_reference.csv", newline="", encoding="utf-8") as handle:
        skill_ids = {row["skill_id"] for row in csv.DictReader(handle)}
    from backend.app.services.education import EDUCATION_LEVELS
    return skill_ids, EDUCATION_LEVELS


def squash(text: str) -> str:
    """Letters and digits only, lower-case: line wraps, spacing and punctuation do not matter."""
    text = unicodedata.normalize("NFKC", text or "").lower()
    return re.sub(r"[^a-z0-9]+", "", text)


# Words a sidebar or label column may insert between two words of a value that
# wraps beside it ("Client Relationship Very good Management").
MAX_INTERLEAVED_WORDS = 6


def words(text: str) -> list[str]:
    return [squash(word) for word in re.findall(r"\S+", unicodedata.normalize("NFKC", text or "")) if squash(word)]


def found_in_order(value_words: list[str], document_words: list[str]) -> bool:
    """True when the value's words appear in order, each within a few words of the previous one."""
    for start, word in enumerate(document_words):
        if word != value_words[0]:
            continue
        position, ok = start, True
        for wanted in value_words[1:]:
            window = document_words[position + 1: position + 2 + MAX_INTERLEAVED_WORDS]
            if wanted not in window:
                ok = False
                break
            position += 1 + window.index(wanted)
        if ok:
            return True
    return False


def document_text(path: Path) -> str | None:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        import pdfplumber
        parts = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                parts.append(page.extract_text(x_tolerance=1.5) or "")
                # Sidebars and label columns are also read on their own, as
                # vertical slices, so a value that wraps beside the main column
                # is found whole.
                for split in (0.3, 0.4, 0.5, 0.6, 0.7):
                    x = page.width * split
                    for box in ((0, 0, x, page.height), (x, 0, page.width, page.height)):
                        parts.append(page.crop(box).extract_text(x_tolerance=1.5) or "")
        return "\n".join(parts)
    if suffix == ".docx":
        from backend.app.services.resume_parser import extract_docx_document
        return extract_docx_document(path.read_bytes(), use_ocr=False).text
    if suffix in {".jpg", ".jpeg", ".png"} and shutil.which("tesseract"):
        result = subprocess.run(["tesseract", str(path), "stdout", "--psm", "3"], capture_output=True, timeout=120, check=False)
        return result.stdout.decode("utf-8", "replace")
    return None


def text_values(doc: dict) -> list[tuple[str, str]]:
    """(where, value) for every plain-text value that must appear in the document."""
    values = []
    fields = doc["fields"]
    for key in ("full_name", "headline", "summary"):
        if fields[key].get("status") == "present" and fields[key].get("value"):
            values.append((key, fields[key]["value"]))
    for key, columns in (("work_experience", ("job_title", "company", "department", "location", "dates_as_written")),
                         ("education", ("degree_program", "school_university", "location", "honors", "dates_as_written")),
                         ("certifications", ("title", "issuer", "dates_as_written")),
                         ("training", ("title", "provider", "dates_as_written")),
                         ("achievements", ("text",))):
        for index, entry in enumerate(fields[key].get("entries", []) or []):
            for column in columns:
                if entry.get(column):
                    values.append((f"{key}[{index}].{column}", entry[column]))
    for key in ("skills_stated", "languages", "interests"):
        for value in fields[key].get("values", []) or []:
            values.append((key, value))
    for section in doc["sections"]:
        if section.get("heading"):
            values.append(("sections.heading", section["heading"]))
    return values


def digests(text: str) -> tuple[set[str], set[str]]:
    emails = {hashlib.sha256(m.lower().encode()).hexdigest() for m in re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", text)}
    phones = set()
    # A number can run into a neighbouring one ("555-0100 12 Main St"), so
    # every run of adjacent digit groups is a candidate.
    for match in re.findall(r"\+?\(?\d[\d ()\-.]{6,}\d", text):
        groups = re.findall(r"\d+", match)
        for start in range(len(groups)):
            for end in range(start + 1, len(groups) + 1):
                digits = "".join(groups[start:end])
                if 7 <= len(digits) <= 15:
                    phones.add(hashlib.sha256(digits.encode()).hexdigest())
    return emails, phones


def check_structure(doc: dict, sample: dict, skill_ids: set[str], levels: list[str]) -> list[str]:
    errors = []
    sid = doc.get("sample_id")
    if doc.get("schema_version") != "1.0":
        errors.append("schema_version must be 1.0")
    if (doc.get("content_group") or "") != (sample.get("content_group") or ""):
        errors.append(f"content_group {doc.get('content_group')!r} differs from the manifest {sample.get('content_group')!r}")
    level = doc.get("annotation", {}).get("level")
    if level not in {"full", "layout_only"}:
        errors.append(f"annotation.level {level!r} is not full or layout_only")
    expected_level = "layout_only" if sample.get("content_type") == "placeholder_template" else "full"
    if level != expected_level:
        errors.append(f"annotation.level should be {expected_level} for a {sample.get('content_type')}")
    if doc.get("annotation", {}).get("review_status") not in {"unreviewed", "reviewed"}:
        errors.append("annotation.review_status must be unreviewed or reviewed")
    if list(doc.get("fields", {})) != FIELDS:
        errors.append("fields must list exactly: " + ", ".join(FIELDS))
        return errors
    for name, field in doc["fields"].items():
        status = field.get("status")
        if status not in STATUSES:
            errors.append(f"{name}: status {status!r}")
            continue
        if level == "full" and status == "placeholder":
            errors.append(f"{name}: placeholder in a full annotation")
        if status == "absent" and len(field) > 1:
            errors.append(f"{name}: an absent field carries values")
        if status != "present":
            continue
        if name in {"email", "phone", "street_address"} and not HEX64.match(str(field.get("sha256", ""))):
            errors.append(f"{name}: present without a sha256 digest")
        if name == "links" and not isinstance(field.get("count"), int):
            errors.append("links: count missing")
        if name == "personal_details" and not set(field.get("items", [])) <= PERSONAL_ITEMS:
            errors.append(f"personal_details: unknown items {field.get('items')}")
        if name in {"work_experience", "education", "certifications", "training", "projects", "achievements"} and not field.get("entries"):
            errors.append(f"{name}: present with no entries")
        if name in {"skills_stated", "languages", "interests"} and not field.get("values"):
            errors.append(f"{name}: present with no values")
    for index, entry in enumerate(doc["fields"]["work_experience"].get("entries", []) or []):
        for key in ("start_date", "end_date"):
            value = entry.get(key)
            if value is not None and value != "present" and not DATE.match(value):
                errors.append(f"work_experience[{index}].{key} {value!r} is not YYYY or YYYY-MM")
        if entry.get("is_current") != (entry.get("end_date") == "present"):
            errors.append(f"work_experience[{index}]: is_current disagrees with end_date")
    for index, entry in enumerate(doc["fields"]["education"].get("entries", []) or []):
        if entry.get("highest_educational_attainment") not in levels + [None]:
            errors.append(f"education[{index}]: level {entry.get('highest_educational_attainment')!r} is not a Kareerly level")
        for key in ("start_date", "end_date"):
            value = entry.get(key)
            if value is not None and value != "present" and not DATE.match(value):
                errors.append(f"education[{index}].{key} {value!r} is not YYYY or YYYY-MM")
        if entry.get("in_progress") and entry.get("year_graduated"):
            errors.append(f"education[{index}]: in progress but has a graduation year")
    for index, entry in enumerate(doc["fields"]["certifications"].get("entries", []) or []):
        if entry.get("kind") not in {"certification", "license"}:
            errors.append(f"certifications[{index}].kind {entry.get('kind')!r}")
        if entry.get("year") is not None and not re.match(r"^\d{4}$", entry["year"]):
            errors.append(f"certifications[{index}].year {entry['year']!r}")
    for index, section in enumerate(doc.get("sections", [])):
        if section.get("type") not in SECTION_TYPES:
            errors.append(f"sections[{index}].type {section.get('type')!r}")
    if not doc.get("sections"):
        errors.append("no sections annotated")
    skills = doc.get("skills", {})
    expected, acceptable = skills.get("expected_skill_ids"), skills.get("acceptable_skill_ids")
    if not isinstance(expected, list) or not isinstance(acceptable, list):
        errors.append("skills: expected_skill_ids and acceptable_skill_ids must be lists")
    else:
        unknown = sorted(set(expected + acceptable) - skill_ids)
        if unknown:
            errors.append(f"skills: unknown skill IDs {unknown}")
        both = sorted(set(expected) & set(acceptable))
        if both:
            errors.append(f"skills: IDs both expected and acceptable {both}")
        if len(set(expected)) != len(expected) or len(set(acceptable)) != len(acceptable):
            errors.append("skills: duplicate IDs")
    return errors


def check_against_document(doc: dict, path: Path) -> tuple[list[str], list[str]]:
    text = document_text(path)
    if text is None:
        return [], [f"{path.name}: no text available to check against"]
    is_image = path.suffix.lower() in {".jpg", ".jpeg", ".png"}
    problems = []
    haystack = squash(text)
    document_words = words(text)
    for where, value in text_values(doc):
        needle = squash(value)
        if not needle or needle in haystack:
            continue
        value_words = words(value)
        if value_words and found_in_order(value_words, document_words):
            continue
        if is_image:
            matcher = difflib.SequenceMatcher(None, haystack, needle, autojunk=False)
            block = matcher.find_longest_match(0, len(haystack), 0, len(needle))
            window = haystack[max(0, block.a - block.b): block.a - block.b + len(needle)]
            if difflib.SequenceMatcher(None, window, needle).ratio() >= 0.85:
                continue
        problems.append(f"{where}: {value[:60]!r} not found in the document")
    emails, phones = digests(text)
    fields = doc["fields"]
    if fields["email"].get("status") == "present" and fields["email"]["sha256"] not in emails:
        problems.append("email: digest matches no address in the document")
    if fields["phone"].get("status") == "present" and fields["phone"]["sha256"] not in phones:
        problems.append("phone: digest matches no number in the document")
    return ([], problems) if is_image else (problems, [])


def main() -> int:
    skill_ids, levels = load_reference()
    with open(DATASET / "manifest.csv", newline="", encoding="utf-8") as handle:
        manifest = {row["sample_id"]: row for row in csv.DictReader(handle)}
    files = {path.stem: path for path in GROUND_TRUTH.glob("*.json")}
    errors: list[str] = []
    warnings: list[str] = []
    for sid in sorted(set(manifest) - set(files)):
        errors.append(f"{sid}: no ground-truth file")
    for sid in sorted(set(files) - set(manifest)):
        errors.append(f"{sid}: ground-truth file for a sample not in the manifest")
    checked_text = 0
    for sid in sorted(set(files) & set(manifest)):
        doc = json.loads(files[sid].read_text(encoding="utf-8"))
        if doc.get("sample_id") != sid:
            errors.append(f"{sid}: sample_id {doc.get('sample_id')!r} differs from the file name")
            continue
        errors += [f"{sid}: {e}" for e in check_structure(doc, manifest[sid], skill_ids, levels)]
        source = DATASET / manifest[sid]["file_name"]
        if source.exists() and doc.get("annotation", {}).get("level") == "full":
            problems, notes = check_against_document(doc, source)
            errors += [f"{sid}: {p}" for p in problems]
            warnings += [f"{sid}: {n}" for n in notes]
            checked_text += 1
    for message in warnings:
        print("warning:", message)
    for message in errors:
        print("error:", message)
    print(f"{len(files)} files, {checked_text} checked against their documents, "
          f"{len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
