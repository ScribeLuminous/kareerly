"""Fit-Now / Aspiration / Low Match classification and its skill evidence."""
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from backend.app.services import match_scoring as scoring
from backend.app.services import matching_service as matching

THRESHOLDS = scoring.MatchThresholds(
    fit_now_min_semantic=scoring.FIT_NOW_MIN_SEMANTIC,
    fit_now_min_required_coverage=scoring.FIT_NOW_MIN_REQUIRED_COVERAGE,
    aspiration_min_semantic=scoring.ASPIRATION_MIN_SEMANTIC,
)
NONE = scoring.SkillEvidence()


def evidence(held: int, missing: int) -> scoring.SkillEvidence:
    return scoring.SkillEvidence([f"H{i}" for i in range(held)], [f"M{i}" for i in range(missing)])


class ClassificationTests(unittest.TestCase):
    def score(self, cosine, required, preferred=NONE, critical=0, in_area=None):
        return scoring.score_match(cosine, required, preferred, critical, THRESHOLDS, in_preferred_career_area=in_area)

    def test_module_documents_the_fit_now_coverage_threshold(self):
        # The docstring said "at least half" after the bar moved to 75%.
        self.assertEqual(scoring.FIT_NOW_MIN_REQUIRED_COVERAGE, 0.75)
        self.assertIn("at least 75%", scoring.__doc__)
        self.assertNotIn("at least half", scoring.__doc__)

    def test_strong_match_is_fit_now(self):
        result = self.score(0.62, evidence(4, 1))
        self.assertEqual(result.match_category, scoring.FIT_NOW)
        self.assertEqual(result.failed_fit_now_rules, [])

    def test_moderate_match_is_aspiration(self):
        result = self.score(0.38, evidence(1, 3))
        self.assertEqual(result.match_category, scoring.ASPIRATION)
        self.assertIn("required_skill_coverage", result.failed_fit_now_rules)

    def test_weak_match_is_neither(self):
        self.assertEqual(self.score(0.08, evidence(0, 4)).match_category, scoring.LOW_MATCH)
        # Related wording without a single shared skill is not a learnable path either.
        self.assertEqual(self.score(0.40, evidence(0, 4)).match_category, scoring.LOW_MATCH)

    def test_missing_skill_data_fails_gracefully(self):
        result = self.score(0.5, NONE)
        self.assertIsNone(result.required_skill_coverage)
        self.assertEqual(result.match_score, 0.5)
        self.assertIn("no_required_skills_listed", result.failed_fit_now_rules)

    def test_zero_required_skills_is_not_rejected_or_divided_by_zero(self):
        result = self.score(0.5, NONE, evidence(1, 1))
        self.assertEqual(result.match_category, scoring.ASPIRATION)
        self.assertEqual(result.required_skill_count, 0)
        self.assertAlmostEqual(result.match_score, (0.45 * 0.5 + 0.10 * 0.5) / 0.55, places=4)

    def test_fit_now_boundaries(self):
        at = scoring.FIT_NOW_MIN_SEMANTIC
        self.assertEqual(self.score(at, evidence(3, 1)).match_category, scoring.FIT_NOW)
        self.assertEqual(self.score(at - 1e-4, evidence(3, 1)).match_category, scoring.ASPIRATION)
        # 0.75 coverage passes; 2 of 3 (0.67) and 1 of 2 (0.50) do not.
        self.assertEqual(self.score(0.6, evidence(3, 1)).match_category, scoring.FIT_NOW)
        self.assertEqual(self.score(0.6, evidence(2, 1)).match_category, scoring.ASPIRATION)
        self.assertEqual(self.score(0.6, evidence(1, 1)).match_category, scoring.ASPIRATION)

    def test_aspiration_boundaries(self):
        at = scoring.ASPIRATION_MIN_SEMANTIC
        self.assertEqual(self.score(at, evidence(1, 4)).match_category, scoring.ASPIRATION)
        self.assertEqual(self.score(at - 1e-4, evidence(1, 4)).match_category, scoring.LOW_MATCH)

    def test_critical_skill_blocks_fit_now_and_is_penalised(self):
        result = self.score(0.7, evidence(3, 1), critical=1)
        self.assertEqual(result.match_category, scoring.ASPIRATION)
        self.assertEqual(result.penalty, scoring.CRITICAL_MISSING_PENALTY)
        self.assertAlmostEqual(result.match_score, result.raw_weighted_score - result.penalty, places=4)

    def test_negative_cosine_is_clipped_not_rescaled(self):
        result = self.score(-0.3, evidence(1, 1))
        self.assertEqual(result.semantic_similarity, 0.0)
        self.assertEqual(result.semantic_similarity_raw, -0.3)
        self.assertEqual(result.match_score, 0.25)

    def test_score_weights_skills_at_least_as_much_as_semantics(self):
        self.assertGreaterEqual(
            scoring.MATCH_WEIGHT_REQUIRED_SKILLS + scoring.MATCH_WEIGHT_PREFERRED_SKILLS,
            scoring.MATCH_WEIGHT_SEMANTIC,
        )

    def test_aspiration_follows_the_chosen_career_area(self):
        # In the chosen area: Aspiration even with no shared skill and low similarity;
        # the resume only sets the score and the gaps.
        chosen = self.score(0.05, evidence(0, 4), in_area=True)
        self.assertEqual(chosen.match_category, scoring.ASPIRATION)
        self.assertEqual(chosen.failed_aspiration_rules, [])
        # Shared skills raise the score within the list.
        self.assertGreater(self.score(0.05, evidence(2, 2), in_area=True).match_score, chosen.match_score)
        # Outside the chosen area, even a related job with shared skills is not an Aspiration.
        outside = self.score(0.40, evidence(1, 3), in_area=False)
        self.assertEqual(outside.match_category, scoring.LOW_MATCH)
        self.assertEqual(outside.failed_aspiration_rules, ["outside_career_area"])

    def test_fit_now_ignores_every_preference(self):
        for in_area in (True, False, None):
            self.assertEqual(self.score(0.62, evidence(4, 1), in_area=in_area).match_category, scoring.FIT_NOW)

    def test_without_a_known_career_area_the_resume_decides(self):
        self.assertEqual(self.score(0.40, evidence(1, 3)).match_category, scoring.ASPIRATION)
        self.assertEqual(self.score(0.10, evidence(1, 3)).failed_aspiration_rules, ["not_related"])
        self.assertEqual(self.score(0.40, evidence(0, 4)).failed_aspiration_rules, ["no_shared_skill"])

    def test_a_job_listing_no_skills(self):
        # Without a known area the resume cannot show anything shared: neither list.
        result = self.score(0.6, NONE)
        self.assertEqual(result.match_category, scoring.LOW_MATCH)
        self.assertIn("no_skills_listed", result.failed_aspiration_rules)
        # In the chosen area it is an Aspiration, scored on role similarity.
        self.assertEqual(self.score(0.6, NONE, in_area=True).match_category, scoring.ASPIRATION)

    def test_fit_now_ignores_career_preferences(self):
        self.assertEqual(self.score(0.62, evidence(4, 1), in_area=False).match_category, scoring.FIT_NOW)
        self.assertEqual(self.score(0.62, evidence(4, 1), in_area=True).match_category, scoring.FIT_NOW)

    def test_thresholds_are_validated(self):
        with patch.dict("os.environ", {"KAREERLY_FIT_NOW_MIN_COSINE": "1.5"}):
            with self.assertRaises(RuntimeError):
                scoring.MatchThresholds.from_env()


