"""Offline contracts for the thesis bi-encoder and transparent matching rules."""
import io
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from docx import Document

from backend.app.services import matching_service as matching
from backend.app.services import bi_encoder_service as encoder


class MatchingRegressionTests(unittest.TestCase):
    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)
        self.jobs = pd.DataFrame([
            dict(job_id="developer", category_id="K01", job_category="Technology", job_title="Developer",
                job_description="Build Python backend applications and database queries.",
                required_skills_comma_separated="Python Programming; SQL", mapped_required_skill_names="Python Programming; SQL",
                required_skill_ids="SK001;SK004", must_have_skill_ids="", experience_level_required="Entry level",
                location="Philippines", work_type="Remote", salary_range_monthly_php="", job_text_for_matching=""),
            dict(job_id="analyst", category_id="K01", job_category="Technology", job_title="Analyst",
                job_description="Analyze data and build SQL queries for business reports.",
                required_skills_comma_separated="SQL", mapped_required_skill_names="SQL", required_skill_ids="SK004",
                must_have_skill_ids="SK004", experience_level_required="Entry level", location="Philippines",
                work_type="Remote", salary_range_monthly_php="", job_text_for_matching=""),
        ])

    def run_match(self, skills, scores=(0.7, 0.9), preferences=None):
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=self.jobs), \
             patch.object(matching, "score_jobs", return_value=np.asarray(scores)), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources", return_value=[]):
            return matching.match_text_to_jobs("Python developer builds backend applications and reports.",
                confirmed_skills=skills, preferences=preferences)

    def test_canonical_coverage_is_three_of_four_without_partial_credit(self):
        result = matching.compute_skill_coverage(["SK001", "SQL", "Excel"], ["Python Programming", "SK004", "Excel", "Data Visualization"])
        self.assertEqual(result["skill_coverage"], 0.75)
        self.assertEqual(result["missing_skills"], ["Data Visualization"])
        separate = matching.compute_skill_coverage(["Data Analysis"], ["Data Visualization"])
        self.assertEqual(separate["skill_coverage"], 0)

    def test_no_forced_fit_now_or_critical_skill_override(self):
        result = self.run_match([{"skill_id": "SK001", "skill_name": "Python Programming"}])
        self.assertEqual([item["job_id"] for item in result["fit_now_matches"]], ["developer"])
        self.assertEqual(result["aspiration_matches"][0]["critical_missing_skill_ids"], ["SK004"])
        empty = self.run_match([])
        self.assertEqual(empty["fit_now_matches"], [])
        self.assertEqual(len(empty["aspiration_matches"]), 2)

    def test_text_route_extracts_resume_skills_when_ids_are_missing(self):
        with patch.object(matching, "extract_skills_from_text", return_value=[{
            "skill_id": "SK001",
            "skill_name": "Python Programming",
        }]), \
            patch.object(matching, "load_internal_jobs_dataframe", return_value=self.jobs), \
            patch.object(matching, "score_jobs", return_value=np.asarray([0.7, 0.9])), \
            patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
            patch.object(matching, "recommend_learning_resources", return_value=[]):
            result = matching.match_jobs(
                "Python developer builds backend applications and reports.",
                candidate_skill_ids=[],
            )

        self.assertEqual(result["confirmed_skills"], ["Python Programming"])
        self.assertEqual([item["job_id"] for item in result["fit_now_matches"]], ["developer"])

    def test_cosine_is_not_catalog_rescaled_and_preferences_do_not_replace_ranking(self):
        result = self.run_match([], preferences={"target_role": "Developer"})
        self.assertEqual([item["job_id"] for item in result["aspiration_matches"]], ["analyst", "developer"])
        self.assertEqual(result["aspiration_matches"][0]["match_percentage"], 90)
        self.assertEqual(result["aspiration_matches"][1]["match_percentage"], 70)
        self.assertEqual(result["metadata"]["model_version"], encoder.MODEL_ID)
        self.assertIn("bi-encoder", result["model_used"])

    def test_career_area_slug_aligns_with_backend_job_category(self):
        job = {
            "job_category": "Technology, Data, and Digital Systems",
            "job_title": "Data Analyst",
            "job_description": "Analyze business data.",
            "experience_level_required": "Entry level",
            "work_type": "Remote",
            "salary_range_monthly_php": "",
        }
        self.assertEqual(
            matching.compute_preference_alignment(job, {"industry": "technology-data"}),
            1.0,
        )

    def test_expanded_category_ids_are_normalized_through_k24(self):
        self.assertEqual(matching.normalize_category_id("K24"), "K24")
        self.assertEqual(matching.normalize_category_id("24"), "K24")
        self.assertEqual(matching.normalize_category_id("K25"), "K25")

    def test_skill_ids_are_authoritative_and_unknown_ids_rejected(self):
        result = self.run_match([{"skill_id": "SK001", "skill_name": "SQL"}])
        self.assertEqual(result["confirmed_skills"], ["Python Programming"])
        self.assertEqual(result["fit_now_matches"][0]["matched_skill_ids"], ["SK001"])
        with self.assertRaises(ValueError):
            self.run_match([{"skill_id": "UNKNOWN", "skill_name": "SQL"}])

    def test_gap_ids_feed_learning_and_unreviewed_keyword_resources_do_not_count(self):
        result = self.run_match([])
        self.assertTrue(any(gap["skill_id"] == "SK004" for gap in result["skill_gaps"]))
        rows = pd.DataFrame([dict(skill_ids="SK004", skills_youll_gain="SQL", status="active")])
        with patch.object(matching, "load_reviewed_learning_resources", return_value=rows):
            self.assertEqual(matching.compute_learning_readiness(["SQL"]), 0)

    def test_empty_catalog_does_not_infer(self):
        with patch.object(encoder, "get_bi_encoder") as load:
            self.assertEqual(encoder.score_jobs("query", []).tolist(), [])
        load.assert_not_called()

    def test_file_and_text_routes_share_exact_scoring(self):
        text = "Python developer builds backend applications and database reports."
        document = Document(); document.add_paragraph(text)
        file = io.BytesIO(); document.save(file)
        records = [{"skill_id": "SK001", "skill_name": "Python Programming"}]
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=self.jobs), \
             patch.object(matching, "score_jobs", return_value=np.asarray([0.7, 0.9])), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources", return_value=[]):
            file_result = matching.match_resume_to_jobs(file.getvalue(), "fixture.docx", confirmed_skills=records)
            text_result = matching.match_jobs(text, candidate_skill_ids=["SK001"])
        self.assertEqual(file_result["all_fit_now_matches"], text_result["all_fit_now_matches"])
        self.assertEqual(file_result["all_aspiration_matches"], text_result["all_aspiration_matches"])

    def test_results_never_show_skill_or_category_identifiers(self):
        import re
        jobs = self.jobs.copy()
        # Jobs still carry legacy IDs with no taxonomy entry.
        jobs.loc[0, "required_skill_ids"] = "SK001;SK_CRM"
        jobs.loc[0, "must_have_skill_ids"] = "SK001;SK_CRM"
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=jobs), \
             patch.object(matching, "score_jobs", return_value=np.asarray([0.9, 0.7])), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources", return_value=[]):
            result = matching.match_text_to_jobs("Python developer with CRM experience.",
                confirmed_skills=[{"skill_id": "SK001", "skill_name": "Python Programming"}])
        shown = [name
                 for match in result["all_fit_now_matches"] + result["all_aspiration_matches"]
                 for name in match["matched_skills"] + match["missing_skills"]]
        shown += [gap["skill_name"] for gap in result["skill_gaps"]]
        self.assertTrue(shown)
        for name in shown:
            self.assertIsNone(re.fullmatch(r"SK[_-]?[A-Za-z0-9_-]*|K\d{1,2}", name), f"identifier shown to the user: {name}")
        labels = {"SK029": "Customer Service"}
        # A legacy job ID with no taxonomy entry reads as words rather than being hidden.
        self.assertEqual(matching.display_skill_name("SK_GOOGLE_WORKSPACE", labels), "Google Workspace")
        self.assertEqual(matching.display_skill_name("SK029", labels), "Customer Service")
        self.assertEqual(matching.display_skill_name("SK404", labels), "")

    def test_job_list_is_reused_until_the_cache_expires(self):
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=self.jobs) as load:
            first = matching.load_reference_jobs()
            first["added_by_caller"] = 1
            second = matching.load_reference_jobs()
            self.assertEqual(load.call_count, 1)
            self.assertNotIn("added_by_caller", second.columns)
            with patch.object(matching, "JOBS_CACHE_SECONDS", 0):
                matching.load_reference_jobs()
            self.assertEqual(load.call_count, 2)
        self.assertEqual(matching.get_jobs_source(), "supabase_internal_and_employer_jobs")

    def test_repeat_resume_upload_skips_parsing(self):
        with patch.object(matching, "extract_text_from_pdf", return_value="Python developer " * 10) as parse:
            first = matching.extract_resume_text_cached(b"%PDF same file", "resume.pdf")
            second = matching.extract_resume_text_cached(b"%PDF same file", "copy.PDF")
        self.assertEqual(first, second)
        self.assertEqual(parse.call_count, 1)


