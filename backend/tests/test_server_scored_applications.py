"""POST /api/candidate/applications scores the job on the server (audit APP-01)."""
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import main

JOB = {"job_id": "EMP-1", "job_source": "employer", "job_title": "Data Analyst"}
SCORED = {"match": {"match_percentage": 61.6, "matched_skills": ["SQL", "Excel"], "missing_skills": ["Tableau"]}}


class ServerScoredApplicationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.calls = []
        for name, kwargs in (
            ("_get_authenticated_user_id", {"return_value": "cand-1"}),
            ("_load_external_job_candidate", {"return_value": ("resume text", [{"skill_name": "SQL"}], {"industry": "x"}, {})}),
            ("find_catalogue_job", {"return_value": dict(JOB)}),
            ("analyze_candidate_job_match", {"return_value": SCORED}),
        ):
            patcher = patch(f"backend.app.main.{name}", **kwargs)
            setattr(self, name.strip("_"), patcher.start())
            self.addCleanup(patcher.stop)

    def apply(self, json, supabase=None):
        def default(path, **kwargs):
            self.calls.append({"path": path, **kwargs})
            return {"id": "app-1", "match_score": kwargs["body"]["applicant_match_score"]}
        with patch("backend.app.main._supabase_request", side_effect=supabase or default):
            return self.client.post("/api/candidate/applications", headers={"Authorization": "Bearer t"}, json=json)

    def test_the_saved_score_is_the_servers_not_the_browsers(self):
        response = self.apply({"job_id": "EMP-1", "job_source": "employer", "match_score": 100, "matched_skills": ["Everything"]})
        self.assertEqual(response.status_code, 200)
        call = self.calls[0]
        self.assertEqual(call["path"], "/rest/v1/rpc/submit_job_application_for")
        self.assertTrue(call["service_role"])
        self.assertEqual(call["body"], {
            "applicant_id": "cand-1", "target_job_source": "employer", "target_job_id": "EMP-1",
            "applicant_match_score": 62, "applicant_matched_skills": ["SQL", "Excel"], "applicant_missing_skills": ["Tableau"],
        })
        # Scored from the candidate's saved resume and skills, against the catalogue job.
        args, kwargs = self.analyze_candidate_job_match.call_args
        self.assertEqual(args, ("resume text", JOB))
        self.assertEqual(kwargs["confirmed_skills"], [{"skill_name": "SQL"}])
        self.assertEqual(response.json()["application"]["match_score"], 62)

    def test_a_job_that_is_not_open_is_refused_before_scoring(self):
        self.find_catalogue_job.return_value = None
        response = self.apply({"job_id": "EMP-9", "job_source": "employer"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], main.JOB_CLOSED_MESSAGE)
        self.analyze_candidate_job_match.assert_not_called()
        self.assertEqual(self.calls, [])

    def test_bad_requests_and_missing_sessions(self):
        self.assertEqual(self.apply({"job_id": "", "job_source": "employer"}).status_code, 422)
        self.assertEqual(self.apply({"job_id": "EMP-1", "job_source": "elsewhere"}).status_code, 422)
        self.get_authenticated_user_id.return_value = None
        self.assertEqual(self.apply({"job_id": "EMP-1", "job_source": "employer"}).status_code, 401)

    def test_a_candidate_without_a_resume_is_asked_for_one(self):
        self.load_external_job_candidate.side_effect = HTTPException(
            status_code=409, detail={"code": "PROFILE_REQUIRED", "message": "Upload or complete your resume first."})
        response = self.apply({"job_id": "EMP-1", "job_source": "employer"})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "PROFILE_REQUIRED")

    def test_database_refusals_become_readable_messages(self):
        cases = (
            ('{"code":"23505","message":"You have already applied for this job."}', 409, "You have already applied for this job."),
            ('{"code":"P0002","message":"This job is closed or no longer accepting applications."}', 404,
             "This job is closed or no longer accepting applications."),
            ('{"code":"42501","message":"Only job seeker accounts can apply for jobs."}', 403, "Only job seeker accounts can apply for jobs."),
        )
        for body, status, message in cases:
            with self.subTest(status=status):
                def refuse(path, **kwargs):
                    raise main.SupabaseRequestError(status_code=status, detail=body)
                response = self.apply({"job_id": "EMP-1", "job_source": "employer"}, supabase=refuse)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()["detail"], message)

    def test_scoring_failures_do_not_leak_details(self):
        self.analyze_candidate_job_match.side_effect = KeyError("internal_column")
        response = self.apply({"job_id": "EMP-1", "job_source": "employer"})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("internal_column", response.text)


if __name__ == "__main__":
    unittest.main()


class CatalogueLookupTests(unittest.TestCase):
    def test_finds_by_id_and_source_and_reloads_once_for_a_new_post(self):
        import pandas as pd
        from backend.app.services import matching_service as ms
        old = pd.DataFrame([{"job_id": "EMP-1", "job_source": "employer"}, {"job_id": "EMP-1", "job_source": "internal"}])
        new = pd.DataFrame([*old.to_dict(orient="records"), {"job_id": "EMP-NEW", "job_source": "employer"}])
        with patch.object(ms, "load_reference_jobs", side_effect=[old, old, new]), \
             patch.object(ms, "refresh_jobs_cache_for", return_value=True) as refresh:
            self.assertEqual(ms.find_catalogue_job("EMP-1", "internal")["job_source"], "internal")
            self.assertEqual(ms.find_catalogue_job("EMP-NEW", "employer")["job_id"], "EMP-NEW")
        refresh.assert_called_once_with(["EMP-NEW"])
        with patch.object(ms, "load_reference_jobs", return_value=old), \
             patch.object(ms, "refresh_jobs_cache_for", return_value=False):
            self.assertIsNone(ms.find_catalogue_job("EMP-GONE", "employer"))
            self.assertIsNone(ms.find_catalogue_job("", "employer"))
