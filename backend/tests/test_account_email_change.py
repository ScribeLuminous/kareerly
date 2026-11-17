"""Account settings: a new login email is confirmed by the user before it takes
effect, and the candidate settings are for candidate accounts only."""
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.main import app

USER_ID = "00000000-0000-0000-0000-0000000000c1"


class FakeAuth:
    """Just enough of Supabase (profiles, candidate/employer profiles, Auth) for the settings endpoints."""

    def __init__(self, role="candidate", email="old@example.com", auth_email=None, new_email=None, user_update_error=None):
        self.profile = {"first_name": "Cara", "last_name": "One", "email": email, "role": role}
        self.auth_user = {"id": USER_ID, "email": auth_email or email, "new_email": new_email, "user_metadata": {}}
        self.user_update_error = user_update_error
        self.calls = []

    def __call__(self, path, *, method="GET", token=None, service_role=False, body=None, prefer=None):
        self.calls.append({"path": path, "method": method, "token": token, "service_role": service_role, "body": body})
        if path.startswith("/rest/v1/profiles?"):
            if method == "PATCH":
                self.profile.update(body)
                return None
            return [dict(self.profile)]
        if path.startswith("/rest/v1/candidate_profiles"):
            return [{"public_id": "KR-1", "location": "Iloilo"}] if method == "GET" else None
        if path.startswith("/rest/v1/employer_profiles"):
            if self.profile["role"] != "employer":
                return []
            return [{"id": "emp-1", "user_id": USER_ID, "company_name": "Acme"}]
        if path.startswith("/auth/v1/admin/users/"):
            if method == "PUT":
                self.auth_user.update({key: value for key, value in body.items() if key != "user_metadata"})
                self.auth_user["user_metadata"] = body.get("user_metadata", self.auth_user["user_metadata"])
                return dict(self.auth_user)
            return dict(self.auth_user)
        if path == "/auth/v1/user" and method == "PUT":
            if self.user_update_error:
                raise self.user_update_error
            self.auth_user["new_email"] = body["email"]
            return dict(self.auth_user)
        return None

    def admin_puts(self):
        return [call for call in self.calls if call["path"].startswith("/auth/v1/admin/users/") and call["method"] == "PUT"]

    def user_puts(self):
        return [call for call in self.calls if call["path"] == "/auth/v1/user" and call["method"] == "PUT"]


class AccountEmailChangeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer user-token"}
        user = patch("backend.app.main._get_authenticated_user_id", return_value=USER_ID)
        user.start()
        self.addCleanup(user.stop)

    def patch_candidate(self, fake, **fields):
        with patch("backend.app.main._supabase_request", side_effect=fake):
            return self.client.patch("/api/candidate/account-settings", headers=self.auth,
                json={"full_name": "Cara One", "email": "old@example.com", **fields})

    def test_candidate_email_change_waits_for_confirmation(self):
        fake = FakeAuth()
        response = self.patch_candidate(fake, email="New@Example.com")
        self.assertEqual(response.status_code, 200)
        # Requested with the user's own session, so Supabase sends the confirmation link.
        self.assertEqual(len(fake.user_puts()), 1)
        self.assertEqual(fake.user_puts()[0]["token"], "user-token")
        self.assertFalse(fake.user_puts()[0]["service_role"])
        self.assertEqual(fake.user_puts()[0]["body"], {"email": "new@example.com"})
        # Nothing changes the login email or marks it confirmed directly.
        for call in fake.admin_puts():
            self.assertNotIn("email", call["body"])
            self.assertNotIn("email_confirm", call["body"])
        self.assertEqual(fake.profile["email"], "old@example.com")
        self.assertEqual(response.json()["email"], "old@example.com")
        self.assertEqual(response.json()["pending_email"], "new@example.com")

    def test_unchanged_email_requests_nothing(self):
        fake = FakeAuth()
        response = self.patch_candidate(fake, email="OLD@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake.user_puts(), [])
        self.assertIsNone(response.json()["pending_email"])

    def test_confirmed_change_is_copied_to_the_profile_on_next_read(self):
        fake = FakeAuth(email="old@example.com", auth_email="confirmed@example.com")
        with patch("backend.app.main._supabase_request", side_effect=fake):
            response = self.client.get("/api/candidate/account-settings", headers=self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "confirmed@example.com")
        self.assertEqual(fake.profile["email"], "confirmed@example.com")

    def test_unusable_email_gets_a_readable_error(self):
        fake = FakeAuth(user_update_error=HTTPException(status_code=422, detail='{"code":"email_exists"}'))
        response = self.patch_candidate(fake, email="taken@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("email_exists", response.text)

    def test_rate_limited_change_says_so(self):
        fake = FakeAuth(user_update_error=HTTPException(status_code=429, detail="email rate limit exceeded"))
        response = self.patch_candidate(fake, email="new@example.com")
        self.assertEqual(response.status_code, 429)

    def test_employer_cannot_use_candidate_settings(self):
        fake = FakeAuth(role="employer")
        response = self.patch_candidate(fake, email="old@example.com")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(fake.admin_puts(), [])
        self.assertFalse(any(call["method"] in {"POST", "PATCH"} for call in fake.calls))

    def test_employer_login_email_change_waits_for_confirmation(self):
        fake = FakeAuth(role="employer")
        with patch("backend.app.main._supabase_request", side_effect=fake):
            response = self.client.patch("/api/employer/account-settings", headers=self.auth, json={
                "company_name": "Acme", "account_email": "hr@acme.example", "first_name": "Cara", "last_name": "One",
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual([call["body"] for call in fake.user_puts()], [{"email": "hr@acme.example"}])
        for call in fake.admin_puts():
            self.assertNotIn("email", call["body"])
            self.assertNotIn("email_confirm", call["body"])
        self.assertEqual(response.json()["account_email"], "old@example.com")
        self.assertEqual(response.json()["pending_email"], "hr@acme.example")


if __name__ == "__main__":
    unittest.main()
