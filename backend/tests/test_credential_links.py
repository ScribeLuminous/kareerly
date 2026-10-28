"""Certificate links: clean-up, Credly badge checking, and the endpoint.

The sample pages below are written to resemble Credly's public badge pages; they
were not copied from the live site, so a real badge link should also be tried
by hand (see docs in the PR)."""
import unittest
import urllib.error
from unittest.mock import patch

from backend.app.services import credential_links as links

BADGE = "https://www.credly.com/badges/d6edaf38-1ed2-418c-9ecd-f6913acdc0f2/public_url"
GOOD_PAGE = """<html><head><title>Data Analytics Certificate - Credly</title>
<meta property="og:title" content="Data Analytics Professional Certificate was issued by Example Academy to Juan Dela Cruz.">
</head><body></body></html>"""
TITLE_ONLY_PAGE = "<html><head><title>Cloud Practitioner - Credly</title></head><body></body></html>"
NOT_FOUND_PAGE = "<html><head><title>Page not found - Credly</title></head><body>Sorry</body></html>"
SHELL_PAGE = "<html><head><title>Credly</title></head><body><div id='app'></div></body></html>"


class NormalizeTests(unittest.TestCase):
    def test_a_bare_link_gets_https(self):
        self.assertEqual(links.normalize_credential_url("credly.com/badges/x"), "https://credly.com/badges/x")

    def test_unsafe_or_unusable_links_are_refused(self):
        for bad in ("", "javascript:alert(1)", "ftp://example.com/a", "https://user:pw@credly.com/x", "https://localhost/a",
                    "https://127.0.0.1/a", "https://10.0.0.5/a", "https://[::1]/a", "http://", "not a link", "https://" + "a" * 600 + ".com"):
            with self.subTest(bad=bad):
                with self.assertRaises(links.CredentialLinkError):
                    links.normalize_credential_url(bad)

    def test_the_fragment_is_dropped_and_http_becomes_https(self):
        self.assertEqual(links.normalize_credential_url("http://www.credly.com/badges/x#top"), "https://www.credly.com/badges/x")


class ReadBadgePageTests(unittest.TestCase):
    def test_name_issuer_and_recipient_are_read(self):
        self.assertEqual(links.read_badge_page(GOOD_PAGE), {
            "badge_name": "Data Analytics Professional Certificate", "issuer": "Example Academy", "recipient": "Juan Dela Cruz"})

    def test_a_title_alone_still_names_a_badge(self):
        self.assertEqual(links.read_badge_page(TITLE_ONLY_PAGE)["badge_name"], "Cloud Practitioner")

    def test_error_and_empty_pages_are_not_badges(self):
        for page in (NOT_FOUND_PAGE, SHELL_PAGE, "", "<html><body>hello</body></html>", "<title>Some blog - My Site</title>"):
            with self.subTest(page=page[:40]):
                self.assertIsNone(links.read_badge_page(page))


class CheckTests(unittest.TestCase):
    def check(self, url, code=200, page=GOOD_PAGE, error=None):
        def fetch(_url):
            if error:
                raise error
            return code, page
        return links.check_credential_link(url, fetch)

    def test_a_real_badge_is_verified_with_its_details(self):
        result = self.check(BADGE)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["provider"], "Credly")
        self.assertEqual(result["badge_name"], "Data Analytics Professional Certificate")

    def test_a_badge_that_does_not_exist_is_not_found(self):
        self.assertEqual(self.check(BADGE, code=404, page="")["status"], "not_found")
        self.assertEqual(self.check(BADGE, page=NOT_FOUND_PAGE)["status"], "not_found")

    def test_a_credly_link_that_is_not_a_badge_is_not_fetched(self):
        fetched = []
        result = links.check_credential_link("https://www.credly.com/users/someone", lambda url: fetched.append(url) or (200, GOOD_PAGE))
        self.assertEqual(result["status"], "not_found")
        self.assertEqual(fetched, [])

    def test_when_credly_cannot_be_reached_the_link_is_kept_unchecked(self):
        self.assertEqual(self.check(BADGE, error=urllib.error.URLError("down"))["status"], "unreachable")
        self.assertEqual(self.check(BADGE, error=TimeoutError())["status"], "unreachable")
        self.assertEqual(self.check(BADGE, code=403, page="")["status"], "unreachable")

    def test_other_providers_are_never_fetched(self):
        fetched = []
        result = links.check_credential_link("https://www.credential.net/abc123", lambda url: fetched.append(url) or (200, GOOD_PAGE))
        self.assertEqual(result["status"], "not_checked")
        self.assertEqual(result["provider"], "Accredible")
        self.assertEqual(fetched, [])

    def test_an_internal_address_dressed_as_credly_is_never_fetched(self):
        fetched = []
        for url in ("https://credly.com.evil.example/badges/d6edaf38-1ed2-418c-9ecd-f6913acdc0f2", "https://evil.example/https://credly.com/badges/x", "https://169.254.169.254/latest"):
            result = links.check_credential_link(url, lambda u: fetched.append(u) or (200, GOOD_PAGE))
            self.assertIn(result["status"], {"not_checked", "invalid"})
        self.assertEqual(fetched, [])

    def test_invalid_input_is_reported_not_raised(self):
        self.assertEqual(self.check("javascript:alert(1)")["status"], "invalid")


class EndpointTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from backend.app.main import app
        self.client = TestClient(app)

    def test_it_needs_a_signed_in_user(self):
        with patch("backend.app.main._get_authenticated_user_id", return_value=None):
            response = self.client.post("/api/candidate/credential-links/check", json={"url": BADGE})
        self.assertEqual(response.status_code, 401)

    def test_a_signed_in_candidate_gets_the_result(self):
        with patch("backend.app.main._get_authenticated_user_id", return_value="user-1"), \
             patch("backend.app.main.check_credential_link", return_value={"status": "verified", "url": BADGE, "provider": "Credly", "message": "ok"}) as check:
            response = self.client.post("/api/candidate/credential-links/check", json={"url": BADGE}, headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "verified")
        check.assert_called_once_with(BADGE)


if __name__ == "__main__":
    unittest.main()
