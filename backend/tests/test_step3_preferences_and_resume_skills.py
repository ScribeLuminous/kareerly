"""Step 3 preferences and resume skill evidence, end to end.

* An unrestricted answer (job level or salary "I'm not sure", work setup
  "Flexible - no preference") neither filters jobs out nor lowers a job's
  preference alignment; the report rests on the career area and the resume.
* A skill named in an uploaded PDF or DOCX resume is extracted in Step 1 and is
  never reported as a skill gap, including skills in DOCX tables and PDF words
  split by ligatures, soft hyphens or hyphenated line breaks.
"""
import io
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from backend.app.services import matching_service as matching
from backend.app.services.resume_analyzer import analyze_resume_file
from backend.app.services.resume_parser import extract_text_from_docx, extract_text_from_pdf, normalize_extracted_text
from backend.app.services.skill_extractor import SkillExtractor

AREA = "sales-marketing-customer-service"
UNRESTRICTED_LEVEL = {"role_level": "unsure", "target_role": "unsure", "role": "unsure"}
UNRESTRICTED_SETUP = {"work_setup": "flexible"}
UNRESTRICTED_SALARY = {"salary_expectation": "unsure"}
# The dashboard saves labels instead of option values.
UNRESTRICTED_LABELS = {"role_level": "I'm not sure", "target_role": "I'm not sure",
    "work_setup": "Flexible - no preference", "salary_expectation": "I’m not sure"}
# Answers that exclude every job below.
MISMATCHED_LEVEL = {"role_level": "senior", "target_role": "senior", "role": "senior"}
MISMATCHED_SETUP = {"work_setup": "remote"}
MISMATCHED_SALARY = {"salary_expectation": "50+"}


def job(job_id, title, category_id, category, required_ids, level="Entry Level", setup="Onsite",
        salary="PHP 18,000 - 25,000"):
    return dict(
        job_id=job_id, category_id=category_id, job_category=category, job_subcategory="", job_title=title,
        job_description=title, required_skills_comma_separated="", mapped_required_skill_names="",
        required_skill_ids=required_ids, must_have_skill_ids=required_ids, experience_level_required=level,
        location="Metro Manila", work_type=setup, salary_range_monthly_php=salary, job_text_for_matching="",
    )


JOBS = pd.DataFrame([
    job("support", "Customer Support Associate", "K09", "Customer Service and Retail", "SK029;SK644"),
    job("sales-ops", "Sales Operations Assistant", "K07", "Sales and Purchasing", "SK643;SK629"),
    job("crm", "CRM Coordinator", "K07", "Sales and Purchasing", "SK642;SK651;SK021"),
    job("site", "Site Engineer", "K17", "Construction and Skilled Trades", "SK070;SK680"),
])
SEMANTIC = np.asarray([0.45, 0.40, 0.35, 0.25])
RESUME = ("Customer support specialist. Skills: customer service, Zendesk, Salesforce, Microsoft Excel. "
          "Experience: Support Agent, Example Co, 2021 - Present, resolved tickets in Zendesk.")
CONFIRMED = [{"skill_id": "SK029", "skill_name": "Customer Service"}]


def report(preferences, resume=RESUME, confirmed=CONFIRMED):
    with patch.object(matching, "load_internal_jobs_dataframe", return_value=JOBS), \
         patch.object(matching, "score_jobs", return_value=SEMANTIC), \
         patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
         patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
        return matching.match_text_to_jobs(resume, confirmed_skills=confirmed, preferences=preferences)


def recommended(result):
    return [(item["job_id"], item["match_type"], item["match_score"], item["preference_alignment"])
            for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]]


