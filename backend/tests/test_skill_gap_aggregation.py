"""Skill gaps regrouped by skill: tiers, order, scope, synonyms and By Skill / By Job parity."""
import itertools
import json
import re
import unittest
from unittest.mock import patch

import pandas as pd
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import learning_recommender, matching_service, skill_gap_config as config
from backend.app.services.resume_summary import build_resume_summary, resume_version
from backend.app.services.skill_gap_aggregation import (
    aggregate_by_job, aggregate_by_skill, build_gap_report, gap_job_from_match, resolve_jobs, select_scope,
)


def plain(name):
    """A resolver for rule tests: every distinct name is its own skill."""
    return name.upper(), name, ""


def job(job_id, required=(), nice=(), match_type="fit_now", pct=80.0, source="internal"):
    return {"job_id": job_id, "job_source": source, "title": f"Job {job_id}", "company": f"Company {job_id}",
            "match_pct": pct, "match_type": match_type, "missing_required": list(required), "missing_nice": list(nice)}


class TierRuleTests(unittest.TestCase):
    def test_tier_truth_table(self):
        cases = {
            (2, 0): config.TIER_CLOSE_FIRST, (3, 4): config.TIER_CLOSE_FIRST,
            (1, 0): config.TIER_WORTH_NEXT, (1, 6): config.TIER_WORTH_NEXT,
            (0, 2): config.TIER_WORTH_NEXT, (0, 5): config.TIER_WORTH_NEXT,
            (0, 1): config.TIER_NICE_EXTRAS,
        }
        for (required, nice), tier in cases.items():
            with self.subTest(required=required, nice=nice):
                self.assertEqual(config.assign_tier(required, nice), tier)

    def test_every_gap_follows_the_tier_rule_and_sort_order(self):
        # Every combination of 0-3 required and 0-3 nice-to-have jobs, with varied match %.
        jobs, index = [], 0
        for required, nice in itertools.product(range(4), range(4)):
            if not required and not nice:
                continue
            skill = f"Skill r{required} n{nice}"
            for position in range(required + nice):
                index += 1
                is_required = position < required
                jobs.append(job(f"j{index}", required=[skill] if is_required else [], nice=[] if is_required else [skill],
                                pct=40 + (index * 7) % 55))
        rows = aggregate_by_skill(resolve_jobs(jobs, plain))
        self.assertEqual(len(rows), 15)
        for row in rows:
            with self.subTest(skill=row["skill_name"]):
                required = sum(entry["requirement"] == "required" for entry in row["jobs"])
                self.assertEqual((row["required_jobs"], row["nice_jobs"]), (required, len(row["jobs"]) - required))
                self.assertEqual(row["tier"], config.assign_tier(row["required_jobs"], row["nice_jobs"]))
                self.assertEqual(row["jobs_needing"], len(row["jobs"]))
                self.assertEqual(row["best_match_pct"], max(entry["match_pct"] for entry in row["jobs"]))
        keys = [config.skill_sort_key(row["tier"], row["jobs_needing"], row["best_match_pct"], row["skill_name"]) for row in rows]
        self.assertEqual(keys, sorted(keys))

    def test_within_a_tier_more_jobs_then_higher_match_comes_first(self):
        jobs = [
            job("a", required=["Excel", "SQL"], pct=60), job("b", required=["Excel", "SQL"], pct=70),
            job("c", required=["SQL"], pct=50), job("d", required=["Python", "Tableau"], pct=95),
            job("e", required=["Python", "Tableau"], pct=65),
        ]
        rows = aggregate_by_skill(resolve_jobs(jobs, plain))
        self.assertEqual([row["skill_name"] for row in rows], ["SQL", "Python", "Tableau", "Excel"])
        self.assertTrue(all(row["tier"] == config.TIER_CLOSE_FIRST for row in rows))
        # Python and Tableau tie on jobs and match %, so the name decides.
        self.assertEqual(rows[1]["best_match_pct"], rows[2]["best_match_pct"])

    def test_a_skill_both_required_and_nice_in_one_job_counts_as_required_once(self):
        rows = aggregate_by_skill(resolve_jobs([job("a", required=["SQL"], nice=["SQL"])], plain))
        self.assertEqual((rows[0]["required_jobs"], rows[0]["nice_jobs"], rows[0]["jobs_needing"]), (1, 0, 1))

    def test_impact_meter_follows_jobs_needing(self):
        self.assertEqual(config.impact_for(1), ("Low impact", 1))
        self.assertEqual(config.impact_for(2), ("Medium impact", 2))
        self.assertEqual(config.impact_for(7), ("High impact", 3))

    def test_default_view_shows_at_most_eight_rows_before_show_more(self):
        jobs = [job(f"j{index}", required=[f"Shared {index % 12}", f"Own {index}"], nice=[f"Extra {index}"]) for index in range(30)]
        report = build_gap_report(jobs, scope=config.SCOPE_ALL, resolve=plain)
        self.assertGreaterEqual(report["totals"]["open_skills"], 30)
        visible = sum(min(count, config.TIER_DISPLAY_LIMITS[tier]) for tier, count in report["totals"]["by_tier"].items())
        self.assertLessEqual(visible, 8)


