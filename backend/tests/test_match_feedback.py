"""Candidate match feedback endpoints and the context copied into each vote."""
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.learning.feedback import find_match_context

USER = "00000000-0000-0000-0000-00000000000a"
AUTH = {"Authorization": "Bearer user-token"}

FIT_ITEM = {
    "job_id": "JOB-7", "job_source": "internal", "job_title": "Data Analyst", "match_score": 0.8123,
    "semantic_similarity": 0.61, "required_skill_coverage": 1.0, "preferred_skill_coverage": None,
    "preference_alignment": 0.55, "learning_readiness": 0.25, "critical_missing_skill_ids": [],
    "in_preferred_career_area": True, "category_id": "K02", "ranker_version": "baseline-composite-v1",
    "matched_skills": ["SQL"], "missing_skills": ["Tableau"], "job_description": "Analyze data.",
    "resume_text_for_matching": "Jane Doe jane@example.com 0917 000 0000",
}
HISTORY = [{
    "id": "11111111-1111-1111-1111-111111111111", "created_at": "2026-09-24T00:00:00Z",
    "all_fit_now": [{"job_id": "JOB-1", "match_score": 0.9}, FIT_ITEM],
    "fit_now": None,
    "all_aspiration": [{"job_id": "EMP-3", "job_source": "employer", "match_percentage": 42.5,
        "preference_alignment": 0.9, "match_breakdown": {"critical_missing_count": 1}}],
    "aspiration": None,
    "metadata": {"model_version": "kareerly-skills-first-minilm-2026-09-10"},
}]