class UnrestrictedPreferenceTests(unittest.TestCase):
    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)

    def test_each_unrestricted_field_leaves_alignment_to_the_career_area(self):
        in_area, other_area = JOBS.iloc[0].to_dict(), JOBS.iloc[3].to_dict()
        area_only = {"industry": AREA}
        self.assertEqual(matching.compute_preference_alignment(in_area, area_only), 1.0)
        for name, open_field, restricted_field in [
            ("job level", UNRESTRICTED_LEVEL, MISMATCHED_LEVEL),
            ("salary", UNRESTRICTED_SALARY, MISMATCHED_SALARY),
            ("work setup", UNRESTRICTED_SETUP, MISMATCHED_SETUP),
        ]:
            with self.subTest(name):
                # Unrestricted: the job keeps full alignment in the chosen area ...
                self.assertEqual(matching.compute_preference_alignment(in_area, {**area_only, **open_field}), 1.0)
                # ... and the field does not lift a job outside it either.
                self.assertEqual(matching.compute_preference_alignment(other_area, {**area_only, **open_field}), 0.0)
                # A real answer that the job does not meet lowers alignment.
                self.assertLess(matching.compute_preference_alignment(in_area, {**area_only, **restricted_field}), 1.0)

    def test_labels_and_spellings_of_unrestricted_answers(self):
        for value in ["unsure", "I'm not sure", "I’m not sure", "Not sure", "flexible", "Flexible - no preference",
                      "No preference", "Any", ""]:
            self.assertTrue(matching.is_unrestricted_preference(value), value)
        for value in ["entry", "remote", "hybrid", "onsite", "15-35", "PHP 50,001 - more"]:
            self.assertFalse(matching.is_unrestricted_preference(value), value)

    def test_unrestricted_fields_neither_filter_nor_penalize_any_job(self):
        area_only = recommended(report({"industry": AREA}))
        # Every sales and customer service job is recommended; the construction job is not.
        self.assertEqual({job_id for job_id, *_ in area_only}, {"support", "sales-ops", "crm"})
        for name, open_fields in [
            ("job level", UNRESTRICTED_LEVEL), ("salary", UNRESTRICTED_SALARY), ("work setup", UNRESTRICTED_SETUP),
            ("all three", {**UNRESTRICTED_LEVEL, **UNRESTRICTED_SALARY, **UNRESTRICTED_SETUP}),
            ("all three as labels", UNRESTRICTED_LABELS),
        ]:
            with self.subTest(name):
                result = report({"industry": AREA, **open_fields})
                # Same jobs, same categories, same scores, same order as choosing only the area.
                self.assertEqual(recommended(result), area_only)
        result = report({"industry": AREA, **UNRESTRICTED_LEVEL, **UNRESTRICTED_SALARY, **UNRESTRICTED_SETUP})
        self.assertEqual(result["debug_summary"]["unrestricted_preferences"],
            ["role_level", "work_setup", "salary_expectation"])
        # Stated answers the jobs do not meet never remove a job; they lower its
        # alignment, and the job says which answers it does not fit.
        restricted = report({"industry": AREA, **MISMATCHED_LEVEL, **MISMATCHED_SALARY, **MISMATCHED_SETUP})
        self.assertEqual({job_id for job_id, *_ in recommended(restricted)}, {"support", "sales-ops", "crm"})
        self.assertTrue(all(alignment < 1.0 for *_, alignment in recommended(restricted)))
        crm = restricted["all_aspiration_matches"][0]
        self.assertEqual(crm["preference_conflicts"], ["job_level", "work_setup", "salary"])
        self.assertIn("It differs from your Step 3 choices", crm["explanation"])
        self.assertIn("(you chose remote)", crm["explanation"])
        self.assertEqual(restricted["debug_summary"]["unrestricted_preferences"], [])

    def test_jobs_that_fit_the_other_answers_come_first(self):
        jobs = pd.DataFrame([
            job("onsite", "CRM Coordinator", "K07", "Sales and Purchasing", "SK642;SK651", setup="Onsite"),
            job("remote", "CRM Associate", "K07", "Sales and Purchasing", "SK642;SK651", setup="Remote"),
            # A Fit-Now job, so neither CRM job is listed as the closest Fit-Now.
            JOBS.iloc[0].to_dict(),
        ])
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=jobs), \
             patch.object(matching, "score_jobs", return_value=np.asarray([0.40, 0.30, 0.45])), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            result = matching.match_text_to_jobs(RESUME, confirmed_skills=CONFIRMED,
                preferences={"industry": AREA, "work_setup": "remote"})
        # Both stay; the remote job leads although the resume is closer to the other.
        self.assertEqual([item["job_id"] for item in result["all_aspiration_matches"]], ["remote", "onsite"])
        onsite = result["all_aspiration_matches"][1]
        self.assertEqual(onsite["preference_conflicts"], ["work_setup"])
        self.assertEqual(onsite["preference_mismatch_notes"], ["work setup Onsite (you chose remote)"])

    def test_unstated_job_fields_and_open_answers_never_conflict(self):
        job_row = JOBS.iloc[2].to_dict() | {"experience_level_required": "", "work_type": "", "salary_range_monthly_php": ""}
        self.assertEqual(matching.preference_conflicts(job_row, {**MISMATCHED_LEVEL, **MISMATCHED_SETUP, **MISMATCHED_SALARY}), [])
        self.assertEqual(matching.preference_conflicts(JOBS.iloc[2].to_dict(),
            {**UNRESTRICTED_LEVEL, **UNRESTRICTED_SETUP, **UNRESTRICTED_SALARY}), [])
        self.assertEqual(matching.preference_conflicts(JOBS.iloc[2].to_dict(),
            {"role_level": "entry", "work_setup": "onsite", "salary_expectation": "15-35"}), [])

    def test_career_area_decides_aspiration_and_the_resume_decides_fit_now(self):
        open_fields = {**UNRESTRICTED_LEVEL, **UNRESTRICTED_SALARY, **UNRESTRICTED_SETUP}
        sales_report = report({"industry": AREA, **open_fields})
        construction = report({"industry": "construction-maintenance", **open_fields})
        # The resume already covers these two, so they are Fit-Now under any area.
        for result in (sales_report, construction):
            self.assertEqual({item["job_id"] for item in result["all_fit_now_matches"]}, {"support", "sales-ops"})
        # Aspiration follows the chosen area, whether or not the resume shares its skills.
        self.assertEqual([item["job_id"] for item in sales_report["all_aspiration_matches"]], ["crm"])
        self.assertEqual([item["job_id"] for item in construction["all_aspiration_matches"]], ["site"])
        crm = sales_report["all_aspiration_matches"][0]
        self.assertTrue(crm["in_preferred_career_area"])
        # The resume is compared with it: the skills still to build.
        self.assertEqual(crm["missing_skills"], ["HubSpot", "Invoicing and Billing", "Project Coordination"])

    def test_salary_ranges_with_thousands_separators(self):
        self.assertEqual(matching._salary_range("php 60,000 - 80,000"), (60000.0, 80000.0))
        self.assertEqual(matching._salary_range("php 15,000 - php 35,000/month"), (15000.0, 35000.0))
        well_paid = {**JOBS.iloc[0].to_dict(), "salary_range_monthly_php": "PHP 60,000 - 80,000"}
        self.assertEqual(matching.compute_preference_alignment(well_paid, {"salary_expectation": "15-35"}), 0.0)
        self.assertEqual(matching.compute_preference_alignment(well_paid, {"salary_expectation": "PHP 50,001 - more"}), 1.0)