class ScopeAndParityTests(unittest.TestCase):
    def setUp(self):
        self.jobs = [
            job("f1", required=["Excel", "SQL"], pct=88), job("f2", required=["SQL"], nice=["Tableau"], pct=81),
            job("f3", pct=90),  # Fit-Now with no gaps
            job("a1", required=["Python", "SQL"], match_type="aspiration", pct=55),
            job("a2", nice=["Tableau"], match_type="aspiration", pct=52, source="employer"),
            job("a3", required=["Power BI"], match_type="aspiration", pct=50),
        ]

    def scope_ids(self, scope, saved=(), applied=()):
        in_scope, unmatched = select_scope(resolve_jobs(self.jobs, plain), scope, saved, applied)
        return {item["job_id"] for item in in_scope}, unmatched

    def test_scopes(self):
        saved = [("employer", "a2"), ("internal", "not-a-match")]
        applied = [("internal", "a1")]
        self.assertEqual(self.scope_ids(config.SCOPE_FIT_NOW, saved, applied), ({"f1", "f2", "f3"}, 1))
        self.assertEqual(self.scope_ids(config.SCOPE_SAVED, saved, applied), ({"a1", "a2"}, 1))
        self.assertEqual(self.scope_ids(config.SCOPE_DEFAULT, saved, applied), ({"f1", "f2", "f3", "a1", "a2"}, 1))
        self.assertEqual(self.scope_ids(config.SCOPE_ALL, saved, applied)[0], {"f1", "f2", "f3", "a1", "a2", "a3"})
        # A saved job is identified by source and ID: internal "a2" is not the employer job.
        self.assertEqual(self.scope_ids(config.SCOPE_SAVED, [("internal", "a2")])[0], set())
        with self.assertRaises(ValueError):
            select_scope([], "everything")

    def test_skill_counts_match_the_job_cards_exactly(self):
        for scope in config.SCOPE_IDS:
            with self.subTest(scope=scope):
                saved = [("employer", "a2")]
                skills = build_gap_report(self.jobs, scope=scope, saved=saved, resolve=plain)["skills"]
                cards = build_gap_report(self.jobs, scope=scope, saved=saved, group_by=config.GROUP_BY_JOB, resolve=plain)["jobs"]
                for skill in skills:
                    holders = {(card["job_source"], card["job_id"]) for card in cards
                               if any(gap["skill_id"] == skill["skill_id"] for gap in card["gaps"])}
                    self.assertEqual(holders, {(entry["job_source"], entry["job_id"]) for entry in skill["jobs"]})
                    for card in cards:
                        for gap in card["gaps"]:
                            if gap["skill_id"] == skill["skill_id"]:
                                self.assertEqual(gap["other_jobs"], skill["jobs_needing"] - 1)

    def test_report_totals(self):
        report = build_gap_report(self.jobs, scope=config.SCOPE_FIT_NOW, resolve=plain)
        self.assertEqual(report["totals"]["in_scope_jobs"], 3)
        self.assertEqual(report["totals"]["gap_free_fit_now_jobs"], 1)
        self.assertEqual([skill["skill_name"] for skill in report["skills"]], ["SQL", "Excel", "Tableau"])
        self.assertEqual([skill["tier"] for skill in report["skills"]],
                         [config.TIER_CLOSE_FIRST, config.TIER_WORTH_NEXT, config.TIER_NICE_EXTRAS])
        self.assertEqual(report["scope_counts"][config.SCOPE_ALL], 5)
        self.assertEqual({skill["skill_name"] for skill in report["all_skills"]}, {"Excel", "SQL", "Tableau", "Python", "Power BI"})
        cards = build_gap_report(self.jobs, scope=config.SCOPE_ALL, group_by=config.GROUP_BY_JOB, resolve=plain)["jobs"]
        # Fit-Now cards first, each by match %; gap-free jobs have no card.
        self.assertEqual([card["job_id"] for card in cards], ["f1", "f2", "a1", "a2", "a3"])

    def test_run_matching_matches_convert_to_gap_jobs(self):
        converted = gap_job_from_match({
            "job_id": "J1", "job_source": "employer", "job_title": "Analyst", "company_name": "Acme",
            "match_percentage": 72.5, "match_type": matching_service.FIT_NOW,
            "missing_essential_skills": ["SQL"], "missing_preferred_skills": ["Tableau"],
        })
        self.assertEqual((converted["match_type"], converted["missing_required"], converted["missing_nice"], converted["title"]),
                         ("fit_now", ["SQL"], ["Tableau"], "Analyst"))