class EncoderRegressionTests(unittest.TestCase):
    def setUp(self):
        encoder._job_vectors.clear()

    def test_cache_reuses_job_vectors_and_invalidates_changed_catalog(self):
        calls = []
        class Model:
            def encode(self, texts, **kwargs):
                calls.append(texts)
                return np.asarray([[3, 4]]) if len(texts) == 1 and texts[0].startswith("query") else np.asarray([[1, 0], [0, 1]])
        with patch.object(encoder, "get_bi_encoder", return_value=Model()):
            self.assertTrue(np.allclose(encoder.score_jobs("query1", ["job1", "job2"]), [0.6, 0.8]))
            encoder.score_jobs("query2", ["job1", "job2"])
            encoder.score_jobs("query3", ["changed job1", "job2"])
        self.assertEqual(sum(len(call) == 2 for call in calls), 2)

    def test_training_input_limits_and_contact_redaction(self):
        value = encoder.build_model_input("Python developer jane@example.org https://example.org +63 912 345 6789 " + "evidence " * 400)
        self.assertTrue(value.startswith("[ROLE]  [SKILLS]"))
        self.assertIn("[EMAIL]", value)
        self.assertIn("[URL]", value)
        self.assertNotIn("jane@example.org", value)
        self.assertLessEqual(len(value.split("[EVIDENCE] ")[1]), 1400)
        self.assertLessEqual(len(value.split("[SKILLS] ")[1].split(" [EVIDENCE]")[0].split("; ")), 32)

    def test_missing_model_returns_readable_error_without_another_algorithm(self):
        encoder.get_bi_encoder.cache_clear()
        with patch.object(encoder, "model_path", return_value=Path("/tmp/kareerly-model-does-not-exist")):
            with self.assertRaises(encoder.MatchingModelUnavailable):
                encoder.get_bi_encoder()


if __name__ == "__main__":
    unittest.main()
