"""Regression tests for a Step 4 report where no job passes every Fit-Now rule.

An executive/administrative assistant resume with Communications & Creative
Media as the Step 3 career area. No job reaches the 75% Fit-Now coverage rule.

Product rule (2026-09-25): Fit-Now reads the resume only; Aspiration follows
the Step 3 preferences (the chosen career area, without a clear job level,
work setup or salary conflict), and the resume is compared with those jobs
for the score, the order and the skills to build. So the creative jobs are
Aspiration even though the resume shares no skill with them.

Product rule (2026-10-15): when no job passes every Fit-Now rule, the job
closest to the resume is listed as Fit-Now, marked ``fit_now_fallback``,
whatever the Step 3 answers. ``closest_matches`` stays in the response, always
empty, for older clients.

Product rule (2026-10-29): only a job near Fit-Now can be listed that way: a
related Low Match job that holds 50% or more of its required skills and misses
no must-have. An Aspiration job stays Aspiration, and with no job near Fit-Now
the Fit-Now list is empty. (A Company Nurse job sharing one office skill with a
teacher's resume was called "the closest to your resume".)
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


SALES_AREA = {"industry": "sales-marketing-customer-service", "role_level": "entry", "work_setup": "flexible"}


class CareerAreaTests(unittest.TestCase):
    def test_aspiration_is_the_chosen_area_whatever_the_resume_shares(self):
        result = run()
        # Outside the chosen area, but the closest job to the resume.
        self.assertEqual(ids(result["all_fit_now_matches"]), ["cs-associate"])
        self.assertEqual(set(ids(result["all_aspiration_matches"])), {"designer", "writer"})
        for item in result["all_aspiration_matches"]:
            self.assertTrue(item["in_preferred_career_area"])
            # The resume is still compared with the job: the skills to build.
            self.assertEqual(item["matched_skills"], [])
            self.assertEqual(item["aspiration_gap_skills"], item["missing_skills"])
            self.assertTrue(item["missing_skills"])
        # Related to the resume, but outside the chosen area: neither list.
        self.assertEqual(result["debug_summary"]["aspiration_blockers"], {"outside_career_area": 2})
        self.assertIn("No job meets every Fit-Now requirement yet", result["recommendation_notice"])

    def test_shared_skills_are_noted_and_raise_the_score(self):
        jobs = pd.DataFrame([
            job("account-exec", "Account Executive", "K07", "Sales and Purchasing", "SK300;SK032;SK_SALES_TECHNIQUES"),
            job("sales-assistant", "Sales Assistant", "K07", "Sales and Purchasing", "SK_SALES_TECHNIQUES"),
            # Passes every Fit-Now rule, so both Aspiration jobs stay Aspiration.
            job("support", "Customer Support Specialist", "K09", "Customer Service and Retail", "SK029;SK300;SK623"),
        ])
        result = run(jobs=jobs, scores=[0.30, 0.30, 0.5], preferences=SALES_AREA)
        self.assertEqual(ids(result["all_fit_now_matches"]), ["support"])
        self.assertEqual(ids(result["all_aspiration_matches"]), ["account-exec", "sales-assistant"])
        top = result["all_aspiration_matches"][0]
        self.assertEqual(top["missing_skills"], ["Negotiation", "Sales Techniques"])
        self.assertEqual(len(top["matched_skills"]), 1)
        self.assertIn("already shows 1 of 3 of its required skills", top["match_reason"])
        self.assertIn("To get there: Negotiation, Sales Techniques", top["match_reason"])

    def test_no_closest_list_is_filled(self):
        result = run()
        self.assertEqual(result["closest_matches"], [])
        self.assertEqual(result["all_closest_matches"], [])
        self.assertEqual(result["debug_summary"]["closest_count"], 0)


class FitNowIntegrityTests(unittest.TestCase):
    def test_a_missing_must_have_skill_blocks_fit_now(self):
        # The resume holds every required skill except the one the employer
        # singled out as a must-have.
        jobs = pd.DataFrame([job("crm", "CRM Coordinator", "K09", "Customer Service and Retail",
            "SK029;SK300;SK623;SK622;SK_NEGOTIATION", must_have="SK_NEGOTIATION")])
        result = run(jobs=jobs, scores=[0.6], preferences=SALES_AREA)
        # Never a Fit-Now, not even as the closest job: it stays Aspiration.
        self.assertEqual(result["all_fit_now_matches"], [])
        item = result["all_aspiration_matches"][0]
        self.assertNotIn("fit_now_fallback", item)
        self.assertEqual(item["match_breakdown"]["match_category"], "Aspiration")
        self.assertEqual(item["match_breakdown"]["required_skill_coverage"], 0.8)
        self.assertEqual(item["match_breakdown"]["failed_fit_now_rules"], ["critical_skill_missing"])
        self.assertEqual(item["missing_must_have_skills"], ["Negotiation"])
        self.assertIn("To get there: Negotiation", item["match_reason"])

    def test_fit_now_ignores_the_career_area_and_both_lists_can_be_filled(self):
        jobs = pd.concat([CATALOGUE, pd.DataFrame([job("support", "Customer Support Specialist", "K09",
            "Customer Service and Retail", "SK029;SK300;SK623")])], ignore_index=True)
        result = run(jobs=jobs, scores=[*SEMANTIC, 0.5])
        # Outside the creative area, but the resume already qualifies.
        self.assertEqual(ids(result["all_fit_now_matches"]), ["support"])
        self.assertNotIn("fit_now_fallback", result["all_fit_now_matches"][0])
        self.assertIsNone(result["debug_summary"]["fit_now_fallback"])
        self.assertEqual(set(ids(result["all_aspiration_matches"])), {"designer", "writer"})
        self.assertEqual(result["recommendation_notice"], "")


class ConsistencyTests(unittest.TestCase):
    def test_each_job_is_listed_once_and_the_counts_agree(self):
        result = run(preferences=SALES_AREA)
        listed = ids(result["all_fit_now_matches"]) + ids(result["all_aspiration_matches"])
        self.assertEqual(len(listed), len(set(listed)))
        self.assertEqual(result["total_qualifying_matches"], len(listed))
        summary = result["debug_summary"]
        self.assertEqual(summary["aspiration_count"], len(result["all_aspiration_matches"]))
        self.assertEqual(summary["fit_now_count"] + summary["aspiration_count"] + summary["low_match_count"], 4)
        self.assertEqual(result["catalog_status"]["state"], "available")
        self.assertEqual(result["catalog_status"]["jobs_available"], 4)

    def test_no_job_in_the_chosen_area_means_an_empty_aspiration_list_and_a_notice(self):
        result = run(preferences={"industry": "healthcare-wellness"})
        self.assertEqual(ids(result["all_fit_now_matches"]), ["cs-associate"])
        self.assertEqual(result["all_aspiration_matches"], [])
        # Only the closest job's gaps.
        self.assertEqual([gap["skill_name"] for gap in result["skill_gaps"]], ["Onboarding"])
        self.assertIn("None fits the career area you chose", result["recommendation_notice"])

    def test_guest_access_limit_applies_to_both_lists_and_their_gaps(self):
        jobs = pd.DataFrame([job(f"cs-{n}", f"Customer Success Associate {n}", "K09", "Customer Service and Retail",
            "SK029;SK300;SK_ONBOARDING" if n < 5 else "SK029;SK300;SK_UPSELLING") for n in range(6)])
        result = run(jobs=jobs, scores=[0.4] * 5 + [0.3], preferences=SALES_AREA)
        # All six are in the chosen area and none passes Fit-Now: all Aspiration.
        self.assertEqual(result["fit_now_matches"], [])
        self.assertEqual(len(result["aspiration_matches"]), 6)
        limited = main._apply_report_access_control(result, "guest", "initial")["limited_report"]
        self.assertEqual(limited["fit_now_matches"], [])
        self.assertEqual(len(limited["aspiration_matches"]), 3)
        self.assertEqual(limited["closest_matches"], [])
        # The guest sees three jobs, none of which needs Upselling.
        shown = {item["job_id"] for item in limited["fit_now_matches"] + limited["aspiration_matches"]}
        for gap in limited["skill_gaps"]:
            self.assertTrue({job["job_id"] for job in gap["affected_job_details"]} <= shown, gap)
        self.assertNotIn("Upselling", [gap["skill_name"] for gap in limited["skill_gaps"]])

    def test_text_route_uses_the_same_rules(self):
        matching.clear_reference_jobs_cache()
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=CATALOGUE), \
             patch.object(matching, "score_jobs", return_value=SEMANTIC), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            result = matching.match_jobs(RESUME, candidate_skill_ids=["SK029", "SK300"], preferences=CREATIVE_AREA)
        matching.clear_reference_jobs_cache()
        self.assertEqual(ids(result["fit_now_matches"]), ["cs-associate"])
        self.assertEqual(set(ids(result["aspiration_matches"])), {"designer", "writer"})
        self.assertEqual(result["closest_matches"], [])


class FitNowFallbackTests(unittest.TestCase):
    """An empty Fit-Now list takes the job near Fit-Now, whatever the Step 3 answers."""

    # Career areas that leave the Customer Success job a Low Match.
    PREFERENCES = [
        CREATIVE_AREA,
        {"industry": "healthcare-wellness", "role_level": "senior", "work_setup": "remote", "salary_expectation": "50+"},
        {"industry": "communications-creative-media", "location_scope": "region", "region": "BARMM", "work_setup": "onsite"},
    ]

    def test_every_preference_gets_the_same_closest_job(self):
        for preferences in self.PREFERENCES:
            with self.subTest(preferences):
                result = run(preferences=preferences)
                self.assertEqual(ids(result["all_fit_now_matches"]), ["cs-associate"])
                self.assertEqual(ids(result["fit_now_matches"]), ["cs-associate"])
                self.assertEqual(result["debug_summary"]["fit_now_count"], 1)

    def test_the_closest_job_is_marked_and_explained(self):
        result = run()
        item = result["all_fit_now_matches"][0]
        self.assertTrue(item["fit_now_fallback"])
        self.assertEqual(item["fit_now_fallback_reason"], "closest_to_resume")
        self.assertEqual(item["match_type"], "Fit-Now")
        self.assertEqual(item["aspiration_gap_skills"], [])
        # The scoring rules are reported as they are; nothing is overridden.
        self.assertEqual(item["match_breakdown"]["match_category"], "Low Match")
        self.assertEqual(item["match_breakdown"]["failed_fit_now_rules"], ["required_skill_coverage"])
        self.assertIn("closest to your resume", item["match_reason"])
        self.assertIn("To be fully ready: Onboarding", item["match_reason"])
        self.assertTrue(item["explanation"].startswith("No job meets every Fit-Now requirement yet; "
            "Customer Success Associate is the closest to your resume"))
        self.assertEqual(result["debug_summary"]["fit_now_fallback"],
            {"job_id": "cs-associate", "reason": "closest_to_resume", "scored_as": "Low Match"})
        self.assertEqual(result["debug_summary"]["low_match_count"], 1)

    def test_only_a_job_near_fit_now_is_listed(self):
        # Higher similarity alone does not make the account executive close:
        # the resume holds one of its three required skills.
        result = run(scores=[0.35, 0.60, 0.05, 0.12])
        self.assertEqual(ids(result["all_fit_now_matches"]), ["cs-associate"])
        # Unrelated to the resume, the Customer Success job is not close either.
        result = run(scores=[0.05, 0.95, 0.05, 0.12])
        self.assertEqual(result["all_fit_now_matches"], [])
        self.assertIsNone(result["debug_summary"]["fit_now_fallback"])
        self.assertEqual(set(ids(result["all_aspiration_matches"])), {"designer", "writer"})
        self.assertIn("No job meets every Fit-Now requirement yet. The Aspiration list", result["recommendation_notice"])

    def test_a_job_sharing_one_skill_is_not_called_the_closest(self):
        # Company Nurse for a teacher's resume: one office skill of three.
        jobs = pd.DataFrame([job("nurse", "Company Nurse", "", "", "SK029;SK_NURSING;SK_OCCUPATIONAL_HEALTH")])
        result = run(jobs=jobs, scores=[0.25], preferences={})
        self.assertEqual(result["all_fit_now_matches"], [])
        self.assertEqual(ids(result["all_aspiration_matches"]), ["nurse"])
        self.assertNotIn("closest to your resume", result["all_aspiration_matches"][0]["explanation"])

    def test_a_resume_with_no_skills_gets_no_closest_job(self):
        result = run(confirmed=[], scores=[0.10, 0.10, 0.40, 0.20])
        self.assertEqual(result["all_fit_now_matches"], [])

    def test_an_aspiration_job_stays_aspiration(self):
        # The Customer Success job is in the chosen area and short of Fit-Now.
        for preferences in ({}, SALES_AREA):
            with self.subTest(preferences):
                result = run(preferences=preferences)
                self.assertEqual(result["all_fit_now_matches"], [])
                self.assertIn("cs-associate", ids(result["all_aspiration_matches"]))
                self.assertIsNone(result["debug_summary"]["fit_now_fallback"])
                self.assertIn("No job meets every Fit-Now requirement yet. The Aspiration list",
                    result["recommendation_notice"])

    def test_an_empty_region_still_gets_the_closest_job_from_elsewhere(self):
        result = run(preferences={**CREATIVE_AREA, "work_setup": "onsite", "location_scope": "region", "region": "BARMM"})
        item = result["all_fit_now_matches"][0]
        self.assertEqual(item["job_id"], "cs-associate")
        self.assertEqual(item["region_filter_status"], "out_of_region")
        self.assertIn("outside the region you chose", item["explanation"])
        self.assertEqual(result["all_aspiration_matches"], [])
        self.assertIn("It is outside Bangsamoro", result["recommendation_notice"])


class PreferenceMismatchTests(unittest.TestCase):
    """A Step 3 answer the job does not fit never moves or hides a Fit-Now job."""

    def test_an_onsite_fit_now_job_stays_fit_now_for_a_hybrid_candidate(self):
        jobs = pd.DataFrame([job("support", "Customer Support Specialist", "K09",
            "Customer Service and Retail", "SK029;SK300;SK623")])
        for setup in ("Hybrid", "100% Work from Home"):
            with self.subTest(setup):
                result = run(jobs=jobs, scores=[0.5], preferences={**CREATIVE_AREA, "work_setup": setup})
                self.assertEqual(ids(result["all_fit_now_matches"]), ["support"])
                item = result["all_fit_now_matches"][0]
                self.assertNotIn("fit_now_fallback", item)
                self.assertEqual(item["preference_conflicts"], ["work_setup"])
                self.assertEqual(item["preference_mismatches"], [{"field": "work_setup", "label": "work setup",
                    "job_value": "Onsite", "chosen_value": {"Hybrid": "Hybrid", "100% Work from Home": "Remote"}[setup]}])

    def test_every_preference_is_flagged_in_plain_words(self):
        # The employer form's options against Step 3 answers, sent as keys or labels.
        cases = [
            ("job_level", {"experience_level_required": "Senior (5+ yrs)"}, {"role_level": "entry"}, "Entry-level"),
            ("job_level", {"experience_level_required": "Junior (1-2 yrs)"}, {"role_level": "Mid-level (2-5 years experience)"}, "Mid-level"),
            ("work_setup", {"work_type": "Remote"}, {"work_setup": "onsite"}, "On-site"),
            ("work_setup", {"work_type": "On-site"}, {"work_setup": "Hybrid (mix of remote & office)"}, "Hybrid"),
            ("salary", {"salary_range_monthly_php": "₱40,000 - 45,000"}, {"salary_expectation": "15-35"}, "PHP 15,000 - 35,000"),
            ("salary", {"salary_range_monthly_php": "₱40,000 - 45,000"}, {"salary_expectation": "PHP 50,001 - more"}, "PHP 50,001+"),
        ]
        for field, posting, preferences, chosen in cases:
            with self.subTest(posting=posting, preferences=preferences):
                conflicts = matching.preference_conflicts(posting, preferences)
                self.assertEqual(conflicts, [field])
                self.assertEqual(matching.preference_mismatches(posting, preferences, conflicts)[0]["chosen_value"], chosen)

    def test_matching_or_open_answers_are_not_flagged(self):
        cases = [
            ({"experience_level_required": "Junior (1-2 yrs)"}, {"role_level": "entry"}),
            ({"experience_level_required": "Senior (5+ yrs)"}, {"role_level": "unsure"}),
            ({"work_type": "On-site"}, {"work_setup": "Flexible - no preference"}),
            ({"salary_range_monthly_php": "₱20,000 - 30,000"}, {"salary_expectation": "15-35"}),
            # Nothing listed on the job: nothing to compare.
            ({"experience_level_required": "", "work_type": "", "salary_range_monthly_php": ""},
             {"role_level": "senior", "work_setup": "remote", "salary_expectation": "50+"}),
        ]
        for posting, preferences in cases:
            with self.subTest(posting=posting, preferences=preferences):
                self.assertEqual(matching.preference_conflicts(posting, preferences), [])

    def test_a_matching_setup_has_no_mismatch(self):
        jobs = pd.DataFrame([job("support", "Customer Support Specialist", "K09",
            "Customer Service and Retail", "SK029;SK300;SK623")])
        result = run(jobs=jobs, scores=[0.5], preferences={**CREATIVE_AREA, "work_setup": "On-site"})
        self.assertEqual(result["all_fit_now_matches"][0]["preference_mismatches"], [])


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
