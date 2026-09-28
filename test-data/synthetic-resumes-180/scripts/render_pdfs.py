"""Render the 180 synthetic resumes to PDF and write the manifests.

Reads generation_matrix.json and content/<candidate_id>.json, draws the blocks
from layouts.py with a visual style per layout variant, and writes:

    controlled/category-NN/CATNN-RNN.pdf
    stress-tests/STRESS-NNN.pdf
    manifest.json, manifest.csv

PDF properties carry only Title ("<name> — Resume") and Author (the name);
Subject and Keywords stay empty and no XMP is written. ReportLab runs in
invariant mode, so the same inputs, ReportLab version and font files give
byte-identical PDFs.

Requires reportlab (see scripts/requirements.txt) and the DejaVu Sans fonts,
which render "ñ" and other Filipino names exactly.

Usage: python render_pdfs.py [--only CAT01 STRESS]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab import rl_config

rl_config.invariant = 1

from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4, LETTER  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402
from reportlab.pdfbase.ttfonts import TTFont  # noqa: E402
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer  # noqa: E402

HERE = Path(__file__).resolve().parent
DATASET_DIR = HERE.parent
sys.path.insert(0, str(HERE))

import layouts  # noqa: E402

FONT_DIRS = [Path("/usr/share/fonts/truetype/dejavu"), Path("/usr/share/fonts/dejavu"), HERE / "fonts"]
FONTS = {"Body": "DejaVuSans.ttf", "Bold": "DejaVuSans-Bold.ttf"}

# Visual style per layout: page, margins, sizes, accent colour, heading style.
STYLES = {
    "classic_summary_first": dict(page=A4, margin=18, body=9.6, name=18, accent="#1f3b5c", heading="rule"),
    "skills_first": dict(page=A4, margin=16, body=9.4, name=17, accent="#2e5e4e", heading="plain"),
    "education_first_graduate": dict(page=A4, margin=20, body=10, name=19, accent="#5a3e85", heading="rule"),
    "project_heavy": dict(page=LETTER, margin=17, body=9.4, name=18, accent="#8a4b12", heading="caps"),
    "certification_focus": dict(page=A4, margin=18, body=9.5, name=18, accent="#0e5a8a", heading="rule"),
    "compact_one_page": dict(page=A4, margin=12, body=8.6, name=15, accent="#333333", heading="caps"),
    "experienced_professional": dict(page=LETTER, margin=19, body=9.8, name=20, accent="#243447", heading="rule"),
    "experience_first": dict(page=A4, margin=17, body=9.5, name=17, accent="#6b2737", heading="plain"),
    "bullet_heavy": dict(page=LETTER, margin=16, body=9.3, name=17, accent="#3d5a1e", heading="caps"),
    "mixed_paragraph": dict(page=A4, margin=19, body=9.8, name=18, accent="#4a4a7a", heading="plain"),
}


def register_fonts() -> None:
    for alias, filename in FONTS.items():
        for folder in FONT_DIRS:
            path = folder / filename
            if path.exists():
                pdfmetrics.registerFont(TTFont(alias, str(path)))
                break
        else:
            raise SystemExit(f"font {filename} not found in {', '.join(map(str, FONT_DIRS))}")


def paragraph_styles(variant: str) -> dict[str, ParagraphStyle]:
    s = STYLES[variant]
    accent = colors.HexColor(s["accent"])
    body = s["body"]
    return {
        "name": ParagraphStyle("name", fontName="Bold", fontSize=s["name"], leading=s["name"] * 1.2, textColor=accent),
        "headline": ParagraphStyle("headline", fontName="Body", fontSize=body + 1.5, leading=(body + 1.5) * 1.3,
                                   textColor=colors.HexColor("#444444")),
        "contact": ParagraphStyle("contact", fontName="Body", fontSize=body - 0.5, leading=(body - 0.5) * 1.35,
                                  textColor=colors.HexColor("#333333")),
        "heading": ParagraphStyle("heading", fontName="Bold", fontSize=body + 2, leading=(body + 2) * 1.3,
                                  textColor=accent, spaceBefore=body * 0.9, spaceAfter=body * 0.25),
        "entry": ParagraphStyle("entry", fontName="Bold", fontSize=body, leading=body * 1.35, spaceBefore=body * 0.45),
        "meta": ParagraphStyle("meta", fontName="Body", fontSize=body - 0.6, leading=(body - 0.6) * 1.35,
                               textColor=colors.HexColor("#555555")),
        "para": ParagraphStyle("para", fontName="Body", fontSize=body, leading=body * 1.4, spaceAfter=body * 0.2),
        "line": ParagraphStyle("line", fontName="Body", fontSize=body, leading=body * 1.4),
        "bullet": ParagraphStyle("bullet", fontName="Body", fontSize=body, leading=body * 1.38, leftIndent=12,
                                 bulletIndent=3, bulletFontName="Body"),
    }


def flowables(content: dict, variant: str) -> list:
    styles = paragraph_styles(variant)
    heading_mode = STYLES[variant]["heading"]
    accent = colors.HexColor(STYLES[variant]["accent"])
    out = []
    for kind, text in layouts.blocks(content, variant):
        safe = escape(text)
        if kind == "heading":
            label = safe.upper() if heading_mode == "caps" else safe
            out.append(Paragraph(label, styles["heading"]))
            if heading_mode == "rule":
                out.append(HRFlowable(width="100%", thickness=0.6, color=accent, spaceBefore=0, spaceAfter=3))
        elif kind == "bullet":
            out.append(Paragraph(safe, styles["bullet"], bulletText="•"))
        elif kind == "name":
            out.append(Paragraph(safe, styles["name"]))
        else:
            out.append(Paragraph(safe, styles[kind]))
        if kind == "contact" and layouts.LAYOUTS[variant]["contact"] == "one_line":
            out.append(Spacer(1, 2))
    return out


def render(content: dict, variant: str) -> bytes:
    s = STYLES[variant]
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=s["page"],
        leftMargin=s["margin"] * mm, rightMargin=s["margin"] * mm,
        topMargin=s["margin"] * mm, bottomMargin=s["margin"] * mm,
        title=f"{content['full_name']} — Resume", author=content["full_name"],
        subject="", keywords="", creator="",
    )
    doc.build(flowables(content, variant))
    return buffer.getvalue()


def resume_path(row: dict) -> str:
    cid = row["candidate_id"]
    if row["dataset_group"] == "controlled":
        return f"controlled/category-{cid[3:5]}/{cid}.pdf"
    return f"stress-tests/{cid}.pdf"


# ---------------------------------------------------------------- manifest

MANIFEST_FIELDS = [
    "candidate_id", "resume_filename", "dataset_group", "target_skill_category", "target_skill_category_id",
    "profile_variant", "experience_level", "experience_years", "city", "province", "region_code", "region_name",
    "primary_role", "primary_skills", "supporting_skills", "adjacent_skills", "intentionally_missing_skills",
    "education_level", "resume_template_variant",
    "primary_category", "secondary_categories", "overlap_skills", "category_specific_missing_skills",
    "stress_test_reason",
]
LIST_FIELDS = {"primary_skills", "supporting_skills", "adjacent_skills", "intentionally_missing_skills",
               "secondary_categories", "overlap_skills", "category_specific_missing_skills"}


def manifest_rows(matrix: list[dict]) -> list[dict]:
    rows = []
    for r in sorted(matrix, key=lambda x: x["candidate_id"]):
        stress = r["dataset_group"] == "cross_category_stress"
        rows.append({
            "candidate_id": r["candidate_id"],
            "resume_filename": resume_path(r),
            "dataset_group": r["dataset_group"],
            "target_skill_category": r["primary_category"] if stress else r["target_category"],
            "target_skill_category_id": r["target_category_id"],
            "profile_variant": r["profile_variant"],
            "experience_level": r["experience_level"],
            "experience_years": r["experience_years"],
            "city": r["city"], "province": r["province"],
            "region_code": r["region_code"], "region_name": r["region_name"],
            "primary_role": r["primary_role"],
            "primary_skills": r["core_skills"],
            "supporting_skills": r["supporting_skills"],
            "adjacent_skills": r["adjacent_skills"],
            "intentionally_missing_skills": r["category_specific_missing_skills"] if stress else r["intentionally_missing_skills"],
            "education_level": r["education_level"],
            "resume_template_variant": r["resume_template_variant"],
            "primary_category": r["primary_category"],
            "secondary_categories": r["secondary_categories"],
            "overlap_skills": r["overlap_skills"],
            "category_specific_missing_skills": r["category_specific_missing_skills"],
            "stress_test_reason": r["stress_test_reason"],
        })
    return rows


def write_manifests(rows: list[dict]) -> None:
    (DATASET_DIR / "manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=MANIFEST_FIELDS, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: ("" if row[k] is None else "|".join(row[k]) if k in LIST_FIELDS else row[k])
                         for k in MANIFEST_FIELDS})
    (DATASET_DIR / "manifest.csv").write_text(buffer.getvalue(), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", nargs="*", help="candidate ID prefixes")
    args = parser.parse_args()
    register_fonts()
    matrix = json.loads((DATASET_DIR / "generation_matrix.json").read_text(encoding="utf-8"))["candidates"]
    count = 0
    for row in matrix:
        cid = row["candidate_id"]
        if args.only and not any(cid.startswith(o) for o in args.only):
            continue
        content = json.loads((DATASET_DIR / "content" / f"{cid}.json").read_text(encoding="utf-8"))
        target = DATASET_DIR / resume_path(row)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(render(content, row["resume_template_variant"]))
        count += 1
    write_manifests(manifest_rows(matrix))
    print(f"rendered {count} PDFs; wrote manifest.json and manifest.csv ({len(matrix)} records)")


if __name__ == "__main__":
    main()
