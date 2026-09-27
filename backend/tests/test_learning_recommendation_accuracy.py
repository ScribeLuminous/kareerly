"""Regression tests: learning recommendations follow the verified skill gaps.

Job requirement -> skill match -> skill gap -> learning resource, through the
production matcher and the bundled learning catalogue
(backend/data/learning_resources.csv). A resource is recommended only for a
skill a returned job is missing, only when it teaches that skill, and with a
reason that names the job and the gap.
"""
import re
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from backend.app import main
from backend.app.services import learning_recommender
from backend.app.services import matching_service as matching


def job(job_id, title, category, required_ids, preferred_ids=""):
    labels = matching.get_skill_labels_by_id()
    names = "; ".join(labels[skill_id] for skill_id in required_ids.split(";") if skill_id)
    preferred = "; ".join(labels[skill_id] for skill_id in preferred_ids.split(";") if skill_id)
    return dict(
        job_id=job_id, category_id=category, job_category="", job_subcategory="", job_title=title,
        job_description=f"{title} role.", required_skills_comma_separated=names, mapped_required_skill_names=names,
        required_skill_ids=required_ids, must_have_skill_ids=required_ids, nice_to_have_skill_ids=preferred_ids,
        mapped_nice_to_have_skill_names=preferred, nice_to_have_skills_optional=preferred,
        experience_level_required="Entry Level", location="Remote", work_type="Remote",
        salary_range_monthly_php="", job_text_for_matching="",
    )


# HTML and CSS (SK677), JavaScript (SK002), React.js (SK678); Microsoft Excel
# (SK629), SQL (SK004), Power BI (SK669); Trello (SK634) has no resource.
FRONTEND = job("FE-1", "Front-End Developer", "K01", "SK677;SK002;SK678")
DATA_ANALYST = job("DA-1", "Data Analyst", "K02", "SK629;SK004;SK669")
PROJECT_ASSISTANT = job("PA-1", "Project Assistant", "K06", "SK002;SK634", preferred_ids="SK669")

WEB_AND_DATA_RESUME = """Sample Candidate
Junior developer and reporting assistant.
SKILLS
HTML, CSS, JavaScript, Microsoft Excel, SQL
EXPERIENCE
Built landing pages with HTML, CSS and JavaScript. Prepared weekly Excel and SQL reports.
"""


def resource_text(resource):
    return " ".join([resource["title"], resource["description"], resource["skills_youll_gain"]]).lower()


