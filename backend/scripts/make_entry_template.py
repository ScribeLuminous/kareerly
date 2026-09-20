"""Build the workbook for listing new jobs and certifications by hand.

One sheet per table (public.internal_jobs, public.learning_resources) with the
columns those tables expect, dropdowns for the fixed values, and lookup sheets
for skill IDs and PSOC occupations, so a row can be pasted straight into
Supabase or loaded by a script.

    python3 scripts/make_entry_template.py
    python3 scripts/make_entry_template.py --out data/entry/kareerly_entry_template.xlsx

Regenerate it whenever the taxonomy changes: the lookup sheets are built from
data/skills_reference.csv and the imported PSOC groups.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

SKILLS_REFERENCE = BACKEND_DIR / "data" / "skills_reference.csv"
PSOC_GROUPS = BACKEND_DIR / "data" / "corpus" / "reference" / "import" / "psoc_groups.csv"
OUT_DEFAULT = BACKEND_DIR / "data" / "entry" / "kareerly_entry_template.xlsx"

# (column, required, help, dropdown values)
JOB_COLUMNS = [
    ("job_id", True, "Unique code you choose, e.g. KJ-0112. Must not already exist.", None),
    ("job_title", True, "As advertised, e.g. Executive Assistant.", None),
    ("company_name", False, "Employer name.", None),
    ("category_code", True, "Kareerly category code; pick from the list.", "categories"),
    ("category_name", True, "Must match the code you picked.", "category_names"),
    ("job_subcategory", False, "Optional finer grouping.", None),
    ("psoc_unit_code", False, "PSOC 2012 unit group (4 digits) from the PSOC sheet. Not stored yet; kept for the occupation work.", None),
    ("location", False, "City and region, e.g. Cebu City, Central Visayas. Use 'Remote' for fully remote.", None),
    ("work_setup", True, "", ("Remote", "Hybrid", "Onsite")),
    ("employment_type", True, "", ("Full-Time", "Part-Time", "Contract", "Internship", "Project-Based")),
    ("job_level", True, "", ("Entry level", "Junior (1-2 Yrs)", "Mid", "Senior", "Manager")),
    ("salary_min_php", False, "Monthly, numbers only, e.g. 25000. Leave blank if undisclosed.", None),
    ("salary_max_php", False, "Monthly, numbers only.", None),
    ("job_description", True, "What the role is. Plain text; the site splits out responsibilities.", None),
    ("responsibilities", False, "One per line.", None),
    ("required_skills", True, "Skill names as the ad words them, separated by semicolons.", None),
    ("preferred_skills", False, "Nice-to-have skills, semicolon separated.", None),
    ("must_have_skill_ids", True, "Kareerly skill IDs (SK...) for the required skills, semicolon separated. Use the Skills sheet; matching only counts these.", None),
    ("application_deadline", False, "YYYY-MM-DD, or blank.", None),
    ("source_platform", False, "Where it was found, e.g. JobStreet, company site.", None),
    ("source_url", False, "Link to the posting.", None),
    ("source_note", False, "Anything worth recording about the source.", None),
    ("posting_status", True, "", ("active", "closed", "draft")),
    ("is_synthetic_seed", True, "TRUE for made-up seed data, FALSE for a real posting. Keep honest: the thesis reports this.", ("TRUE", "FALSE")),
]

CERTIFICATION_COLUMNS = [
    ("resource_id", True, "Unique code you choose, e.g. LR-0421.", None),
    ("course_or_certification_title", True, "Official title.", None),
    ("course_or_certification_description", False, "One or two sentences.", None),
    ("offered_by_provider", True, "e.g. TESDA, Coursera, DICT, Google.", None),
    ("provider_type", False, "", ("government", "university", "industry", "platform", "ngo", "employer")),
    ("credential_type", True, "What the learner ends up holding.", ("exam_review", "professional_certificate", "industry_certification", "certificate_course", "course")),
    ("resource_type", False, "", ("course", "certification", "training", "review_class", "webinar")),
    ("level", False, "", ("beginner", "intermediate", "advanced")),
    ("recommended_experience", False, "Who it suits, e.g. no experience needed.", None),
    ("estimated_duration", False, "e.g. 6 weeks, 40 hours.", None),
    ("schedule", False, "e.g. self-paced, weekends.", None),
    ("delivery_mode", False, "", ("online", "onsite", "blended")),
    ("cost_type", False, "", ("free", "free_to_audit", "paid", "scholarship", "subsidised")),
    ("language", False, "e.g. English, Filipino.", None),
    ("skills_youll_gain", True, "Skill names, semicolon separated, as the provider words them.", None),
    ("skill_ids", True, "Kareerly skill IDs (SK...) those skills map to, semicolon separated. A gap is only closed by IDs listed here.", None),
    ("category_id", False, "Kareerly category code; pick from the list.", "categories"),
    ("category_name", False, "Must match the code you picked.", "category_names"),
    ("external_course_or_certification_link", True, "Direct link to the course or certification page.", None),
    ("status", True, "", ("active", "inactive")),
    ("notes", False, "Anything a reviewer should know, e.g. exam fee is separate.", None),
]

INSTRUCTIONS = [
    ("What this is", "A sheet for listing new jobs and certifications. Column names match the Supabase tables (internal_jobs, learning_resources), so filled rows can be imported as they are."),
    ("How to fill it", "One row per job or certification. Rows marked required must be filled. Grey cells are dropdowns, so pick from the list rather than typing."),
    ("Skill IDs", "must_have_skill_ids (jobs) and skill_ids (certifications) drive the whole system: a job only credits a candidate for skills listed by ID, and a certification only closes a gap for the IDs it lists. Find them on the Skills sheet (filter by name) and separate several with semicolons, e.g. SK029;SK276."),
    ("Skills that are missing", "If no Kareerly skill fits, leave the ID out, put the wording in required_skills or skills_youll_gain, and note it. Missing skills are added from ESCO in a separate review."),
    ("PSOC", "psoc_unit_code on the Jobs sheet is optional and not yet stored in the database. It is here so occupations can be attached later without re-typing the jobs."),
    ("Honesty", "is_synthetic_seed must be TRUE for invented rows. The thesis distinguishes real postings from seed data."),
    ("When you are done", "Send the file back and it can be checked (IDs exist, no duplicate job_id, required fields filled) before anything is written to Supabase."),
]


def _read(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def build(out: Path) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation

    skills = sorted(_read(SKILLS_REFERENCE), key=lambda row: row["skill_id"])
    psoc = [row for row in _read(PSOC_GROUPS) if row["level"] == "unit"]
    categories = sorted({(row["category_id"], row["skill_category"]) for row in skills if row.get("category_id")})

    workbook = Workbook()
    readme = workbook.active
    readme.title = "Read me"
    readme.append(["Topic", "Details"])
    for topic, details in INSTRUCTIONS:
        readme.append([topic, details])
    readme.append(["Generated", dt.date.today().isoformat()])
    readme.column_dimensions["A"].width = 24
    readme.column_dimensions["B"].width = 118
    for cell in readme["B"]:
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    for cell in readme["A"]:
        cell.font = Font(bold=True)

    lists = workbook.create_sheet("Lists")
    lists.append(["category_code", "category_name"])
    for code, name in categories:
        lists.append([code, name])
    lists.column_dimensions["A"].width = 16
    lists.column_dimensions["B"].width = 52
    named = {
        "categories": f"Lists!$A$2:$A${len(categories) + 1}",
        "category_names": f"Lists!$B$2:$B${len(categories) + 1}",
    }

    required_fill = PatternFill("solid", fgColor="FCE4D6")
    dropdown_fill = PatternFill("solid", fgColor="EDEDED")
    ROWS = 300

    def entry_sheet(title: str, columns):
        sheet = workbook.create_sheet(title)
        sheet.append([name for name, *_ in columns])
        sheet.append([("required" if required else "optional") + (f" - {help_text}" if help_text else "") for _, required, help_text, _ in columns])
        for index, (name, required, _, choices) in enumerate(columns, start=1):
            letter = get_column_letter(index)
            header, hint = sheet.cell(row=1, column=index), sheet.cell(row=2, column=index)
            header.font = Font(bold=True)
            hint.font = Font(italic=True, size=9, color="808080")
            hint.alignment = Alignment(wrap_text=True, vertical="top")
            sheet.column_dimensions[letter].width = 40 if name in {"job_description", "responsibilities", "course_or_certification_description"} else 26
            if required:
                header.fill = required_fill
            if choices:
                formula = named[choices] if isinstance(choices, str) else '"' + ",".join(choices) + '"'
                validation = DataValidation(type="list", formula1=formula, allow_blank=not required)
                sheet.add_data_validation(validation)
                validation.add(f"{letter}3:{letter}{ROWS}")
                for row_number in range(3, ROWS + 1):
                    sheet.cell(row=row_number, column=index).fill = dropdown_fill
        sheet.row_dimensions[2].height = 42
        sheet.freeze_panes = "B3"
        return sheet

    entry_sheet("Jobs", JOB_COLUMNS)
    entry_sheet("Certifications", CERTIFICATION_COLUMNS)

    skills_sheet = workbook.create_sheet("Skills")
    skills_sheet.append(["skill_id", "skill_name", "skill_category", "esco_label", "mapping_status"])
    for row in skills:
        skills_sheet.append([row["skill_id"], row["skill_name"], row.get("skill_category", ""),
                             row.get("esco_preferred_label", ""), row.get("mapping_status", "")])
    psoc_sheet = workbook.create_sheet("PSOC occupations")
    psoc_sheet.append(["psoc_code", "title", "description"])
    for row in psoc:
        psoc_sheet.append([row["psoc_code"], row["title"], row.get("description", "")[:300]])
    for sheet, widths in ((skills_sheet, (12, 40, 44, 40, 22)), (psoc_sheet, (12, 54, 80))):
        for index, width in enumerate(widths, start=1):
            sheet.column_dimensions[get_column_letter(index)].width = width
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions

    out.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(out)
    print(f"jobs columns: {len(JOB_COLUMNS)} | certification columns: {len(CERTIFICATION_COLUMNS)} | "
          f"skills listed: {len(skills)} | PSOC units listed: {len(psoc)}")
    print(f"wrote {out}")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=OUT_DEFAULT)
    build(parser.parse_args(argv).out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
