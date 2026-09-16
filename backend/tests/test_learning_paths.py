"""Offline catalog contract checks. Fixtures are fictional, never seeded."""
import unittest
import pandas as pd
from app.services.learning_recommender import (
    recommend_learning_resources, recommend_learning_resources_for_gap,
    resource_is_reviewed, provider_url, LEARNING_RESOURCES_PATH,
)

class LearningPathsTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(resource_id="test-1", course_or_certification_title="Certificate title is not evidence",
            offered_by_provider="Test provider", status="active", skill_ids="SQL;PY",
            skill_id_mapping_status="reviewed", review_status="verified", reviewer="test reviewer",
            source_evidence="https://example.org/syllabus", skill_id_mapping_notes="Explicit outcomes",
            last_verified_at="2026-09-13", catalog_version="fixture", resource_type="course",
            external_course_or_certification_link="https://example.org/course")

    def recommend(self, **changes):
        return recommend_learning_resources_for_gap(dict(skill_id="SQL", skill_name="SQL"),
            pd.DataFrame([{**self.row, **changes}]), skills_lookup={})

    def test_review_required_and_generated_excluded(self):
        for changes in [dict(status="Generated - Review Needed"), dict(status="Active/Review"),
                        dict(review_status=""), dict(skill_id_mapping_status="generated_mapped"),
                        dict(source_evidence=""), dict(reviewer=""), dict(last_verified_at="2099-01-01")]:
            with self.subTest(changes=changes): self.assertEqual(self.recommend(**changes), [])
        self.assertEqual(len(self.recommend()), 1)

    def test_no_keyword_or_unrelated_fallback(self):
        self.assertEqual(self.recommend(skill_ids="JAVA", skills_youll_gain="SQL"), [])
        self.assertEqual(recommend_learning_resources([], pd.DataFrame([self.row])), [])
        self.assertEqual(recommend_learning_resources([dict(skill_id="JAVA")], pd.DataFrame([self.row])), [])

    def test_multiple_gap_mappings_are_preserved_without_mutation(self):
        gaps = [dict(skill_id="SQL", skill_name="SQL"), dict(skill_id="PY", skill_name="Python")]
        frame = pd.DataFrame([self.row]); before = frame.copy(deep=True)
        result = recommend_learning_resources(gaps, frame)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["matched_gap_skill_ids"], ["SQL", "PY"])
        self.assertEqual(result[0]["matched_gap_skill_names"], ["SQL", "Python"])
        pd.testing.assert_frame_equal(frame, before)
        self.assertNotIn("completed", result[0])

    def test_actions_and_unknown_metadata(self):
        for kind, label in [("course", "Start learning"), ("exam_review", "View preparation course"),
                            ("certification", "View certification")]:
            item = self.recommend(resource_type=kind)[0]
            self.assertEqual(item["url_label"], label)
            self.assertIn("Unknown", item["credential_conditions"])
            self.assertIn("Unknown", item["cost_type"])
        verified = self.recommend(credential_review_status="verified", credential_conditions="Separate exam required",
                                 credential_evidence="https://example.org/exam")[0]
        self.assertEqual(verified["credential_conditions"], "Separate exam required")

    def test_links(self):
        for url in ["javascript:alert(1)", "//example.org", "not a url", "https://", "https://user:pass@example.org", "https://example.org:bad"]:
            self.assertEqual(provider_url(url), "")
            self.assertEqual(self.recommend(external_course_or_certification_link=url)[0]["url"], "")
        self.assertEqual(provider_url("http://example.org/course"), "http://example.org/course")

    def test_legacy_csv_rows_are_not_promoted_to_verified(self):
        frame = pd.read_csv(LEARNING_RESOURCES_PATH, dtype=str, keep_default_na=False)
        for _, row in frame.iterrows():
            if row.get("status", "").lower() != "active" or row.get("skill_id_mapping_status", "").lower() != "reviewed":
                self.assertFalse(resource_is_reviewed(row))

if __name__ == "__main__": unittest.main()