# ---------------------------------------------------------------------------
# Resume documents
# ---------------------------------------------------------------------------

LIGATURE_FFI = "\x01"  # drawn as one glyph whose ToUnicode entry is U+FB03 "ffi"


def text_pdf(lines):
    """A one-page PDF with a real text layer, one line per entry.

    Byte 0x01 is mapped to the "ffi" ligature by the font's ToUnicode CMap, as
    Word and LaTeX do for "Office". An empty list gives a page with no text
    layer, like a scanned resume.
    """
    def escape(value):
        return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    content = "BT /F1 11 Tf 14 TL 72 760 Td " + " ".join(f"({escape(line)}) Tj T*" for line in lines) + " ET"
    content = content.encode("latin-1") if lines else b""
    cmap = (b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Custom def "
            b"1 begincodespacerange <00> <FF> endcodespacerange "
            b"1 beginbfchar <01> <FB03> endbfchar "
            b"1 beginbfrange <20> <7E> <0020> endbfrange "
            b"endcmap CMapName currentdict /CMap defineresource pop end end")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>",
    ]
    streams = [zlib.compress(content), zlib.compress(cmap)]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects + streams, start=1):
        offsets.append(out.tell())
        if number > len(objects):
            out.write(f"{number} 0 obj << /Length {len(body)} /Filter /FlateDecode >> stream\n".encode())
            out.write(body + b"\nendstream endobj\n")
        else:
            out.write(f"{number} 0 obj ".encode() + body + b" endobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(offsets) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer << /Size {len(offsets) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def non_breaking_hyphen_paragraph(document, before, after):
    paragraph = document.add_paragraph()
    paragraph.add_run(before)
    paragraph.add_run()._r.append(OxmlElement("w:noBreakHyphen"))
    paragraph.add_run(after)


def table_docx():
    """Skills only inside table cells (one nested), as two-column resume templates do."""
    document = Document()
    document.add_paragraph("Jamie Cruz")
    document.add_paragraph("Customer support specialist with five years of experience in busy support teams.")
    document.add_paragraph("SKILLS")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Zendesk"
    table.cell(0, 1).text = "Salesforce"
    table.cell(1, 0).text = "Python"
    nested = table.cell(1, 1).add_table(rows=1, cols=1)
    nested.cell(0, 0).text = "Microsoft Excel"
    non_breaking_hyphen_paragraph(document, "Managed E", "commerce order tracking")
    document.add_paragraph("EXPERIENCE")
    document.add_paragraph("Support Agent | Example Co | 2021 - Present")
    document.sections[0].footer.paragraphs[0].text = "Tools: HubSpot"
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


PDF_LINES = [
    "Jamie Cruz",
    "Customer support specialist with five years of experience in busy support teams.",
    "SKILLS",
    f"Microsoft O{LIGATURE_FFI}ce, Zendesk, Sales-",
    "force, Python, Quick-",
    "books and Microsoft",
    "Excel",
    "EXPERIENCE",
    "Support Agent | Example Co | 2021 - Present",
]


def analyze_bytes(data, suffix):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / f"resume.{suffix}"
        path.write_bytes(data)
        return analyze_resume_file(str(path), SkillExtractor())


class ResumeDocumentSkillTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.docx = analyze_bytes(table_docx(), "docx")
        cls.pdf = analyze_bytes(text_pdf(PDF_LINES), "pdf")

    @staticmethod
    def gaps(analysis, required_ids, confirmed_ids=()):
        text = analysis["normalized_for_matching"]["resume_text_for_matching"]
        return matching.compute_skill_coverage(list(confirmed_ids), required_ids, text)

    def test_pdf_text_layer_is_repaired(self):
        text = extract_text_from_pdf(io.BytesIO(text_pdf(PDF_LINES)))
        self.assertIn("Microsoft Office", text)
        self.assertIn("Salesforce", text)
        self.assertIn("Quickbooks", text)
        self.assertNotIn("ﬃ", text)

    def test_docx_reads_tables_nested_tables_hyphens_and_footer(self):
        text = extract_text_from_docx(io.BytesIO(table_docx()))
        for expected in ["Zendesk", "Salesforce", "Python", "Microsoft Excel", "Managed E-commerce", "Tools: HubSpot"]:
            self.assertIn(expected, text)

    def test_skills_in_each_format_are_extracted(self):
        for name, analysis, expected in [
            ("docx", self.docx, {"Zendesk", "Salesforce", "Python Programming", "Microsoft Excel", "HubSpot"}),
            ("pdf", self.pdf, {"Microsoft Office", "Zendesk", "Salesforce", "Python Programming", "QuickBooks",
                               "Microsoft Excel"}),
        ]:
            with self.subTest(name):
                self.assertLessEqual(expected, set(analysis["normalized_for_matching"]["skill_names"]))

    def test_a_skill_named_in_the_resume_is_never_a_gap(self):
        # SK644 Zendesk, SK643 Salesforce, SK001 Python Programming, SK629 Microsoft Excel.
        required = ["SK644", "SK643", "SK001", "SK629"]
        for name, analysis in [("docx", self.docx), ("pdf", self.pdf)]:
            with self.subTest(name):
                # Held when confirmed in Step 2 ...
                confirmed = analysis["normalized_for_matching"]["skill_ids"]
                self.assertEqual(self.gaps(analysis, required, confirmed)["missing_skills"], [])
                # ... and when not confirmed (outside the twenty, or removed): the resume names it.
                self.assertEqual(self.gaps(analysis, required)["missing_skills"], [])
        self.assertEqual(self.gaps(self.pdf, ["SK628", "SK652"])["missing_skills"], [])
        self.assertEqual(self.gaps(self.docx, ["SK642"])["missing_skills"], [])
        # A skill the resume does not name is still a gap.
        self.assertEqual(self.gaps(self.pdf, ["SK680"])["missing_skills"], ["AutoCAD"])

    def test_skill_gaps_in_a_report_from_each_format(self):
        open_fields = {**UNRESTRICTED_LEVEL, **UNRESTRICTED_SALARY, **UNRESTRICTED_SETUP}
        for name, analysis in [("docx", self.docx), ("pdf", self.pdf)]:
            with self.subTest(name):
                result = report({"industry": AREA, **open_fields},
                    resume=analysis["normalized_for_matching"]["resume_text_for_matching"])
                jobs = {item["job_id"]: item for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]}
                self.assertEqual(jobs["sales-ops"]["missing_skills"], [])
                gap_names = {gap["skill_name"] for gap in result["prioritized_skill_gaps"]}
                self.assertFalse(gap_names & {"Zendesk", "Salesforce", "Microsoft Excel"}, gap_names)

    def test_image_only_pdf_is_reported_unreadable_not_guessed(self):
        # No text layer and no OCR: nothing is extracted and the candidate is warned.
        analysis = analyze_bytes(text_pdf([]), "pdf")
        self.assertEqual(analysis["candidate_profile"]["skills"], [])
        self.assertEqual(analysis["status"], "warning")
        self.assertTrue(any("scanned" in warning for warning in analysis["warnings"]))


