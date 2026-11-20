"""Graduation year from an education entry (audit PARSE-01)."""
import unittest

from backend.app.services.resume_analyzer import extract_education


def year_of(text):
    entries = extract_education(text, {"education": text})
    return entries[0]["year_graduated"] if entries else None


class GraduationYearTests(unittest.TestCase):
    def test_degree_and_school_on_one_line(self):
        text = ("Bachelor of Science in Statistics — Lanao Lakeside State College\n"
                "Marawi City, Lanao del Sur | 2020 – 2024\n• Cum laude")
        self.assertEqual(year_of(text), "2024")

    def test_a_year_in_a_bullet_is_not_the_graduation_year(self):
        text = ("Bachelor of Science in Accountancy — Davao Gulf College of Business\n"
                "Tagum City, Davao del Norte | 2020 – 2024\n"
                "• Passed the Certified Public Accountant Licensure Examination, May 2025")
        self.assertEqual(year_of(text), "2024")

    def test_range_spellings(self):
        for dates, expected in (("2019-2023", "2023"), ("2018 to 2022", "2022"), ("2017 — 2021", "2021")):
            with self.subTest(dates=dates):
                self.assertEqual(year_of(f"Bachelor of Science in Nursing\nUniversity of San Agustin\n{dates}"), expected)

    def test_an_ongoing_degree_has_no_graduation_year(self):
        self.assertEqual(year_of("Bachelor of Science in Information Technology\nCebu Technological University\n2023 – Present"), "")

    def test_a_single_year_is_still_read(self):
        self.assertEqual(year_of("Bachelor of Science in Tourism Management\nUniversity of San Agustin – Iloilo City, 2017"), "2017")


if __name__ == "__main__":
    unittest.main()
