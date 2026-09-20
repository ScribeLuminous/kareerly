"""Propose taxonomy skill IDs for the legacy ``SK_*`` IDs on Supabase jobs.

Jobs store required skills as ad hoc IDs such as ``SK_CALENDAR`` while resumes
are mapped to taxonomy IDs such as ``SK029`` (data/skills_reference.csv), so
skill coverage can never credit a candidate. This script only reads Supabase.

    python3 scripts/job_skill_id_review.py propose
        Writes a review workbook: one row per legacy ID with the proposed taxonomy
        skill, the evidence for it, and empty decision columns for the reviewer.

    python3 scripts/job_skill_id_review.py build --workbook <reviewed.xlsx>
        Reads the reviewer's decisions and writes a SQL migration (with a backup
        table and guarded updates) plus the rows to append to skills_reference.csv.
        Nothing is applied; run the SQL yourself after checking it.

Matching compares the job's wording for each legacy ID with each taxonomy skill's
name and ESCO preferred label ("names") and its ESCO alternative labels
("synonyms"), exactly and by sentence embedding
(sentence-transformers/all-MiniLM-L6-v2). related_skills is not used: it mixes
in parent-group labels and loose phrases such as "scheduling software", which
are fine for spotting skills in a resume but too broad to pick one ID.
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services import supabase_jobs  # noqa: E402
from app.services.skill_extractor import SKILLS_REFERENCE_PATH, SkillExtractor, _normalize_alias  # noqa: E402

REVIEW_DIR = BACKEND_DIR / "data" / "skill_id_review"
ESCO_SKILLS_CSV = BACKEND_DIR / "data" / "corpus" / "reference" / "import" / "esco_skills.csv"
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
JOB_TABLES = ("internal_jobs", "employer_job_posts")

# Cosine thresholds. They only sort rows for review; every mapping still needs a decision.
NAME_HIGH = 0.85  # "high": exact name, or this close to a skill's name
CHECK = 0.75  # "check": exact synonym, or this close to a name or synonym
LOW = 0.62  # "low" down to here; below it no existing skill is close enough
SYNONYM_CHECK = 0.90  # long ESCO synonyms drift ("scheduling software"), so a synonym-only match needs this for "check"
SYNONYM_PENALTY = 0.05  # a synonym match counts slightly less than a name match
SAME_CATEGORY_BONUS = 0.03  # tie-break toward skills in the job's own category

DECISIONS = ("approve", "use_alt_2", "use_alt_3", "use_id", "new_skill", "drop")
ESCO_HIGH = 0.85  # an ESCO label this close is worth adopting as a new Kareerly skill
ESCO_LOW = 0.70  # below this ESCO has no equivalent (tools such as Canva or FastAPI), so the skill stays Kareerly-local


@dataclass
class LegacySkill:
    legacy_id: str
    labels: collections.Counter = field(default_factory=collections.Counter)
    jobs: list[tuple[str, str, str]] = field(default_factory=list)  # (table, job_id, title)
    categories: collections.Counter = field(default_factory=collections.Counter)


def split_names(value: Any) -> list[str]:
    return [part.strip() for part in re.split(r"[;,|\n]", str(value or "")) if part.strip()]


def slug_label(legacy_id: str) -> str:
    return legacy_id.upper().removeprefix("SK_").replace("_", " ").lower()


class TaxonomyIndex:
    def __init__(self) -> None:
        extractor = SkillExtractor(SKILLS_REFERENCE_PATH)
        category_terms = extractor._category_label_terms()
        category_ids = {row["skill_id"]: row.get("category_id", "") for row in _read_reference_rows()}
        self.rows = [{**row, "category_id": category_ids.get(row["skill_id"], "")} for row in extractor.rows]
        # (normalized text, row index, is_name)
        entries: dict[tuple[str, int], bool] = {}
        for row_index, row in enumerate(self.rows):
            names = [row.get("skill_name", ""), row.get("esco_preferred_label", "")]
            synonyms = [part for part in re.split(r";", row.get("esco_alternative_labels", "")) if part.strip()]
            for text, is_name in [*((name, True) for name in names), *((synonym, False) for synonym in synonyms)]:
                normalized = _normalize_alias(text)
                if len(normalized) < 3 or normalized in category_terms:
                    continue
                entries[(normalized, row_index)] = entries.get((normalized, row_index), False) or is_name
        self.entries = [(text, row_index, is_name) for (text, row_index), is_name in sorted(entries.items())]
        self.by_text: dict[str, list[tuple[int, bool]]] = collections.defaultdict(list)
        for text, row_index, is_name in self.entries:
            self.by_text[text].append((row_index, is_name))
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(EMBEDDING_MODEL)
        self.entry_vectors = self.encode([text for text, _, _ in self.entries])

    def encode(self, texts: list[str]):
        return self.model.encode(texts, batch_size=128, normalize_embeddings=True, show_progress_bar=False)

    def exact(self, labels: list[str]) -> list[tuple[int, bool]]:
        """Skills whose name or synonym equals a label, names first."""
        found: dict[int, bool] = {}
        for label in labels:
            for row_index, is_name in self.by_text.get(_normalize_alias(label), []):
                found[row_index] = found.get(row_index, False) or is_name
        return sorted(found.items(), key=lambda item: not item[1])

    def nearest(self, labels: list[str], category: str = "", top_k: int = 3) -> list[tuple[int, float, str, bool]]:
        """Top skills by cosine to a name, or slightly discounted cosine to a synonym."""
        query = self.encode([label for label in labels if label])
        scores = (query @ self.entry_vectors.T).max(axis=0)
        best: dict[int, tuple[float, float, str, bool]] = {}
        for column, (text, row_index, is_name) in enumerate(self.entries):
            raw = float(scores[column])
            adjusted = raw if is_name else raw - SYNONYM_PENALTY
            if category and self.rows[row_index].get("skill_category") == category:
                adjusted += SAME_CATEGORY_BONUS
            if row_index not in best or adjusted > best[row_index][0]:
                best[row_index] = (adjusted, raw, text, is_name)
        ranked = sorted(best.items(), key=lambda item: item[1][0], reverse=True)[:top_k]
        return [(row_index, raw, text, is_name) for row_index, (_, raw, text, is_name) in ranked]

    def skill(self, row_index: int) -> dict[str, str]:
        return self.rows[row_index]


class EscoIndex:
    """ESCO skills (imported by scripts/import_reference_data.py) searched by label."""

    def __init__(self, model, path: Path = ESCO_SKILLS_CSV) -> None:
        with path.open(encoding="utf-8", newline="") as handle:
            self.skills = {row["concept_uri"]: row for row in csv.DictReader(handle)}
        self.labels: list[tuple[str, str, bool]] = []  # (normalized label, uri, is_preferred)
        seen: set[tuple[str, str]] = set()
        for uri, row in self.skills.items():
            for label, preferred in [(row["preferred_label"], True), *((alt, False) for alt in row["alt_labels"].splitlines())]:
                normalized = _normalize_alias(label)
                if len(normalized) < 3 or (normalized, uri) in seen:
                    continue
                seen.add((normalized, uri))
                self.labels.append((normalized, uri, preferred))
        self.by_text: dict[str, list[str]] = collections.defaultdict(list)
        for normalized, uri, _ in self.labels:
            self.by_text[normalized].append(uri)
        self.model = model
        self.vectors = model.encode([text for text, _, _ in self.labels], batch_size=256, normalize_embeddings=True, show_progress_bar=False)

    def best(self, queries: list[str], top_k: int = 2) -> list[tuple[str, float, str]]:
        """(uri, similarity, matched label); an exact label wins outright."""
        for query in queries:
            for uri in self.by_text.get(_normalize_alias(query), []):
                return [(uri, 1.0, "exact ESCO label")]
        scores = (self.model.encode(queries, batch_size=64, normalize_embeddings=True, show_progress_bar=False) @ self.vectors.T).max(axis=0)
        best: dict[str, tuple[float, str]] = {}
        for column, (text, uri, _) in enumerate(self.labels):
            score = float(scores[column])
            if uri not in best or score > best[uri][0]:
                best[uri] = (score, text)
        ranked = sorted(best.items(), key=lambda item: item[1][0], reverse=True)[:top_k]
        return [(uri, round(score, 3), text) for uri, (score, text) in ranked]


def fetch_jobs() -> dict[str, list[dict[str, Any]]]:
    return {table: supabase_jobs._fetch_jobs_table(table, limit=5000) for table in JOB_TABLES}


def job_label_for(legacy_id: str, names: list[str], index: TaxonomyIndex) -> str:
    """The job's own wording for a legacy ID: its required-skill name closest to the ID slug."""
    slug = slug_label(legacy_id)
    if not names:
        return slug
    vectors = index.encode([slug, *names])
    scores = vectors[1:] @ vectors[0]
    best = int(scores.argmax())
    return names[best] if float(scores[best]) >= 0.5 else slug