class ProgrammingLanguageEvidenceTests(unittest.TestCase):
    def test_language_names_show_reviewed_language_skills(self):
        for text, skill_id in [("Python", "SK001"), ("JavaScript", "SK002"), ("Java", "SK133")]:
            with self.subTest(text):
                self.assertEqual(matching.compute_skill_coverage([], [skill_id], f"Skills: {text}")["missing_skills"], [])
        # Java is not JavaScript, and everyday words do not name auto-generated language rows.
        self.assertEqual(matching.compute_skill_coverage([], ["SK133"], "Skills: JavaScript")["missing_skills"],
            ["Java (computer programming)"])
        everyday = "Built the tracker from scratch and kept the assembly line running with swift turnaround."
        self.assertEqual(len(matching.compute_skill_coverage([], ["SK175", "SK150", "SK148"], everyday)["missing_skills"]), 3)

    def test_data_entry_shows_data_encoding(self):
        self.assertEqual(matching.compute_skill_coverage([], ["SK017"], "Handled data entry for invoices.")["missing_skills"], [])


class NormalizeExtractedTextTests(unittest.TestCase):
    def test_layout_artifacts(self):
        self.assertEqual(normalize_extracted_text("Microsoft Oﬃce, Workﬂow"), "Microsoft Office, Workflow")
        self.assertEqual(normalize_extracted_text("Sales­force, Zen​desk"), "Salesforce, Zendesk")
        self.assertEqual(normalize_extracted_text("Sales-\nforce"), "Salesforce")
        self.assertEqual(normalize_extracted_text("Sales­\nforce"), "Salesforce")
        # Ranges and capitalised continuations keep their hyphen and line break.
        self.assertEqual(normalize_extracted_text("2021 -\nPresent"), "2021 -\nPresent")
        self.assertEqual(normalize_extracted_text("Jan-\nMar"), "Jan-\nMar")


if __name__ == "__main__":
    unittest.main()
