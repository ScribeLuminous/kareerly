"""Messaging consent: an employer may send one request while none is open,
and nothing else is saved until the candidate accepts it (POST /api/messages)."""
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.main import app

THREAD = {"id": "thread-1", "application_id": "app-1", "employer_id": "emp-1", "candidate_id": "cand-1", "status": "active"}


def consent_supabase(state, role="employer", thread_exists=True):
    """A stand-in for _supabase_request; ``state`` None means the application does not exist."""
    calls = []

    def request(path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
        calls.append({"path": path, "method": method, "body": body})
        if path.startswith("/rest/v1/job_applications?") and method == "GET":
            return [] if state is None else [{"message_request_state": state}]
        if path.startswith("/rest/v1/job_applications?") and method == "PATCH":
            return None
        if path.startswith("/rest/v1/message_threads?"):
            return [dict(THREAD)] if thread_exists else []
        if path.startswith("/rest/v1/candidate_profiles?"):
            return [{"id": "cand-1"}] if role == "candidate" else []
        if path.startswith("/rest/v1/employer_profiles?"):
            return [{"id": "emp-1"}] if role == "employer" else []
        if path.startswith("/rest/v1/message_moderation_actions"):
            return []
        if path == "/rest/v1/application_messages" and method == "POST":
            return [body]
        return None

    return request, calls


def saved_messages(calls):
    return [call for call in calls if call["path"] == "/rest/v1/application_messages" and call["method"] == "POST"]


class MessageConsentTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer token"}
        user = patch("backend.app.main._get_authenticated_user_id", return_value="user-1")
        user.start()
        self.addCleanup(user.stop)
        env = patch.dict(os.environ, {"MESSAGE_ENCRYPTION_KEY": "test-key"})
        env.start()
        self.addCleanup(env.stop)

    def send(self, state, kind, **options):
        request, calls = consent_supabase(state, **options)
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.client.post("/api/messages", headers=self.auth,
                json={"application_id": "app-1", "message_text": "Hello", "message_kind": kind})
        return response, calls

    def test_nothing_is_saved_before_the_candidate_accepts(self):
        for state in ("pending", "declined", "ignored"):
            for kind in ("message", "request"):
                with self.subTest(state=state, kind=kind):
                    response, calls = self.send(state, kind)
                    self.assertIn(response.status_code, {403, 409})
                    self.assertEqual(saved_messages(calls), [])

    def test_unknown_kinds_are_refused(self):
        for kind in ("text", "anything", "REQUESTX"):
            with self.subTest(kind=kind):
                response, calls = self.send("pending", kind)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(saved_messages(calls), [])

    def test_empty_kind_is_an_ordinary_message(self):
        response, calls = self.send("pending", "")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(saved_messages(calls), [])

    def test_kind_is_case_insensitive(self):
        response, calls = self.send("accepted", "Message")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(saved_messages(calls)), 1)

    def test_accepted_conversation_allows_messages(self):
        for role in ("employer", "candidate"):
            with self.subTest(role=role):
                response, calls = self.send("accepted", "message", role=role)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(saved_messages(calls)[0]["body"]["sender_role"], role)

    def test_employer_request_records_the_pending_state(self):
        response, calls = self.send("none", "request")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["message_request_state"], "pending")
        self.assertEqual(len(saved_messages(calls)), 1)
        update = next(call for call in calls if call["method"] == "PATCH")
        self.assertIn("message_request_state=eq.none", update["path"])
        self.assertEqual(update["body"]["message_request_state"], "pending")

    def test_candidate_cannot_send_a_request(self):
        response, calls = self.send("none", "request", role="candidate")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(saved_messages(calls), [])

    def test_first_request_opens_the_thread(self):
        request, calls = consent_supabase("none", thread_exists=False)
        with patch("backend.app.main._supabase_request", side_effect=request), \
             patch("backend.app.main._create_employer_message_thread",
                   return_value={**THREAD, "participant_role": "employer"}) as create_thread:
            response = self.client.post("/api/messages", headers=self.auth,
                json={"application_id": "app-1", "message_text": "Hello", "message_kind": "request"})
        self.assertEqual(response.status_code, 200)
        create_thread.assert_called_once_with("app-1", "user-1")

    def test_message_without_a_thread_is_not_found(self):
        response, calls = self.send("none", "message", thread_exists=False)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(saved_messages(calls), [])

    def test_unknown_application_is_not_found(self):
        response, calls = self.send(None, "request")
        self.assertEqual(response.status_code, 404)
        self.assertFalse(any(call["method"] in {"POST", "PATCH"} for call in calls))

    def test_a_request_is_not_resent_after_a_decline(self):
        with patch("backend.app.main._create_employer_message_thread",
                   side_effect=HTTPException(status_code=500, detail="must not be called")):
            response, calls = self.send("declined", "request", thread_exists=False)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(saved_messages(calls), [])


if __name__ == "__main__":
    unittest.main()
