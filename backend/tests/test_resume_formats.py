"""Resume formats end to end: scanned PDFs, multi-column PDFs, split skill names,
DOCX text boxes/images/SmartArt and legacy .doc files.

For every fixture a skill printed in the resume must be extracted in Step 1 and
must not be reported as a skill gap, whether or not it was confirmed. Fixtures
live in tests/fixtures/resumes (see build_fixtures.py there). Tests that run
tesseract or a .doc converter are skipped when the tool is not installed; the
failure paths are covered with stubs so they always run.
"""
import io
import subprocess
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from pypdf import PdfReader

from backend.app.main import app
from backend.app.services import doc_conversion, ocr
from backend.app.services import matching_service as matching
from backend.app.services import resume_parser
from backend.app.services.pdf_layout import Word, order_words
from backend.app.services.resume_analyzer import analyze_resume_bytes
from backend.app.services.resume_parser import (
    OCR_FAILED_WARNING,
    OCR_UNAVAILABLE_WARNING,
    ResumeFileError,
    extract_resume_document,
    validate_resume_upload,
)
from backend.app.services.skill_extractor import SkillExtractor
from backend.app.services.split_words import build_split_word_vocabulary, repair_split_skill_words
from backend.tests.test_step3_preferences_and_resume_skills import (
    UNRESTRICTED_LEVEL,
    UNRESTRICTED_SALARY,
    UNRESTRICTED_SETUP,
    report,
    text_pdf,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "resumes"
EXTRACTOR = SkillExtractor()
HAS_OCR = ocr.ocr_available()
HAS_SOFFICE = doc_conversion.soffice_path() is not None
HAS_ANTIWORD = doc_conversion.antiword_path() is not None

CUSTOMER_SERVICE, ZENDESK, SALESFORCE, HUBSPOT = "SK029", "SK644", "SK643", "SK642"
QUICKBOOKS, EXCEL, DATA_ENCODING, JAVASCRIPT = "SK652", "SK629", "SK017", "SK002"
SKILL_NAMES = {
    CUSTOMER_SERVICE: "Customer Service", ZENDESK: "Zendesk", SALESFORCE: "Salesforce", HUBSPOT: "HubSpot",
    QUICKBOOKS: "QuickBooks", EXCEL: "Microsoft Excel", DATA_ENCODING: "Data Encoding",
    JAVASCRIPT: "JavaScript Programming",
}


def fixture(name):
    return (FIXTURES / name).read_bytes()


def analyze(name, data=None):
    return analyze_resume_bytes(fixture(name) if data is None else data, name, EXTRACTOR)


def resume_text(analysis):
    return analysis["normalized_for_matching"]["resume_text_for_matching"]


class VisibleSkillAssertions:
    """A skill visible in the resume shows in Step 1 and is never a gap."""

    def assert_visible_skills_held(self, analysis, skill_ids):
        step1_ids = set(analysis["normalized_for_matching"]["skill_ids"])
        self.assertLessEqual(set(skill_ids), step1_ids, analysis["normalized_for_matching"]["skill_names"])
        text = resume_text(analysis)
        # Confirmed in Step 2 ...
        self.assertEqual(matching.compute_skill_coverage(sorted(step1_ids), list(skill_ids), text)["missing_skills"], [])
        # ... or not confirmed at all: the resume text still names it.
        self.assertEqual(matching.compute_skill_coverage([], list(skill_ids), text)["missing_skills"], [])
        # And in a full report the skill is not among the prioritized gaps.
        open_fields = {**UNRESTRICTED_LEVEL, **UNRESTRICTED_SALARY, **UNRESTRICTED_SETUP}
        confirmed = [{"skill_id": skill_id} for skill_id in analysis["normalized_for_matching"]["skill_ids"]]
        result = report({"industry": "sales-marketing-customer-service", **open_fields}, resume=text,
                        confirmed=confirmed)
        gap_names = {gap["skill_name"] for gap in result["prioritized_skill_gaps"]}
        for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]:
            gap_names.update(item["missing_skills"])
        self.assertFalse(gap_names & {SKILL_NAMES[skill_id] for skill_id in skill_ids}, gap_names)

    def assert_report_route_reads_the_same(self, name, skill_ids):
        """The report's own file reader (no Step 1 text) sees the same skills."""
        text = matching.extract_resume_text(fixture(name), name)
        self.assertEqual(matching.compute_skill_coverage([], list(skill_ids), text)["missing_skills"], [])


