"""Regression tests for the Step 4 report listing skills the resume shows as gaps.

The synthetic resume below stands in for a real one: an assistant who handled
order fulfillment and live chat support. The Non-Voice job requires "Order
Processing" (sent by production jobs as the legacy ID SK_ORDER_PROCESSING),
Chat Support and Onboarding.
"""
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from docx import Document
from docx.oxml import parse_xml

from backend.app.services import matching_service as matching
from backend.app.services.resume_analyzer import analyze_resume_file
from backend.app.services.resume_parser import extract_text_from_docx, extract_text_from_pdf
from backend.app.services.skill_extractor import SkillExtractor

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
RESUME_LINES = [
    "Alex Example",
    "SUMMARY",
    "Virtual assistant with remote e-commerce and customer support experience.",
    "SKILLS",
    "Customer Service, Data Entry, Shopify, Zendesk",
    "WORK EXPERIENCE",
    "E-commerce Assistant, Sample Goods 2021 - Present",
    "Handled order fulfillment and refunds for an online store.",
    "Answered customer questions through live chat support.",
]


def job(job_id, title, required_ids, required_names, description="Support online store customers."):
    return dict(
        job_id=job_id, category_id="K09", job_category="Customer Service and Retail",
        job_subcategory="Customer Service", job_title=title, job_description=description,
        required_skills_comma_separated=required_names, mapped_required_skill_names=required_names,
        required_skill_ids=required_ids, must_have_skill_ids=required_ids, experience_level_required="Entry Level",
        location="Remote", work_type="Remote", salary_range_monthly_php="", job_text_for_matching="",
    )


JOBS = pd.DataFrame([
    job("non-voice", "Non-Voice Support Associate", "SK689;SK_ORDER_PROCESSING;SK_ONBOARDING",
        "Chat Support; Order Processing; Onboarding"),
    # No requirement the matcher can compare: it must claim no matched or missing skills.
    job("csr", "Customer Service Representative", "", "", "Handle customer inquiries by phone and email."),
])


def resume_docx(lines=RESUME_LINES, hide="Handled order fulfillment and refunds for an online store."):
    """A DOCX that keeps one line in a content control, as many templates do."""
    document = Document()
    for line in lines:
        if line == hide:
            control = parse_xml(
                f'<w:sdt xmlns:w="{W}"><w:sdtContent><w:p><w:r><w:t>{line}</w:t></w:r></w:p></w:sdtContent></w:sdt>'
            )
            document.element.body.insert(len(document.element.body) - 1, control)
        else:
            document.add_paragraph(line)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def text_pdf(lines):
    """A one-page PDF with a real text layer, written without a PDF library."""
    text = "\n".join(f"({line}) Tj T*" for line in lines)
    stream = f"BT /F1 11 Tf 14 TL 72 760 Td\n{text}\nET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(output)
    output += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    output += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    output += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(output)


class ResumeTextExtractionTests(unittest.TestCase):
    def test_docx_content_controls_nested_tables_text_boxes_and_headers_are_read(self):
        document = Document()
        document.sections[0].header.paragraphs[0].text = "Alex Example | Remote"
        document.add_paragraph("SUMMARY")
        control = parse_xml(
            f'<w:sdt xmlns:w="{W}"><w:sdtContent><w:p><w:r><w:t>Handled order fulfillment.</w:t></w:r></w:p>'
            "</w:sdtContent></w:sdt>"
        )
        document.element.body.insert(len(document.element.body) - 1, control)
        table = document.add_table(rows=1, cols=2)
        table.cell(0, 0).text = "SKILLS"
        table.cell(0, 1).add_table(rows=1, cols=1).cell(0, 0).text = "Live chat support"
        # Word stores a text box twice: a DrawingML choice and a VML fallback.
        text_box = parse_xml(
            f'<w:p xmlns:w="{W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
            'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
            'xmlns:v="urn:schemas-microsoft-com:vml"><w:r><mc:AlternateContent>'
            '<mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>Client onboarding</w:t>'
            "</w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox>"
            "<w:txbxContent><w:p><w:r><w:t>Client onboarding</w:t></w:r></w:p></w:txbxContent></v:textbox></w:pict>"
            "</mc:Fallback></mc:AlternateContent></w:r></w:p>"
        )
        document.element.body.insert(len(document.element.body) - 1, text_box)
        buffer = io.BytesIO()
        document.save(buffer)

        text = extract_text_from_docx(io.BytesIO(buffer.getvalue()))

        for expected in ["Alex Example | Remote", "Handled order fulfillment.", "Live chat support", "Client onboarding"]:
            self.assertIn(expected, text)
        self.assertEqual(text.count("Client onboarding"), 1)
        # Merged table cells are read once, not once per grid column.
        self.assertEqual(text.count("SKILLS"), 1)

    def test_pdf_with_a_text_layer_is_read(self):
        text = extract_text_from_pdf(io.BytesIO(text_pdf(RESUME_LINES)))
        self.assertIn("Handled order fulfillment and refunds for an online store.", text)
        self.assertEqual(matching.extract_text_from_pdf(text_pdf(RESUME_LINES)), matching.clean_text(
            matching.extract_text_from_pdf(text_pdf(RESUME_LINES))))

    def test_upload_and_report_routes_read_the_same_docx_text(self):
        file_bytes = resume_docx()
        self.assertIn("order fulfillment", matching.extract_text_from_docx(file_bytes))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "resume.docx"
            path.write_bytes(file_bytes)
            analysis = analyze_resume_file(str(path), SkillExtractor())
        self.assertIn("order fulfillment", analysis["normalized_for_matching"]["resume_text_for_matching"])


