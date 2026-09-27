"""The employer stage-change endpoint: ownership checks, the audited RPC path
and the fallback for databases without the evaluation migration."""
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.main import app


def fake_supabase(rpc_result=None, rpc_error=None, owned=True):
    calls = []

    def request(path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
        calls.append({"path": path, "method": method, "token": token, "service_role": service_role, "body": body})
        if path.startswith("/rest/v1/job_applications?") and method == "GET":
            return [{"id": "app-1", "job_id": "EMP-1"}]
        if path.startswith("/rest/v1/employer_profiles?"):
            return [{"id": "emp-1"}]
        if path.startswith("/rest/v1/employer_job_posts?"):
            return [{"id": "post-1"}] if owned else []
        if path == "/rest/v1/rpc/set_application_stage":
            if rpc_error:
                raise rpc_error
            return rpc_result
        if path.startswith("/rest/v1/job_applications?") and method == "PATCH":
            return [{"id": "app-1", "status": body["status"]}]
        return None

    return request, calls


class EmployerStageChangeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer employer-token"}
        patcher = patch("backend.app.main._get_authenticated_user_id", return_value="user-1")
        patcher.start()
        self.addCleanup(patcher.stop)

    def post(self, status, reason=None):
        return self.client.post("/api/messages/application-status", headers=self.auth,
                                json={"application_id": "app-1", "status": status, "rejection_reason": reason})

    def test_stage_change_runs_as_the_employer_for_the_audit_trail(self):
        request, calls = fake_supabase(rpc_result={"id": "app-1", "status": "interviewing"})
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.post("interviewing")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["application"]["status"], "interviewing")
        rpc = next(call for call in calls if call["path"].endswith("set_application_stage"))
        self.assertEqual(rpc["token"], "employer-token")
        self.assertFalse(rpc["service_role"])
        self.assertFalse(any(call["method"] == "PATCH" and "job_applications" in call["path"] for call in calls))

    def test_falls_back_when_the_function_is_not_deployed(self):
        request, calls = fake_supabase(rpc_error=HTTPException(status_code=404, detail="PGRST202"))
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.post("shortlisted")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["application"]["status"], "shortlisted")
        self.assertTrue(any(call["method"] == "PATCH" for call in calls))

    def test_other_employers_are_refused_before_any_write(self):
        request, calls = fake_supabase(owned=False)
        with patch("backend.app.main._supabase_request", side_effect=request):
            response = self.post("hired")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(any(call["path"].endswith("set_application_stage") or call["method"] == "PATCH" for call in calls))

    def test_rejection_needs_a_reason(self):
        request, _ = fake_supabase()
        with patch("backend.app.main._supabase_request", side_effect=request):
            self.assertEqual(self.post("rejected").status_code, 400)

    def test_database_errors_are_not_swallowed(self):
        request, _ = fake_supabase(rpc_error=HTTPException(status_code=400, detail="This application is closed"))
        with patch("backend.app.main._supabase_request", side_effect=request):
            self.assertEqual(self.post("interviewing").status_code, 400)


if __name__ == "__main__":
    unittest.main()