# ------------------------------------------------------------------
# 1. Scanned PDFs
# ------------------------------------------------------------------

@unittest.skipUnless(HAS_OCR, "tesseract is not installed")
class ScannedPdfTests(unittest.TestCase, VisibleSkillAssertions):
    @classmethod
    def setUpClass(cls):
        cls.scanned = analyze("scanned_resume.pdf")
        cls.mixed = analyze("mixed_text_and_scan_resume.pdf")

    def test_fixture_has_no_text_layer(self):
        reader = PdfReader(io.BytesIO(fixture("scanned_resume.pdf")))
        self.assertEqual("".join(page.extract_text() or "" for page in reader.pages).strip(), "")

    def test_image_only_pdf_is_read_with_ocr(self):
        extraction = self.scanned["extraction"]
        self.assertEqual((extraction["method"], extraction["ocr_status"], extraction["ocr_pages"]), ("ocr", "used", [1]))
        self.assertIn("OCR", " ".join(self.scanned["warnings"]))
        self.assert_visible_skills_held(self.scanned, [CUSTOMER_SERVICE, ZENDESK, EXCEL, QUICKBOOKS, SALESFORCE])
        self.assert_report_route_reads_the_same("scanned_resume.pdf", [ZENDESK, QUICKBOOKS])

    def test_only_pages_without_text_are_scanned(self):
        extraction = self.mixed["extraction"]
        self.assertEqual((extraction["method"], extraction["ocr_pages"]), ("text+ocr", [2]))
        text = resume_text(self.mixed)
        self.assertIn("food manufacturing", text)  # page 1, text layer
        self.assert_visible_skills_held(self.mixed, [ZENDESK, QUICKBOOKS, SALESFORCE, EXCEL])

    def test_scanned_pages_past_the_limit_are_skipped_with_a_warning(self):
        with patch.object(ocr, "OCR_MAX_PAGES", 0):
            analysis = analyze("scanned_resume.pdf")
        self.assertEqual(analysis["candidate_profile"]["skills"], [])
        self.assertTrue(any("Only the first 0 scanned pages" in warning for warning in analysis["warnings"]))


class OcrFailureTests(unittest.TestCase):
    """Failures never pass silently and never invent skills."""

    def test_missing_tesseract_is_a_clear_warning(self):
        with patch.object(ocr, "tesseract_path", return_value=None):
            analysis = analyze("scanned_resume.pdf")
        self.assertEqual(analysis["status"], "warning")
        self.assertIn(OCR_UNAVAILABLE_WARNING, analysis["warnings"])
        self.assertEqual(analysis["candidate_profile"]["skills"], [])
        self.assertEqual(analysis["extraction"]["ocr_status"], "unavailable")

    def test_ocr_error_is_a_clear_warning(self):
        with patch.object(ocr, "tesseract_path", return_value="/usr/bin/tesseract"), \
             patch.object(ocr.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, b"", b"Error: bad image")):
            analysis = analyze("scanned_resume.pdf")
        self.assertEqual(analysis["status"], "warning")
        self.assertIn(OCR_FAILED_WARNING, analysis["warnings"])
        self.assertEqual(analysis["extraction"]["ocr_status"], "failed")
        self.assertEqual(analysis["candidate_profile"]["skills"], [])

    def test_ocr_timeout_is_a_failure(self):
        with patch.object(ocr, "tesseract_path", return_value="/usr/bin/tesseract"), \
             patch.object(ocr.subprocess, "run", side_effect=subprocess.TimeoutExpired("tesseract", 1)):
            analysis = analyze("scanned_resume.pdf")
        self.assertIn(OCR_FAILED_WARNING, analysis["warnings"])

    def test_report_route_explains_an_unreadable_scan(self):
        with patch.object(ocr, "tesseract_path", return_value=None):
            with self.assertRaises(ValueError) as caught:
                matching.extract_resume_text(fixture("scanned_resume.pdf"), "scanned_resume.pdf")
        self.assertIn("text recognition (OCR) is not available", str(caught.exception))

    def test_blank_page_without_text_layer_is_not_guessed(self):
        analysis = analyze("blank.pdf", text_pdf([]))
        self.assertEqual(analysis["candidate_profile"]["skills"], [])
        self.assertEqual(analysis["status"], "warning")