class FakeStore:
    """Records _supabase_request calls and answers them like PostgREST would."""

    def __init__(self, history=None, feedback=None, fail_upsert=None):
        self.history = HISTORY if history is None else history
        self.feedback = feedback or []
        self.fail_upsert = fail_upsert
        self.calls = []

    def __call__(self, path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
        self.calls.append({"path": path, "method": method, "token": token, "service_role": service_role,
            "body": body, "prefer": prefer})
        if path.startswith("/rest/v1/match_history"):
            return self.history
        if path.startswith("/rest/v1/match_feedback") and method == "POST":
            if self.fail_upsert:
                raise self.fail_upsert
            return [{**body, "updated_at": "2026-09-25T00:00:00Z"}]
        if path.startswith("/rest/v1/match_feedback") and method == "GET":
            return self.feedback
        return None


class MatchFeedbackApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        auth = patch.object(main, "_get_authenticated_user_id", side_effect=lambda h: USER if h == "Bearer user-token" else None)
        auth.start()
        self.addCleanup(auth.stop)

    def request(self, store, method, **kwargs):
        with patch.object(main, "_supabase_request", store):
            return self.client.request(method, "/api/candidate/match-feedback", **kwargs)

    def test_requires_a_signed_in_user(self):
        store = FakeStore()
        for method, kwargs in (("GET", {}), ("PUT", {"json": {"job_id": "JOB-7", "vote": "good"}}),
                ("DELETE", {"params": {"job_id": "JOB-7"}})):
            self.assertEqual(self.request(store, method, **kwargs).status_code, 401)
        self.assertEqual(store.calls, [])

    def test_rejects_invalid_votes_and_sources(self):
        store = FakeStore()
        for body in ({"job_id": "JOB-7", "vote": "meh"}, {"job_id": "", "vote": "good"},
                {"job_id": "JOB-7", "vote": "good", "job_source": "linkedin"}, {"job_id": "x" * 201, "vote": "bad"}):
            self.assertEqual(self.request(store, "PUT", json=body, headers=AUTH).status_code, 422, body)
        self.assertEqual(store.calls, [])

    def test_only_recommended_jobs_can_be_rated(self):
        store = FakeStore()
        response = self.request(store, "PUT", json={"job_id": "NOT-SHOWN", "vote": "good"}, headers=AUTH)
        self.assertEqual(response.status_code, 409)
        self.assertFalse([c for c in store.calls if c["path"].startswith("/rest/v1/match_feedback")])

    def test_vote_is_saved_with_the_users_token_and_no_personal_text(self):
        store = FakeStore()
        response = self.request(store, "PUT", json={"job_id": "JOB-7", "vote": "good"}, headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["feedback"]["vote"], "good")

        history_call = store.calls[0]
        self.assertIn("results_json-%3Eall_fit_now_matches", history_call["path"])
        self.assertNotIn("resume", history_call["path"])
        upsert = store.calls[-1]
        self.assertEqual(upsert["method"], "POST")
        self.assertIn("on_conflict=user_id,job_id,job_source", upsert["path"])
        self.assertIn("resolution=merge-duplicates", upsert["prefer"])
        # Written as the user, so row-level security enforces ownership.
        self.assertEqual(upsert["token"], "user-token")
        self.assertFalse(upsert["service_role"])
        body = upsert["body"]
        self.assertEqual(body["user_id"], USER)
        self.assertEqual(body["vote"], 1)
        self.assertEqual(body["match_category"], "Fit-Now")
        self.assertEqual(body["rank_position"], 2)
        self.assertEqual(body["match_score"], 0.8123)
        self.assertEqual(body["critical_missing_count"], 0)
        self.assertTrue(body["in_preferred_career_area"])
        self.assertEqual(body["match_history_id"], HISTORY[0]["id"])
        self.assertEqual(body["model_version"], "kareerly-skills-first-minilm-2026-09-10")
        forbidden = {"resume_text_for_matching", "matched_skills", "missing_skills", "job_description", "job_title"}
        self.assertFalse(forbidden & set(body))
        self.assertNotIn("jane", str(body).lower())

    def test_changing_a_vote_upserts_and_saving_never_touches_models(self):
        store = FakeStore()
        self.request(store, "PUT", json={"job_id": "JOB-7", "vote": "good"}, headers=AUTH)
        self.request(store, "PUT", json={"job_id": "JOB-7", "vote": "bad"}, headers=AUTH)
        upserts = [c for c in store.calls if c["method"] == "POST"]
        self.assertEqual([c["body"]["vote"] for c in upserts], [1, -1])
        self.assertFalse([c for c in store.calls if "ranking_models" in c["path"]])

    def test_employer_job_in_aspiration_list(self):
        store = FakeStore()
        response = self.request(store, "PUT", json={"job_id": "EMP-3", "job_source": "employer", "vote": "bad"}, headers=AUTH)
        self.assertEqual(response.status_code, 200)
        body = store.calls[-1]["body"]
        self.assertEqual((body["match_category"], body["vote"], body["match_score"]), ("Aspiration", -1, 0.425))
        self.assertEqual(body["critical_missing_count"], 1)

    def test_rate_limit_is_a_readable_429(self):
        store = FakeStore(fail_upsert=HTTPException(status_code=400, detail='{"message":"MATCH_FEEDBACK_RATE_LIMIT"}'))
        response = self.request(store, "PUT", json={"job_id": "JOB-7", "vote": "good"}, headers=AUTH)
        self.assertEqual(response.status_code, 429)
        self.assertIn("Too many ratings", response.json()["detail"])

    def test_list_and_remove(self):
        store = FakeStore(feedback=[{"job_id": "JOB-7", "job_source": "internal", "vote": -1, "updated_at": "t"}])
        listed = self.request(store, "GET", headers=AUTH).json()
        self.assertEqual(listed, {"feedback": [{"job_id": "JOB-7", "job_source": "internal", "vote": "bad", "updated_at": "t"}]})
        removed = self.request(store, "DELETE", params={"job_id": "JOB-7"}, headers=AUTH)
        self.assertEqual(removed.status_code, 200)
        delete = store.calls[-1]
        self.assertEqual(delete["method"], "DELETE")
        self.assertIn(f"user_id=eq.{USER}", delete["path"])
        self.assertIn("job_id=eq.JOB-7", delete["path"])
        self.assertEqual(delete["token"], "user-token")

    def test_supabase_outage_surfaces_as_error_not_silent_success(self):
        def down(*args, **kwargs):
            raise HTTPException(status_code=503, detail="Unable to reach Supabase")
        with patch.object(main, "_supabase_request", down):
            response = self.client.put("/api/candidate/match-feedback", json={"job_id": "JOB-7", "vote": "good"}, headers=AUTH)
        self.assertEqual(response.status_code, 503)


class ContextTests(unittest.TestCase):
    def test_newest_history_wins_and_unknown_jobs_have_no_context(self):
        older = {**HISTORY[0], "id": "older", "all_fit_now": [{**FIT_ITEM, "match_score": 0.1}]}
        context = find_match_context(HISTORY + [older], "JOB-7", "internal")
        self.assertEqual((context["match_history_id"], context["match_score"]), (HISTORY[0]["id"], 0.8123))
        self.assertIsNone(find_match_context(HISTORY, "JOB-7", "employer"))
        self.assertIsNone(find_match_context([], "JOB-7", "internal"))

    def test_out_of_range_values_are_clamped(self):
        history = [{"id": "h", "all_fit_now": [{"job_id": "J", "match_score": 7, "semantic_similarity": -2,
            "critical_missing_skill_ids": list(range(80))}]}]
        context = find_match_context(history, "J", "internal")
        self.assertEqual((context["match_score"], context["semantic_similarity"], context["critical_missing_count"]), (1.0, 0.0, 50))


class LearningAdminApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_admin_endpoints_require_admin(self):
        with patch.object(main, "_require_admin_user", side_effect=HTTPException(status_code=403, detail="Admin role is required.")):
            for method, path, body in (("GET", "/api/admin/learning/status", None), ("POST", "/api/admin/learning/run", {}),
                    ("POST", "/api/admin/learning/rollback", {}), ("GET", "/api/admin/skill-candidates", None),
                    ("POST", "/api/admin/skill-candidates/x/review", {"action": "reject"})):
                self.assertEqual(self.client.request(method, path, json=body).status_code, 403, path)

    def test_scheduler_endpoint_hidden_without_token_and_checks_it(self):
        with patch.dict("os.environ", {"KAREERLY_LEARNING_JOB_TOKEN": ""}):
            self.assertEqual(self.client.post("/api/internal/learning/run", json={}).status_code, 404)
        token = "t" * 32
        with patch.dict("os.environ", {"KAREERLY_LEARNING_JOB_TOKEN": token}):
            self.assertEqual(self.client.post("/api/internal/learning/run", json={},
                headers={"X-Learning-Job-Token": "wrong"}).status_code, 401)
            with patch.object(main, "_run_learning", return_value={"ranking": {"outcome": "insufficient_data"}}) as run:
                response = self.client.post("/api/internal/learning/run", json={"job": "ranking"},
                    headers={"X-Learning-Job-Token": token})
            self.assertEqual(response.status_code, 200)
            run.assert_called_once_with("ranking", False, "webhook")

    def test_rollback_clears_the_matchers_model_cache(self):
        with patch.object(main, "_require_admin_user", return_value="admin-1"), \
             patch.object(main, "_learning_client", return_value=object()), \
             patch.object(main.ranking_training, "rollback", return_value={"active_version": "baseline-composite-v1"}) as rollback, \
             patch.object(main, "clear_ranker_cache") as clear:
            response = self.client.post("/api/admin/learning/rollback", json={}, headers={"Authorization": "Bearer a"})
        self.assertEqual(response.status_code, 200)
        rollback.assert_called_once()
        self.assertIsNone(rollback.call_args.kwargs["target_version"])
        clear.assert_called_once()


if __name__ == "__main__":
    unittest.main()
