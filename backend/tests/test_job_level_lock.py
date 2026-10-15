"""Step 3 job-level lock, enforced in stage 1 (constraint gating).

A career area with zero confirmed skills locks the job level to entry-level;
one confirmed skill in the area is enough to lift the lock. The client's level
is never trusted: a mid-level request for an out-of-area career is matched as
entry-level, and the report gets the reason.
"""
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from backend.app.services import matching_service as matching

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
RESUME = ("Customer support specialist. Skills: customer service, Zendesk. "
          "Experience: Support Agent, Example Co, 2021 - Present, resolved tickets in Zendesk.")
# Customer Service (SK029) is in Sales, Marketing & Customer Service and in
# Hospitality, but in no engineering area.
CONFIRMED = [{"skill_id": "SK029", "skill_name": "Customer Service"}]
MID_LEVEL = {"role_level": "mid", "target_role": "mid", "role": "mid", "work_setup": "flexible",
    "salary_expectation": "unsure"}


def job(job_id, title, category_id, category, required_ids, level):
    return dict(
        job_id=job_id, category_id=category_id, job_category=category, job_subcategory="", job_title=title,
        job_description=title, required_skills_comma_separated="", mapped_required_skill_names="",
        required_skill_ids=required_ids, must_have_skill_ids=required_ids, experience_level_required=level,
        location="Metro Manila", work_type="Onsite", salary_range_monthly_php="PHP 18,000 - 25,000",
        job_text_for_matching="",
    )


JOBS = pd.DataFrame([
    job("junior-eng", "Junior Site Engineer", "K17", "Construction and Skilled Trades", "SK070;SK680", "Entry Level"),
    job("mid-eng", "Site Engineer", "K17", "Construction and Skilled Trades", "SK070;SK680", "Mid Level"),
])
SEMANTIC = np.asarray([0.30, 0.30])


def report(preferences, confirmed=CONFIRMED):
    with patch.object(matching, "load_internal_jobs_dataframe", return_value=JOBS), \
         patch.object(matching, "score_jobs", return_value=SEMANTIC), \
         patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
         patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
        return matching.match_text_to_jobs(RESUME, confirmed_skills=confirmed, preferences=preferences)


class JobLevelGateTests(unittest.TestCase):
    def test_area_with_zero_confirmed_skills_locks_to_entry_level(self):
        gated, lock = matching.gate_job_level({"industry": "construction-maintenance", **MID_LEVEL}, CONFIRMED)
        self.assertEqual(gated["role_level"], "entry")
        self.assertEqual(gated["target_role"], "entry")
        self.assertEqual(gated["role"], "entry")
        self.assertEqual(lock["reason"], "no_confirmed_skills_in_career_area")
        self.assertEqual(lock["requested_level"], "mid")
        self.assertTrue(lock["overridden"])

    def test_area_with_one_confirmed_skill_does_not_lock(self):
        preferences = {"industry": "sales-marketing-customer-service", **MID_LEVEL}
        gated, lock = matching.gate_job_level(preferences, CONFIRMED)
        self.assertIsNone(lock)
        self.assertEqual(gated, preferences)

    def test_entry_level_request_is_still_reported_as_locked_but_not_overridden(self):
        gated, lock = matching.gate_job_level({"industry": "construction-maintenance", "role_level": "entry"}, CONFIRMED)
        self.assertEqual(gated["role_level"], "entry")
        self.assertFalse(lock["overridden"])

    def test_unsure_and_labels_are_overridden_but_a_free_text_role_is_kept(self):
        gated, lock = matching.gate_job_level(
            {"industry": "Construction & Maintenance", "role_level": "I'm not sure", "target_role": "Site Engineer"}, CONFIRMED)
        self.assertEqual(gated["role_level"], "entry")
        self.assertEqual(gated["target_role"], "Site Engineer")
        self.assertEqual(lock["career_area_label"], "Construction & Maintenance")

    def test_no_career_area_means_no_lock(self):
        self.assertIsNone(matching.gate_job_level({"role_level": "senior"}, [])[1])

    def test_legacy_area_counts_skills_of_every_area_it_covers(self):
        # Customer Service is in Hospitality, which the legacy broad area covers.
        self.assertIsNone(matching.gate_job_level({"industry": "engineering-trades-operations", **MID_LEVEL}, CONFIRMED)[1])
        self.assertIsNotNone(matching.gate_job_level({"industry": "education-health-community", **MID_LEVEL}, CONFIRMED)[1])


class JobLevelLockReportTests(unittest.TestCase):
    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)

    def test_mid_level_request_for_out_of_area_career_is_overridden_with_reason(self):
        result = report({"industry": "construction-maintenance", **MID_LEVEL})
        lock = result["job_level_lock"]
        self.assertEqual(lock["reason"], "no_confirmed_skills_in_career_area")
        self.assertEqual(lock["requested_level"], "mid")
        self.assertEqual(lock["applied_level"], "entry")
        self.assertEqual(lock["message"],
            "Results are limited to entry-level roles because you have no confirmed skills in Construction & Maintenance yet.")
        # The report echoes the level it was matched with, not the one sent.
        self.assertEqual(result["preferences_used"]["role_level"], "entry")
        # No job passes Fit-Now, so one of the two is listed there as the closest.
        returned = {item["job_id"]: item for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]}
        self.assertEqual(returned["junior-eng"]["preference_conflicts"], [])
        self.assertIn("job_level", returned["mid-eng"]["preference_conflicts"])

    def test_in_area_career_keeps_the_requested_level(self):
        result = report({"industry": "sales-marketing-customer-service", **MID_LEVEL})
        self.assertIsNone(result["job_level_lock"])
        self.assertEqual(result["preferences_used"]["role_level"], "mid")


class CareerAreaSkillsTests(unittest.TestCase):
    def test_every_area_skill_is_a_canonical_skill_with_its_taxonomy_name(self):
        reference = pd.read_csv(DATA_DIR / "skills_reference.csv", dtype=str)
        labels = dict(zip(reference["skill_id"], reference["skill_name"]))
        areas = matching.career_area_skills()
        self.assertEqual(set(areas), set(matching.CAREER_AREA_LABELS))
        for area, skills in areas.items():
            ids = [skill["id"] for skill in skills]
            self.assertEqual(len(ids), len(set(ids)), f"{area} repeats a skill")
            for skill in skills:
                self.assertEqual(labels.get(skill["id"]), skill["name"], f"{area}: {skill['id']}")

    def test_the_api_serves_the_file(self):
        from fastapi.testclient import TestClient
        from backend.app.main import app

        response = TestClient(app).get("/api/career-areas")
        self.assertEqual(response.status_code, 200)
        on_disk = json.loads((DATA_DIR / "career_area_skills.json").read_text(encoding="utf-8"))["areas"]
        self.assertEqual(response.json()["areas"], on_disk)


if __name__ == "__main__":
    unittest.main()
