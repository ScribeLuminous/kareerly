"""Region preference for job recommendations.

* One mapping places job and candidate locations in Philippine regions; vague
  text ("Philippines", "Remote") is never read as a region.
* "Anywhere in the Philippines" (or no answer) changes nothing.
* With a region filter, on-site and hybrid jobs must be in that region; remote
  jobs stay only when the work setup answer allows remote work; jobs in other
  regions and jobs whose region is unknown are excluded and never brought back
  to fill the list. Scores are never changed by the filter.
* Both matching endpoints pass the preference through, and a filter with no
  usable region is refused instead of guessed.
"""
import json
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import matching_service as matching
from backend.app.services import ph_regions
from backend.app.services.ph_regions import RegionPreferenceError, region_preference, regions_in_location, resolve_single_region

AREA = "sales-marketing-customer-service"


def job(job_id, location, setup="Onsite"):
    return dict(
        job_id=job_id, category_id="K09", job_category="Customer Service and Retail", job_subcategory="",
        job_title="Customer Support Associate", job_description="Customer Support Associate",
        required_skills_comma_separated="", mapped_required_skill_names="", required_skill_ids="SK029;SK644",
        must_have_skill_ids="SK029", experience_level_required="Entry Level", location=location, work_type=setup,
        salary_range_monthly_php="PHP 18,000 - 25,000", job_text_for_matching="",
    )


JOBS = pd.DataFrame([
    job("cebu-onsite", "Cebu City, Cebu"),
    job("cebu-hybrid", "Mandaue, Cebu", setup="Hybrid"),
    job("makati-onsite", "Makati City, Metro Manila"),
    job("davao-hybrid", "Davao City, Davao del Sur", setup="Hybrid"),
    job("vague-hybrid", "Philippines", setup="Hybrid"),
    job("blank-onsite", "", setup="Onsite"),
    job("remote-ph", "Remote, Philippines", setup="Remote"),
    job("remote-manila", "Makati City, Metro Manila", setup="Remote"),
])
SEMANTIC = np.asarray([0.45, 0.44, 0.43, 0.42, 0.41, 0.40, 0.39, 0.38])
RESUME = ("Customer support specialist. Skills: customer service, Zendesk, Microsoft Excel. "
          "Experience: Support Agent, Example Co, 2021 - Present, resolved tickets in Zendesk.")
CONFIRMED = [{"skill_id": "SK029", "skill_name": "Customer Service"}]


def report(preferences, jobs=JOBS, semantic=SEMANTIC):
    with patch.object(matching, "load_internal_jobs_dataframe", return_value=jobs), \
         patch.object(matching, "score_jobs", return_value=semantic), \
         patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
         patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
        return matching.match_text_to_jobs(RESUME, confirmed_skills=CONFIRMED, preferences=preferences)


def recommended(result):
    return {item["job_id"]: (item["match_type"], item["match_score"], item["semantic_score"], item["skill_coverage"])
            for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]}


class RegionMappingTests(unittest.TestCase):
    def test_job_and_candidate_locations_map_to_regions(self):
        cases = {
            "Makati City, Metro Manila": {"NCR"},
            "BGC, Taguig City": {"NCR"},
            "Quezon City": {"NCR"},  # the city, not Quezon province
            "Lucena, Quezon": {"IV-A"},
            "Cebu City, Cebu": {"VII"},
            "Cagayan de Oro, Misamis Oriental": {"X"},  # not Cagayan Valley
            "Tuguegarao, Cagayan": {"II"},
            "Cotabato City": {"BARMM"},
            "Bacolod City, Negros Occidental": {"NIR"},
            "Mandaluyong City, Metro\nManila": {"NCR"},
            "Parañaque": {"NCR"},
            "Laguna / Metro Manila": {"IV-A", "NCR"},
        }
        for location, regions in cases.items():
            with self.subTest(location):
                self.assertEqual(regions_in_location(location), frozenset(regions))

    def test_vague_or_foreign_locations_name_no_region(self):
        for location in ["Philippines", "Remote, Philippines", "Remote (Philippines)", "Nationwide", "", None,
                         "Regional Office", "United Kingdom"]:
            with self.subTest(location):
                self.assertEqual(regions_in_location(location), frozenset())
                self.assertIsNone(resolve_single_region(location))

    def test_sulu_is_not_barmm_and_isabela_city_is_region_ix(self):
        # Supreme Court, 2024: Sulu is excluded from BARMM. No replacement region is guessed.
        for location in ["Jolo, Sulu", "Sulu", "Patikul, Sulu"]:
            with self.subTest(location):
                self.assertNotIn("BARMM", regions_in_location(location))
                self.assertIsNone(resolve_single_region(location))
        self.assertEqual(resolve_single_region("Isabela City"), "IX")
        self.assertEqual(resolve_single_region("Isabela City, Basilan"), "IX")
        self.assertEqual(resolve_single_region("Lamitan City, Basilan"), "BARMM")
        self.assertEqual(resolve_single_region("Ilagan City, Isabela"), "II")

    def test_a_candidate_region_must_be_single(self):
        self.assertEqual(resolve_single_region("Cebu City, Cebu"), "VII")
        # Two regions named: ask, do not pick one.
        self.assertIsNone(resolve_single_region("Laguna / Metro Manila"))

    def test_frontend_region_list_matches_backend(self):
        from pathlib import Path
        source = (Path(__file__).resolve().parents[2] / "frontend/src/lib/regionPreference.ts").read_text(encoding="utf-8")
        import re
        frontend = re.findall(r"\{ code: '([^']+)', name: '([^']+)' \}", source)
        self.assertEqual(frontend, [(region.code, region.name) for region in ph_regions.REGIONS])


    def test_every_frontend_province_resolves_to_its_region(self):
        # Employer company and job locations are saved as "City, Province" with the
        # province picked from this list, so the province alone must place them.
        from pathlib import Path
        import re
        source = (Path(__file__).resolve().parents[2] / "frontend/src/lib/phProvinces.ts").read_text(encoding="utf-8")
        groups = re.findall(r"\{ region: '([^']*)', label: '[^']+', provinces: \[([^\]]+)\] \}", source)
        self.assertEqual(len(groups), 19)
        for code, provinces in groups:
            for province in re.findall(r"'([^']+)'", provinces):
                with self.subTest(province=province):
                    self.assertEqual(resolve_single_region(province), code or None)

