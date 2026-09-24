"""Reference jobs and skills stay consistent after the 2026-09-24 data review.

See docs/job-data-anomalies.md for why each rule exists.
"""
import csv
import importlib.util
import unittest
from pathlib import Path

from backend.app.services.skill_extractor import SkillExtractor

DATA = Path(__file__).resolve().parents[1] / "data"
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fix_reference_job_data.py"
spec = importlib.util.spec_from_file_location("fix_reference_job_data", SCRIPT)
fixes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixes)


def read(name):
    with (DATA / name).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def ids(value):
    return [item for item in value.split(";") if item]


class ReferenceJobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jobs = read("reference_jobs.csv")
        cls.skills = {row["skill_id"]: row for row in read("skills_reference.csv")}
        cls.categories = {row["category_id"]: row["category_name"] for row in read("category_reference.csv")}

    def test_skill_ids_exist_and_names_match(self):
        for job in self.jobs:
            for id_field, name_field in (("required_skill_ids", "mapped_required_skill_names"),
                                         ("nice_to_have_skill_ids", "mapped_nice_to_have_skill_names")):
                names = [self.skills[skill_id]["skill_name"] for skill_id in ids(job[id_field])]
                self.assertEqual("; ".join(names), job[name_field], job["job_id"])

    def test_each_skill_is_listed_once(self):
        for job in self.jobs:
            required = ids(job["required_skill_ids"])
            nice = ids(job["nice_to_have_skill_ids"])
            self.assertEqual(len(required), len(set(required)), job["job_id"])
            self.assertFalse(set(required) & set(nice), job["job_id"])

    def test_required_lists_are_short_enough_to_cover(self):
        for job in self.jobs:
            self.assertTrue(1 <= len(ids(job["required_skill_ids"])) <= fixes.MAX_REQUIRED, job["job_id"])

    def test_jobs_use_only_reviewed_skills(self):
        # The ESCO auto-expansion rows were never reviewed; mapping a job to one is how
        # "Provide anti-cancer medical treatment" ended up on an e-commerce job.
        for job in self.jobs:
            for skill_id in ids(job["required_skill_ids"]) + ids(job["nice_to_have_skill_ids"]):
                self.assertNotEqual("auto_generated_review", self.skills[skill_id]["mapping_status"],
                                    f"{job['job_id']} uses unreviewed {skill_id}")

    def test_categories_are_consistent(self):
        for job in self.jobs:
            self.assertEqual(self.categories[job["category_id"]], job["job_category"], job["job_id"])

    def test_descriptions_have_no_internal_boilerplate(self):
        for job in self.jobs:
            self.assertNotIn("coverage seed", job["job_description"].lower(), job["job_id"])
            self.assertNotIn("coverage seed", job["job_text_for_matching"], job["job_id"])

    def test_matching_text_names_the_required_skills(self):
        for job in self.jobs:
            for name in job["mapped_required_skill_names"].split("; "):
                self.assertIn(name.lower(), job["job_text_for_matching"], job["job_id"])

    def test_reported_wrong_requirements_are_gone(self):
        wrong = {
            "JOB-002": ["SK001", "SK002", "SK003"],  # Accounting Assistant: Python, JavaScript, Web Development
            "JOB-009": ["SK040", "SK012", "SK103"],  # Software Developer: Graphic Design, Bookkeeping, Animal Care
            "JOB-010": ["SK071", "SK012"],  # Data Analyst: Masonry, Bookkeeping
            "JOB-044": ["SK435"],  # E-commerce Specialist: anti-cancer treatment
            "JOB-055": ["SK349"],  # Podcast Producer: dental prescriptions
            "JOB-027": ["SK246"],  # Budget Analyst: airport annual budget
            "JOB-146": ["SK060"],  # Livestock Farm Assistant: Elderly Care
            "WEB-20260922-K17": ["SK071", "SK073"],  # Cost Estimator: Masonry, Electrical Installation
        }
        by_id = {job["job_id"]: job for job in self.jobs}
        for job_id, skill_ids in wrong.items():
            listed = ids(by_id[job_id]["required_skill_ids"]) + ids(by_id[job_id]["nice_to_have_skill_ids"])
            self.assertFalse(set(skill_ids) & set(listed), job_id)


class SkillAliasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skills = {row["skill_id"]: row for row in read("skills_reference.csv")}
        cls.extractor = SkillExtractor()

    def extract(self, text):
        return {skill["skill_name"] for skill in self.extractor.extract_skills_from_sections({"full_text": text})}

    def test_unrelated_aliases_were_removed(self):
        for skill_id, terms in fixes.RELATED_DROP.items():
            related = {term.strip().lower() for term in self.skills[skill_id]["related_skills"].split(";")}
            self.assertFalse(related & {term.lower() for term in terms}, skill_id)

    def test_relinked_skills_point_at_the_intended_esco_concept(self):
        for skill_id, label in fixes.SKILL_RELINKS.items():
            self.assertEqual(label, self.skills[skill_id]["esco_preferred_label"], skill_id)

    def test_resume_phrases_map_to_the_right_skill(self):
        self.assertIn("Basic Life Support", self.extract("Certified to perform CPR and administer first aid."))
        self.assertNotIn("Basic Life Support", self.extract("Provided ICT support to 200 office users."))
        self.assertNotIn("Classroom Management", self.extract("Supervised casino floor staff; managing casino operations."))
        self.assertNotIn("Personal Grooming Services", self.extract("Operated the waste incineration plant."))
        self.assertNotIn("Pharmacy Support", self.extract("Served in navy operations and naval exercises."))


if __name__ == "__main__":
    unittest.main()
