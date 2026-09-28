"""Jooble import: listing mapping, skills from snippets, dedup, budget, save and expiry."""
import io
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.error import HTTPError

from backend.app.learning import skill_discovery as sd
from backend.scripts import import_jooble_jobs as jooble
from backend.tests.fake_supabase import FakeSupabase

NOW = datetime(2026, 9, 27, 12, tzinfo=timezone.utc)
NAMES = jooble._category_names()


def listing(jooble_id="101", title="Junior Data Analyst", snippet=None, **extra):
    return {
        "id": jooble_id, "title": title, "company": "Acme Corp", "location": "Makati, Metro Manila",
        "snippet": snippet if snippet is not None else (
            "We are hiring a data analyst to build reports. Must have SQL and Excel. Tableau is a plus. "
            "Hybrid work setup."),
        "salary": "₱25,000 - ₱35,000 per month", "type": "Full-time", "source": "jobstreet.com.ph",
        "link": f"https://ph.jooble.org/desc/{jooble_id}", "updated": "2026-09-20T00:00:00.0000000", **extra,
    }


class FakeClient:
    def __init__(self, pages, budget=10):
        self.pages = pages
        self.request_budget = budget
        self.requests_used = 0

    @property
    def budget_left(self):
        return self.request_budget - self.requests_used

    def search(self, keywords, location, page=1, per_page=50):
        self.requests_used += 1
        return self.pages.get((keywords, page), [])


class HelperTests(unittest.TestCase):
    def test_salary_is_monthly_php_or_nothing(self):
        self.assertEqual(jooble.monthly_salary_php("₱25,000 - ₱35,000 per month"), (25000, 35000))
        self.assertEqual(jooble.monthly_salary_php("PHP 20k"), (20000, 20000))
        self.assertEqual(jooble.monthly_salary_php("₱600,000 per year"), (50000, 50000))
        self.assertEqual(jooble.monthly_salary_php("₱800 per day"), (17600, 17600))
        self.assertEqual(jooble.monthly_salary_php("$1,500 per month"), (None, None))
        self.assertEqual(jooble.monthly_salary_php("₱120 per hour"), (None, None))
        self.assertEqual(jooble.monthly_salary_php(""), (None, None))

    def test_work_setup_level_and_type_only_when_stated(self):
        self.assertEqual(jooble.work_setup("Virtual Assistant", "Work from home"), "Remote")
        self.assertEqual(jooble.work_setup("Analyst", "Hybrid, 3 days onsite"), "Hybrid")
        self.assertEqual(jooble.work_setup("Cook", "Makati"), "")
        self.assertEqual(jooble.job_level("Senior Accounting Manager"), "Manager")
        self.assertEqual(jooble.job_level("Jr. Web Developer"), "Entry level")
        self.assertEqual(jooble.job_level("Accountant"), "")
        self.assertEqual(jooble.employment_type("Part-time"), "Part-Time")
        self.assertEqual(jooble.employment_type(""), "")

    def test_jooble_dates_with_seven_fraction_digits(self):
        self.assertEqual(jooble.posted_at("2026-09-20T00:00:00.0000000"), datetime(2026, 9, 20, tzinfo=timezone.utc))
        self.assertIsNone(jooble.posted_at("yesterday"))