def collect_legacy_skills(jobs: dict[str, list[dict[str, Any]]], index: TaxonomyIndex) -> dict[str, LegacySkill]:
    legacy: dict[str, LegacySkill] = {}
    for table, rows in jobs.items():
        for row in rows:
            names = split_names(row.get("required_skills"))
            for legacy_id in dict.fromkeys(i.upper() for i in split_names(row.get("must_have_skill_ids"))):
                item = legacy.setdefault(legacy_id, LegacySkill(legacy_id))
                item.labels[job_label_for(legacy_id, names, index)] += 1
                item.jobs.append((table, str(row.get("job_id", "")), str(row.get("job_title", ""))))
                item.categories[str(row.get("category_name", ""))] += 1
    return legacy


def category_crosswalk(jobs: dict[str, list[dict[str, Any]]], index: TaxonomyIndex) -> list[dict[str, Any]]:
    taxonomy = sorted({(row["skill_category"], row.get("category_id", "")) for row in index.rows if row.get("skill_category")})
    reference = {row.get("skill_id"): row for row in _read_reference_rows()}
    taxonomy_ids = {}
    for skill_id, row in reference.items():
        taxonomy_ids.setdefault(row.get("skill_category", ""), row.get("category_id", ""))
    names = sorted({name for name, _ in taxonomy})
    name_vectors = index.encode(names)
    job_categories = collections.Counter(
        (str(row.get("category_code", "")), str(row.get("category_name", ""))) for rows in jobs.values() for row in rows
    )
    result = []
    for (code, name), count in sorted(job_categories.items()):
        scores = name_vectors @ index.encode([name.replace("/", ", ")])[0]
        best = int(scores.argmax())
        taxonomy_name = names[best]
        taxonomy_code = taxonomy_ids.get(taxonomy_name, "")
        result.append({
            "job_category_code": code,
            "job_category_name": name,
            "job_count": count,
            "taxonomy_category_id": taxonomy_code,
            "taxonomy_category_name": taxonomy_name,
            "name_similarity": round(float(scores[best]), 3),
            "codes_agree": "yes" if code == taxonomy_code else "NO",
        })
    return result


