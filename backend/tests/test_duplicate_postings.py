"""Identical postings from one company are listed and matched once."""
import unittest
from unittest.mock import patch

from backend.app.services import supabase_jobs
from backend.app.services.supabase_jobs import drop_duplicate_postings


def posting(job_id, created_at, **changes):
    row = {
        "job_id": job_id, "job_source": "employer", "company_name": "Acme", "job_title": "Data Analyst",
        "location": "Makati City, Metro Manila", "work_type": "Hybrid", "employment_type": "Full-time",
        "experience_level_required": "Junior (1-2 yrs)", "salary_min_php": "30000", "salary_max_php": "40000",
        "job_description": "Build reports.", "responsibilities": "Clean data", "qualifications": "",
        "required_skills_comma_separated": "SQL, Excel", "must_have_skill_ids": "", "nice_to_have_skills_optional": "Python",
        "external_job_link_optional": "", "created_at": created_at,
    }
    row.update(changes)
    return row


class DuplicatePostingTests(unittest.TestCase):
    def test_a_reuploaded_posting_is_kept_once_as_first_posted(self):
        newer = posting("EMP-2", "2026-10-28T17:34:39+00:00")
        older = posting("EMP-1", "2026-10-27T12:48:24+00:00")
        self.assertEqual([row["job_id"] for row in drop_duplicate_postings([newer, older])], ["EMP-1"])

    def test_spacing_and_case_do_not_make_postings_different(self):
        rows = [posting("EMP-1", "2026-10-27"), posting("EMP-2", "2026-10-28", job_title="data  analyst ", location="makati city, metro manila")]
        self.assertEqual(len(drop_duplicate_postings(rows)), 1)

    def test_any_visible_difference_keeps_both(self):
        for field, value in (("location", "Cebu City, Cebu"), ("salary_max_php", "45000"), ("job_description", "Build dashboards."),
                             ("required_skills_comma_separated", "SQL"), ("work_type", "Remote"), ("experience_level_required", "Entry")):
            with self.subTest(field=field):
                rows = [posting("EMP-1", "2026-10-27"), posting("EMP-2", "2026-10-28", **{field: value})]
                self.assertEqual(len(drop_duplicate_postings(rows)), 2)

    def test_identical_postings_from_different_companies_are_kept(self):
        rows = [posting("EMP-1", "2026-10-27"), posting("EMP-2", "2026-10-27", company_name="LTK Corp.")]
        self.assertEqual(len(drop_duplicate_postings(rows)), 2)

    def test_internal_and_employer_sources_are_never_merged(self):
        rows = [posting("EMP-1", "2026-10-27"), posting("JOOBLE-1", "2026-10-27", job_source="internal")]
        self.assertEqual(len(drop_duplicate_postings(rows)), 2)

    def test_order_of_the_rest_is_unchanged(self):
        rows = [posting("A", "3", job_title="A"), posting("B2", "2"), posting("C", "1", job_title="C"), posting("B1", "1")]
        self.assertEqual([row["job_id"] for row in drop_duplicate_postings(rows)], ["A", "C", "B1"])

    def test_the_catalogue_loader_applies_it(self):
        employer = {
            "job_id": "EMP-{}", "job_title": "Data Analyst", "company_name": "Acme", "location": "Makati",
            "required_skills": "SQL", "posting_status": "active",
        }
        records = [{**employer, "job_id": "EMP-1", "created_at": "2026-10-27"}, {**employer, "job_id": "EMP-2", "created_at": "2026-10-28"}]
        with patch.object(supabase_jobs, "fetch_internal_jobs", return_value=[]), \
             patch.object(supabase_jobs, "fetch_employer_jobs", return_value=records):
            jobs = supabase_jobs.load_internal_jobs_dataframe()
        self.assertEqual(list(jobs["job_id"]), ["EMP-1"])


if __name__ == "__main__":
    unittest.main()