class LearningRecommendationTests(unittest.TestCase):
    def setUp(self):
        matching.clear_reference_jobs_cache()
        learning_recommender.clear_learning_resources_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)
        self.addCleanup(learning_recommender.clear_learning_resources_cache)

    def run_matching(self, jobs, resume=WEB_AND_DATA_RESUME):
        frame = pd.DataFrame(jobs)
        # The bundled catalogue (Supabase unreachable) and a fixed role similarity.
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=frame), \
             patch.object(learning_recommender, "load_learning_resources_dataframe", return_value=pd.DataFrame()), \
             patch.object(matching, "score_jobs", return_value=np.full(len(frame), 0.45)):
            return matching.run_matching(resume_text=resume, preferences={})

    def jobs_by_id(self, result):
        return {item["job_id"]: item for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]}

    def for_job(self, result, job_id):
        """What the learning page shows for a selected job: resources for that job's gaps."""
        return [item for item in result["learning_recommendations"]
                if any(job_id in gap["job_ids"] for gap in item["gap_matches"])]

    def test_frontend_developer_missing_react_gets_react_resources(self):
        result = self.run_matching([FRONTEND])
        frontend = self.jobs_by_id(result)["FE-1"]
        self.assertEqual(frontend["missing_skills"], ["React.js"])
        resources = self.for_job(result, "FE-1")
        self.assertTrue(resources)
        for resource in resources:
            with self.subTest(resource=resource["title"]):
                self.assertEqual({gap["skill_name"] for gap in resource["gap_matches"]}, {"React.js"})
                self.assertIn("react", resource_text(resource))
                self.assertNotRegex(resource["title"], r"(?i)python|graphic design|microsoft office")

    def test_data_analyst_missing_power_bi_gets_power_bi_resources(self):
        result = self.run_matching([DATA_ANALYST])
        self.assertEqual(self.jobs_by_id(result)["DA-1"]["missing_skills"], ["Power BI"])
        resources = self.for_job(result, "DA-1")
        self.assertTrue(resources)
        for resource in resources:
            with self.subTest(resource=resource["title"]):
                self.assertIn("power bi", resource_text(resource))
                self.assertNotIn("react", resource_text(resource))

    def test_a_held_skill_is_never_a_learning_gap(self):
        for resume in ("Skills: HTML, CSS, JavaScript, React", "Skills: HTML, CSS, JavaScript, React.js"):
            with self.subTest(resume=resume):
                result = self.run_matching([FRONTEND], resume=resume)
                self.assertIn("React.js", self.jobs_by_id(result)["FE-1"]["matched_skills"])
                self.assertEqual(result["learning_recommendations"], [])
                self.assertEqual(result["skill_gaps"], [])

    def test_changing_the_focus_job_changes_the_resources_and_reasons(self):
        result = self.run_matching([FRONTEND, DATA_ANALYST])
        frontend, analyst = self.for_job(result, "FE-1"), self.for_job(result, "DA-1")
        self.assertTrue(frontend and analyst)
        self.assertFalse({item["resource_id"] for item in frontend} & {item["resource_id"] for item in analyst}
                         - {item["resource_id"] for item in frontend if "power bi" in resource_text(item)})
        for resource in analyst:
            self.assertNotIn("React.js", [gap["skill_name"] for gap in resource["gap_matches"] if "DA-1" in gap["job_ids"]])
            self.assertIn("Data Analyst", resource["why_by_job"]["DA-1"])
            self.assertNotIn("FE-1", {job_id for gap in resource["gap_matches"] if gap["skill_name"] == "Power BI"
                                      for job_id in gap["job_ids"]})
        for resource in frontend:
            self.assertIn("React.js is a required skill for Front-End Developer", resource["why_by_job"]["FE-1"])

    def test_reasons_are_grounded_and_carry_no_invented_scores(self):
        result = self.run_matching([FRONTEND, DATA_ANALYST])
        for resource in result["learning_recommendations"]:
            with self.subTest(resource=resource["title"]):
                self.assertTrue(resource["why_recommended"].startswith("Recommended because "))
                self.assertNotRegex(resource["why_recommended"], r"\d+\s*%")
                self.assertEqual((resource["certification_score"], resource["recommendation_percentage"]), (0, 0))
                self.assertEqual(resource["learning_relation"], "direct")
                for job_id, reason in resource["why_by_job"].items():
                    gap = next(gap for gap in resource["gap_matches"] if job_id in gap["job_ids"])
                    self.assertIn(gap["skill_name"], reason)

    def test_recommendations_never_contradict_the_skill_analysis(self):
        result = self.run_matching([FRONTEND, DATA_ANALYST, PROJECT_ASSISTANT])
        jobs = self.jobs_by_id(result)
        for resource in result["learning_recommendations"]:
            for gap in resource["gap_matches"]:
                for job_id in gap["job_ids"]:
                    with self.subTest(resource=resource["title"], job=job_id, skill=gap["skill_name"]):
                        missing = jobs[job_id]["missing_skills"] + jobs[job_id].get("missing_preferred_skills", [])
                        self.assertIn(gap["skill_name"], missing)
                        self.assertNotIn(gap["skill_name"], jobs[job_id]["matched_skills"])

    def test_a_gap_without_a_resource_that_teaches_it_gets_none(self):
        result = self.run_matching([PROJECT_ASSISTANT])
        self.assertIn("Trello", self.jobs_by_id(result)["PA-1"]["missing_skills"])
        taught = {gap["skill_name"] for item in result["learning_recommendations"] for gap in item["gap_matches"]}
        self.assertNotIn("Trello", taught)

    def test_required_gaps_come_before_nice_to_have_gaps(self):
        result = self.run_matching([PROJECT_ASSISTANT])
        requirements = [item["gap_matches"][0]["requirement"] for item in result["learning_recommendations"]]
        self.assertIn("preferred", requirements)  # Power BI is only nice-to-have here
        self.assertEqual(requirements, sorted(requirements, key=lambda value: value != "essential"))
        power_bi = next(item for item in result["learning_recommendations"] if item["gap_matches"][0]["skill_name"] == "Power BI")
        self.assertIn("a nice-to-have skill for Project Assistant", power_bi["why_by_job"]["PA-1"])

    def test_each_resource_is_listed_once(self):
        result = self.run_matching([FRONTEND, DATA_ANALYST, PROJECT_ASSISTANT])
        ids = [item["resource_id"] for item in result["learning_recommendations"]]
        self.assertEqual(len(ids), len(set(ids)))
        titles = [re.sub(r"\s+", " ", item["title"]).lower() for item in result["learning_recommendations"]]
        self.assertEqual(len(titles), len(set(titles)))

    def test_no_gaps_means_no_recommendations(self):
        result = self.run_matching([job("HC-1", "Web Assistant", "K01", "SK677;SK002")])
        self.assertEqual(self.jobs_by_id(result)["HC-1"]["missing_skills"], [])
        self.assertEqual(result["learning_recommendations"], [])

    def test_limited_report_lists_resources_for_its_own_jobs_only(self):
        result = self.run_matching([FRONTEND, DATA_ANALYST])
        # The report lists only the first job; the other job's resources are left out.
        shown = (result["all_fit_now_matches"] + result["all_aspiration_matches"])[:1]
        shown_ids = {item["job_id"] for item in shown}
        limited = main._apply_report_access_control({**result, "all_fit_now_matches": [], "all_aspiration_matches": shown},
                                                    "guest", "limited")["limited_report"]
        self.assertTrue(limited["learning_recommendations"])
        for resource in limited["learning_recommendations"]:
            self.assertTrue(shown_ids & {job_id for gap in resource["gap_matches"] for job_id in gap["job_ids"]})