def _read_reference_rows() -> list[dict[str, str]]:
    with Path(SKILLS_REFERENCE_PATH).open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def propose(args: argparse.Namespace) -> int:
    index = TaxonomyIndex()
    esco = None
    if not args.no_esco and ESCO_SKILLS_CSV.exists():
        esco = EscoIndex(index.model)
        print(f"ESCO skills loaded: {len(esco.skills)}")
    elif not args.no_esco:
        print(f"! {ESCO_SKILLS_CSV} not found; run scripts/import_reference_data.py esco first. Continuing without ESCO.")
    jobs = fetch_jobs()
    legacy = collect_legacy_skills(jobs, index)
    crosswalk = category_crosswalk(jobs, index)
    taxonomy_category_by_job_category = {row["job_category_name"]: row for row in crosswalk}
    code_aliases = supabase_jobs.SKILL_ID_ALIASES
    reference_ids = {row["skill_id"]: row for row in _read_reference_rows()}
    taxonomy_skill_by_esco_uri = {
        row["esco_skill_uri"].strip(): row for row in reference_ids.values() if row.get("esco_skill_uri", "").strip()
    }

    mapping_rows: list[dict[str, Any]] = []
    for legacy_id in sorted(legacy, key=lambda key: (-len(legacy[key].jobs), key)):
        item = legacy[legacy_id]
        labels = [label for label, _ in item.labels.most_common()]
        queries = list(dict.fromkeys([*labels, slug_label(legacy_id)]))
        job_category = item.categories.most_common(1)[0][0] if item.categories else ""
        expected_category = taxonomy_category_by_job_category.get(job_category, {}).get("taxonomy_category_name", "")
        exact = index.exact(queries)
        nearest = index.nearest(queries, expected_category)

        if exact:
            # Several skills can share a synonym; keep name matches first, then the closest by embedding.
            order = {row_index: position for position, (row_index, *_rest) in enumerate(index.nearest(queries, expected_category, top_k=50))}
            exact.sort(key=lambda item: (not item[1], order.get(item[0], 99)))
            top_index, is_name = exact[0]
            score, method = 1.0, "exact"
            matched = "exact skill name" if is_name else "exact ESCO synonym"
            confidence = "high" if is_name else "check"
            alternatives = [(i, s, t, n) for i, s, t, n in nearest if i != top_index][:2]
        else:
            top_index, score, matched_text, is_name = nearest[0]
            method = "embedding"
            matched = f"{'name' if is_name else 'synonym'}: {matched_text}"
            if is_name and score >= NAME_HIGH:
                confidence = "high"
            elif score >= (CHECK if is_name else SYNONYM_CHECK):
                confidence = "check"
            elif score >= LOW:
                confidence = "low"
            else:
                confidence = "no match"
            alternatives = nearest[1:3]

        top = index.skill(top_index)
        action = {
            "high": "map",
            "check": "map after a quick check",
            "low": "review",
            "no match": "add new skill",
        }[confidence]
        category_note = "" if not expected_category or top["skill_category"] == expected_category else f"job category maps to {expected_category}"
        existing_alias = code_aliases.get(legacy_id, "")

        row = {
            "legacy_skill_id": legacy_id,
            "job_wording": " | ".join(labels),
            "job_count": len(item.jobs),
            "example_jobs": "; ".join(f"{job_id} {title}" for _, job_id, title in item.jobs[:4]),
            "job_category": job_category,
            "proposed_skill_id": top["skill_id"] if confidence != "no match" else "",
            "proposed_skill_name": top["skill_name"] if confidence != "no match" else "",
            "proposed_skill_category": top["skill_category"] if confidence != "no match" else "",
            "match_method": method,
            "matched_on": matched,
            "similarity": round(score, 3),
            "confidence": confidence,
            "recommended_action": action,
            "category_check": category_note,
            "current_code_alias": f"{existing_alias} {reference_ids.get(existing_alias, {}).get('skill_name', '')}".strip(),
        }
        if len(item.categories) > 1:
            category_note = (category_note + "; " if category_note else "") + f"used in {len(item.categories)} job categories"
            row["category_check"] = category_note
        for position, (alt_index, alt_score, _, _) in enumerate(alternatives[:2], start=2):
            alt = index.skill(alt_index)
            row[f"alt_{position}_skill_id"] = alt["skill_id"]
            row[f"alt_{position}_skill_name"] = alt["skill_name"]
            row[f"alt_{position}_similarity"] = round(alt_score, 3)
        if confidence == "no match":
            # Keep the closest skills visible so a near miss is not added twice.
            row["alt_2_skill_id"], row["alt_2_skill_name"], row["alt_2_similarity"] = top["skill_id"], top["skill_name"], round(score, 3)
        if esco:
            matches = esco.best(queries)
            for position, (uri, esco_score, matched_label) in enumerate(matches, start=1):
                skill = esco.skills[uri]
                suffix = "" if position == 1 else f"_alt_{position}"
                row[f"esco_skill{suffix}"] = skill["preferred_label"]
                row[f"esco_similarity{suffix}"] = esco_score
                if position == 1:
                    row["esco_matched_on"] = matched_label
                    row["esco_skill_uri"] = uri
                    row["esco_skill_type"] = skill["skill_type"]
        row.update({"decision": "", "final_skill_id": "", "reviewer_notes": ""})
        mapping_rows.append(row)

    next_number = max(int(skill_id[2:]) for skill_id in reference_ids if re.fullmatch(r"SK\d+", skill_id)) + 1
    new_skill_rows = []
    for row in mapping_rows:
        # Offer a new skill wherever the taxonomy match is weak, not only where nothing matched.
        if row["confidence"] not in {"no match", "low"}:
            continue
        crosswalk_row = taxonomy_category_by_job_category.get(row["job_category"], {})
        esco_score = float(row.get("esco_similarity", 0) or 0)
        # Below ESCO_LOW the nearest label is a coincidence, so keep the skill Kareerly-local.
        esco_uri = row.get("esco_skill_uri", "") if esco_score >= ESCO_LOW else ""
        # A close ESCO label is a better skill name than the job's own shorthand.
        use_esco_name = bool(esco_uri) and esco_score >= ESCO_HIGH
        skill = esco.skills[esco_uri] if esco and esco_uri else {}
        owner = taxonomy_skill_by_esco_uri.get(esco_uri) if esco_uri else None
        duplicate_note = (
            f"ESCO skill already in the taxonomy as {owner['skill_id']} {owner['skill_name']}: map to it instead of adding"
            if owner else ("" if esco_uri else f"no ESCO equivalent (closest {row.get('esco_skill', '')} at {esco_score}); Kareerly-local skill")
        )
        new_skill_rows.append({
            "legacy_skill_id": row["legacy_skill_id"],
            "proposed_new_skill_id": f"SK{next_number:03d}",
            "skill_name": skill["preferred_label"] if use_esco_name else row["job_wording"].split(" | ")[0].strip().capitalize(),
            "category_id": crosswalk_row.get("taxonomy_category_id", ""),
            "skill_category": crosswalk_row.get("taxonomy_category_name", ""),
            "esco_skill": skill.get("preferred_label", ""),
            "esco_similarity": row.get("esco_similarity", ""),
            "duplicate_check": duplicate_note,
            "esco_skill_uri": esco_uri,
            "esco_alt_labels": skill.get("alt_labels", "").replace("\n", "; ")[:200],
            "esco_description": skill.get("description", "")[:300],
            "taxonomy_match": f"{row['confidence']}: {row.get('proposed_skill_name', '')} ({row.get('similarity', '')})",
            "used_by_jobs": row["example_jobs"],
            "decision": "",
            "reviewer_notes": "",
        })
        next_number += 1

    by_legacy = {row["legacy_skill_id"]: row for row in mapping_rows}
    new_ids = {row["legacy_skill_id"]: row["proposed_new_skill_id"] for row in new_skill_rows}
    preview_rows = []
    for table, rows in jobs.items():
        for job in rows:
            old_ids = [i.upper() for i in split_names(job.get("must_have_skill_ids"))]
            proposed = []
            for legacy_id in old_ids:
                mapped = by_legacy.get(legacy_id, {})
                proposed.append(mapped.get("proposed_skill_id") or f"{new_ids.get(legacy_id, '?')} (new)")
            names_only = ""
            if not old_ids:
                labels = split_names(job.get("required_skills"))
                exact = [index.skill(row_index)["skill_id"] for row_index, _ in index.exact(labels)]
                names_only = ";".join(dict.fromkeys(exact))
            preview_rows.append({
                "table": table,
                "job_id": job.get("job_id", ""),
                "job_title": job.get("job_title", ""),
                "job_category": job.get("category_name", ""),
                "required_skills_text": job.get("required_skills", ""),
                "current_skill_ids": ";".join(old_ids),
                "proposed_skill_ids": ";".join(dict.fromkeys(proposed)) if old_ids else names_only,
                "note": "" if old_ids else "no skill IDs stored; proposal uses exact name matches only",
            })

    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    output = args.out or REVIEW_DIR / f"job_skill_id_review_{dt.date.today().isoformat()}.xlsx"
    write_workbook(output, mapping_rows, new_skill_rows, preview_rows, crosswalk)
    counts = collections.Counter(row["confidence"] for row in mapping_rows)
    print(f"legacy IDs: {len(mapping_rows)} | " + ", ".join(f"{key}: {value}" for key, value in counts.items()))
    print(f"wrote {output}")
    return 0