# ------------------------------------------------------------------
# 2. Multi-column PDFs
# ------------------------------------------------------------------

class MultiColumnPdfTests(unittest.TestCase, VisibleSkillAssertions):
    @classmethod
    def setUpClass(cls):
        cls.analysis = analyze("two_column_resume.pdf")

    def test_fixture_interleaves_columns_in_plain_extraction(self):
        plain = PdfReader(io.BytesIO(fixture("two_column_resume.pdf"))).pages[0].extract_text()
        self.assertIn("Customer Support Agent", plain)
        self.assertNotIn("Customer\nService", plain)

    def test_columns_are_read_one_after_the_other(self):
        text = extract_resume_document(fixture("two_column_resume.pdf"), "two_column_resume.pdf").text
        lines = text.splitlines()
        self.assertEqual(lines[0], "Andrea Villanueva")
        self.assertIn("Customer\nService\nMicrosoft\nExcel", text)
        # The whole left column comes before the right column, then the full-width line.
        self.assertLess(lines.index("Filipino and English"), lines.index("WORK EXPERIENCE"))
        self.assertTrue(lines[-1].startswith("EDUCATION"))
        self.assertEqual(self.analysis["extraction"]["multi_column_pages"], [1])

    def test_skills_in_either_column_are_held(self):
        # Left column: Customer Service, Microsoft Excel, Data Entry. Right: Zendesk, QuickBooks.
        self.assert_visible_skills_held(self.analysis, [CUSTOMER_SERVICE, EXCEL, DATA_ENCODING, ZENDESK, QUICKBOOKS])
        self.assert_report_route_reads_the_same("two_column_resume.pdf", [CUSTOMER_SERVICE, EXCEL, ZENDESK])

    def test_single_column_with_right_aligned_dates_is_not_split(self):
        words = []
        for row, (title, date) in enumerate([("Support Agent, Example Co", "2021 - Present"),
                                             ("Team Lead, Sample Shop", "2019 - 2021")]):
            top = 100 + row * 60
            x = 72.0
            for token in title.split():
                words.append(Word(token, x, x + 6 * len(token), top, top + 10))
                x += 6 * len(token) + 3
            x = 470.0
            for token in date.split():
                words.append(Word(token, x, x + 6 * len(token), top, top + 10))
                x += 6 * len(token) + 3
            for line in range(1, 4):
                x = 72.0
                for token in "Resolved customer tickets and trained new agents on the support tools".split():
                    words.append(Word(token, x, x + 6 * len(token), top + 14 * line, top + 14 * line + 10))
                    x += 6 * len(token) + 3
        lines = order_words(words)
        self.assertEqual(lines[0], "Support Agent, Example Co 2021 - Present")


# ------------------------------------------------------------------
# 3. Split skill names
# ------------------------------------------------------------------

