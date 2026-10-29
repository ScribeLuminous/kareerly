"""Highest educational attainment is one fixed list. The cases are shared with
supabase/tests/education_levels_tests.sql and frontend/tests/education.test.mjs."""
import unittest

from backend.app.services.education import EDUCATION_LEVELS, normalize_education_level

CASES = [
    ("Bachelor", "Bachelor's Degree"),
    ("bachelor", "Bachelor's Degree"),
    ("Bachelor's Degree", "Bachelor's Degree"),
    ("Bachelor’s deg.", "Bachelor's Degree"),
    ("BS Computer Science", "Bachelor's Degree"),
    ("College graduate", "Bachelor's Degree"),
    ("Master's in Education", "Master's Degree"),
    ("MBA", "Master's Degree"),
    ("PhD", "Doctorate Degree"),
    ("Doctor of Medicine", "Doctorate Degree"),
    ("Associate in Hotel Management", "Associate Degree"),
    ("TESDA NC II", "Vocational / Technical"),
    ("Vocational course", "Vocational / Technical"),
    ("some college", "Some College"),
    ("Undergraduate", "Some College"),
    ("Senior High School", "High School"),
    ("high school graduate", "High School"),
    ("Vocational / Technical", "Vocational / Technical"),
    ("", ""),
    ("Elementary", ""),
    ("n/a", ""),
]


class EducationLevelTests(unittest.TestCase):
    def test_free_text_maps_to_the_list(self):
        for text, expected in CASES:
            with self.subTest(text=text):
                self.assertEqual(normalize_education_level(text), expected)

    def test_none_is_empty(self):
        self.assertEqual(normalize_education_level(None), "")

    def test_every_listed_level_maps_to_itself(self):
        for level in EDUCATION_LEVELS:
            self.assertEqual(normalize_education_level(level), level)

    def test_a_resume_degree_gets_a_level(self):
        from backend.app.services.resume_analyzer import extract_education
        text = "EDUCATION\nBS in Information Technology\nLaguna State University 2021"
        entry = extract_education(text, {"education": "BS in Information Technology\nLaguna State University 2021"})[0]
        self.assertEqual(entry["highest_educational_attainment"], "Bachelor's Degree")


if __name__ == "__main__":
    unittest.main()