INSTRUCTIONS = [
    ("What this is", "Each legacy job skill ID (SK_*) with a proposed skill from data/skills_reference.csv. Nothing has been changed in Supabase."),
    ("confidence", "high: exact skill name, or embedding similarity >= 0.85 to a skill name. check: exact ESCO synonym, or similarity >= 0.75 to a name (>= 0.90 to a synonym). low: down to 0.62. no match: below 0.62, so a new taxonomy skill is proposed."),
    ("decision (Skill ID mapping)", "approve = use proposed_skill_id | use_alt_2 / use_alt_3 = use that alternative | use_id = put the ID in final_skill_id | new_skill = use the ID from the New skills sheet | drop = remove this skill from the jobs."),
    ("decision (New skills)", "approve = add this skill to the taxonomy (edit skill_name / category first if needed) | skip = do not add. Rows appear for every weak or missing taxonomy match, so a 'low' row can be mapped on the first sheet or added as a new skill here, not both."),
    ("duplicate_check", "Warns when the proposed ESCO skill is already in the taxonomy (map to that skill on the first sheet instead of adding a duplicate), or when ESCO has no equivalent, which is normal for tools such as Canva, Figma or Power BI."),
    ("ESCO columns", "The closest skill in ESCO v1.2.1 (13,939 skills), which is where new Kareerly skills should come from. A new skill approved with an ESCO URI keeps that link, so its ESCO synonyms and description come along."),
    ("category_check", "The proposed skill sits in a different taxonomy category than the job. Often fine for cross-cutting skills (e.g. Communication); check anything surprising."),
    ("Category crosswalk", "Job category codes K04-K11 do not match the taxonomy's codes for the same names. Review separately; the build step does not change categories."),
    ("Next step", "Fill the decision columns, save, then run: python3 scripts/job_skill_id_review.py build --workbook <file>"),
]