class SplitSkillNameTests(unittest.TestCase, VisibleSkillAssertions):
    VOCABULARY = EXTRACTOR.split_word_vocabulary()

    def repair(self, text):
        return repair_split_skill_words(text, self.VOCABULARY, EXTRACTOR.known_phrases())

    def test_fixture_skills_are_held(self):
        analysis = analyze("split_words_resume.pdf")
        text = extract_resume_document(fixture("split_words_resume.pdf"), "split_words_resume.pdf").text
        self.assertIn("Sales force", PdfReader(io.BytesIO(fixture("split_words_resume.pdf"))).pages[0].extract_text())
        for joined in ["Salesforce", "HubSpot", "QuickBooks", "Zendesk", "JavaScript"]:
            self.assertIn(joined, extract_resume_document(
                fixture("split_words_resume.pdf"), "split_words_resume.pdf",
                split_word_vocabulary=self.VOCABULARY, known_phrases=EXTRACTOR.known_phrases()).text)
        self.assertIn("Sales force", text)  # without a vocabulary nothing is joined
        self.assert_visible_skills_held(analysis, [SALESFORCE, HUBSPOT, QUICKBOOKS, ZENDESK, JAVASCRIPT])
        self.assert_report_route_reads_the_same("split_words_resume.pdf", [SALESFORCE, QUICKBOOKS, ZENDESK])
        # The prose "a sales force of 12" in the same resume stays as written.
        self.assertIn("led a sales force of 12", resume_text(analysis))

    def test_decoy_phrases_do_not_become_skills(self):
        analysis = analyze("decoy_phrases_resume.pdf")
        names = set(analysis["normalized_for_matching"]["skill_names"])
        self.assertFalse(names & {"Salesforce", "QuickBooks"}, names)
        # The gap check does not assemble them from separate words either.
        self.assertEqual(matching.compute_skill_coverage([], [SALESFORCE, QUICKBOOKS], resume_text(analysis))["missing_skills"],
                         ["QuickBooks", "Salesforce"])
        # A name written as separate words still matches its one-word spelling, and hyphens are ignored.
        self.assertTrue(matching._phrase_in_text("Help Scout", "tickets in helpscout"))
        self.assertTrue(matching._phrase_in_text("ecommerce", "e-commerce orders"))

    def test_joins(self):
        cases = {
            "Sales force": "Salesforce",          # glyph gap inside a word
            "Sales\nforce": "Salesforce",         # line wrap, lower-case continuation
            "Quick Books": "QuickBooks",          # split before a capital letter
            "Quick\nBooks": "QuickBooks",
            "QUICK BOOKS": "QuickBooks",          # all caps, capital boundary in the name
            "Hub Spot": "HubSpot",
            "Java Script": "JavaScript",
            "Zen desk,": "Zendesk,",
            "Micro soft Excel": "Microsoft Excel",
            "Word Press site": "WordPress site",
        }
        for text, expected in cases.items():
            with self.subTest(text):
                self.assertEqual(self.repair(text), expected)

    def test_unrelated_words_stay_apart(self):
        for text in [
            "led a sales force of 12",       # lower-case prose
            "Sales Force Award",             # capital where the name has none
            "SALES FORCE",                   # all caps cannot show a lower-case boundary
            "quick books summary",
            "Quick books",                   # lower case where the name has a capital
            "Java, Script writing",          # punctuation between the pieces
            "Zen\n\ndesk",                   # a blank line is a new paragraph
            "Zen   \n desk".replace("\n", ";"),
            "xSales force",                  # glued to a longer word
            "Sales forces",
            "Customer Service",              # the spaced form is itself a known skill
        ]:
            with self.subTest(text):
                self.assertEqual(self.repair(text), text)

    def test_vocabulary_is_names_only(self):
        vocabulary = build_split_word_vocabulary(["QuickBooks; quickbooks online", "Microsoft Excel", "SQL", "Excel"])
        self.assertEqual(vocabulary["quickbooks"], ("QuickBooks",))
        self.assertIn("microsoft", vocabulary)
        self.assertNotIn("excel", vocabulary)  # shorter than six letters
        self.assertNotIn("sql", vocabulary)


# ------------------------------------------------------------------
# 4. DOCX text boxes, images and SmartArt
# ------------------------------------------------------------------