class CanonicalSkillTests(unittest.TestCase):
    def test_synonyms_collapse_into_one_skill_row(self):
        jobs = [job("a", required=["SEO"]), job("b", required=["Search Engine Optimization"]),
                job("c", nice=["search engine optimisation"], match_type="aspiration")]
        report = build_gap_report(jobs, scope=config.SCOPE_ALL)
        self.assertEqual(len(report["skills"]), 1, report["skills"])
        row = report["skills"][0]
        self.assertEqual((row["skill_id"], row["skill_name"], row["jobs_needing"], row["tier"]),
                         ("SK672", "Search Engine Optimization", 3, config.TIER_CLOSE_FIRST))

    def test_report_gap_list_groups_by_canonical_skill_and_uses_the_tiers(self):
        matches = [
            {"job_id": "1", "job_title": "A", "match_type": "Fit-Now", "match_percentage": 80, "missing_skills": ["SEO"]},
            {"job_id": "2", "job_title": "B", "match_type": "Aspiration", "match_percentage": 60,
             "missing_skills": ["Search Engine Optimization"]},
            {"job_id": "3", "job_title": "C", "match_type": "Aspiration", "match_percentage": 90, "missing_skills": ["Jira"],
             "missing_preferred_skills": ["Canva"]},
        ]
        gaps = matching_service.prioritize_skill_gaps(matches, limit=None)
        self.assertEqual([gap["skill_name"] for gap in gaps], ["Search Engine Optimization", "Jira", "Canva"])
        self.assertEqual([gap["tier"] for gap in gaps],
                         [config.TIER_CLOSE_FIRST, config.TIER_WORTH_NEXT, config.TIER_NICE_EXTRAS])
        self.assertEqual(gaps[0]["severity"], "Close these first")
        self.assertEqual(gaps[0]["frequency"], 2)


class CoursesBySkillTests(unittest.TestCase):
    def test_courses_are_keyed_by_skill_and_say_how_many_matches_they_help(self):
        row = dict(resource_id="test-1", course_or_certification_title="SQL for analysts", skills_youll_gain="SQL",
                   offered_by_provider="Test provider", status="active", skill_ids="SQL",
                   skill_id_mapping_status="reviewed", review_status="verified", reviewer="test reviewer",
                   source_evidence="https://example.org/syllabus", skill_id_mapping_notes="Explicit outcomes",
                   last_verified_at="2026-09-13", catalog_version="fixture", resource_type="course",
                   external_course_or_certification_link="https://example.org/course")
        rows = [{**row, "resource_id": f"test-{index}", "course_or_certification_title": f"SQL course {index}",
                 "external_course_or_certification_link": f"https://example.org/course-{index}"} for index in range(5)]
        skills = aggregate_by_skill(resolve_jobs([job("a", required=["SQL"]), job("b", nice=["SQL"]), job("c", required=["Excel"])],
                                                 lambda name: (name.upper(), name, name.upper())))
        evidence = lambda text: {word.upper() for word in re.findall(r"[A-Za-z]+", text)}
        by_skill = learning_recommender.recommend_learning_resources_by_skill(skills, pd.DataFrame(rows), skill_evidence=evidence)
        self.assertEqual(set(by_skill), {"SQL", "EXCEL"})
        self.assertEqual((by_skill["SQL"]["helps_matches"], by_skill["SQL"]["required_by"], by_skill["SQL"]["nice_for"]),
                         (2, ["Job a"], ["Job b"]))
        self.assertEqual(len(by_skill["SQL"]["courses"]), 5)
        self.assertEqual(by_skill["EXCEL"]["courses"], [])
        self.assertTrue(by_skill["SQL"]["courses"][0]["why_recommended"].startswith("Helps 2 of your matches"))


