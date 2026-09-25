"""Regression tests for a Step 4 report with zero Fit-Now matches and no
relevant recommendation.

Reproduced failure (2026-09-25): an executive/administrative assistant resume
with Communications & Creative Media as its career area. No job reached the
75% Fit-Now coverage rule, so every job the resume was closest to (customer
success, customer service, sales) was Low Match and hidden, while Aspiration
listed creative jobs that share no skill with the resume. The candidate saw no
relevant job although the catalogue had several.

The fix keeps Fit-Now unchanged and adds Closest Match: with no Fit-Now job,
the jobs nearest to it are shown, labelled as not Fit-Now, with the rules they
failed. An empty or unreadable catalogue is reported, never filled in.
"""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from backend.app import main
from backend.app.services import matching_service as matching
from backend.tests.test_named_tool_report import RESUME_LINES

RESUME = "\n".join(RESUME_LINES)
CONFIRMED = [
    {"skill_id": "SK029", "skill_name": "Customer Service"},
    {"skill_id": "SK300", "skill_name": "Use customer relationship management software"},
    {"skill_id": "SK623", "skill_name": "Email Management"},
    {"skill_id": "SK622", "skill_name": "Calendar Management"},
]
CREATIVE_AREA = {"industry": "communications-creative-media", "role_level": "entry", "work_setup": "flexible"}


def job(job_id, title, category_id, category, required_ids, must_have=""):
    return dict(
        job_id=job_id, category_id=category_id, job_category=category, job_subcategory="", job_title=title,
        job_description=f"{title} role.", required_skills_comma_separated="", mapped_required_skill_names="",
        required_skill_ids=required_ids, must_have_skill_ids=must_have, experience_level_required="Entry level",
        location="Metro Manila", work_type="Onsite", salary_range_monthly_php="", job_text_for_matching="",
    )


# Customer Service (SK029), CRM software (SK300), Negotiation (SK032), Video
# Editing (SK039), Copywriting (SK035); SK_* IDs are legacy names.
CATALOGUE = pd.DataFrame([
    job("cs-associate", "Customer Success Associate", "K09", "Customer Service and Retail", "SK029;SK300;SK_ONBOARDING"),
    job("account-exec", "Account Executive", "K07", "Sales and Purchasing", "SK300;SK032;SK_SALES_TECHNIQUES"),
    job("designer", "Graphic Designer", "K11", "Design, Media, and Performing Arts", "SK039;SK_GRAPHIC_DESIGN"),
    job("writer", "Content Writer", "K10", "Writing, Language, and Communications", "SK035;SK_COPYWRITING"),
])
# Role similarity the fine-tuned model gives pairs like these.
SEMANTIC = np.asarray([0.45, 0.30, 0.05, 0.12])


def run(jobs=CATALOGUE, scores=SEMANTIC, preferences=CREATIVE_AREA, confirmed=CONFIRMED):
    matching.clear_reference_jobs_cache()
    try:
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=jobs), \
             patch.object(matching, "score_jobs", return_value=np.asarray(scores)), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            return matching.match_text_to_jobs(RESUME, confirmed_skills=confirmed, preferences=preferences)
    finally:
        matching.clear_reference_jobs_cache()


def ids(items):
    return [item["job_id"] for item in items]


class ReproducedFailureTests(unittest.TestCase):
    def test_no_job_passes_fit_now_and_the_career_area_holds_only_unrelated_jobs(self):
        result = run()
        # The reproduced conditions: zero Fit-Now, and Aspiration holds only
        # the creative jobs, which share no skill with the resume.
        self.assertEqual(result["all_fit_now_matches"], [])
        self.assertEqual(set(ids(result["all_aspiration_matches"])), {"designer", "writer"})
        for item in result["all_aspiration_matches"]:
            self.assertEqual(item["matched_skills"], [])

    def test_the_candidate_now_sees_the_jobs_the_resume_is_closest_to(self):
        result = run()
        closest = result["closest_matches"]
        self.assertEqual(ids(closest), ["cs-associate", "account-exec"])
        top = closest[0]
        self.assertEqual(top["match_category"], "Closest Match")
        self.assertEqual(top["match_type"], "Closest Match")
        self.assertTrue(top["is_closest_match"])
        self.assertEqual(top["closest_match_strength"], "related")
        # Outside the chosen career area, so the scoring rules made it Low Match.
        self.assertEqual(top["base_match_category"], "Low Match")
        self.assertEqual(top["missing_skills"], ["Onboarding"])
        self.assertIn("Not a Fit-Now match yet", top["match_reason"])
        self.assertIn("2 of 3 required skills", top["match_reason"])
        self.assertIn("75%", top["match_reason"])
        self.assertIn("Closest Match", result["recommendation_notice"])


