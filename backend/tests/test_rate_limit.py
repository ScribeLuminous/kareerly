"""Request limits on the expensive public endpoints (audit SEC-06)."""
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import main, rate_limit

ORIGIN = "http://localhost:5173"


class RateLimiterTests(unittest.TestCase):
    def setUp(self):
        rate_limit.limiter.reset()
        self.addCleanup(rate_limit.limiter.reset)

    def test_sliding_window_per_bucket_and_client(self):
        limiter = rate_limit.RateLimiter()
        with patch.dict(os.environ, {"KAREERLY_RATE_LIMIT_RESUME": "2/60"}):
            self.assertIsNone(limiter.check("resume", "a", now=0))
            self.assertIsNone(limiter.check("resume", "a", now=1))
            self.assertEqual(limiter.check("resume", "a", now=2), 58)
            # Another client, and another bucket, are counted separately.
            self.assertIsNone(limiter.check("resume", "b", now=2))
            self.assertIsNone(limiter.check("certificate", "a", now=2))
            # The oldest request leaves the window.
            self.assertIsNone(limiter.check("resume", "a", now=60.5))

    def test_limits_can_be_tuned_or_turned_off(self):
        with patch.dict(os.environ, {"KAREERLY_RATE_LIMIT_MATCHING": "off"}):
            self.assertIsNone(rate_limit.configured_limit("matching"))
        with patch.dict(os.environ, {"KAREERLY_RATE_LIMIT_MATCHING": "200/300"}):
            self.assertEqual(rate_limit.configured_limit("matching"), (200, 300.0))
        with patch.dict(os.environ, {"KAREERLY_RATE_LIMIT_MATCHING": "nonsense"}):
            self.assertEqual(rate_limit.configured_limit("matching"), rate_limit.DEFAULT_LIMITS["matching"])

    def test_the_forwarded_address_cannot_be_forged(self):
        scope = {"headers": [(b"x-forwarded-for", b"1.1.1.1, 203.0.113.9")], "client": ("10.0.0.1", 1)}
        self.assertEqual(rate_limit.client_address(scope), "203.0.113.9")
        self.assertEqual(rate_limit.client_address({"headers": [], "client": ("10.0.0.1", 1)}), "10.0.0.1")

    def test_an_endpoint_answers_429_with_retry_after_and_cors(self):
        client = TestClient(main.app)
        headers = {"Origin": ORIGIN}
        with patch.dict(os.environ, {"KAREERLY_RATE_LIMIT_RESUME": "2/600"}), \
             patch("backend.app.main.analyze_resume_bytes", return_value={"ok": True}):
            codes = [client.post("/api/resume/analyze", headers=headers,
                                 files={"resume": ("resume.pdf", b"%PDF-1.4", "application/pdf")}).status_code for _ in range(3)]
            limited = client.post("/api/resume/analyze", headers=headers, files={"resume": ("resume.pdf", b"%PDF-1.4", "application/pdf")})
            # Reading is not limited.
            self.assertEqual(client.get("/api/health").status_code, 200)
        self.assertEqual(codes, [200, 200, 429])
        self.assertEqual(limited.status_code, 429)
        self.assertGreater(int(limited.headers["retry-after"]), 0)
        self.assertEqual(limited.headers.get("access-control-allow-origin"), ORIGIN)
        self.assertIn("Too many requests", limited.json()["detail"])


class CertificateSizeTests(unittest.TestCase):
    def test_an_oversized_certificate_is_refused(self):
        rate_limit.limiter.reset()
        body = b"%PDF-1.4 /Type /Page" + b"0" * (main.MAX_CERTIFICATE_BYTES + 10)
        response = TestClient(main.app).post("/api/certificates/validate", files={"certificate": ("c.pdf", body, "application/pdf")})
        self.assertEqual(response.status_code, 400)
        self.assertIn("5MB", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
