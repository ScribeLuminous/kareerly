"""Review the ESCO skill each Kareerly skill is linked to.

skills_reference.csv carries an esco_skill_uri on all 621 skills, but 500 were
generated automatically and most score below 0.8, so links such as
"Python Programming" -> "smart contract programming languages" and
"Bookkeeping" -> "bookkeeping regulations" are common: the nearest label wins
even when it names the rules about the work rather than the work.

    python3 scripts/skill_esco_link_review.py propose
        Writes a workbook: current link, how close it is, and up to three better
        ESCO candidates, worst first, with an empty decision column.

    python3 scripts/skill_esco_link_review.py build --workbook <reviewed.xlsx>
        Turns the decisions into an updated skills_reference.csv and the matching
        kareerly_skill_esco_links rows (review_status 'reviewed'), both written
        beside the workbook. Nothing is applied.

ESCO marks each skill as 'knowledge' (what you know about) or 'skill/competence'
(what you do). A Kareerly skill named for an activity linked to a knowledge
concept is the usual sign of a bad link, so that pairing is flagged.
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import sys
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts.job_skill_id_review import (  # noqa: E402
    ESCO_SKILLS_CSV, EscoIndex, REVIEW_DIR, _read_reference_rows, _sheet_rows,
)

KEEP = 0.85  # current link this close to the skill name is left alone
BETTER = 0.08  # a candidate must beat the current link by this much to be suggested
DECISIONS = ("keep", "use_1", "use_2", "use_3", "use_uri", "unlink")
INSTRUCTIONS = [
    ("What this is", "The ESCO skill each Kareerly skill is linked to, with better candidates. Worst matches first. Nothing is changed until you run the build step."),
    ("current_similarity", "How close the linked ESCO label is to the Kareerly skill name. Low means the link was probably picked by wording, not meaning."),
    ("type_flag", "'knowledge vs activity' means the Kareerly skill names work to do, but the linked ESCO concept is background knowledge (the Python and Bookkeeping pattern)."),
    ("decision", "keep = leave the current link | use_1 / use_2 / use_3 = use that candidate | use_uri = paste an ESCO URI into final_esco_uri | unlink = no ESCO equivalent (the skill stays Kareerly-local)."),
    ("Next step", "Fill decisions, save, then run: python3 scripts/skill_esco_link_review.py build --workbook <file>"),
]
ESCO_COLUMNS = {
    "esco_skill_uri": "concept_uri",
    "esco_preferred_label": "preferred_label",
    "esco_alternative_labels": "alt_labels",
    "esco_description": "description",
}


def _status(current_uri: str, current_similarity: float, candidates: list[tuple[str, float, str]]) -> tuple[str, str]:
    if candidates and current_uri == candidates[0][0]:
        return "keep", "closest ESCO skill already linked"
    if current_similarity >= KEEP:
        return "keep", "current link matches the skill name closely"
    best = candidates[0][1] if candidates else 0.0
    if best - current_similarity >= BETTER:
        return "replace", f"candidate 1 is {round(best - current_similarity, 3)} closer than the current link"
    return "check", "no clearly better candidate; confirm the current link means the same work"


def propose(args: argparse.Namespace) -> int:
    reference = _read_reference_rows()
    esco = EscoIndex(_model())
    skills_by_uri = esco.skills
    rows: list[dict[str, Any]] = []
    for skill in reference:
        name = skill["skill_name"].strip()
        current_uri = skill.get("esco_skill_uri", "").strip()
        current = skills_by_uri.get(current_uri)
        candidates = [c for c in esco.best([name], top_k=4) if c[0] != current_uri][:3]
        current_similarity = round(float(esco.similarity(name, current["preferred_label"])), 3) if current else 0.0
        action, reason = _status(current_uri, current_similarity, candidates)
        type_flag = (
            "knowledge vs activity"
            if current and current["skill_type"] == "knowledge" and any(c for c in candidates if skills_by_uri[c[0]]["skill_type"] != "knowledge")
            else ""
        )
        row = {
            "skill_id": skill["skill_id"],
            "skill_name": name,
            "skill_category": skill.get("skill_category", ""),
            "current_esco_label": current["preferred_label"] if current else "(missing from ESCO v1.2.1)",
            "current_esco_type": current["skill_type"] if current else "",
            "current_similarity": current_similarity,
            "stored_confidence": skill.get("mapping_confidence", ""),
            "mapping_status": skill.get("mapping_status", ""),
            "recommended_action": action,
            "reason": reason,
            "type_flag": type_flag,
        }
        for position, (uri, score, label) in enumerate(candidates, start=1):
            candidate = skills_by_uri[uri]
            row[f"candidate_{position}"] = candidate["preferred_label"]
            row[f"candidate_{position}_type"] = candidate["skill_type"]
            row[f"candidate_{position}_similarity"] = score
            row[f"candidate_{position}_uri"] = uri
        row.update({"decision": "", "final_esco_uri": "", "reviewer_notes": ""})
        rows.append(row)

    order = {"replace": 0, "check": 1, "keep": 2}
    rows.sort(key=lambda row: (order[row["recommended_action"]], row["current_similarity"]))
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    out = args.out or REVIEW_DIR / f"skill_esco_link_review_{dt.date.today().isoformat()}.xlsx"
    _write_workbook(out, rows)
    counts = collections.Counter(row["recommended_action"] for row in rows)
    print(f"links: {len(rows)} | " + ", ".join(f"{key}: {value}" for key, value in counts.most_common()))
    print(f"flagged knowledge-vs-activity: {sum(1 for row in rows if row['type_flag'])}")
    print(f"wrote {out}")
    return 0


def _write_workbook(path: Path, rows: list[dict[str, Any]]) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    workbook = Workbook()
    readme = workbook.active
    readme.title = "Read me"
    readme.append(["Topic", "Details"])
    for topic, details in INSTRUCTIONS:
        readme.append([topic, details])
    readme.column_dimensions["A"].width = 24
    readme.column_dimensions["B"].width = 120
    for cell in readme["B"]:
        cell.alignment = Alignment(wrap_text=True, vertical="top")

    sheet = workbook.create_sheet("Skill to ESCO links")
    headers = list(dict.fromkeys(key for row in rows for key in row))
    sheet.append(headers)
    for row in rows:
        sheet.append([row.get(header, "") for header in headers])
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    sheet.freeze_panes = "C2"
    sheet.auto_filter.ref = sheet.dimensions
    widths = {"skill_name": 30, "current_esco_label": 34, "reason": 46, "type_flag": 22, "skill_category": 30,
              "candidate_1": 32, "candidate_2": 32, "candidate_3": 32, "reviewer_notes": 40}
    decision_fill = PatternFill("solid", fgColor="DDEBF7")
    fills = {"replace": PatternFill("solid", fgColor="FBE5D6"), "check": PatternFill("solid", fgColor="FFF2CC"),
             "keep": PatternFill("solid", fgColor="E2F0D9")}
    for index, header in enumerate(headers, start=1):
        letter = sheet.cell(row=1, column=index).column_letter
        sheet.column_dimensions[letter].width = widths.get(header, min(max(len(header) + 2, 12), 30))
        if header in {"decision", "final_esco_uri", "reviewer_notes"}:
            for cell in sheet[letter][1:]:
                cell.fill = decision_fill
    validation = DataValidation(type="list", formula1='"' + ",".join(DECISIONS) + '"', allow_blank=True)
    sheet.add_data_validation(validation)
    letter = sheet.cell(row=1, column=headers.index("decision") + 1).column_letter
    validation.add(f"{letter}2:{letter}{len(rows) + 1}")
    action_column = headers.index("recommended_action") + 1
    for row_number in range(2, len(rows) + 2):
        fill = fills.get(sheet.cell(row=row_number, column=action_column).value)
        if fill:
            for cell in sheet[row_number]:
                if cell.fill != decision_fill:
                    cell.fill = fill
    workbook.save(path)


def _model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


def build(args: argparse.Namespace) -> int:
    from openpyxl import load_workbook

    rows = _sheet_rows(load_workbook(args.workbook, data_only=True), "Skill to ESCO links")
    esco = EscoIndex(_model())
    reference = _read_reference_rows()
    by_id = {row["skill_id"]: row for row in rows}
    problems, changed, unlinked = [], 0, 0
    link_rows = []
    for skill in reference:
        row = by_id.get(skill["skill_id"])
        if not row:
            continue
        decision = row.get("decision", "")
        target = {
            "keep": skill.get("esco_skill_uri", "").strip(),
            "use_1": row.get("candidate_1_uri", ""),
            "use_2": row.get("candidate_2_uri", ""),
            "use_3": row.get("candidate_3_uri", ""),
            "use_uri": row.get("final_esco_uri", "").strip(),
            "unlink": "",
        }.get(decision)
        if not decision:
            continue
        if decision == "unlink":
            for column in ESCO_COLUMNS:
                skill[column] = ""
            skill["mapping_status"] = "kareerly_local"
            unlinked += 1
            continue
        if not target or target not in esco.skills:
            problems.append(f"{skill['skill_id']}: decision '{decision}' has no usable ESCO URI")
            continue
        candidate = esco.skills[target]
        if target != skill.get("esco_skill_uri", "").strip():
            changed += 1
        for column, source in ESCO_COLUMNS.items():
            skill[column] = candidate[source].replace("\n", ";") if source == "alt_labels" else candidate[source]
        skill["esco_version"] = "v1.2.1"
        skill["mapping_status"] = "reviewed"
        skill["mapping_confidence"] = str(row.get(f"candidate_{decision[-1]}_similarity", row.get("current_similarity", "")))
        link_rows.append({
            "skill_id": skill["skill_id"],
            "skill_uri": target,
            "method": "manual",
            "evidence": f"skill_esco_link_review: '{skill['skill_name']}' reviewed against ESCO '{candidate['preferred_label']}'",
            "confidence": skill["mapping_confidence"],
            "review_status": "reviewed",
        })
    if problems:
        print("! fix these rows first:\n  " + "\n  ".join(problems))
        return 1

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    reference_path = out_dir / f"{dt.date.today().isoformat()}_skills_reference.csv"
    with reference_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(reference[0]))
        writer.writeheader()
        writer.writerows(reference)
    links_path = out_dir / f"{dt.date.today().isoformat()}_skill_esco_links_reviewed.csv"
    with links_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["skill_id", "skill_uri", "method", "evidence", "confidence", "review_status"])
        writer.writeheader()
        writer.writerows(link_rows)
    print(f"reviewed links: {len(link_rows)} (changed {changed}, unlinked {unlinked})")
    print(f"wrote {reference_path}\nwrote {links_path}")
    print("Apply with: cp <skills_reference.csv> data/skills_reference.csv, then load the links CSV with scripts/load_reference_data.py")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    propose_parser = commands.add_parser("propose", help="write the review workbook")
    propose_parser.add_argument("--out", type=Path, default=None)
    build_parser = commands.add_parser("build", help="turn decisions into an updated taxonomy and link rows")
    build_parser.add_argument("--workbook", type=Path, required=True)
    build_parser.add_argument("--out-dir", type=Path, default=REVIEW_DIR)
    args = parser.parse_args(argv)
    if not ESCO_SKILLS_CSV.exists():
        raise SystemExit(f"! {ESCO_SKILLS_CSV} not found; run scripts/import_reference_data.py esco first.")
    return propose(args) if args.command == "propose" else build(args)


if __name__ == "__main__":
    raise SystemExit(main())