class SkillCoverageTests(unittest.TestCase):
    def test_duplicate_taxonomy_ids_count_once(self):
        # SK134 "Python (computer programming)" is an auto-generated copy of SK001.
        result = matching.compute_skill_coverage(["SK134"], ["SK001", "SK134", "SK004"])
        self.assertEqual(result["skill_coverage"], 0.5)
        self.assertEqual(result["matched_skill_ids"], ["SK001"])

    def test_distinct_skills_sharing_a_bad_uri_are_not_merged(self):
        # SK007 Technical Support and SK061 Basic Life Support share an ESCO URI by mistake.
        self.assertEqual(matching.compute_skill_coverage(["SK007"], ["SK061"])["skill_coverage"], 0.0)

    def test_alias_and_case_do_not_reduce_coverage(self):
        result = matching.compute_skill_coverage(["sql", "PYTHON PROGRAMMING"], ["SQL", "Python Programming"])
        self.assertEqual(result["skill_coverage"], 1.0)

    def test_legacy_ids_are_met_by_the_named_skill(self):
        result = matching.compute_skill_coverage(["SK004"], ["SK004", "SK_EXCEL", "SK_POWER_BI"],
            resume_text="Built monthly reports in Excel.")
        self.assertEqual(result["matched_skills"], ["Microsoft Excel", "SQL"])
        self.assertEqual(result["missing_skills"], ["Power BI"])

    def test_resume_naming_a_taxonomy_skill_satisfies_it_but_an_alias_does_not(self):
        # Step 2 confirms at most 20 skills, so a skill the resume names outright still counts.
        self.assertEqual(matching.compute_skill_coverage([], ["SK004"], resume_text="I know SQL.")["skill_coverage"], 1.0)
        # Imported ESCO aliases are too broad to stand in for a confirmed skill.
        self.assertEqual(matching.compute_skill_coverage([], ["SK029"], resume_text="Provided customer care.")["skill_coverage"], 0.0)


