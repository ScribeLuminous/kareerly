import io
import unittest
import urllib.error
from unittest.mock import patch

from fastapi import HTTPException

from backend.app import main


class SupabaseErrorRedactionTests(unittest.TestCase):
    def _raise(self, body: str):
        error = urllib.error.HTTPError("https://db.test/rest/v1/profiles", 409, "Conflict", {}, io.BytesIO(body.encode()))
        with patch.object(main, "SUPABASE_URL", "https://db.test"), patch.object(main, "SUPABASE_ANON_KEY", "anon"), \
                patch.object(main, "SUPABASE_SERVICE_ROLE_KEY", "service"), \
                patch("backend.app.main.urllib.request.urlopen", side_effect=error):
            with self.assertRaises(HTTPException) as caught:
                main._supabase_request("/rest/v1/profiles", method="PATCH", service_role=True, body={})
        return caught.exception

    def test_constraint_values_are_not_returned(self):
        exc = self._raise(
            '{"code":"23505","details":"Key (email)=(someone@example.com) already exists.",'
            '"message":"duplicate key value violates unique constraint \\"profiles_email_key\\""}'
        )
        self.assertEqual(exc.status_code, 409)
        self.assertNotIn("someone@example.com", str(exc.detail))
        self.assertIn("Key (email)=([redacted]) already exists", str(exc.detail))
        self.assertIn("23505", str(exc.detail))

    def test_foreign_key_values_are_not_returned(self):
        exc = self._raise('{"details":"Key (user_id)=(0000-aaaa) is not present in table \\"profiles\\"."}')
        self.assertNotIn("0000-aaaa", str(exc.detail))

    def test_error_codes_callers_match_on_are_kept(self):
        exc = self._raise('{"code":"P0001","message":"MAX_EXTERNAL_JOB_MATCHES_REACHED"}')
        self.assertIn("MAX_EXTERNAL_JOB_MATCHES_REACHED", str(exc.detail))


if __name__ == "__main__":
    unittest.main()