def write_workbook(path: Path, mapping_rows, new_skill_rows, preview_rows, crosswalk) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    workbook = Workbook()
    readme = workbook.active
    readme.title = "Read me"
    readme.append(["Topic", "Details"])
    for topic, details in INSTRUCTIONS:
        readme.append([topic, details])
    readme.column_dimensions["A"].width = 28
    readme.column_dimensions["B"].width = 120
    for cell in readme["B"]:
        cell.alignment = Alignment(wrap_text=True, vertical="top")

    fills = {
        "high": PatternFill("solid", fgColor="E2F0D9"),
        "check": PatternFill("solid", fgColor="EDF5E1"),
        "low": PatternFill("solid", fgColor="FFF2CC"),
        "no match": PatternFill("solid", fgColor="FBE5D6"),
    }
    decision_fill = PatternFill("solid", fgColor="DDEBF7")

    def add_sheet(title: str, rows: list[dict[str, Any]], decision_values: tuple[str, ...] | None = None, widths=None):
        sheet = workbook.create_sheet(title)
        if not rows:
            sheet.append(["(none)"])
            return sheet
        headers = list(dict.fromkeys(key for row in rows for key in row))
        sheet.append(headers)
        for row in rows:
            sheet.append([row.get(header, "") for header in headers])
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        sheet.freeze_panes = "B2"
        sheet.auto_filter.ref = sheet.dimensions
        for column_index, header in enumerate(headers, start=1):
            letter = sheet.cell(row=1, column=column_index).column_letter
            sheet.column_dimensions[letter].width = (widths or {}).get(header, min(max(len(header) + 2, 14), 40))
            if header in {"decision", "final_skill_id", "reviewer_notes"}:
                for cell in sheet[letter][1:]:
                    cell.fill = decision_fill
        if decision_values and "decision" in headers:
            letter = sheet.cell(row=1, column=headers.index("decision") + 1).column_letter
            validation = DataValidation(type="list", formula1='"' + ",".join(decision_values) + '"', allow_blank=True)
            sheet.add_data_validation(validation)
            validation.add(f"{letter}2:{letter}{len(rows) + 1}")
        if "confidence" in headers:
            column = headers.index("confidence") + 1
            for row_number in range(2, len(rows) + 2):
                fill = fills.get(sheet.cell(row=row_number, column=column).value)
                if fill:
                    for cell in sheet[row_number]:
                        if cell.fill != decision_fill:
                            cell.fill = fill
        return sheet

    add_sheet("Skill ID mapping", mapping_rows, DECISIONS, {"job_wording": 32, "example_jobs": 50, "category_check": 36, "esco_skill": 34, "esco_skill_uri": 30})
    add_sheet("New skills", new_skill_rows, ("approve", "skip"), {"used_by_jobs": 44, "taxonomy_match": 40, "duplicate_check": 48, "esco_skill": 34, "esco_description": 50, "esco_alt_labels": 40, "esco_skill_uri": 30})
    add_sheet("Job preview", preview_rows, None, {"required_skills_text": 50, "current_skill_ids": 45, "proposed_skill_ids": 45})
    add_sheet("Category crosswalk", crosswalk)
    workbook.save(path)


