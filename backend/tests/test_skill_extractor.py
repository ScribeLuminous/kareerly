"""Resume skill extraction must come from skill names and synonyms, not category words."""
import unittest

from backend.app.services.skill_extractor import SkillExtractor


class SkillExtractorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.extractor = SkillExtractor()

    def extract(self, text):
        return {skill["skill_name"] for skill in self.extractor.extract_skills_from_sections({"full_text": text})}

    def test_category_words_do_not_become_skills(self):
        text = ("Executive assistant supporting clients across operations, customer service, healthcare, "
                "construction, and ecommerce. Handled data verification, inventory listings, and business workflows. "
                "EDUCATION Bachelor of Science in Computer Science. Maintained CRM records.")
        skills = self.extract(text)
        self.assertIn("Customer Service", skills)
        self.assertIn("Customer relationship management", skills)
        for unrelated in ["Cyber attack counter-measures", "Python Programming", "SQL", "Clinical Documentation",
                          "Classroom Management", "Technical Drafting", "Bookkeeping"]:
            self.assertNotIn(unrelated, skills)

    def test_named_skills_are_still_found(self):
        skills = self.extract("Wrote Python and SQL queries and built data visualization dashboards.")
        self.assertTrue({"SQL", "Data Visualization"} <= skills, skills)
        self.assertTrue(any(name.startswith("Python") for name in skills), skills)


if __name__ == "__main__":
    unittest.main()