class FitNowIntegrityTests(unittest.TestCase):
    def test_fit_now_rules_are_unchanged(self):
        result = run()
        for item in result["closest_matches"]:
            self.assertNotEqual(item["match_type"], "Fit-Now")
            self.assertTrue(item["match_breakdown"]["failed_fit_now_rules"])
        self.assertEqual(result["debug_summary"]["fit_now_count"], 0)

    def test_a_missing_must_have_skill_is_a_closest_match_not_fit_now(self):
        # The resume holds every required skill except the one the employer
        # singled out as a must-have.
        jobs = pd.DataFrame([job("crm", "CRM Coordinator", "K09", "Customer Service and Retail",
            "SK029;SK300;SK623;SK622;SK_NEGOTIATION", must_have="SK_NEGOTIATION")])
        result = run(jobs=jobs, scores=[0.6])
        self.assertEqual(result["all_fit_now_matches"], [])
        item = result["closest_matches"][0]
        self.assertEqual(item["match_breakdown"]["required_skill_coverage"], 0.8)
        self.assertIn("critical_skill_missing", item["match_breakdown"]["failed_fit_now_rules"])
        self.assertIn("must-have skill", item["match_reason"])

    def test_no_closest_matches_when_a_fit_now_job_exists(self):
        jobs = pd.concat([CATALOGUE, pd.DataFrame([job("support", "Customer Support Specialist", "K09",
            "Customer Service and Retail", "SK029;SK300;SK623")])], ignore_index=True)
        result = run(jobs=jobs, scores=[*SEMANTIC, 0.5])
        self.assertEqual(ids(result["all_fit_now_matches"]), ["support"])
        self.assertEqual(result["closest_matches"], [])
        self.assertEqual(result["all_closest_matches"], [])
        self.assertEqual(result["recommendation_notice"], "")


class ConsistencyTests(unittest.TestCase):
    def test_each_job_is_listed_once_and_the_counts_agree(self):
        # Customer success is in the chosen area here, so it is Aspiration by
        # the rules; as a closest match it moves out of the Aspiration list.
        result = run(preferences={"industry": "sales-marketing-customer-service"})
        listed = ids(result["all_fit_now_matches"]) + ids(result["all_closest_matches"]) + ids(result["all_aspiration_matches"])
        self.assertEqual(len(listed), len(set(listed)))
        self.assertIn("cs-associate", ids(result["all_closest_matches"]))
        self.assertNotIn("cs-associate", ids(result["all_aspiration_matches"]))
        self.assertEqual(result["closest_matches"][0]["base_match_category"], "Aspiration")
        self.assertEqual(result["total_qualifying_matches"], len(listed))
        summary = result["debug_summary"]
        self.assertEqual(summary["closest_count"], len(result["all_closest_matches"]))
        self.assertEqual(summary["aspiration_count"], len(result["all_aspiration_matches"]))
        self.assertEqual(result["catalog_status"]["state"], "available")
        self.assertEqual(result["catalog_status"]["jobs_available"], 4)

    def test_closest_match_gaps_are_counted(self):
        result = run()
        gaps = {gap["skill_name"]: gap for gap in result["skill_gaps"]}
        self.assertEqual(gaps["Onboarding"]["appears_in_closest"], 1)
        self.assertEqual(gaps["Onboarding"]["appears_in_aspiration"], 0)

    def test_guest_access_limit_applies_to_closest_matches(self):
        jobs = pd.DataFrame([job(f"cs-{n}", f"Customer Success Associate {n}", "K09", "Customer Service and Retail",
            "SK029;SK300;SK_ONBOARDING") for n in range(6)])
        result = run(jobs=jobs, scores=[0.4] * 6)
        self.assertEqual(len(result["closest_matches"]), matching.TOP_CLOSEST)
        limited = main._apply_report_access_control(result, "guest", "initial")["limited_report"]
        self.assertEqual(len(limited["closest_matches"]), 3)
        self.assertEqual(limited["fit_now_matches"], [])

    def test_text_route_keeps_closest_matches(self):
        matching.clear_reference_jobs_cache()
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=CATALOGUE), \
             patch.object(matching, "score_jobs", return_value=SEMANTIC), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            result = matching.match_jobs(RESUME, candidate_skill_ids=["SK029", "SK300"], preferences=CREATIVE_AREA)
        matching.clear_reference_jobs_cache()
        self.assertEqual(ids(result["closest_matches"])[0], "cs-associate")


