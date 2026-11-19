"""Admin user management, resumes, message reports, match stats and deletion requests."""
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.services.admin_stats import summarize_match_feedback

ADMIN = "00000000-0000-0000-0000-0000000000ad"
CANDIDATE = "00000000-0000-0000-0000-0000000000c1"
EMPLOYER = "00000000-0000-0000-0000-0000000000e1"
AUTH = {"Authorization": "Bearer admin-token"}

PROFILES = {
    ADMIN: {"id": ADMIN, "role": "admin", "first_name": "Ada", "last_name": "Admin", "email": "ada@kareerly.test"},
    CANDIDATE: {"id": CANDIDATE, "role": "candidate", "first_name": "Cara", "last_name": "Cruz", "email": "cara@example.com"},
    EMPLOYER: {"id": EMPLOYER, "role": "employer", "first_name": "Emil", "last_name": "Reyes", "email": "hr@acme.test"},
}


class FakeStore:
    """Answers _supabase_request like PostgREST, Auth admin and Storage would."""

    def __init__(self, deletion_requests=None, resumes=None, reports=None):
        self.calls = []
        self.deletion_requests = deletion_requests or []
        self.resumes = resumes if resumes is not None else [{
            "id": "r1", "user_id": CANDIDATE, "original_filename": "cara.pdf", "storage_bucket": "resumes",
            "storage_path": f"{CANDIDATE}/cara.pdf", "parsed_text": "Cara Cruz\nData analyst", "created_at": "2026-09-20T00:00:00Z",
        }]
        self.reports = reports or []

    def __call__(self, path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
        self.calls.append((method, path, body))
        if path.startswith("/auth/v1/admin/users"):
            if method == "GET":
                return {"users": [{"id": CANDIDATE, "banned_until": "2126-01-01T00:00:00Z"}, {"id": EMPLOYER, "banned_until": None}]}
            return {"id": path.rsplit("/", 1)[-1], "banned_until": "2126-01-01T00:00:00Z" if body and body.get("ban_duration") != "none" else None}
        if path.startswith("/storage/v1/object/sign/"):
            return {"signedURL": "/object/sign/resumes/file.pdf?token=abc"}
        if path.startswith("/storage/v1/"):
            return []
        if path.startswith("/rest/v1/profiles"):
            return [row for row in PROFILES.values() if self._matches_id(path, row["id"])]
        if path.startswith("/rest/v1/resumes"):
            if method == "DELETE":
                return None
            return [row for row in self.resumes if self._matches_id(path, row["id"]) or CANDIDATE in path or "id=" not in path]
        if path.startswith("/rest/v1/account_deletion_requests"):
            if method == "POST":
                row = {"id": "d-new", "status": "pending", **body}
                self.deletion_requests.append(row)
                return [row]
            if method == "PATCH":
                return [{**row, **body} for row in self.deletion_requests if row["id"] in path] or []
            if "?id=eq." in path:
                return [row for row in self.deletion_requests if f"?id=eq.{row['id']}" in path]
            return self.deletion_requests
        if path.startswith("/rest/v1/message_moderation_actions"):
            if method == "PATCH":
                return [{**row, **body} for row in self.reports if row["id"] in path]
            return self.reports
        if path.startswith("/rest/v1/message_threads"):
            return [{"application_id": "app-1", "candidate_id": "cp-1", "employer_id": "ep-1"}]
        if path.startswith("/rest/v1/candidate_profiles"):
            return [{"id": "cp-1", "user_id": CANDIDATE}]
        if path.startswith("/rest/v1/employer_profiles"):
            return [{"id": "ep-1", "user_id": EMPLOYER, "company_name": "Acme Corp"}]
        if path.startswith("/rest/v1/job_applications"):
            return [{"id": "app-1", "job_title": "Data Analyst", "company_name": "Acme Corp", "status": "pending"}]
        return []

    @staticmethod
    def _matches_id(path, row_id):
        if "id=eq." in path or "id=in." in path:
            return row_id in path
        return "id=" not in path or "user_id=" in path

    def methods(self, prefix):
        return [(method, path) for method, path, _ in self.calls if path.startswith(prefix)]


class AdminApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        admin = patch.object(main, "_require_admin_user", side_effect=lambda h: ADMIN if h == "Bearer admin-token" else (_ for _ in ()).throw(
            HTTPException(status_code=403, detail="Admin role is required.")))
        admin.start()
        self.addCleanup(admin.stop)

    def call(self, store, method, path, **kwargs):
        with patch.object(main, "_supabase_request", store):
            return self.client.request(method, path, **kwargs)

    def test_admin_endpoints_reject_non_admins(self):
        store = FakeStore()
        for method, path in (("GET", "/api/admin/users"), ("POST", f"/api/admin/users/{CANDIDATE}/suspend"),
                ("DELETE", f"/api/admin/users/{CANDIDATE}"), ("GET", "/api/admin/resumes"), ("GET", "/api/admin/resumes/r1"),
                ("DELETE", "/api/admin/resumes/r1"), ("GET", "/api/admin/reports"), ("PATCH", "/api/admin/reports/x"),
                ("GET", "/api/admin/match-feedback/stats"), ("GET", "/api/admin/deletion-requests"),
                ("POST", "/api/admin/deletion-requests/d1/approve"), ("POST", "/api/admin/deletion-requests/d1/reject")):
            body = {"suspended": True} if path.endswith("suspend") else {"status": "resolved"} if "reports/" in path else {}
            response = self.call(store, method, path, json=body, headers={"Authorization": "Bearer someone"})
            self.assertEqual(response.status_code, 403, path)
        self.assertEqual(store.calls, [])

    def test_user_list_includes_suspension_and_resume_count(self):
        store = FakeStore()
        response = self.call(store, "GET", "/api/admin/users", params={"role": "candidate", "q": "cara,(x)"}, headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        user = next(row for row in response.json()["users"] if row["id"] == CANDIDATE)
        self.assertTrue(user["suspended"])
        self.assertEqual(user["resume_count"], 1)
        profile_query = next(path for _, path in store.methods("/rest/v1/profiles"))
        search = parse_qs(urlsplit(profile_query).query)["or"][0]
        self.assertEqual(search, "(email.ilike.*cara  x*,first_name.ilike.*cara  x*,last_name.ilike.*cara  x*)")

    def test_suspend_and_reactivate_use_supabase_ban(self):
        store = FakeStore()
        response = self.call(store, "POST", f"/api/admin/users/{CANDIDATE}/suspend", json={"suspended": True}, headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(store.calls[-1][2], {"ban_duration": main.SUSPEND_DURATION})
        self.call(store, "POST", f"/api/admin/users/{CANDIDATE}/suspend", json={"suspended": False}, headers=AUTH)
        self.assertEqual(store.calls[-1][2], {"ban_duration": "none"})

    def test_admins_and_self_cannot_be_suspended_or_deleted(self):
        store = FakeStore()
        self.assertEqual(self.call(store, "DELETE", f"/api/admin/users/{ADMIN}", headers=AUTH).status_code, 400)
        with patch.dict(PROFILES, {"other-admin": {"id": "other-admin", "role": "admin", "email": "b@x.test", "first_name": "", "last_name": ""}}):
            response = self.call(store, "POST", "/api/admin/users/other-admin/suspend", json={"suspended": True}, headers=AUTH)
        self.assertEqual(response.status_code, 403)
        self.assertFalse([call for call in store.calls if call[0] != "GET"])

    def test_admin_can_edit_name_email_and_role(self):
        store = FakeStore()
        response = self.call(store, "PATCH", "/api/admin/users", headers=AUTH, json={
            "user_id": CANDIDATE, "first_name": " Carla ", "last_name": "Cruz", "email": "Carla@Example.com", "role": "employer"})
        self.assertEqual(response.status_code, 200, response.text)
        auth_body = next(body for method, path, body in store.calls if method == "PUT" and path.startswith("/auth/v1/admin/users"))
        self.assertEqual(auth_body["email"], "carla@example.com")
        self.assertEqual(auth_body["user_metadata"], {"first_name": "Carla", "last_name": "Cruz", "role": "employer"})
        profile_body = next(body for method, path, body in store.calls if method == "PATCH" and path.startswith("/rest/v1/profiles"))
        self.assertEqual({k: profile_body[k] for k in ("first_name", "last_name", "email", "role")},
                         {"first_name": "Carla", "last_name": "Cruz", "email": "carla@example.com", "role": "employer"})

    def test_admin_cannot_change_own_role_or_use_invalid_values(self):
        store = FakeStore()
        for payload in ({"user_id": ADMIN, "role": "candidate"}, {"user_id": CANDIDATE, "role": "owner"},
                        {"user_id": CANDIDATE, "first_name": "  "}, {"user_id": CANDIDATE, "email": "nope"}, {"user_id": CANDIDATE}):
            self.assertEqual(self.call(store, "PATCH", "/api/admin/users", headers=AUTH, json=payload).status_code, 400, payload)
        self.assertEqual([call for call in store.calls if call[0] in {"PUT", "PATCH"}], [])

    def test_delete_user_removes_resume_files_then_auth_user(self):
        store = FakeStore()
        response = self.call(store, "DELETE", f"/api/admin/users/{CANDIDATE}", headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        writes = [(method, path.split("?")[0]) for method, path, _ in store.calls if method != "GET"]
        self.assertEqual(writes[-2:], [("DELETE", "/storage/v1/object/resumes"), ("DELETE", f"/auth/v1/admin/users/{CANDIDATE}")])
        storage_body = next(body for method, path, body in store.calls if path == "/storage/v1/object/resumes")
        self.assertEqual(storage_body, {"prefixes": [f"{CANDIDATE}/cara.pdf"]})

    def test_view_resume_returns_signed_link_and_text(self):
        store = FakeStore()
        with patch.object(main, "SUPABASE_URL", "https://proj.supabase.co"):
            response = self.call(store, "GET", "/api/admin/resumes/r1", headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        resume = response.json()["resume"]
        self.assertEqual(resume["download_url"], "https://proj.supabase.co/storage/v1/object/sign/resumes/file.pdf?token=abc")
        self.assertIn("Data analyst", resume["parsed_text"])
        self.assertEqual(resume["owner"]["email"], "cara@example.com")

    def test_delete_resume_removes_file_and_row(self):
        store = FakeStore()
        response = self.call(store, "DELETE", "/api/admin/resumes/r1", headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        writes = [(method, path.split("?")[0]) for method, path, _ in store.calls if method != "GET"]
        self.assertEqual(writes, [("DELETE", "/storage/v1/object/resumes"), ("DELETE", "/rest/v1/resumes")])

    def test_missing_resume_is_404(self):
        response = self.call(FakeStore(resumes=[]), "DELETE", "/api/admin/resumes/nope", headers=AUTH)
        self.assertEqual(response.status_code, 404)

    def test_reports_name_the_reporter_and_the_other_participant(self):
        reports = [
            {"id": "rep-1", "application_id": "app-1", "actor_user_id": CANDIDATE, "actor_role": "candidate",
                "reason": "scam", "details": "Asked for a fee", "created_at": "2026-09-25T00:00:00Z", "review_status": "open"},
            {"id": "rep-2", "application_id": "app-1", "actor_user_id": EMPLOYER, "actor_role": "employer",
                "reason": "harassment", "details": None, "created_at": "2026-09-25T01:00:00Z", "review_status": "open"},
        ]
        response = self.call(FakeStore(reports=reports), "GET", "/api/admin/reports", headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        by_id = {row["id"]: row for row in response.json()["reports"]}
        self.assertEqual(by_id["rep-1"]["reporter"]["email"], "cara@example.com")
        self.assertEqual(by_id["rep-1"]["reported"]["email"], "hr@acme.test")
        self.assertEqual(by_id["rep-1"]["reported"]["company_name"], "Acme Corp")
        self.assertEqual(by_id["rep-2"]["reported"]["email"], "cara@example.com")
        self.assertEqual(by_id["rep-1"]["application"]["job_title"], "Data Analyst")

    def test_review_report_validates_status_and_records_reviewer(self):
        store = FakeStore(reports=[{"id": "rep-1", "action": "report", "review_status": "open"}])
        self.assertEqual(self.call(store, "PATCH", "/api/admin/reports/rep-1", json={"status": "deleted"}, headers=AUTH).status_code, 400)
        response = self.call(store, "PATCH", "/api/admin/reports/rep-1", json={"status": "resolved", "note": "Warned user"}, headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        report = response.json()["report"]
        self.assertEqual((report["review_status"], report["reviewed_by"], report["admin_note"]), ("resolved", ADMIN, "Warned user"))

    def test_approving_a_deletion_request_deletes_the_account(self):
        store = FakeStore(deletion_requests=[{"id": "d1", "user_id": CANDIDATE, "user_email": "cara@example.com",
            "user_role": "candidate", "status": "pending"}])
        response = self.call(store, "POST", "/api/admin/deletion-requests/d1/approve", json={}, headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["request"]["status"], "approved")
        self.assertIn(("DELETE", f"/auth/v1/admin/users/{CANDIDATE}"), store.methods("/auth/v1/admin/users"))

    def test_rejecting_or_reapproving_does_not_delete(self):
        store = FakeStore(deletion_requests=[{"id": "d1", "user_id": CANDIDATE, "status": "pending"},
            {"id": "d2", "user_id": CANDIDATE, "status": "approved"}])
        self.assertEqual(self.call(store, "POST", "/api/admin/deletion-requests/d1/reject", json={"note": "Open invoices"}, headers=AUTH).status_code, 200)
        self.assertEqual(self.call(store, "POST", "/api/admin/deletion-requests/d2/approve", json={}, headers=AUTH).status_code, 409)
        self.assertFalse(store.methods("/auth/v1/admin/users"))


class AccountDeletionRequestTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        auth = patch.object(main, "_get_authenticated_user_id", side_effect=lambda h: {"Bearer c": CANDIDATE, "Bearer a": ADMIN}.get(h))
        auth.start()
        self.addCleanup(auth.stop)

    def call(self, store, method, **kwargs):
        with patch.object(main, "_supabase_request", store):
            return self.client.request(method, "/api/account/deletion-request", **kwargs)

    def test_requires_sign_in(self):
        self.assertEqual(self.call(FakeStore(), "POST", json={}).status_code, 401)

    def test_candidate_request_snapshots_email_and_role(self):
        store = FakeStore()
        response = self.call(store, "POST", json={"reason": "Found a job"}, headers={"Authorization": "Bearer c"})
        self.assertEqual(response.status_code, 200, response.text)
        created = next(body for method, path, body in store.calls if method == "POST")
        self.assertEqual(created, {"user_id": CANDIDATE, "user_email": "cara@example.com", "user_role": "candidate", "reason": "Found a job"})

    def test_existing_pending_request_is_reused(self):
        store = FakeStore(deletion_requests=[{"id": "d1", "user_id": CANDIDATE, "status": "pending"}])
        response = self.call(store, "POST", json={}, headers={"Authorization": "Bearer c"})
        self.assertEqual(response.json()["request"]["id"], "d1")
        self.assertFalse([call for call in store.calls if call[0] == "POST"])

    def test_admins_cannot_request_deletion(self):
        self.assertEqual(self.call(FakeStore(), "POST", json={}, headers={"Authorization": "Bearer a"}).status_code, 400)


class MatchFeedbackStatsTests(unittest.TestCase):
    NOW = datetime(2026, 9, 26, 12, tzinfo=timezone.utc)  # a Saturday

    def test_counts_rates_and_groups(self):
        rows = [
            {"user_id": "u1", "job_id": "J1", "job_source": "internal", "vote": 1, "match_category": "Fit-Now", "match_score": 0.85,
                "ranker_version": "baseline", "updated_at": "2026-09-25T10:00:00Z"},
            {"user_id": "u2", "job_id": "J1", "job_source": "internal", "vote": -1, "match_category": "Fit-Now", "match_score": 0.82,
                "ranker_version": "baseline", "updated_at": "2026-09-21T10:00:00Z"},
            {"user_id": "u2", "job_id": "J2", "job_source": "employer", "vote": -1, "match_category": "Aspiration", "match_score": 0.35,
                "ranker_version": "rerank-v2", "updated_at": "2026-09-10T10:00:00Z"},
            {"user_id": "u3", "job_id": "J2", "job_source": "employer", "vote": -1, "match_category": "Aspiration", "match_score": 0.3,
                "ranker_version": "rerank-v2", "updated_at": "2025-01-01T00:00:00Z"},
            {"user_id": "u3", "job_id": "J3", "vote": 0},
        ]
        stats = summarize_match_feedback(rows, now=self.NOW)
        self.assertEqual(stats["totals"], {"good": 1, "bad": 3, "total": 4, "good_rate": 0.25, "voters": 3})
        self.assertEqual(stats["by_category"]["Fit-Now"]["good_rate"], 0.5)
        bands = {item["band"]: item["total"] for item in stats["by_score_band"]}
        self.assertEqual(bands, {"0-39%": 2, "40-59%": 0, "60-79%": 0, "80-100%": 2})
        self.assertEqual(len(stats["by_week"]), 8)
        self.assertEqual(stats["by_week"][-1], {"week_start": "2026-09-21", "good": 1, "bad": 1, "total": 2, "good_rate": 0.5})
        self.assertEqual(sum(week["total"] for week in stats["by_week"]), 3)  # the 2025 vote is outside the window
        self.assertEqual([job["job_id"] for job in stats["most_downvoted_jobs"]], ["J2", "J1"])

    def test_empty_feedback(self):
        stats = summarize_match_feedback([], now=self.NOW)
        self.assertEqual(stats["totals"]["total"], 0)
        self.assertIsNone(stats["totals"]["good_rate"])
        self.assertEqual(stats["most_downvoted_jobs"], [])


if __name__ == "__main__":
    unittest.main()


class AdminRoleChangeTests(unittest.TestCase):
    """Role changes keep accounts usable and access consistent (audit ADMIN-01)."""

    def call(self, store, json):
        client = TestClient(main.app)
        with patch("backend.app.main._supabase_request", side_effect=store), \
             patch("backend.app.main._require_admin_user", return_value=ADMIN):
            return client.patch("/api/admin/users", headers=AUTH, json=json)

    def test_promotion_creates_the_new_workspace_profile(self):
        for user_id, role, table, expected in (
            (CANDIDATE, "employer", "/rest/v1/employer_profiles?on_conflict=user_id",
             {"user_id": CANDIDATE, "company_name": "Employer Workspace", "business_email": "cara@example.com"}),
            (EMPLOYER, "candidate", "/rest/v1/candidate_profiles?on_conflict=user_id", {"user_id": EMPLOYER}),
        ):
            with self.subTest(role=role):
                store = FakeStore()
                self.assertEqual(self.call(store, {"user_id": user_id, "role": role}).status_code, 200)
                posts = [body for method, path, body in store.calls if method == "POST" and path == table]
                self.assertEqual(posts, [expected])

    def test_an_employer_who_owns_job_posts_keeps_the_role(self):
        store = FakeStore()
        original = store.__call__

        def with_posts(path, **kwargs):
            if path.startswith("/rest/v1/employer_job_posts"):
                store.calls.append((kwargs.get("method", "GET"), path, kwargs.get("body")))
                return [{"id": "post-1"}]
            return original(path, **kwargs)

        response = self.call(with_posts, {"user_id": EMPLOYER, "role": "candidate"})
        self.assertEqual(response.status_code, 409)
        self.assertIn("job posts", response.json()["detail"])
        self.assertEqual([call for call in store.calls if call[0] in {"PUT", "PATCH", "POST"}], [])

    def test_an_unchanged_role_creates_nothing(self):
        store = FakeStore()
        self.assertEqual(self.call(store, {"user_id": CANDIDATE, "role": "candidate", "first_name": "Cara"}).status_code, 200)
        self.assertFalse(any(method == "POST" for method, _path, _body in store.calls))