class ListingTests(unittest.TestCase):
    def row(self, item, query=None):
        return jooble.listing_to_row(item, query or {"keywords": "data analyst", "category_code": "K02"},
                                     names=NAMES, now=NOW, today="2026-09-27")

    def test_listing_becomes_an_external_catalogue_row(self):
        row, reason = self.row(listing())
        self.assertEqual(reason, "")
        self.assertEqual(row["job_id"], "JOOBLE-101")
        self.assertEqual(row["source_platform"], "Jooble")
        self.assertEqual(row["source_url"], "https://ph.jooble.org/desc/101")
        self.assertFalse(row["is_synthetic_seed"])
        self.assertEqual((row["work_setup"], row["job_level"], row["employment_type"]), ("Hybrid", "Entry level", "Full-Time"))
        self.assertEqual((row["salary_min_php"], row["salary_max_php"]), (25000, 35000))
        self.assertEqual(row["category_code"], "K02")
        self.assertIn("jobstreet.com.ph", row["source_note"])

    def test_only_stated_requirements_are_required(self):
        row, _ = self.row(listing())
        required = row["required_skills"].lower()
        self.assertIn("sql", required)
        self.assertNotIn("tableau", required)
        self.assertIn("tableau", (row["preferred_skills"] or "").lower())

    def test_unstated_snippet_skills_are_nice_to_have(self):
        row, _ = self.row(listing(title="Office Staff", snippet="Prepare reports in Microsoft Excel and file records for the team."))
        self.assertIsNone(row["required_skills"])
        self.assertIsNone(row["must_have_skill_ids"])
        self.assertIn("excel", row["preferred_skills"].lower())

    def test_listings_without_skills_or_text_are_skipped(self):
        self.assertEqual(self.row(listing(snippet="Apply now!"))[1], "snippet too short")
        self.assertEqual(self.row(listing(title="Staff", snippet="Join our friendly team today and grow with a company that cares."))[1],
                         "no known skill in title or snippet")
        self.assertEqual(self.row(listing(link="http://example.com"))[1], "missing id, title or link")

    def test_category_left_blank_when_the_listing_reads_like_another_area(self):
        row, _ = self.row(listing(title="Staff Nurse", snippet="Provide patient care and patient assessment in the ward. Must have Basic Life Support training."),
                          {"keywords": "data analyst", "category_code": "K02"})
        self.assertIsNone(row["category_code"])


class CollectTests(unittest.TestCase):
    def test_dedup_age_limit_and_budget(self):
        old = listing("300", title="Data Analyst II", updated="2026-06-01T00:00:00.0000000")
        client = FakeClient({
            ("data analyst", 1): [listing("101"), listing("101"), listing("102"), old],
            ("accountant", 1): [listing("201", title="Staff Accountant",
                                        snippet="Handle bookkeeping and bank reconciliation. Must have accounting and Excel skills.")],
        }, budget=1)
        queries = [{"keywords": "data analyst", "category_code": "K02"}, {"keywords": "accountant", "category_code": "K04"}]
        result = jooble.collect(client, queries, "Philippines", pages=1, per_page=50, max_age_days=30, now=NOW)
        # 102 is the same title, company and location as 101: one posting listed twice.
        self.assertEqual([row["job_id"] for row in result["rows"]], ["JOOBLE-101"])
        self.assertEqual(result["skipped"], {"duplicate": 2, "older than 30 days": 1})
        self.assertEqual(result["requests_used"], 1)  # budget stopped the second search

    def test_client_never_leaks_the_key_in_errors(self):
        def refuse(request, timeout):
            raise HTTPError(request.full_url, 403, "Forbidden", {}, io.BytesIO(b""))
        client = jooble.JoobleClient("secret-key", request_budget=2, pause_seconds=0, opener=refuse)
        with self.assertRaises(jooble.JoobleError) as caught:
            client.search("nurse", "Philippines")
        self.assertNotIn("secret-key", str(caught.exception))
        self.assertEqual(client.budget_left, 1)

    def test_client_posts_the_search(self):
        sent = {}

        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def answer(request, timeout):
            sent.update(url=request.full_url, body=json.loads(request.data))
            return Response(json.dumps({"totalCount": 1, "jobs": [listing()]}).encode())
        client = jooble.JoobleClient("k", request_budget=1, pause_seconds=0, opener=answer)
        self.assertEqual(len(client.search("nurse", "Philippines", page=2, per_page=20)), 1)
        self.assertEqual(sent["url"], "https://ph.jooble.org/api/k")
        self.assertEqual(sent["body"], {"keywords": "nurse", "location": "Philippines", "page": "2", "ResultOnPage": "20"})