class DocxEmbeddedContentTests(unittest.TestCase, VisibleSkillAssertions):
    NAME = "embedded_content_resume.docx"

    def test_text_box_and_smartart_are_read_once(self):
        text = extract_resume_document(fixture(self.NAME), self.NAME, use_ocr=False).text
        # Each is stored twice in the file (DrawingML + VML fallback; diagram data + drawing).
        self.assertEqual(text.count("Tools: Zendesk and HubSpot"), 1)
        self.assertEqual(text.count("Customer Service"), 1)
        self.assertEqual(text.count("Data Entry"), 1)

    @unittest.skipUnless(HAS_OCR, "tesseract is not installed")
    def test_text_in_images_is_read_once(self):
        analysis = analyze(self.NAME)
        text = extract_resume_document(fixture(self.NAME), self.NAME).text
        self.assertEqual(text.lower().count("quickbooks"), 1)  # the banner appears twice, one image part
        self.assertEqual(analysis["extraction"]["ocr_images"], 1)  # the photo adds nothing
        self.assert_visible_skills_held(analysis, [ZENDESK, HUBSPOT, CUSTOMER_SERVICE, DATA_ENCODING, QUICKBOOKS, SALESFORCE])
        self.assert_report_route_reads_the_same(self.NAME, [ZENDESK, QUICKBOOKS, SALESFORCE])

    def test_image_ocr_failure_is_a_warning(self):
        with patch.object(ocr, "tesseract_path", return_value="/usr/bin/tesseract"), \
             patch.object(ocr.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, b"", b"Error")):
            analysis = analyze(self.NAME)
        self.assertIn(resume_parser.DOCX_IMAGE_OCR_FAILED_WARNING, analysis["warnings"])
        self.assertEqual(analysis["extraction"]["ocr_status"], "failed")

    def test_without_ocr_a_text_resume_gets_no_image_warning(self):
        with patch.object(ocr, "tesseract_path", return_value=None):
            analysis = analyze(self.NAME)
        self.assertFalse(any("image" in warning.lower() for warning in analysis["warnings"]))
        self.assert_visible_skills_held(analysis, [ZENDESK, HUBSPOT, CUSTOMER_SERVICE])


# ------------------------------------------------------------------
# 5. Legacy .doc
# ------------------------------------------------------------------

class LegacyDocTests(unittest.TestCase, VisibleSkillAssertions):
    NAME = "legacy_resume.doc"
    SKILLS = [CUSTOMER_SERVICE, ZENDESK, QUICKBOOKS, EXCEL]

    @unittest.skipUnless(HAS_SOFFICE, "LibreOffice is not installed")
    def test_doc_through_libreoffice(self):
        with patch.object(doc_conversion, "antiword_path", return_value=None):
            analysis = analyze(self.NAME)
        self.assertEqual(analysis["extraction"]["method"], "converted_docx")
        self.assert_visible_skills_held(analysis, self.SKILLS)
        self.assert_report_route_reads_the_same(self.NAME, self.SKILLS)

    @unittest.skipUnless(HAS_ANTIWORD, "antiword is not installed")
    def test_doc_through_antiword(self):
        with patch.object(doc_conversion, "soffice_path", return_value=None):
            analysis = analyze(self.NAME)
        self.assertEqual(analysis["extraction"]["method"], "converted_text")
        self.assert_visible_skills_held(analysis, self.SKILLS)

    def test_no_converter_asks_for_docx_or_pdf(self):
        with patch.object(doc_conversion, "soffice_path", return_value=None), \
             patch.object(doc_conversion, "antiword_path", return_value=None):
            with self.assertRaises(ResumeFileError) as caught:
                analyze(self.NAME)
        self.assertIn("save the resume as DOCX or PDF", str(caught.exception))

    def test_converter_timeout_is_reported(self):
        def hang(*args, **kwargs):
            raise doc_conversion.DocConversionError("Converting the .doc file took too long.")
        with patch.object(doc_conversion, "soffice_path", return_value="/usr/bin/soffice"), \
             patch.object(doc_conversion, "antiword_path", return_value=None), \
             patch.object(doc_conversion, "convert_doc_with_soffice", side_effect=hang):
            with self.assertRaises(ResumeFileError) as caught:
                analyze(self.NAME)
        self.assertIn("took too long", str(caught.exception))

    def test_real_timeout_kills_the_converter(self):
        with self.assertRaises(doc_conversion.DocConversionError):
            doc_conversion._run(["sleep", "5"], "/tmp", timeout=0.2)

    def test_rtf_or_other_files_named_doc_are_refused(self):
        for data, message in [(b"{\\rtf1\\ansi Skills: Zendesk}", "RTF"), (b"just text", "not a valid Word document")]:
            with self.subTest(message), self.assertRaises(ResumeFileError) as caught:
                validate_resume_upload("resume.doc", data)
            self.assertIn(message, str(caught.exception))

    def test_docx_renamed_to_doc_is_read_as_docx(self):
        data = fixture("embedded_content_resume.docx")
        self.assertEqual(validate_resume_upload("resume.doc", data), "docx")
        text = extract_resume_document(data, "resume.doc", use_ocr=False).text
        self.assertIn("Tools: Zendesk and HubSpot", text)


