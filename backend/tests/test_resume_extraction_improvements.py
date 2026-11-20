"""Resume extraction across formats and layouts: section headings, profile fields,
education and certification entries, names, images and OCR clean-up.

The cases mirror layouts found in the resume-extraction samples
(test-data/resume-extraction): sidebars, label columns, letter-spaced and
numbered headings, Philippine headings and credentials, and photos. Every
person, school and company here is fictional.
"""
import io
import shutil
import unittest
from unittest.mock import patch

from PIL import Image

from backend.app.services import ocr, resume_parser
from backend.app.services.pdf_layout import Word, detect_columns, order_words
from backend.app.services.resume_analyzer import (
    analyze_resume_bytes,
    detect_resume_sections,
    extract_candidate_full_name,
    extract_certifications,
    extract_education,
    field_section_kind,
    field_sections,
    is_plausible_person_name,
    section_kind,
    split_resume_sections,
)
from backend.app.services.resume_fields import (
    city_level,
    extract_phone,
    extract_profile_fields,
    extract_work_experience,
    find_date_ranges,
    join_split_date_ranges,
)
from backend.app.services.resume_parser import (
    ResumeFileError,
    _ocr_lines,
    extract_resume_document,
    validate_resume_upload,
)
from backend.app.services.skill_extractor import SkillExtractor


def kinds(text):
    return [(heading, section_kind(heading)) for heading, _ in split_resume_sections(text)]


class SectionHeadingTests(unittest.TestCase):
    def test_heading_variants_are_recognised(self):
        cases = {
            "Licenses and Certifications": "certifications", "Trainings Attended": "training",
            "SEMINARS & TRAININGS": "training", "Core Competencies": "skills", "Areas of Expertise": "skills",
            "Professional Summary": "summary", "Career Objective": "summary", "Character References": "references",
            "Personal Information": "personal_details", "ON-THE-JOB TRAINING (OJT)": "experience",
            "PRE-PROFESSIONAL EXPERIENCE": "experience", "Employment": "experience", "Educational Attainment": "education",
            "ACHIEVEMENTS / RESPONSIBILITIES": "achievements", "LEADERSHIP & ACTIVITIES": "activities",
            "Languages": "languages", "Hobbies": "interests",
        }
        for heading, kind in cases.items():
            with self.subTest(heading=heading):
                found = kinds(f"Jane Reyes\n{heading}\nSome content line\n")
                self.assertEqual(found[-1][1], kind)

    def test_decorated_headings(self):
        for heading in ["01   SUMMARY", "_SUMMARY_", "○ SUMMARY ○", "■ SUMMARY", "S U M M A R Y"]:
            with self.subTest(heading=heading):
                self.assertEqual(kinds(f"Jane Reyes\n{heading}\nA careful bookkeeper.\n")[-1], ("summary", "summary"))

    def test_letter_spaced_heading_with_text_on_the_same_line(self):
        sections = split_resume_sections("Jane Reyes\nP R O F I L E Careful bookkeeper with two years of experience.\n")
        self.assertEqual(sections[-1], ("profile", "Careful bookkeeper with two years of experience."))
        sections = split_resume_sections("Jane Reyes\nE M P L OY M E N T  H I S TO RY\nClerk, Example Co\n")
        self.assertEqual(section_kind(sections[-1][0]), "experience")

    def test_capital_heading_followed_by_content(self):
        sections = split_resume_sections("Jane Reyes\nEDUCATION BS in Accountancy\nSKILLS: Excel, QuickBooks\n")
        self.assertIn(("education", "BS in Accountancy"), sections)
        self.assertIn(("skills", "Excel, QuickBooks"), sections)

    def test_heading_wrapped_in_a_label_column(self):
        text = "Jane Reyes\nPRE-PROFESSIONAL Technical Support Intern\nEXPERIENCE Example Services Inc. (June 2014 - Feb 2015)\n"
        heading, body = split_resume_sections(text)[-1]
        self.assertEqual(section_kind(heading), "experience")
        self.assertIn("Technical Support Intern", body)

    def test_ordinary_lines_are_not_headings(self):
        text = ("SUMMARY\nStrong work history in retail.\nSKILLS\nProgramming (Java, C++, Android Programming\n"
                "Language)\nEDUCATION\nBS Accountancy\nThesis: audit analytics in SMEs\nTeam Leadership\n")
        names = [heading for heading, _ in split_resume_sections(text)]
        self.assertEqual(names, ["summary", "skills", "education"])

    def test_existing_heading_keys_are_unchanged(self):
        for heading in ["EXPERIENCE", "Work Experience", "Employment History", "Work History:", "RELEVANT WORK HISTORY"]:
            with self.subTest(heading=heading):
                self.assertIn(heading.lower().rstrip(":"), detect_resume_sections(f"Jane Reyes\n{heading}\nClerk\n"))

    def test_a_recognised_heading_ends_the_section_above(self):
        """Sidebar text after an unrecognised heading used to become certifications."""
        text = ("COURSES\nAdvanced Excel Course, Example Institute\nJan 2020 - Feb 2020\nDetails\n1515 Example Ave\n"
                "Los Angeles, CA 90291\n5550100123\nLinks\nLinkedIn\nResume Templates\n")
        titles = [c["title"] for c in extract_certifications(text, detect_resume_sections(text))]
        self.assertEqual(titles, ["Advanced Excel Course"])


