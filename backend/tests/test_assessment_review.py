"""AI-drafted Candidate Assessment review: the draft is cleaned up, stored and
returned, and never becomes a scorecard by itself."""
import unittest
from unittest.mock import patch

from backend.app.services.assessment_review import build_review_request, extract_links, normalize_draft, redact_contact_details

CRITERIA = [
    {"criterion_id": "c1", "name": "SQL", "description": "Uses SQL", "question": "Describe a query.", "weight": 3,
     "anchors": ["a", "b", "c", "d"], "response": "I tuned a join. See https://example.com/work."},
    {"criterion_id": "c2", "name": "Communication", "description": "", "question": "Explain.", "weight": 1,
     "anchors": [], "response": "   "},
]


class DraftCleanupTests(unittest.TestCase):
    def test_links_are_listed_once_without_trailing_punctuation(self):
        links = extract_links(["See https://example.com/a, and (https://example.com/b).", "Again https://example.com/a."])
        self.assertEqual(links, ["https://example.com/a", "https://example.com/b"])

    def test_request_carries_no_candidate_identity(self):
        request = build_review_request([{**CRITERIA[0], "candidate_name": "Juan"}])
        self.assertNotIn("Juan", str(request))
        self.assertEqual(request["criteria"][0]["candidate_answer"], "I tuned a join. See [link removed].")

    def test_ratings_outside_the_scale_or_for_unknown_criteria_are_dropped(self):
        draft = normalize_draft({"ratings": [
            {"criterion_id": "c1", "rating": 9, "evidence": "x"},
            {"criterion_id": "zzz", "rating": 4, "evidence": "not a criterion"},
        ], "summary": "ok"}, CRITERIA)
        self.assertEqual([item["criterion_id"] for item in draft["ratings"]], ["c1", "c2"])
        self.assertIsNone(draft["ratings"][0]["rating"])

    def test_a_blank_answer_is_not_assessed_never_a_low_rating(self):
        draft = normalize_draft({"ratings": [{"criterion_id": "c2", "rating": 1, "evidence": "bad"}]}, CRITERIA)
        blank = draft["ratings"][1]
        self.assertIsNone(blank["rating"])
        self.assertEqual(blank["evidence"], "No answer was provided.")

    def test_valid_rating_and_long_text_are_kept_within_limits(self):
        draft = normalize_draft({"ratings": [{"criterion_id": "c1", "rating": "3", "evidence": "e" * 5000}], "summary": "s" * 5000}, CRITERIA)
        self.assertEqual(draft["ratings"][0]["rating"], 3)
        self.assertLessEqual(len(draft["ratings"][0]["evidence"]), 600)
        self.assertLessEqual(len(draft["summary"]), 1500)


class RedactionTests(unittest.TestCase):
    def test_emails_phones_and_links_are_removed(self):
        text = ("Email me at juan.dela-cruz@example.com or call 0917 123 4567, +63 (917) 123-4567 or (02) 8123 4567. "
                "See https://example.com/work, www.myportfolio.ph/cv and github.com/juan.")
        redacted = redact_contact_details(text)
        for leaked in ("example.com", "0917", "123-4567", "8123 4567", "myportfolio", "github.com", "@"):
            self.assertNotIn(leaked, redacted)
        self.assertIn("[email removed]", redacted)
        self.assertIn("[phone removed]", redacted)
        self.assertIn("[link removed]", redacted)

    def test_years_amounts_and_ordinary_text_are_kept(self):
        text = "In 2019 we collected 40 sacks, raised 1,200 pesos from 15 volunteers (June 2020-March 2021) and cut errors by 35.5%."
        self.assertEqual(redact_contact_details(text), text)

    def test_the_model_request_has_no_contact_details_but_the_reviewer_link_list_keeps_links(self):
        criteria = [{**CRITERIA[0], "response": "Call 09171234567 or write a@b.com. Work: https://example.com/work"}]
        request = str(build_review_request(criteria))
        for leaked in ("09171234567", "a@b.com", "example.com"):
            self.assertNotIn(leaked, request)
        self.assertEqual(extract_links([criteria[0]["response"]]), ["https://example.com/work"])