class CatalogMappingTests(unittest.TestCase):
    """The catalog's generated skill IDs are not taken as proof of what a resource teaches."""

    @classmethod
    def setUpClass(cls):
        cls.catalog = pd.read_csv(learning_recommender.LEARNING_RESOURCES_PATH, dtype=str, keep_default_na=False)

    def recommend(self, skill_id):
        name = matching.get_skill_labels_by_id()[skill_id]
        with patch.object(learning_recommender, "load_learning_resources_dataframe", return_value=pd.DataFrame()):
            learning_recommender.clear_learning_resources_cache()
            return matching.learning_recommendations_for(
                [{"job_id": "J", "job_title": "Job", "missing_skill_ids": [skill_id], "missing_skills": [name]}])

    def test_wrongly_mapped_certificates_are_not_recommended(self):
        cases = {
            "SK004": "Meta Social Media Marketing",  # SQL
            "SK008": "Certified Public Accountant",  # Database Management
            "SK003": "Certified Information Systems Security",  # Web Development
            "SK040": "AWS Certified Solutions Architect",  # Graphic Design
            "SK046": "Google Data Analytics",  # Classroom Management
        }
        for skill_id, title in cases.items():
            with self.subTest(skill_id=skill_id):
                self.assertFalse([item for item in self.recommend(skill_id) if item["title"].replace("\n", " ").startswith(title)])

    def test_generated_placeholders_are_never_recommended(self):
        placeholders = set(self.catalog.loc[self.catalog["status"] == "Generated - Review Needed", "resource_id"])
        for skill_id in ("SK004", "SK003", "SK012", "SK020", "SK119"):
            with self.subTest(skill_id=skill_id):
                self.assertFalse({item["resource_id"] for item in self.recommend(skill_id)} & placeholders)

    def test_real_resources_still_teach_their_skills(self):
        for skill_id, word in {"SK004": "sql", "SK012": "bookkeeping", "SK669": "power bi", "SK678": "react"}.items():
            with self.subTest(skill_id=skill_id):
                resources = self.recommend(skill_id)
                self.assertTrue(resources)
                for resource in resources:
                    self.assertIn(word, resource_text(resource))


if __name__ == "__main__":
    unittest.main()
