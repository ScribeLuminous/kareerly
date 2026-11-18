"""Clients get readable errors, never library or database internals (audit ERR-01, SEC-09)."""
import io
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import main
from backend.app.services.resume_parser import UNREADABLE_PDF_MESSAGE

FIXTURES = Path(__file__).parent / "fixtures" / "resumes"


class UnreadableResumeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_a_cut_off_pdf_is_the_users_error_to_fix(self):
        whole = (FIXTURES / "two_column_resume.pdf").read_bytes()
        truncated = whole[: len(whole) // 2]
        for body in (truncated, b"%PDF-1.4\n%garbage\n"):
            with self.subTest(size=len(body)):
                response = self.client.post("/api/resume/analyze", files={"resume": ("resume.pdf", body, "application/pdf")})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"], UNREADABLE_PDF_MESSAGE)
                self.assertNotIn("Stream has ended", response.text)

    def test_unexpected_analysis_failures_do_not_echo_the_exception(self):
        with patch("backend.app.main.analyze_resume_bytes", side_effect=KeyError("internal_field_name")):
            response = self.client.post("/api/resume/analyze", files={"resume": ("resume.pdf", b"%PDF-1.4", "application/pdf")})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("internal_field_name", response.text)


class SupabaseErrorMessageTests(unittest.TestCase):
    def test_messages_raised_on_purpose_are_shown(self):
        for code in ("22023", "P0001", "P0002", "42501"):
            with self.subTest(code=code):
                body = f'{{"code":"{code}","message":"This application is closed and cannot change stage.","hint":null}}'
                self.assertEqual(main.supabase_error_message(400, body), "This application is closed and cannot change stage.")

    def test_database_internals_are_hidden(self):
        cases = {
            '{"code":"42501","message":"permission denied for table employer_profiles"}': "employer_profiles",
            '{"code":"23505","message":"duplicate key value violates unique constraint \\"profiles_email_key\\""}': "profiles_email_key",
            '{"code":"PGRST204","message":"Could not find the \'secret_col\' column of \'resumes\'"}': "secret_col",
            '{"code":"42P01","message":"relation \\"public.message_blocks\\" does not exist"}': "message_blocks",
            "not json at all from table_x": "table_x",
        }
        for body, secret in cases.items():
            with self.subTest(secret=secret):
                for status in (400, 403, 404, 409, 500, 503):
                    self.assertNotIn(secret, main.supabase_error_message(status, body))
        self.assertIn("temporarily unavailable", main.supabase_error_message(503, "boom"))
        self.assertIn("conflicts", main.supabase_error_message(409, '{"code":"23505","message":"duplicate key"}'))

    def test_api_responses_carry_the_safe_message_and_keep_the_status(self):
        client = TestClient(main.app)
        error = urllib.error.HTTPError(
            "https://db.test/rest/v1/candidate_notifications", 400, "Bad Request", {},
            io.BytesIO(b'{"code":"42703","message":"column candidate_notifications.secret does not exist","hint":"Perhaps you meant x"}'))
        with patch.object(main, "SUPABASE_URL", "https://db.test"), patch.object(main, "SUPABASE_ANON_KEY", "anon"), \
             patch.object(main, "SUPABASE_SERVICE_ROLE_KEY", "service"), \
             patch("backend.app.main._get_authenticated_user_id", return_value="user-1"), \
             patch("backend.app.main.urllib.request.urlopen", side_effect=error):
            response = client.get("/api/candidate/notifications", headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("candidate_notifications", response.text)
        self.assertNotIn("Perhaps", response.text)
        self.assertEqual(response.json()["detail"], main.supabase_error_message(400, ""))


if __name__ == "__main__":
    unittest.main()


class CompressionTests(unittest.TestCase):
    def test_large_json_responses_are_gzipped_for_browsers_that_ask(self):
        client = TestClient(main.app)
        jobs = [{"job_id": f"J{n}", "job_title": "Data Analyst", "required_skills": ["SQL", "Excel"]} for n in range(300)]
        with patch("backend.app.main.list_available_jobs", return_value=jobs), \
             patch("backend.app.main.refresh_jobs_cache_for", return_value=False):
            zipped = client.get("/api/jobs/list", headers={"Accept-Encoding": "gzip"})
            plain = client.get("/api/jobs/list", headers={"Accept-Encoding": "identity"})
        self.assertEqual(zipped.headers.get("content-encoding"), "gzip")
        self.assertEqual(zipped.json(), plain.json())
        self.assertNotIn("content-encoding", plain.headers)

    def test_small_responses_are_sent_as_they_are(self):
        response = TestClient(main.app).get("/api/health", headers={"Accept-Encoding": "gzip"})
        self.assertNotIn("content-encoding", response.headers)
