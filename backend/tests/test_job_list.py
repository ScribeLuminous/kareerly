"""The Kareers list is all open jobs or the last complete list, never a short one."""

import io
import json
from unittest import TestCase, mock

from backend.app.services import job_matcher, supabase_jobs


def _api(total, *, fail_offsets=()):
    jobs = [{"job_id": f"JOB-{n:04d}", "job_title": "Role", "created_at": "2026-09-01T00:00:00Z"} for n in range(total)]

    def reply(request, timeout):
        query = dict(item.split("=", 1) for item in request.full_url.split("?", 1)[1].split("&"))
        if "employer_job_posts" in request.full_url:
            return io.BytesIO(b"[]")
        offset, limit = int(query["offset"]), int(query["limit"])
        if offset in fail_offsets:
            raise TimeoutError("slow page")
        return io.BytesIO(json.dumps(jobs[offset:offset + limit]).encode())

    return reply


class StrictLoadingTests(TestCase):
    def test_strict_load_raises_when_a_page_keeps_failing(self):
        with mock.patch.object(supabase_jobs, "urlopen", side_effect=_api(1000, fail_offsets={500})):
            with self.assertRaises(supabase_jobs.JobCatalogueIncomplete):
                supabase_jobs._fetch_jobs_table("internal_jobs", limit=5000, strict=True)

    def test_default_load_still_returns_what_it_read(self):
        with mock.patch.object(supabase_jobs, "urlopen", side_effect=_api(1000, fail_offsets={500})):
            rows = supabase_jobs._fetch_jobs_table("internal_jobs", limit=5000)
        self.assertEqual(len(rows), 500)


class JobListTests(TestCase):
    def setUp(self):
        job_matcher._job_list_cache.update(limit=0, loaded_at=0.0, results=None)

    def test_a_short_read_keeps_the_last_complete_list(self):
        with mock.patch.object(supabase_jobs, "urlopen", side_effect=_api(1000)):
            self.assertEqual(len(job_matcher.list_available_jobs()), 1000)
        job_matcher._job_list_cache["loaded_at"] = 0.0  # expired
        with mock.patch.object(supabase_jobs, "urlopen", side_effect=_api(1000, fail_offsets={500})):
            self.assertEqual(len(job_matcher.list_available_jobs()), 1000)

    def test_a_short_read_with_nothing_cached_is_an_error(self):
        with mock.patch.object(supabase_jobs, "urlopen", side_effect=_api(1000, fail_offsets={500})):
            with self.assertRaises(supabase_jobs.JobCatalogueIncomplete):
                job_matcher.list_available_jobs()

    def test_a_fresh_list_is_shared_instead_of_re_read(self):
        reply = mock.Mock(side_effect=_api(10))
        with mock.patch.object(supabase_jobs, "urlopen", reply):
            job_matcher.list_available_jobs()
            calls = reply.call_count
            job_matcher.list_available_jobs()
        self.assertEqual(reply.call_count, calls)
