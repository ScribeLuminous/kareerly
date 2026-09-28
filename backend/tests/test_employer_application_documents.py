"""Employer access to a candidate's shared resume and portfolio, and the job
detail fields added for the candidate job header."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.main import app


def fake_supabase(status="interviewing", owned=True, shared=None, job_source="employer"):
    calls = []
    shared = {"resume_id": "res-1", "share_resume": True, "portfolio_url": "https://example.com/me"} if shared is None else shared

    def request(path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
        calls.append(path)
        if path.startswith("/rest/v1/job_applications?"):
            return [{"id": "app-1", "job_id": "EMP-1", "job_source": job_source, "status": status}]
        if path.startswith("/rest/v1/employer_profiles?"):
            return [{"id": "emp-1"}]
        if path.startswith("/rest/v1/employer_job_posts?"):
            return [{"id": "post-1"}] if owned else []
        if path.startswith("/rest/v1/application_shared_documents?"):
            return [shared] if shared else []
        if path.startswith("/rest/v1/resumes?"):
            return [{"id": "res-1", "original_filename": "cv.pdf", "file_mime_type": "application/pdf", "file_size_bytes": 2048,
                     "storage_bucket": "resumes", "storage_path": "user-1/cv.pdf"}]
        if path.startswith("/storage/v1/object/sign/"):
            return {"signedURL": "/object/sign/resumes/user-1/cv.pdf?token=t"}
        return None

    return request, calls


class EmployerApplicationDocumentsTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        patcher = patch("backend.app.main._get_authenticated_user_id", return_value="user-1")
        patcher.start()
        self.addCleanup(patcher.stop)

    def get(self, request):
        with patch("backend.app.main._supabase_request", side_effect=request):
            return self.client.get("/api/employer/applications/app-1/documents", headers={"Authorization": "Bearer t"})

    def test_interviewing_applicant_shares_resume_and_portfolio(self):
        request, _ = fake_supabase()
        body = self.get(request).json()
        self.assertTrue(body["available"])
        self.assertEqual(body["resume"]["file_name"], "cv.pdf")
        self.assertTrue(body["resume"]["download_url"].endswith("token=t"))
        self.assertEqual(body["portfolio_url"], "https://example.com/me")

    def test_documents_stay_hidden_before_interviewing(self):
        for status in ("pending", "shortlisted", "rejected", "withdrawn"):
            request, calls = fake_supabase(status=status)
            body = self.get(request).json()
            self.assertFalse(body["available"])
            self.assertIsNone(body["resume"])
            self.assertFalse(any("application_shared_documents" in path or "storage" in path for path in calls))

    def test_resume_not_shared_when_candidate_opted_out(self):
        request, calls = fake_supabase(shared={"resume_id": "res-1", "share_resume": False, "portfolio_url": None})
        body = self.get(request).json()
        self.assertTrue(body["available"])
        self.assertIsNone(body["resume"])
        self.assertFalse(any("storage" in path for path in calls))

    def test_other_employers_are_refused(self):
        request, _ = fake_supabase(owned=False)
        self.assertEqual(self.get(request).status_code, 403)

    def test_requires_sign_in(self):
        with patch("backend.app.main._get_authenticated_user_id", return_value=None):
            response = self.client.get("/api/employer/applications/app-1/documents")
        self.assertEqual(response.status_code, 401)


class JobDetailHeaderFieldsTests(unittest.TestCase):
    def test_employer_job_detail_includes_questions_stages_and_counts(self):
        row = {
            "job_id": "EMP-1", "job_title": "Data Analyst", "posting_status": "open", "created_at": "2026-09-20T01:00:00Z",
            "screening_questions": [{"question": "Years with SQL?", "expected_answer": "3+"}, {"question": " "}],
            "hiring_stages": [{"stage": "Application", "description": ""}, {"stage": "Interview", "description": "45 minutes"}],
        }

        def request(path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
            if path.startswith("/rest/v1/employer_job_posts?"):
                return [row]
            if path == "/rest/v1/rpc/get_job_applicant_counts":
                # The count function is not executable with the anon key.
                self.assertTrue(service_role)
                return [{"job_id": "EMP-1", "applicant_count": 12}]
            return None

        with patch("backend.app.main._supabase_request", side_effect=request):
            job = TestClient(app).get("/api/jobs/detail?job_id=EMP-1&job_source=employer").json()["job"]
        self.assertEqual(job["posted_at"], "2026-09-20T01:00:00Z")
        self.assertEqual(job["applicant_count"], 12)
        self.assertEqual(job["screening_questions"], [{"question": "Years with SQL?"}])
        self.assertEqual(job["hiring_stages"], [{"stage": "Application", "description": None}, {"stage": "Interview", "description": "45 minutes"}])


if __name__ == "__main__":
    unittest.main()