class SaveTests(unittest.TestCase):
    def test_upsert_keeps_admin_decisions_and_expires_unseen_listings(self):
        stale = (NOW - timedelta(days=40)).isoformat()
        client = FakeSupabase({"internal_jobs": [
            {"job_id": "JOOBLE-1", "posting_status": "closed", "source_platform": "Jooble", "updated_at": stale},
            {"job_id": "JOOBLE-2", "posting_status": "active", "source_platform": "Jooble", "updated_at": stale},
            {"job_id": "JOOBLE-3", "posting_status": "expired", "source_platform": "Jooble", "updated_at": stale},
            {"job_id": "KJ-1", "posting_status": "active", "source_platform": None, "updated_at": stale},
        ]})
        rows = [jooble.listing_to_row(listing(jooble_id), {"keywords": "data analyst", "category_code": "K02"},
                                      names=NAMES, now=NOW, today="2026-09-27")[0] for jooble_id in ("1", "3", "4")]
        summary = jooble.save(client, rows, expire_after_days=21, now=NOW)
        status = {row["job_id"]: row["posting_status"] for row in client.rows("internal_jobs")}
        self.assertEqual(summary, {"upserted": 2, "left_closed_by_admin": 1, "expired": 1})
        self.assertEqual(status, {"JOOBLE-1": "closed", "JOOBLE-2": "expired", "JOOBLE-3": "active",
                                  "JOOBLE-4": "active", "KJ-1": "active"})

    def test_skill_discovery_skips_jooble_snippets(self):
        client = FakeSupabase({"internal_jobs": [
            {"job_id": "JOOBLE-1", "company_name": "A", "job_description": "", "responsibilities": "",
             "required_skills": "Terraform", "preferred_skills": "", "posting_status": "active", "source_platform": "Jooble"},
            {"job_id": "KJ-1", "company_name": "B", "job_description": "", "responsibilities": "",
             "required_skills": "Terraform", "preferred_skills": "", "posting_status": "active", "source_platform": None},
        ]})
        refs = {mention.source_ref for mention in sd.collect_mentions(client)}
        self.assertEqual(refs, {"internal_jobs:KJ-1"})


class CsvTests(unittest.TestCase):
    def test_every_listing_is_written_with_its_outcome(self):
        import csv
        import tempfile
        from pathlib import Path

        client = FakeClient({("data analyst", 1): [
            listing("101"), listing("102"), listing("103", title="Staff", snippet="Join our friendly team today and grow with us."),
        ]})
        result = jooble.collect(client, [{"keywords": "data analyst", "category_code": "K02"}], "Philippines",
                                pages=1, per_page=50, max_age_days=30, now=NOW)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "listings.csv"
            self.assertEqual(jooble.write_csv(path, result["listings"]), 3)
            with path.open(encoding="utf-8-sig", newline="") as handle:
                written = list(csv.DictReader(handle))
        self.assertEqual([(r["jooble_id"], r["outcome"], r["skip_reason"]) for r in written], [
            ("101", "imported", ""), ("102", "skipped", "duplicate"), ("103", "skipped", "no known skill in title or snippet")])
        self.assertEqual(written[0]["job_id"], "JOOBLE-101")
        self.assertEqual(written[0]["search_keywords"], "data analyst")
        self.assertIn("SQL", written[0]["snippet"])
        self.assertEqual(written[1]["job_id"], "")


class MainTests(unittest.TestCase):
    def test_missing_key_is_a_visible_skip(self):
        with patch.dict("os.environ", {"JOOBLE_API_KEY": ""}), patch("sys.stdout", new_callable=io.StringIO) as out, \
                patch.object(jooble, "load_dotenv"):
            self.assertEqual(jooble.main(["--dry-run"]), 0)
        self.assertTrue(json.loads(out.getvalue())["skipped"])


if __name__ == "__main__":
    unittest.main()
