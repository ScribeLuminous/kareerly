import tempfile
import unittest
from pathlib import Path

from docx import Document

from backend.app.services.resume_parser import (
    MAX_RESUME_TEXT_CHARS,
    clean_resume_text,
    extract_text_from_docx,
)


class ResumeParserRegressionTests(unittest.TestCase):
    def test_clean_resume_text_caps_pathological_input(self):
        cleaned = clean_resume_text("Python " * (MAX_RESUME_TEXT_CHARS // 3 + 1000))
        self.assertLessEqual(len(cleaned), MAX_RESUME_TEXT_CHARS)
        self.assertIn("Python", cleaned)

    def test_docx_extraction_caps_pathological_input(self):
        document = Document()
        document.add_paragraph("Python " * (MAX_RESUME_TEXT_CHARS // 3 + 1000))

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large-resume.docx"
            document.save(path)
            extracted = extract_text_from_docx(str(path))

        self.assertLessEqual(len(extracted), MAX_RESUME_TEXT_CHARS)
        self.assertIn("Python", extracted)


if __name__ == "__main__":
    unittest.main()