class ResumeSummaryTests(unittest.TestCase):
    def summary(self, **changes):
        values = dict(resume_text="Resume text", skills=["Excel", "SQL", "Customer Service", "Excel", "Jira", "Canva", "Zendesk"],
                      role_level="entry", fit_now_titles=["Data Encoder", "Office Clerk", "data encoder"], aspiration_titles=["Analyst"])
        return build_resume_summary(**{**values, **changes})

    def test_summary_is_two_or_three_template_sentences(self):
        for changes in [{}, {"role_level": "unsure"}, {"fit_now_titles": []}, {"fit_now_titles": [], "aspiration_titles": []},
                        {"skills": []}, {"role_level": "Mid-level (2-5 years experience)"}]:
            with self.subTest(changes=changes):
                result = self.summary(**changes)
                self.assertIn(len(result["sentences"]), (2, 3))
                self.assertNotIn("—", result["summary"])
                self.assertNotIn("–", result["summary"])

    def test_summary_content(self):
        result = self.summary()
        self.assertEqual(result["sentences"][0], "Your resume shows 6 skills we recognise, led by Excel, SQL and Customer Service.")
        self.assertEqual(result["top_skills"], ["Excel", "SQL", "Customer Service", "Jira", "Canva"])
        self.assertEqual((result["experience_level"]["value"], result["experience_level"]["source"]), ("entry", "step3_job_level"))
        self.assertEqual((result["best_fit_roles"], result["roles_basis"]), (["Data Encoder", "Office Clerk"], "fit_now"))
        closest = self.summary(fit_now_titles=[])
        self.assertEqual(closest["roles_basis"], "aspiration")
        self.assertIn("not a Fit-Now match yet", closest["summary"])
        self.assertEqual(self.summary(role_level="")["experience_level"]["value"], "unset")

    def test_resume_version_follows_the_resume_text(self):
        self.assertEqual(resume_version("a  b"), resume_version("a b"))
        self.assertNotEqual(resume_version("a b"), resume_version("a c"))


class SkillGapEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def post(self, body, **params):
        return self.client.post("/api/skills/gaps", params=params, data={"payload": json.dumps(body)})

    def test_groups_by_skill_and_by_job(self):
        body = {"matches": [job("1", required=["Jira"]), job("2", required=["Jira"], match_type="aspiration")],
                "saved_jobs": [{"job_id": "2", "job_source": "internal"}]}
        with patch("backend.app.main.learning_by_skill_for", return_value={"JIRA": {}}) as courses:
            by_skill = self.post(body, include_courses="true")
        self.assertEqual(by_skill.status_code, 200, by_skill.text)
        payload = by_skill.json()
        self.assertEqual((payload["scope"], payload["group_by"]), ("default", "skill"))
        self.assertEqual(payload["skills"][0]["jobs_needing"], 2)
        self.assertEqual(payload["rules"]["display"]["tier_limits"]["close_first"], 5)
        self.assertEqual(payload["rules"]["display"]["learning_skills_visible"], 5)
        courses.assert_called_once()
        by_job = self.post(body, group_by="job", scope="fit_now").json()
        self.assertEqual([card["job_id"] for card in by_job["jobs"]], ["1"])

    def test_rejects_unknown_options_and_bad_payloads(self):
        self.assertEqual(self.post({"matches": []}, scope="everything").status_code, 422)
        self.assertEqual(self.post({"matches": []}, group_by="team").status_code, 422)
        self.assertEqual(self.client.post("/api/skills/gaps", data={"payload": "[]"}).status_code, 422)
        self.assertEqual(self.post({"matches": [{"job_id": "1", "match_type": "maybe"}]}).status_code, 422)

    def test_resume_summary_endpoint(self):
        result = self.client.post("/api/resume/summary", data={"payload": json.dumps({
            "resume_text": "text", "skills": ["Excel"], "role_level": "senior", "fit_now_titles": ["Supervisor"]})})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["best_fit_roles"], ["Supervisor"])


if __name__ == "__main__":
    unittest.main()