class RegionPreferenceParsingTests(unittest.TestCase):
    def test_anywhere_and_missing_apply_no_filter(self):
        for preferences in [{}, None, {"location_scope": "anywhere"}, {"location_scope": "", "region": "NCR"}]:
            with self.subTest(preferences):
                self.assertFalse(region_preference(preferences).active)

    def test_current_region_from_code_or_profile_location(self):
        self.assertEqual(region_preference({"location_scope": "current", "region": "vii"}).region, "VII")
        self.assertEqual(
            region_preference({"location_scope": "current", "current_location": "Cebu City, Cebu"}).region, "VII")

    def test_current_region_that_cannot_be_determined_is_refused(self):
        for location in ["Philippines", "", "Laguna / Metro Manila"]:
            with self.subTest(location), self.assertRaises(RegionPreferenceError) as error:
                region_preference({"location_scope": "current", "current_location": location})
            self.assertIn("choose a region", str(error.exception).lower())

    def test_chosen_region_must_be_a_known_region(self):
        self.assertEqual(region_preference({"location_scope": "region", "region": "IV-A"}).region, "IV-A")
        self.assertEqual(region_preference({"location_scope": "region", "region": "Region VII – Central Visayas"}).region, "VII")
        for region in ["", "Philippines", "Mars"]:
            with self.subTest(region), self.assertRaises(RegionPreferenceError):
                region_preference({"location_scope": "region", "region": region})


