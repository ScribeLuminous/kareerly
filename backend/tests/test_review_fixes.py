"""Message reports by either participant, block checks that fail closed, closed
applications in the stage-change fallback, unreadable messages, and the
confirmed skills External Job Analysis uses."""
import base64
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.main import app

THREAD = {"id": "thread-1", "application_id": "app-1", "employer_id": "emp-1", "candidate_id": "cand-1", "status": "active"}


def message_supabase(role="employer", moderation_rows=None, moderation_error=None, message_rows=None):
    calls = []

    def request(path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
        calls.append({"path": path, "method": method, "body": body})
        if path.startswith("/rest/v1/message_threads?"):
            return [dict(THREAD)]
        if path.startswith("/rest/v1/candidate_profiles?"):
            return [{"id": "cand-1"}] if role == "candidate" else []
        if path.startswith("/rest/v1/employer_profiles?"):
            return [{"id": "emp-1"}] if role == "employer" else []
        if path.startswith("/rest/v1/message_moderation_actions") and method == "GET":
            if moderation_error:
                raise moderation_error
            return list(moderation_rows or [])
        if path == "/rest/v1/message_moderation_actions" and method == "POST":
            return None
        if path.startswith("/rest/v1/job_applications?") and method == "GET":
            return [{"message_request_state": "accepted"}]
        if path.startswith("/rest/v1/application_messages?") and method == "GET":
            return list(message_rows or [])
        if path == "/rest/v1/application_messages" and method == "POST":
            return [body]
        return None

    return request, calls


class MessageModerationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer token"}
        patcher = patch("backend.app.main._get_authenticated_user_id", return_value="user-1")
        patcher.start()
        self.addCleanup(patcher.stop)
        env = patch.dict(os.environ, {"MESSAGE_ENCRYPTION_KEY": "test-key"})
        env.start()
        self.addCleanup(env.stop)

    def test_employer_report_is_saved_for_admin_review(self):
        request, calls = message_supabase(role="employer")
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.client.post("/api/messages/moderation", headers=self.auth, json={
                "application_id": "app-1", "action": "report", "reason": "harassment", "details": "Abusive replies",
            })
        self.assertEqual(response.status_code, 200)
        saved = next(call for call in calls if call["method"] == "POST" and call["path"] == "/rest/v1/message_moderation_actions")
        self.assertEqual(saved["body"]["actor_role"], "employer")
        self.assertEqual(saved["body"]["action"], "report")
        self.assertEqual(saved["body"]["reason"], "harassment")

    def test_candidate_can_report_a_scam(self):
        request, calls = message_supabase(role="candidate")
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.client.post("/api/messages/moderation", headers=self.auth, json={
                "application_id": "app-1", "action": "report", "reason": "scam",
            })
        self.assertEqual(response.status_code, 200)
        saved = next(call for call in calls if call["method"] == "POST" and call["path"] == "/rest/v1/message_moderation_actions")
        self.assertEqual(saved["body"]["actor_role"], "candidate")

    def test_report_needs_a_known_reason(self):
        request, calls = message_supabase()
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.client.post("/api/messages/moderation", headers=self.auth, json={"application_id": "app-1", "action": "report", "reason": "dislike"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(any(call["method"] == "POST" for call in calls))

    def test_a_failed_block_check_stops_the_message(self):
        request, calls = message_supabase(moderation_error=HTTPException(status_code=500, detail="db down"))
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.client.post("/api/messages", headers=self.auth, json={"application_id": "app-1", "message_text": "Hello"})
        self.assertEqual(response.status_code, 503)
        self.assertFalse(any(call["path"] == "/rest/v1/application_messages" for call in calls))

    def test_a_missing_moderation_table_still_allows_messages(self):
        request, calls = message_supabase(moderation_error=HTTPException(status_code=404, detail="PGRST205"))
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.client.post("/api/messages", headers=self.auth, json={"application_id": "app-1", "message_text": "Hello"})
        self.assertEqual(response.status_code, 200)

    def test_a_blocked_conversation_refuses_messages(self):
        rows = [{"actor_user_id": "cand-user", "actor_role": "candidate", "action": "block", "created_at": "2026-10-01T00:00:00Z"}]
        request, calls = message_supabase(moderation_rows=rows)
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.client.post("/api/messages", headers=self.auth, json={"application_id": "app-1", "message_text": "Hello"})
        self.assertEqual(response.status_code, 403)

    def test_unreadable_messages_stay_visible_in_the_thread(self):
        cipher = main._message_cipher()
        nonce = os.urandom(12)
        good = cipher.encrypt(nonce, b"Hi there", b"thread-1")
        rows = [
            {"id": "m1", "sender_role": "employer", "ciphertext": base64.b64encode(good).decode(), "encryption_nonce": base64.b64encode(nonce).decode(), "created_at": "1"},
            {"id": "m2", "sender_role": "candidate", "ciphertext": base64.b64encode(b"garbage").decode(), "encryption_nonce": base64.b64encode(nonce).decode(), "created_at": "2"},
        ]
        request, _ = message_supabase(message_rows=rows)
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.client.get("/api/messages/app-1", headers=self.auth)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual([row["id"] for row in body], ["m1", "m2"])
        self.assertEqual(body[0]["message_text"], "Hi there")
        self.assertTrue(body[1]["unreadable"])


class ClosedApplicationFallbackTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        patcher = patch("backend.app.main._get_authenticated_user_id", return_value="user-1")
        patcher.start()
        self.addCleanup(patcher.stop)

    def fake(self, status, patched_rows=None):
        calls = []

        def request(path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
            calls.append({"path": path, "method": method})
            if path.startswith("/rest/v1/job_applications?") and method == "GET":
                return [{"id": "app-1", "job_id": "EMP-1", "status": status}]
            if path.startswith("/rest/v1/employer_profiles?"):
                return [{"id": "emp-1"}]
            if path.startswith("/rest/v1/employer_job_posts?"):
                return [{"id": "post-1"}]
            if path == "/rest/v1/rpc/set_application_stage":
                raise HTTPException(status_code=404, detail="PGRST202")
            if method == "PATCH" and path.startswith("/rest/v1/job_applications?"):
                return patched_rows if patched_rows is not None else [{"id": "app-1", "status": "shortlisted"}]
            return None

        return request, calls

    def post(self, status):
        return self.client.post("/api/messages/application-status", headers={"Authorization": "Bearer t"},
                                json={"application_id": "app-1", "status": status})

    def test_withdrawn_application_cannot_be_reopened(self):
        request, calls = self.fake("withdrawn")
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.post("shortlisted")
        self.assertEqual(response.status_code, 409)
        self.assertFalse(any(call["method"] == "PATCH" for call in calls))

    def test_update_is_conditional_on_the_status_it_read(self):
        request, calls = self.fake("pending")
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.post("shortlisted")
        self.assertEqual(response.status_code, 200)
        patch_call = next(call for call in calls if call["method"] == "PATCH")
        self.assertIn("status=eq.pending", patch_call["path"])

    def test_a_status_changed_meanwhile_is_reported(self):
        request, _ = self.fake("pending", patched_rows=[])
        with patch("backend.app.main._supabase_request", side_effect=request):
            self.assertEqual(self.post("shortlisted").status_code, 409)


class ConfirmedSkillsTests(unittest.TestCase):
    def rows(self, created_at):
        return [{"skill_id": "S1", "skill_name": "SQL", "confidence": 1, "created_at": created_at}]

    def test_confirmed_skills_saved_after_the_resume_are_used(self):
        with patch("backend.app.main._supabase_request", return_value=self.rows("2026-10-02T00:00:00+00:00")):
            skills = main._confirmed_skills_since("user-1", "2026-10-01T00:00:00+00:00")
        self.assertEqual(skills, [{"skill_id": "S1", "skill_name": "SQL", "confidence": 1}])

    def test_skills_confirmed_for_an_older_resume_are_ignored(self):
        with patch("backend.app.main._supabase_request", return_value=self.rows("2026-09-01T00:00:00Z")):
            self.assertEqual(main._confirmed_skills_since("user-1", "2026-10-01T00:00:00Z"), [])


if __name__ == "__main__":
    unittest.main()
