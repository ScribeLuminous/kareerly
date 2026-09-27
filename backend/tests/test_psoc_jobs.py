"""Reviewed PSOC occupation codes travel with jobs without changing their skills."""

import io
import json
from urllib.error import HTTPError
from unittest import TestCase, mock

from backend.app.services import supabase_jobs


class JobOccupationTests(TestCase):
    def test_valid_unit_code_is_job_metadata(self):
        record = {
            "job_id": "JOB-1",
            "job_title": "Software Developer",
            "required_skills": "Python; SQL",
            "psoc_unit_code": "2512",
        }
        occupation = {"code": "2512", "valid": True, "level": "unit", "title": "SOFTWARE DEVELOPERS"}
        with mock.patch.object(supabase_jobs, "validate_occupation_code", return_value=occupation):
            mapped = supabase_jobs._map_job_record(record, "internal")
        self.assertEqual(mapped["psoc_unit_code"], "2512")
        self.assertEqual(mapped["psoc_title"], "SOFTWARE DEVELOPERS")
        self.assertEqual(mapped["required_skills_comma_separated"], "Python; SQL")

    def test_invalid_or_nonunit_code_is_not_exposed(self):
        with mock.patch.object(supabase_jobs, "validate_occupation_code", return_value={
            "code": "251", "valid": True, "level": "minor", "title": "Developers"
        }):
            mapped = supabase_jobs._map_job_record({"job_id": "JOB-2", "psoc_unit_code": "251"}, "employer")
        self.assertEqual(mapped["psoc_unit_code"], "")
        self.assertEqual(mapped["psoc_title"], "")

    def test_jobs_still_load_before_the_column_migration(self):
        requests = []

        def reply(request, timeout):
            requests.append(request.full_url)
            if "psoc_unit_code" in request.full_url:
                raise HTTPError(request.full_url, 400, "missing column", {},
                                io.BytesIO(b'{"message":"column psoc_unit_code does not exist"}'))
            return io.BytesIO(json.dumps([{"job_id": "JOB-1", "job_title": "Software Developer"}]).encode())

        with mock.patch.object(supabase_jobs, "urlopen", side_effect=reply):
            rows = supabase_jobs._fetch_jobs_table("internal_jobs", limit=1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(requests), 2)