class RegionFilterMatchingTests(unittest.TestCase):
    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)
        self.baseline = recommended(report({"industry": AREA, "work_setup": "flexible"}))
        # Every job is recommendable without a region filter.
        self.assertEqual(set(self.baseline), set(JOBS["job_id"]))

    def test_no_region_preference_changes_nothing(self):
        for preferences in [{"industry": AREA, "work_setup": "flexible"},
                            {"industry": AREA, "work_setup": "flexible", "location_scope": "anywhere"}]:
            with self.subTest(preferences):
                result = report(preferences)
                self.assertEqual(recommended(result), self.baseline)
                self.assertFalse(result["location_filter"]["active"])

    def test_manually_chosen_region(self):
        result = report({"industry": AREA, "work_setup": "onsite", "location_scope": "region", "region": "VII"})
        # On-site and hybrid jobs in Central Visayas only; with an on-site answer no remote job stays.
        self.assertEqual(set(recommended(result)), {"cebu-onsite", "cebu-hybrid"})
        self.assertEqual(result["location_filter"]["region_name"], "Region VII – Central Visayas")
        self.assertEqual(result["preferences_used"]["region"], "VII")

    def test_current_region_from_profile_location(self):
        result = report({"industry": AREA, "work_setup": "hybrid", "location_scope": "current",
                         "current_location": "Poblacion, Makati City"})
        # The Makati-based remote job is in the region too; work setup never removes
        # a job by itself (it lowers alignment), so only its region is checked here.
        self.assertEqual(set(recommended(result)), {"makati-onsite", "remote-manila"})
        self.assertEqual(result["location_filter"]["location_scope"], "current")
        self.assertEqual(result["location_filter"]["region"], "NCR")

    def test_out_of_region_jobs_are_excluded_and_counted(self):
        result = report({"industry": AREA, "work_setup": "onsite", "location_scope": "region", "region": "XI"})
        self.assertEqual(set(recommended(result)), {"davao-hybrid"})
        location_filter = result["location_filter"]
        self.assertEqual(location_filter["jobs_in_region"], 1)
        # Cebu x2, Makati on-site, and the Makati-based remote job (remote not allowed).
        self.assertEqual(location_filter["excluded_out_of_region"], 4)

    def test_remote_jobs_stay_when_work_setup_allows_remote(self):
        for setup in ["remote", "flexible", "Flexible - no preference", "100% Work from Home"]:
            with self.subTest(setup):
                result = report({"industry": AREA, "work_setup": setup, "location_scope": "region", "region": "XI"})
                self.assertEqual(set(recommended(result)), {"davao-hybrid", "remote-ph", "remote-manila"})
                self.assertEqual(result["location_filter"]["remote_jobs_included"], 2)
        for setup in ["onsite", "hybrid"]:
            with self.subTest(setup):
                result = report({"industry": AREA, "work_setup": setup, "location_scope": "region", "region": "XI"})
                self.assertNotIn("remote-ph", recommended(result))
                self.assertNotIn("remote-manila", recommended(result))

    def test_jobs_with_an_unknown_region_are_not_included(self):
        result = report({"industry": AREA, "work_setup": "flexible", "location_scope": "region", "region": "NCR"})
        kept = recommended(result)
        self.assertNotIn("vague-hybrid", kept)
        self.assertNotIn("blank-onsite", kept)
        self.assertEqual(result["location_filter"]["excluded_region_unknown"], 2)

    def test_filter_never_changes_scores(self):
        result = report({"industry": AREA, "work_setup": "flexible", "location_scope": "region", "region": "VII"})
        for job_id, values in recommended(result).items():
            self.assertEqual(values, self.baseline[job_id], job_id)

    def test_empty_region_is_not_filled_with_other_jobs_except_one_fit_now(self):
        result = report({"industry": AREA, "work_setup": "onsite", "location_scope": "region", "region": "BARMM"})
        # Fit-Now always lists the job closest to the resume, here from outside
        # the region; Aspiration is not filled with other jobs.
        self.assertEqual(len(result["fit_now_matches"]), 1)
        closest = result["fit_now_matches"][0]
        # A job that passes every Fit-Now rule, shown although it is in Cebu.
        self.assertEqual(closest["fit_now_fallback_reason"], "outside_region_filter")
        self.assertEqual(closest["match_breakdown"]["match_category"], "Fit-Now")
        self.assertEqual(closest["region_filter_status"], "out_of_region")
        self.assertIn("outside the region you chose", closest["explanation"])
        self.assertEqual(recommended(result), {closest["job_id"]: self.baseline[closest["job_id"]]})
        self.assertEqual(result["aspiration_matches"], [])
        self.assertIn("No job in Bangsamoro", result["recommendation_notice"])
        self.assertIn("Anywhere in the Philippines", result["recommendation_notice"])

    def test_filter_without_a_region_is_refused(self):
        with self.assertRaises(ValueError):
            report({"industry": AREA, "location_scope": "current", "current_location": "Philippines"})


class RegionPreferenceEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_both_matching_routes_pass_the_region_preference(self):
        preference = {"work_setup": "onsite", "location_scope": "region", "region": "VII"}
        with patch("backend.app.main.run_matching", return_value={}) as match, \
             patch("backend.app.main._apply_report_access_control", return_value={}):
            self.assertEqual(self.client.post("/api/matches/run", json={
                "resume_text_for_matching": "Support agent", "preferences": preference}).status_code, 200)
            self.assertEqual(self.client.post("/api/matches/run-form", data={"payload": json.dumps({
                "resume_text_for_matching": "Support agent", "preferences": preference})}).status_code, 200)
            self.assertEqual(self.client.post("/api/matches/from-resume", files={"file": ("resume.pdf", b"%PDF sample")},
                data={"preferences": json.dumps(preference)}).status_code, 200)
        self.assertEqual(match.call_count, 3)
        for call in match.call_args_list:
            self.assertEqual(call.kwargs["preferences"]["location_scope"], "region")
            self.assertEqual(call.kwargs["preferences"]["region"], "VII")

    def test_region_filter_without_a_region_is_a_readable_400(self):
        preferences = {"location_scope": "current", "current_location": "Philippines"}
        with patch.object(matching, "_prepare_candidate_context", side_effect=AssertionError("not reached")):
            response = self.client.post("/api/matches/run", json={
                "resume_text_for_matching": "Support agent", "preferences": preferences})
            self.assertEqual(response.status_code, 400)
            self.assertIn("choose a region", response.json()["detail"].lower())
            response = self.client.post("/api/matches/from-resume", files={"file": ("resume.pdf", b"%PDF sample")},
                data={"preferences": json.dumps(preferences), "resume_text_for_matching": "Support agent"})
            self.assertEqual(response.status_code, 400)

    def test_region_lookup_endpoint(self):
        body = self.client.get("/api/locations/regions", params={"location": "Cebu City, Cebu"}).json()
        self.assertEqual(body["current_region"], "VII")
        self.assertEqual(body["current_region_name"], "Region VII – Central Visayas")
        self.assertEqual(len(body["regions"]), 18)
        vague = self.client.get("/api/locations/regions", params={"location": "Philippines"}).json()
        self.assertEqual(vague["current_region"], "")


if __name__ == "__main__":
    unittest.main()