class DateTests(unittest.TestCase):
    def test_date_ranges_are_normalised(self):
        cases = {
            "Sep 2022 - Apr 2025": ("2022-09", "2025-04"), "January 2021 — April 2022": ("2021-01", "2022-04"),
            "Feb – Jun 2025": ("2025-02", "2025-06"), "(June 2014 – Feb 2015)": ("2014-06", "2015-02"),
            "2021 – 2025": ("2021", "2025"), "FEBRUARY 2021 — PRESENT": ("2021-02", "present"),
            "01/2026 – 04/2026": ("2026-01", "2026-04"),
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                found = find_date_ranges(text)[0]
                self.assertEqual((found["start"], found["end"]), expected)

    def test_a_range_wrapped_over_two_lines_is_joined(self):
        self.assertEqual(join_split_date_ranges(["Example College | 2018", "– 2022"]), ["Example College | 2018 – 2022"])


class ContactTests(unittest.TestCase):
    def fields(self, text, name=""):
        return extract_profile_fields(text, field_sections(text), field_section_kind, name)["fields"]

    def test_contact_line(self):
        fields = self.fields("Jane Reyes\nQuezon City, Metro Manila · +63 917 000 1234 · jane.reyes@example.com\n"
                             "linkedin.com/in/janereyes\nSUMMARY\nCareful bookkeeper with two years at an audit firm.\n", "Jane Reyes")
        self.assertEqual(fields["email"], "jane.reyes@example.com")
        self.assertEqual(fields["phone"], "+63 917 000 1234")
        self.assertEqual(fields["location"], "Quezon City, Metro Manila")
        self.assertEqual(fields["links"], ["linkedin.com/in/janereyes"])
        self.assertEqual(fields["summary"], "Careful bookkeeper with two years at an audit firm.")

    def test_phone_does_not_run_into_the_street_number(self):
        self.assertEqual(extract_phone("jane@example.com (555) 010-0123 1515 Example Ave")[0], "(555) 010-0123")

    def test_masked_phone_is_reported_not_guessed(self):
        self.assertEqual(extract_phone("Phone: 0917 - XXX - XXXX"), ("", True))

    def test_city_from_an_address(self):
        self.assertEqual(city_level("1515 Example Ave, CA 90291 Los Angeles"), "Los Angeles, CA")
        self.assertEqual(city_level("98 Example Avenue, Pasig, Philippines"), "Pasig, Philippines")
        fields = self.fields("Jane Reyes\nPhone: 0917 - XXX - XXXX Address: 98 Example Avenue, Pasig, Philippines\njane@example.com\n")
        self.assertEqual(fields["location"], "Pasig, Philippines")

    def test_absent_fields_stay_empty(self):
        fields = self.fields("Jane Reyes\nSKILLS\nExcel\n", "Jane Reyes")
        for key in ("email", "phone", "location", "summary", "headline", "references"):
            self.assertEqual(fields[key], "", key)
        for key in ("links", "work_experience", "languages", "achievements", "projects", "interests"):
            self.assertEqual(fields[key], [], key)


class WorkExperienceTests(unittest.TestCase):
    def jobs(self, body):
        return [(j["job_title"], j["company"], j["location"], j["start_date"], j["end_date"])
                for j in extract_work_experience([("experience", body)], section_kind)]

    def test_header_arrangements(self):
        cases = {
            "Junior Web Developer, Example Cooperative Services\nTabuk City, Kalinga | Aug 2025 – Present\n• Built pages":
                ("Junior Web Developer", "Example Cooperative Services", "Tabuk City, Kalinga", "2025-08", "present"),
            "Programming Intern (OJT) | Example Trading Inc. | Butuan City, Agusan del Norte | 01/2026 – 04/2026":
                ("Programming Intern (OJT)", "Example Trading Inc.", "Butuan City, Agusan del Norte", "2026-01", "2026-04"),
            "Example Energy Services Inc. — San Jose, Occidental Mindoro\nAutomation Specialist, Oct 2023 – Present":
                ("Automation Specialist", "Example Energy Services Inc.", "San Jose, Occidental Mindoro", "2023-10", "present"),
            "Sep 2022 - Apr 2025 Global Key Account Manager\nExample Oil & Petroleum, Dallas, TX\nSales grew 20%.":
                ("Global Key Account Manager", "Example Oil & Petroleum", "Dallas, TX", "2022-09", "2025-04"),
            "Security Guard at Example Security, Port Washington\nJanuary 2021 — April 2022":
                ("Security Guard", "Example Security", "Port Washington", "2021-01", "2022-04"),
            "Technical Support Intern - IT Department\nExample Business Services Philippines Inc. (June 2014 – Feb 2015)":
                ("Technical Support Intern", "Example Business Services Philippines Inc.", "", "2014-06", "2015-02"),
        }
        for body, expected in cases.items():
            with self.subTest(body=body.splitlines()[0]):
                self.assertEqual(self.jobs(body), [expected])

    def test_a_description_is_not_taken_for_the_next_company(self):
        body = ("Live In Au Pair Mar 2022 - Dec 2025\nExample Family, Kansas City\nPrepare breakfast in the morning\n"
                "Ensure that children are fed and bathed by 7 pm in the evenings\nTeacher Au Pair May 2020 - Feb 2022\n"
                "Second Family, Miami\n")
        self.assertEqual([job[1] for job in self.jobs(body)], ["Example Family", "Second Family"])

    def test_internship_type(self):
        job = extract_work_experience([("on-the-job training (ojt)", "Audit Intern — 600 hours completed Feb – Jun 2025\nExample & Co., CPAs — Makati")], section_kind)[0]
        self.assertEqual((job["job_title"], job["company"], job["location"], job["employment_type"]),
                         ("Audit Intern", "Example & Co., CPAs", "Makati", "internship"))


class EducationTests(unittest.TestCase):
    def entries(self, body):
        text = f"EDUCATION\n{body}\n"
        return [(e["degree_program"], e["school_university"], e["year_graduated"], e["highest_educational_attainment"])
                for e in extract_education(text, detect_resume_sections(text))]

    def test_every_entry_is_returned_highest_first(self):
        body = ("Senior High School, STEM strand\nExample National High School\n2015 - 2017\n"
                "Bachelor of Science in Nursing\nExample University\n2017 - 2021")
        self.assertEqual(self.entries(body), [
            ("Bachelor of Science in Nursing", "Example University", "2021", "Bachelor's Degree"),
            ("Senior High School, STEM strand", "Example National High School", "2017", "High School"),
        ])

    def test_degree_wordings(self):
        for line, level in [("Associates Degree in Education", "Associate Degree"), ("Bachelor Degree in Marketing", "Bachelor's Degree"),
                            ("Masters Degree in Human Computer Interaction (HCI)", "Master's Degree"), ("BSIT", "Bachelor's Degree"),
                            ("BS Accountancy — Cum Laude", "Bachelor's Degree")]:
            with self.subTest(line=line):
                self.assertEqual(self.entries(f"{line}\nExample State University\n2019 - 2023")[0][3], level)

    def test_year_on_the_degree_line(self):
        self.assertEqual(self.entries("BS Accountancy — Cum Laude (GWA 1.45) 2021 – 2025\nExample University, Manila")[0][2], "2025")

    def test_ms_word_is_not_a_degree(self):
        text = "SKILLS\nMicrosoft Office (MS Word, Excel, Powerpoint)\nEDUCATION\nBS in Information Technology\nExample University 2021"
        self.assertEqual(extract_education(text, detect_resume_sections(text))[0]["degree_program"], "BS in Information Technology")

    def test_vocational_programme_with_its_training_centre(self):
        self.assertEqual(self.entries("Cookery NC II | Example Skills Development Center\nSep 2024 – Feb 2025 · Example City"),
                         [("Cookery NC II", "Example Skills Development Center", "2025", "Vocational / Technical")])

    def test_degree_in_progress(self):
        entry = self.entries("BA in Film and Television, Example University, Boston\nFEBRUARY 2021 — PRESENT")[0]
        self.assertEqual((entry[2], entry[3]), ("", "Some College"))

    def test_wrapped_school_name(self):
        entry = self.entries("Senior High School, TVL Track – Home Economics strand, Example Valley Integrated\nSchool\nExample City | 2024 – 2026")[0]
        self.assertEqual(entry[:3], ("Senior High School, TVL Track – Home Economics strand", "Example Valley Integrated School", "2026"))


class CertificationTests(unittest.TestCase):
    def certs(self, text):
        return [(c["title"], c["issuer"], c["year"], c["kind"]) for c in extract_certifications(text, detect_resume_sections(text))]

    def test_wrapped_titles_dates_and_issuers(self):
        text = ("COURSES\nCertified Key Accounts Manager (\nCKAM), Example Academy, Online\nMay 2016\n"
                "Online Graduate Certificate in Warehousing & Supply Chain Management, Example University (EU), NH.\nJuly 2022 — July 2022\n"
                "Basic Au Pair Skills Programme Jul 2016\n")
        self.assertEqual(self.certs(text), [
            ("Certified Key Accounts Manager ( CKAM)", "Example Academy", "2016", "certification"),
            ("Online Graduate Certificate in Warehousing & Supply Chain Management", "Example University (EU)", "2022", "certification"),
            ("Basic Au Pair Skills Programme", "", "2016", "training"),
        ])

    def test_seminars_section(self):
        text = "SEMINARS & TRAININGS\nPFRS Updates Seminar — Example Institute, March 2025\nQuickBooks Online basic training — completed with certificate, 2025\n"
        self.assertEqual(self.certs(text), [("PFRS Updates Seminar", "Example Institute", "2025", "training"),
                                            ("QuickBooks Online basic training", "", "2025", "training")])

    def test_credentials_stated_in_the_summary(self):
        text = "PROFILE\nGuard qualified as a CPO (Certified Protection Guard). Has a valid commercial driver's license.\nSKILLS\nCCTV\n"
        self.assertEqual([c[0] for c in self.certs(text)], ["CPO (Certified Protection Guard)", "Commercial driver's license"])


class NameTests(unittest.TestCase):
    def test_labels_headings_and_titles_are_not_names(self):
        cases = [
            ("Resume\nPersonal details\nName Michelle Example\nEmail address mex@example.com", "Michelle Example"),
            ("John Example, UX Designer\n9 Example St, New York, 10005, USA, 555-010-0401, jx@example.com", "John Example"),
            ("JOHN DAVID EXAMPLE 3\nPhone: 0917 — XXX — XXXX\nEmail: jde@example.com", "John David Example"),
            ("SKILLS\nTeam Leadership\nLANGUAGES\nEnglish\nMICHELLE EXAMPLE\nmex@example.com\n(555) 010-3010", "Michelle Example"),
            ("SECURITY GUARD LOS ANGELES, CA 90291\nDetails\nLos Angeles, CA 90291\nme@example.com", ""),
        ]
        for text, expected in cases:
            with self.subTest(text=text.splitlines()[0]):
                self.assertEqual(extract_candidate_full_name(text, text), expected)

    def test_surnames_that_are_also_towns(self):
        text = "Camille Ilagan\nE-commerce Specialist\nTuguegarao City, Cagayan | camille@example.net | +63 908 000 6381"
        self.assertEqual(extract_candidate_full_name(text, text), "Camille Ilagan")

    def test_five_word_names_with_particles(self):
        self.assertTrue(is_plausible_person_name("Maria Cristina Dela Cruz Santos"))
        self.assertFalse(is_plausible_person_name("Senior Customer Service Team Lead"))


class SkillFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.extractor = SkillExtractor()

    def test_letter_spaced_skills_are_still_found(self):
        names = [s["skill_name"] for s in self.extractor.extract_from_text("S K I L L S\nm i c r o s o f t   e x c e l", limit=None)]
        self.assertIn("Microsoft Excel", names)

    def test_a_letter_spaced_heading_does_not_join_the_whole_resume(self):
        text = "E M P L OY M E N T  H I S TO RY\nExcelled in usability testing of digital products."
        self.assertEqual(self.extractor.extract_from_text(text, limit=None), [])


class LayoutTests(unittest.TestCase):
    @staticmethod
    def page(left_items, right_lines):
        words = []
        for row, item in enumerate(left_items):
            x = 20.0
            for token in item.split():
                words.append(Word(token, x, x + 5 * len(token), 100 + 20 * row, 110 + 20 * row))
                x += 5 * len(token) + 3
        for row, line in enumerate(right_lines):
            x = 230.0
            for token in line.split():
                words.append(Word(token, x, x + 6 * len(token), 100 + 14 * row, 110 + 14 * row))
                x += 6 * len(token) + 3
        return words

    def test_a_narrow_sidebar_is_its_own_column(self):
        sidebar = ["Skills", "Client Relationship Management", "Team Leadership", "Strategic Planning", "Negotiation",
                   "Languages", "English", "Spanish", "Details", "Los Angeles", "United States", "Driving license"]
        main = ["Managed a national team of five account managers and twenty executives across regions"] * 20
        words = self.page(sidebar, main)
        self.assertTrue(detect_columns(words))
        self.assertEqual(order_words(words)[:3], ["Skills", "Client Relationship Management", "Team Leadership"])

    def test_a_column_of_dates_is_not_a_sidebar(self):
        words = self.page([], ["Account Manager, Example Co"] * 6)
        for row in range(6):
            words.append(Word("2019", 470, 494, 100 + 14 * row, 110 + 14 * row))
            words.append(Word("-", 497, 500, 100 + 14 * row, 110 + 14 * row))
            words.append(Word("2021", 503, 527, 100 + 14 * row, 110 + 14 * row))
        self.assertFalse(detect_columns(words))


class OcrAndImageTests(unittest.TestCase):
    def test_ocr_keeps_date_lines_and_drops_bullets(self):
        lines = _ocr_lines("e Hardware troubleshooting\nStudents (2014 - 2015)\n(June 2014 — Feb 2015)\n|| ~~ __\n© Network setup")
        self.assertEqual(lines, ["Hardware troubleshooting", "Students (2014 - 2015)", "(June 2014 — Feb 2015)", "Network setup"])

    @staticmethod
    def image_bytes(fmt):
        buffer = io.BytesIO()
        Image.new("RGB", (400, 300), "white").save(buffer, fmt)
        return buffer.getvalue()

    def test_jpg_and_png_uploads_are_accepted_by_content(self):
        self.assertEqual(validate_resume_upload("resume.jpg", self.image_bytes("JPEG")), "jpg")
        self.assertEqual(validate_resume_upload("resume.png", self.image_bytes("PNG")), "png")
        self.assertEqual(validate_resume_upload("resume.jpg", self.image_bytes("PNG")), "png")
        with self.assertRaises(ResumeFileError):
            validate_resume_upload("resume.png", b"%PDF-1.4 not an image")

    def test_image_is_read_with_ocr(self):
        recognised = "Jane Example\njane@example.com\nSKILLS\ne Microsoft Excel\nEDUCATION\nBS Accountancy\nExample University (2019 - 2023)"
        with patch.object(ocr, "ocr_available", return_value=True), patch.object(ocr, "ocr_image", return_value=recognised):
            result = extract_resume_document(self.image_bytes("PNG"), "resume.png")
        self.assertEqual((result.source_format, result.method, result.ocr_status), ("png", "ocr", "used"))
        self.assertIn("Microsoft Excel", result.text)
        self.assertIn(resume_parser.IMAGE_OCR_USED_WARNING, result.warnings)

    def test_image_without_ocr_is_a_clear_warning(self):
        with patch.object(ocr, "ocr_available", return_value=False):
            result = extract_resume_document(self.image_bytes("JPEG"), "resume.jpg")
        self.assertEqual((result.text, result.ocr_status), ("", "unavailable"))
        self.assertIn(resume_parser.IMAGE_OCR_UNAVAILABLE_WARNING, result.warnings)

    def test_a_phone_photo_taken_sideways_is_turned_upright(self):
        image = Image.new("RGB", (300, 200), "white")
        exif = image.getexif()
        exif[274] = 6  # EXIF orientation: rotate 90 degrees to display
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", exif=exif.tobytes())
        prepared = resume_parser.prepare_image_for_ocr(Image.open(io.BytesIO(buffer.getvalue())))
        width, height = prepared.size
        self.assertGreater(height, width)
        self.assertEqual(prepared.mode, "L")

    @unittest.skipUnless(shutil.which("tesseract"), "tesseract is not installed")
    def test_a_rendered_resume_image_is_read(self):
        from PIL import ImageDraw, ImageFont
        image = Image.new("RGB", (1400, 500), "white")
        draw = ImageDraw.Draw(image)
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", 34)
        except OSError:
            self.skipTest("DejaVu Sans font is not installed")
        for row, line in enumerate(["Jane Example", "jane@example.com", "SKILLS", "Microsoft Excel and Bookkeeping"]):
            draw.text((40, 40 + 90 * row), line, fill="black", font=font)
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        result = extract_resume_document(buffer.getvalue(), "resume.png")
        self.assertIn("Microsoft Excel", result.text)


class AnalysisCompatibilityTests(unittest.TestCase):
    def test_existing_keys_remain_and_new_fields_are_added(self):
        from backend.tests.test_step3_preferences_and_resume_skills import text_pdf
        pdf = text_pdf(["Jane Example", "jane@example.com | +63 917 000 1234 | Pasig City, Metro Manila", "SKILLS", "Microsoft Excel",
                        "WORK EXPERIENCE", "Bookkeeper, Example Trading Inc.", "Jan 2022 - Present", "EDUCATION",
                        "BS Accountancy", "Example University 2021"])
        analysis = analyze_resume_bytes(pdf, "resume.pdf", SkillExtractor())
        profile = analysis["candidate_profile"]
        for key in ("full_name", "skills", "education_indicators", "certification_indicators", "experience_indicators",
                    "education", "certifications"):
            self.assertIn(key, profile)
        for key in ("degree_program", "school_university", "year_graduated", "highest_educational_attainment"):
            self.assertIn(key, profile["education"][0])
        self.assertEqual(profile["email"], "jane@example.com")
        self.assertEqual(profile["work_experience"][0]["company"], "Example Trading Inc.")
        self.assertEqual(analysis["field_confidence"]["email"], "high")
        self.assertEqual(analysis["extraction"]["parser_version"], resume_parser.RESUME_PARSER_VERSION)


if __name__ == "__main__":
    unittest.main()