# ------------------------------------------------------------------
# Upload checks and limits
# ------------------------------------------------------------------

class UploadLimitTests(unittest.TestCase):
    def test_size_type_and_content_checks(self):
        with self.assertRaises(ResumeFileError):
            validate_resume_upload("resume.pdf", b"%PDF-" + b"0" * resume_parser.MAX_RESUME_BYTES)
        with self.assertRaises(ResumeFileError):
            validate_resume_upload("resume.txt", b"Skills: Zendesk")
        with self.assertRaises(ResumeFileError):
            validate_resume_upload("resume.pdf", fixture("embedded_content_resume.docx"))
        with self.assertRaises(ResumeFileError):
            validate_resume_upload("resume.pdf", b"")

    def test_zip_bomb_docx_is_refused_before_parsing(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("word/document.xml", b"<w:document/>")
            archive.writestr("word/media/huge.bin", b"\0" * (resume_parser.MAX_DOCX_UNCOMPRESSED_BYTES + 1))
        with self.assertRaises(ResumeFileError) as caught:
            extract_resume_document(buffer.getvalue(), "resume.docx")
        self.assertIn("too large", str(caught.exception))

    def test_password_protected_pdf_is_explained(self):
        from pypdf import PdfWriter

        writer = PdfWriter(clone_from=io.BytesIO(fixture("two_column_resume.pdf")))
        writer.encrypt(user_password="secret", owner_password="owner")
        buffer = io.BytesIO()
        writer.write(buffer)
        with self.assertRaises(ResumeFileError) as caught:
            extract_resume_document(buffer.getvalue(), "resume.pdf")
        self.assertIn("password", str(caught.exception))


class ResumeUploadApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def post(self, name, data, content_type="application/octet-stream"):
        return self.client.post("/api/resume/analyze", files={"resume": (name, data, content_type)})

    def test_analyze_reads_the_upload_in_memory(self):
        with patch("builtins.open", side_effect=AssertionError("the upload must not be written to disk")):
            response = self.post("two_column_resume.pdf", fixture("two_column_resume.pdf"), "application/pdf")
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertIn("Zendesk", payload["normalized_for_matching"]["skill_names"])
        self.assertEqual(payload["extraction"]["parser_version"], resume_parser.RESUME_PARSER_VERSION)

    @unittest.skipUnless(HAS_SOFFICE or HAS_ANTIWORD, "no .doc converter is installed")
    def test_analyze_accepts_doc(self):
        response = self.post("legacy_resume.doc", fixture("legacy_resume.doc"), "application/msword")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("QuickBooks", response.json()["normalized_for_matching"]["skill_names"])

    def test_analyze_rejects_oversized_and_disguised_files(self):
        too_big = self.post("resume.pdf", b"%PDF-1.4\n" + b"0" * resume_parser.MAX_RESUME_BYTES)
        self.assertEqual(too_big.status_code, 400)
        self.assertIn("5MB", too_big.json()["detail"])
        disguised = self.post("resume.pdf", b"MZ\x90\x00 not a pdf")
        self.assertEqual(disguised.status_code, 400)
        self.assertIn("not a valid PDF", disguised.json()["detail"])
        unsupported = self.post("resume.rtf", b"{\\rtf1}")
        self.assertEqual(unsupported.status_code, 400)

    def test_health_config_reports_resume_readers(self):
        readers = self.client.get("/api/health/config").json()["resume_readers"]
        self.assertEqual(readers, {
            "parser_version": resume_parser.RESUME_PARSER_VERSION,
            "ocr": HAS_OCR,
            "doc_libreoffice": HAS_SOFFICE,
            "doc_antiword": HAS_ANTIWORD,
        })

    def test_report_route_limits_size_too(self):
        response = self.client.post(
            "/api/matches/from-resume",
            files={"file": ("resume.pdf", b"%PDF-1.4\n" + b"0" * resume_parser.MAX_RESUME_BYTES, "application/pdf")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("5MB", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