class WeakFallbackTests(unittest.TestCase):
    def test_one_honestly_labelled_job_when_nothing_is_related(self):
        result = run(jobs=CATALOGUE.iloc[2:].reset_index(drop=True), scores=[0.05, 0.12])
        closest = result["closest_matches"]
        self.assertEqual(len(closest), 1)
        self.assertEqual(closest[0]["closest_match_strength"], "weak")
        self.assertIn("little overlap", closest[0]["match_reason"])
        self.assertEqual(closest[0]["job_id"], "writer")


class CatalogueStatusTests(unittest.TestCase):
    def run_with_csv(self, path):
        matching.clear_reference_jobs_cache()
        try:
            with patch.object(matching, "load_internal_jobs_dataframe", return_value=pd.DataFrame()), \
                 patch.object(matching, "REFERENCE_JOBS_PATH", path), \
                 patch.object(matching, "score_jobs") as score:
                result = matching.match_text_to_jobs(RESUME, confirmed_skills=CONFIRMED, preferences=CREATIVE_AREA)
            score.assert_not_called()
            return result
        finally:
            matching.clear_reference_jobs_cache()

    def assert_nothing_invented(self, result):
        for key in ("fit_now_matches", "aspiration_matches", "closest_matches", "all_fit_now_matches",
                    "all_aspiration_matches", "all_closest_matches", "skill_gaps", "learning_recommendations"):
            self.assertEqual(result[key], [], key)
        self.assertEqual(result["total_qualifying_matches"], 0)
        self.assertEqual(result["recommendation_notice"], result["catalog_status"]["message"])

    def test_empty_catalogue_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reference_jobs.csv"
            path.write_text(",".join(CATALOGUE.columns) + "\n", encoding="utf-8")
            result = self.run_with_csv(str(path))
        self.assert_nothing_invented(result)
        self.assertEqual(result["catalog_status"]["state"], "empty")
        self.assertIn("no active job postings", result["catalog_status"]["message"])

    def test_unreadable_catalogue_is_reported(self):
        result = self.run_with_csv(os.path.join(tempfile.gettempdir(), "kareerly-missing-jobs.csv"))
        self.assert_nothing_invented(result)
        self.assertEqual(result["catalog_status"]["state"], "unavailable")
        self.assertEqual(result["metadata"]["jobs_source"], "unavailable")
        self.assertIn("could not be loaded", result["catalog_status"]["message"])


class ReviewedEvidenceTests(unittest.TestCase):
    def test_office_suites_show_office_software_but_not_excel(self):
        result = matching.compute_skill_coverage([], ["SK186", "SK629"], "Maintained files using Microsoft 365 and Google Workspace.")
        self.assertEqual(result["matched_skills"], ["Office software"])
        self.assertEqual(result["missing_skills"], ["Microsoft Excel"])

    def test_document_and_records_organization_shows_document_management(self):
        for text in ["Core skills: Document & Records Organization", "document and records organization"]:
            self.assertEqual(matching.compute_skill_coverage([], ["SK016"], text)["matched_skills"], ["Document Management"])
        self.assertEqual(matching.compute_skill_coverage([], ["SK016"], "Prepared documents for clients.")["matched_skills"], [])


class CsvLoadingTests(unittest.TestCase):
    def test_blank_cells_and_line_breaks_are_cleaned_with_any_pandas_text_dtype(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "jobs.csv"
            path.write_text('job_id,job_title,notes\nJ1,"Customer Success\nManager",\nJ2,Clerk,remote\n', encoding="utf-8")
            frame = matching.safe_read_csv(str(path))
        self.assertEqual(frame.loc[0, "job_title"], "Customer Success Manager")
        self.assertEqual(frame.loc[0, "notes"], "")


if __name__ == "__main__":
    unittest.main()
