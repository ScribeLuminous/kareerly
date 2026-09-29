"""Filipino names with "ñ", and the "Work History" / "Career History" headings."""
import unittest

from backend.app.services.resume_analyzer import (
    decode_letter_spaced_line,
    detect_resume_sections,
    extract_candidate_full_name,
    is_plausible_person_name,
    normalize_person_name,
    split_resume_sections,
)


class NameTests(unittest.TestCase):
    def test_enye_is_kept(self):
        for raw, expected in [
            ("RANDY OMAÑA", "Randy Omaña"),
            ("mylene ybañez", "Mylene Ybañez"),
            ("Patrick Cañete", "Patrick Cañete"),
            ("Mark Anthony Dela Peña", "Mark Anthony Dela Peña"),
        ]:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_person_name(raw), expected)
                self.assertTrue(is_plausible_person_name(expected))

    def test_decomposed_enye_from_a_pdf_is_composed(self):
        self.assertEqual(normalize_person_name("Patrick Cañete"), "Patrick Cañete")

    def test_name_is_found_above_a_location_line(self):
        text = "Mark Anthony Dela Peña\nAlaminos City, Pangasinan\nmark@example.com\n\nSKILLS\nPython"
        self.assertEqual(extract_candidate_full_name(text, text), "Mark Anthony Dela Peña")

    def test_hyphen_and_apostrophe_still_work(self):
        self.assertEqual(normalize_person_name("maria-luisa d'souza"), "Maria-Luisa D'Souza")

    def test_non_names_are_still_rejected(self):
        for value in ["Alaminos", "Skills Summary", "Ño"]:
            with self.subTest(value=value):
                self.assertFalse(is_plausible_person_name(normalize_person_name(value)))
        # Digits and underscores are never part of a name.
        for value in ["Web Developer 2024", "Jan_Doe Reyes"]:
            with self.subTest(value=value):
                self.assertFalse(is_plausible_person_name(value))
        self.assertEqual(extract_candidate_full_name("Web Developer 2024\nJan Reyes", ""), "Jan Reyes")

    def test_letter_spaced_name_with_enye(self):
        self.assertEqual(decode_letter_spaced_line("R A N D Y    O M A Ñ A"), "RANDY OMAÑA")


class HeadingTests(unittest.TestCase):
    RESUME = "Jane Reyes\n\nSKILLS\nPython\n\n{heading}\nBookkeeper, Acme, 2020 - Present\nInvoicing and billing\n\nEDUCATION\nBS Accountancy\n"

    def test_work_and_career_history_are_sections(self):
        for heading in ["WORK HISTORY", "Career History", "Work History:", "RELEVANT WORK HISTORY"]:
            with self.subTest(heading=heading):
                sections = detect_resume_sections(self.RESUME.format(heading=heading))
                key = heading.lower().rstrip(":")
                self.assertIn(key, sections)
                self.assertIn("Invoicing and billing", sections[key])
                self.assertNotIn("Invoicing", sections.get("skills", ""))
                self.assertNotIn("Invoicing", sections.get("education", ""))

    def test_existing_headings_unchanged(self):
        for heading in ["EXPERIENCE", "Work Experience", "Employment History"]:
            with self.subTest(heading=heading):
                names = [name for name, _ in split_resume_sections(self.RESUME.format(heading=heading))]
                self.assertIn(heading.lower(), names)

    def test_history_in_a_sentence_is_not_a_heading(self):
        text = "SKILLS\nPython\n\nSUMMARY\nStrong work history in retail.\n"
        self.assertNotIn("work history", detect_resume_sections(text))


if __name__ == "__main__":
    unittest.main()