class PipelineRegressionTests(unittest.TestCase):
    """The reported bug: obvious strong matches were all labelled Aspiration."""

    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)

    def run_match(self, jobs, cosines, resume, skills):
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=pd.DataFrame(jobs)), \
             patch.object(matching, "score_jobs", return_value=np.asarray(cosines)), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            return matching.match_text_to_jobs(resume, confirmed_skills=skills)

    @staticmethod
    def job(job_id, title, ids, must_have=None, category_id="K02",
            job_category="Data, Analytics, and Artificial Intelligence", **extra):
        return dict(job_id=job_id, category_id=category_id, job_category=job_category,
            job_title=title, job_description=f"{title} role.", required_skills_comma_separated="",
            mapped_required_skill_names="", required_skill_ids=ids,
            must_have_skill_ids=ids if must_have is None else must_have, experience_level_required="Entry level",
            location="Philippines", work_type="Hybrid", salary_range_monthly_php="", job_text_for_matching="", **extra)

    def test_supabase_style_job_with_most_skills_is_fit_now(self):
        # Supabase and pasted jobs copy every required ID into must_have_skill_ids.
        jobs = [self.job("analyst", "Data Analyst", "SK004;SK006;SK134;SK_POWER_BI"),
                self.job("nurse", "Staff Nurse", "SK056;SK061")]
        skills = [{"skill_id": "SK004"}, {"skill_id": "SK006"}, {"skill_id": "SK001"}]
        result = self.run_match(jobs, [0.58, 0.05], "Data analyst using SQL and Python dashboards.", skills)
        self.assertEqual([item["job_id"] for item in result["fit_now_matches"]], ["analyst"])
        fit = result["fit_now_matches"][0]
        self.assertEqual(fit["required_skill_coverage"], 0.75)
        self.assertEqual(fit["critical_missing_skill_ids"], [])
        self.assertEqual(fit["missing_skills"], ["Power BI"])
        self.assertIn("Your resume already covers most", fit["match_reason"])
        # The unrelated job is scored but recommended in neither list.
        self.assertEqual(result["aspiration_matches"], [])
        self.assertEqual(result["debug_summary"]["low_match_count"], 1)

    def test_aspiration_lists_jobs_from_the_chosen_career_area(self):
        jobs = [self.job("analyst", "Data Analyst", "SK004;SK006;SK134;SK_POWER_BI"),
                self.job("nurse", "Staff Nurse", "SK056;SK061", category_id="K14",
                    job_category="Healthcare and Clinical Services"),
                self.job("teacher", "Teacher", "SK045;SK004", category_id="K12", job_category="Education and Training"),
                self.job("bi", "BI Developer", "SK004;SK670;SK669", category_id="K02")]
        skills = [{"skill_id": "SK004"}, {"skill_id": "SK006"}, {"skill_id": "SK001"}]
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=pd.DataFrame(jobs)), \
             patch.object(matching, "score_jobs", return_value=np.asarray([0.58, 0.05, 0.02, 0.55])), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            result = matching.match_text_to_jobs("Data analyst using SQL and Python dashboards.",
                confirmed_skills=skills, preferences={"industry": "education-health-community"})
        # Fit-Now comes from the resume whatever the preference says.
        self.assertEqual([item["job_id"] for item in result["fit_now_matches"]], ["analyst"])
        # Aspiration is every non-Fit-Now job in the chosen area, shared skills or not;
        # the BI job is related to the resume but outside the area.
        self.assertEqual({item["job_id"] for item in result["aspiration_matches"]}, {"nurse", "teacher"})
        nurse = next(item for item in result["aspiration_matches"] if item["job_id"] == "nurse")
        teacher = next(item for item in result["aspiration_matches"] if item["job_id"] == "teacher")
        self.assertEqual(nurse["matched_skills"], [])
        self.assertIn("does not show its required skills yet", nurse["match_reason"])
        # A shared skill (SQL) is noted and raises the score.
        self.assertEqual(teacher["matched_skills"], ["SQL"])
        self.assertGreater(teacher["match_score"], nurse["match_score"])
        self.assertEqual(result["debug_summary"]["aspiration_blockers"], {"outside_career_area": 1})

    def test_education_heading_does_not_add_teaching_skills(self):
        text = ("Junior Software Developer skilled in Python and JavaScript. "
                "EDUCATION Bachelor of Science in Computer Science, 2022.")
        names = {skill["skill_name"] for skill in matching.extract_skills_from_text(text)}
        self.assertIn("Python Programming", names)
        for unrelated in ("Classroom Management", "Library Assistance", "Instructional Design", "Pedagogy"):
            self.assertNotIn(unrelated, names)


if __name__ == "__main__":
    unittest.main()