def supabase_stub(status="submitted", owned=True, ai_enabled=True):
    calls = []

    def request(path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
        calls.append((method, path, service_role, body))
        if path.startswith("/rest/v1/rpc/owned_job_post_for_application"):
            return "post-1" if owned else None
        if path.startswith("/rest/v1/employer_job_posts?"):
            return [{"ai_review_enabled": ai_enabled}]
        if path.startswith("/rest/v1/candidate_assessments?"):
            return [{"id": "as-1", "status": status, "rubric_id": "rub-1"}]
        if path.startswith("/rest/v1/assessment_criterion_snapshots?"):
            return [{"id": "s1", "source_criterion_id": "c1", "name": "SQL", "description": "", "question": "Q?", "weight": 3, "position": 0}]
        if path.startswith("/rest/v1/candidate_assessment_responses?"):
            return [{"criterion_snapshot_id": "s1", "response_text": "I tuned a join."}]
        if path.startswith("/rest/v1/evaluation_criteria?"):
            return [{"id": "c1", "anchors": ["a", "b", "c", "d"]}]
        return None

    return request, calls


class DraftEndpointTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from backend.app.main import app
        self.client = TestClient(app)
        for target, value in (("backend.app.main._get_authenticated_user_id", "user-1"),):
            patcher = patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def post(self, request, model_output=None, configured=True):
        with patch("backend.app.main._supabase_request", side_effect=request), \
             patch("backend.app.main.gemma_service.draft_assessment_review", return_value=model_output or {"ratings": [{"criterion_id": "c1", "rating": 3, "evidence": "Concrete."}], "summary": "Good."}), \
             patch.object(type(__import__("backend.app.main", fromlist=["gemma_service"]).gemma_service), "configured", new=configured):
            return self.client.post("/api/employer/applications/app-1/assessment-review-draft", headers={"Authorization": "Bearer t"})

    def test_draft_is_stored_for_audit_and_returned_unsaved_as_a_scorecard(self):
        request, calls = supabase_stub()
        response = self.post(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["draft"]["ratings"], [{"criterion_id": "c1", "rating": 3, "evidence": "Concrete."}])
        written = [(path, body) for method, path, role, body in calls if method == "POST" and role]
        self.assertTrue(any("assessment_ai_drafts" in path and body["approved_at"] is None for path, body in written))
        self.assertTrue(any("employer_review_audit_log" in path and body["event_type"] == "ai_review_draft_generated" for path, body in written))
        self.assertFalse(any("evaluation_scorecards" in path or "save_evaluation_scorecard" in path for _, path, _, _ in calls))

    def test_another_employers_application_is_refused(self):
        request, _ = supabase_stub(owned=False)
        self.assertEqual(self.post(request).status_code, 403)

    def test_a_job_with_ai_drafting_turned_off_sends_nothing_to_a_model(self):
        request, calls = supabase_stub(ai_enabled=False)
        from unittest.mock import MagicMock
        model = MagicMock()
        with patch("backend.app.main._supabase_request", side_effect=request), patch("backend.app.main.gemma_service.draft_assessment_review", model):
            response = self.client.post("/api/employer/applications/app-1/assessment-review-draft", headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("turned off", response.json()["detail"])
        model.assert_not_called()
        self.assertFalse(any("candidate_assessment_responses" in path for _, path, _, _ in calls))
        self.assertFalse(any("assessment_ai_drafts" in path for _, path, _, _ in calls))

    def test_assessment_must_be_submitted_first(self):
        request, _ = supabase_stub(status="pending")
        self.assertEqual(self.post(request).status_code, 409)

    def test_manual_review_still_works_when_ai_is_not_configured(self):
        request, _ = supabase_stub()
        response = self.post(request, configured=False)
        self.assertEqual(response.status_code, 503)
        self.assertIn("rate the answers yourself", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