class OrderEvidenceTests(unittest.TestCase):
    def test_order_fulfillment_shows_order_processing_in_any_requirement_form(self):
        resume = "Handled order fulfillment for an online store."
        for requirement in ["Order Processing", "SK_ORDER_PROCESSING", "SK693"]:
            result = matching.compute_skill_coverage([], [requirement], resume)
            self.assertEqual(result["matched_skills"], ["Order Processing"], requirement)
            self.assertEqual(result["missing_skills"], [], requirement)
            self.assertEqual(result["related_skill_credit"], [{"skill": "Order Processing", "evidence": "order fulfillment"}])

    def test_the_relation_is_one_way_and_does_not_spread_to_other_order_skills(self):
        # Processing orders does not show picking, packing and shipping.
        reverse = matching.compute_skill_coverage([], ["Order Fulfillment"], "Order processing and order entry.")
        self.assertEqual(reverse["missing_skills"], ["E-commerce Operations"])
        # Order fulfillment is not purchasing.
        purchase = matching.compute_skill_coverage([], ["Issue purchase orders"], "Handled order fulfillment.")
        self.assertEqual(purchase["missing_skills"], ["Issue purchase orders"])
        unrelated = matching.compute_skill_coverage([], ["Order Processing"], "Kept records in order by date.")
        self.assertEqual(unrelated["missing_skills"], ["Order Processing"])

    def test_a_confirmed_profile_skill_is_never_also_missing(self):
        # Added by name in Step 2 although the resume words it differently.
        result = matching.compute_skill_coverage(["Order Fulfillment"], ["Order Processing", "E-commerce"], "Online store work.")
        self.assertEqual(result["matched_skills"], ["E-commerce Operations", "Order Processing"])
        self.assertEqual(result["missing_skills"], [])

    def test_requirements_without_a_readable_name_do_not_count(self):
        result = matching.compute_skill_coverage(["SK029"], ["SK029", "SK999"], "")
        self.assertEqual((result["matched_skills"], result["missing_skills"], result["skill_coverage"]),
            (["Customer Service"], [], 1.0))


class StepFourReportTests(unittest.TestCase):
    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)

    def report(self, file_bytes):
        """The onboarding flow: analyze the upload, keep the Step 2 skills, generate the report."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "resume.docx"
            path.write_bytes(file_bytes)
            analysis = analyze_resume_file(str(path), SkillExtractor())
        skills = [{"skill_id": s["skill_id"], "skill_name": s["skill_name"]} for s in analysis["candidate_profile"]["skills"]]
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=JOBS), \
             patch.object(matching, "score_jobs", return_value=np.asarray([0.35, 0.3])), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            return matching.match_text_to_jobs(
                analysis["normalized_for_matching"]["resume_text_for_matching"],
                confirmed_skills=skills,
                preferences={"industry": "sales-marketing-customer-service"},
            )

    def matches(self, result):
        return {item["job_id"]: item for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]}

    def test_order_processing_is_matched_and_leaves_the_prioritized_gaps(self):
        result = self.report(resume_docx())
        non_voice = self.matches(result)["non-voice"]
        self.assertEqual(non_voice["matched_skills"], ["Chat Support", "Order Processing"])
        self.assertEqual(non_voice["missing_skills"], ["Onboarding"])
        gaps = [gap["skill_name"] for gap in result["skill_gaps"]]
        self.assertEqual(gaps, ["Onboarding"])
        self.assertNotIn("Order Processing", gaps)

    def test_without_the_evidence_order_processing_stays_a_gap(self):
        lines = [line for line in RESUME_LINES if "order fulfillment" not in line]
        result = self.report(resume_docx(lines))
        self.assertIn("Order Processing", self.matches(result)["non-voice"]["missing_skills"])
        self.assertIn("Order Processing", [gap["skill_name"] for gap in result["skill_gaps"]])


if __name__ == "__main__":
    unittest.main()