def _sql_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _sheet_rows(workbook, title: str) -> list[dict[str, Any]]:
    sheet = workbook[title]
    values = list(sheet.iter_rows(values_only=True))
    if not values or values[0] == ("(none)",):
        return []
    headers = [str(value or "") for value in values[0]]
    return [
        {header: ("" if value is None else str(value).strip()) for header, value in zip(headers, row)}
        for row in values[1:]
        if any(value not in (None, "") for value in row)
    ]


def build(args: argparse.Namespace) -> int:
    from openpyxl import load_workbook

    workbook = load_workbook(args.workbook, data_only=True)
    mapping_rows = _sheet_rows(workbook, "Skill ID mapping")
    new_skill_rows = _sheet_rows(workbook, "New skills")
    reference = {row["skill_id"]: row for row in _read_reference_rows()}

    approved_new = {row["legacy_skill_id"]: row for row in new_skill_rows if row.get("decision") == "approve"}
    problems: list[str] = []
    resolved: dict[str, str | None] = {}  # legacy -> taxonomy ID, or None to drop
    for row in mapping_rows:
        legacy_id, decision = row["legacy_skill_id"], row.get("decision", "")
        target = {
            "approve": row.get("proposed_skill_id", ""),
            "use_alt_2": row.get("alt_2_skill_id", ""),
            "use_alt_3": row.get("alt_3_skill_id", ""),
            "use_id": row.get("final_skill_id", "").upper(),
            "new_skill": approved_new.get(legacy_id, {}).get("proposed_new_skill_id", ""),
        }.get(decision)
        if decision == "drop":
            resolved[legacy_id] = None
        elif not decision:
            continue
        elif not target:
            problems.append(f"{legacy_id}: decision '{decision}' has no skill ID to use")
        elif decision != "new_skill" and target not in reference:
            problems.append(f"{legacy_id}: {target} is not in skills_reference.csv")
        else:
            resolved[legacy_id] = target

    undecided = [row["legacy_skill_id"] for row in mapping_rows if not row.get("decision")]
    if problems:
        print("! fix these rows first:\n  " + "\n  ".join(problems))
        return 1
    if undecided and not args.allow_partial:
        print(f"! {len(undecided)} legacy IDs have no decision (e.g. {', '.join(undecided[:5])}). "
              "Decide them or pass --allow-partial to leave those IDs unchanged.")
        return 1

    jobs = fetch_jobs()
    stamp = dt.date.today().strftime("%Y%m%d")
    backup_table = f"job_skill_ids_backup_{stamp}"
    statements = [
        f"-- Generated by scripts/job_skill_id_review.py from {Path(args.workbook).name}. Review before running.",
        "begin;",
        f"create table if not exists public.{backup_table} as",
        "  select 'internal_jobs'::text as source_table, job_id, must_have_skill_ids from public.internal_jobs",
        "  union all",
        "  select 'employer_job_posts'::text, job_id, must_have_skill_ids from public.employer_job_posts;",
    ]
    changed = 0
    for table, rows in jobs.items():
        for job in rows:
            old_value = str(job.get("must_have_skill_ids") or "")
            old_ids = [i.upper() for i in split_names(old_value)]
            new_ids = []
            for legacy_id in old_ids:
                if legacy_id not in resolved:
                    new_ids.append(legacy_id)
                elif resolved[legacy_id]:
                    new_ids.append(resolved[legacy_id])
            new_value = ";".join(dict.fromkeys(new_ids))
            if new_value == old_value:
                continue
            changed += 1
            # Guarded on the old value so a job edited since the review is left alone.
            statements.append(
                f"update public.{table} set must_have_skill_ids = {_sql_quote(new_value)} "
                f"where job_id = {_sql_quote(job['job_id'])} and must_have_skill_ids is not distinct from {_sql_quote(old_value) if old_value else 'null'};"
            )
    statements.append("commit;")
    statements.append(f"-- Roll back: update each table from public.{backup_table} by job_id.")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    sql_path = out_dir / f"{dt.date.today().isoformat()}_job_skill_ids.sql"
    sql_path.write_text("\n".join(statements) + "\n", encoding="utf-8")

    taxonomy_path = out_dir / f"{dt.date.today().isoformat()}_new_taxonomy_skills.csv"
    with Path(SKILLS_REFERENCE_PATH).open(encoding="utf-8-sig", newline="") as handle:
        reference_columns = next(csv.reader(handle))
    # Same columns as skills_reference.csv so the rows can be appended as they are.
    with taxonomy_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=reference_columns)
        writer.writeheader()
        for row in approved_new.values():
            esco_uri = row.get("esco_skill_uri", "")
            writer.writerow({
                "skill_id": row["proposed_new_skill_id"],
                "category_id": row.get("category_id", ""),
                "skill_category": row.get("skill_category", ""),
                "skill_name": row["skill_name"],
                "related_skills": row["skill_name"],
                "esco_skill_uri": esco_uri,
                "esco_preferred_label": row.get("esco_skill", "") if esco_uri else "",
                "esco_alternative_labels": row.get("esco_alt_labels", "").replace("; ", ";") if esco_uri else "",
                "esco_description": row.get("esco_description", "") if esco_uri else "",
                "esco_version": "v1.2.1" if esco_uri else "",
                "mapping_confidence": row.get("esco_similarity", "") if esco_uri else "",
                "mapping_status": "manual_review",
                "source_note": f"job_skill_id_review {row['legacy_skill_id']}",
            })

    # Links for the new skills, in the shape scripts/load_reference_data.py loads.
    link_rows = [row for row in approved_new.values() if row.get("esco_skill_uri")]
    links_path = out_dir / f"{dt.date.today().isoformat()}_kareerly_skill_esco_links.csv"
    with links_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["skill_id", "skill_uri", "method", "evidence", "confidence", "review_status"])
        writer.writeheader()
        for row in link_rows:
            writer.writerow({
                "skill_id": row["proposed_new_skill_id"],
                "skill_uri": row["esco_skill_uri"],
                "method": "manual",
                "evidence": f"job_skill_id_review: {row['legacy_skill_id']} ('{row.get('skill_name', '')}') approved against ESCO '{row.get('esco_skill', '')}'",
                "confidence": row.get("esco_similarity", ""),
                "review_status": "reviewed",
            })

    print(f"jobs to update: {changed} | legacy IDs resolved: {len(resolved)} | new taxonomy skills: {len(approved_new)} "
          f"({len(link_rows)} linked to ESCO)")
    print(f"wrote {sql_path}\nwrote {taxonomy_path}\nwrote {links_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    propose_parser = commands.add_parser("propose", help="write the review workbook")
    propose_parser.add_argument("--out", type=Path, default=None)
    propose_parser.add_argument("--no-esco", action="store_true", help="skip ESCO proposals")
    build_parser = commands.add_parser("build", help="turn a reviewed workbook into SQL")
    build_parser.add_argument("--workbook", type=Path, required=True)
    build_parser.add_argument("--out-dir", type=Path, default=REVIEW_DIR)
    build_parser.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args(argv)
    return propose(args) if args.command == "propose" else build(args)


if __name__ == "__main__":
    raise SystemExit(main())
