"""Employer job descriptions keep responsibilities and qualifications apart."""

from unittest import TestCase

from backend.app.services import supabase_jobs

DESCRIPTION = (
    "Front desk role.\n\n"
    "Responsibilities:\n- Check guests in\n- Manage bookings\n\n"
    "Qualifications:\n- Bachelor's degree in Hospitality, Tourism or related field\n- Fluent in English"
)


class JobSectionTests(TestCase):
    def test_qualifications_end_the_responsibilities_list(self):
        description, responsibilities, qualifications = supabase_jobs.split_job_sections(DESCRIPTION)
        self.assertEqual(description, "Front desk role.")
        self.assertEqual(responsibilities, ["Check guests in", "Manage bookings"])
        self.assertEqual(qualifications, ["Bachelor's degree in Hospitality, Tourism or related field", "Fluent in English"])

    def test_description_without_headings_stays_whole(self):
        self.assertEqual(supabase_jobs.split_job_sections("Just an overview."), ("Just an overview.", [], []))

    def test_job_record_lists_qualifications_one_per_line(self):
        mapped = supabase_jobs._map_job_record({"job_id": "EMP-1", "job_description": DESCRIPTION}, "employer")
        self.assertEqual(mapped["job_description"], "Front desk role.")
        self.assertEqual(mapped["responsibilities"], "Check guests in\nManage bookings")
        self.assertEqual(mapped["qualifications"], "Bachelor's degree in Hospitality, Tourism or related field\nFluent in English")
