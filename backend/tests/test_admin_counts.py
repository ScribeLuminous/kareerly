"""Admin totals are not cut at PostgREST's 1,000-row page (audit DATA-02)."""
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from backend.app import main


class PagedTable:
    """Answers like PostgREST: never more than 1,000 rows, honouring offset."""

    def __init__(self, rows):
        self.rows = rows
        self.requests = []

    def __call__(self, path, **kwargs):
        query = {key: values[0] for key, values in parse_qs(urlsplit(path).query).items()}
        self.requests.append(query)
        offset, limit = int(query.get("offset", 0)), min(int(query.get("limit", 1000)), 1000)
        return self.rows[offset:offset + limit]


class AdminCountTests(unittest.TestCase):
    def test_counts_past_the_page_size(self):
        for total in (0, 999, 1000, 1228, 2500):
            with self.subTest(total=total):
                table = PagedTable([{"id": str(n)} for n in range(total)])
                with patch("backend.app.main._supabase_request", side_effect=table):
                    self.assertEqual(main._admin_count("employer_job_posts"), total)
                # Each page is ordered and offset, so pages never overlap.
                self.assertTrue(all(request["order"] == "id.asc" for request in table.requests))
                self.assertEqual([int(r["offset"]) for r in table.requests], list(range(0, len(table.requests) * 1000, 1000)))

    def test_reading_stops_at_the_cap(self):
        table = PagedTable([{"id": str(n)} for n in range(5000)])
        with patch("backend.app.main._supabase_request", side_effect=table):
            self.assertEqual(len(main._rest_rows_all("match_feedback", {"select": "id"}, max_rows=2000)), 2000)
        self.assertEqual(len(table.requests), 2)

    def test_a_given_order_is_kept(self):
        table = PagedTable([{"id": "1"}])
        with patch("backend.app.main._supabase_request", side_effect=table):
            main._rest_rows_all("match_feedback", {"select": "id", "order": "updated_at.desc,id.asc"})
        self.assertEqual(table.requests[0]["order"], "updated_at.desc,id.asc")


if __name__ == "__main__":
    unittest.main()
