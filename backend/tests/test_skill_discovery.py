"""Skill discovery: extraction, dedup against the taxonomy, confidence, review, runtime use."""
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import main
from backend.app.learning import skill_discovery as sd
from backend.app.learning.supabase_client import SupabaseError
from backend.app.services import matching_service as matching
from backend.app.services import taxonomy_additions
from backend.app.services.skill_extractor import SkillExtractor
from backend.tests.fake_supabase import FakeSupabase

TAXONOMY = sd.TaxonomyIndex(SkillExtractor())


def job(job_id, company, description="", required="", table="internal_jobs"):
    return {"job_id": job_id, "company_name": company, "job_description": description, "responsibilities": "",
        "required_skills": required, "preferred_skills": "", "_table": table}


def proposals_for(jobs=(), profile_rows=()):
    mentions = [m for j in jobs for m in sd.mentions_from_job(j)]
    mentions += [m for row in profile_rows for m in sd.mentions_from_profile_skill(row)]
    proposals, stats = sd.build_proposals(mentions, TAXONOMY)
    return {p.normalized_label: p for p in proposals}, stats


class ExtractionTests(unittest.TestCase):
    def test_structured_fields_cue_phrases_and_skill_bullets(self):
        mentions = sd.mentions_from_job(job("J1", "Acme", required="Tableau; SQL",
            description="We need someone with experience with Power BI and advanced Excel.\n"
                        "Requirements:\n- Terraform\n- 3+ years in operations\n- Strong Git skills\n\nAbout us\n- Free lunch"))
        found = {(m.label, m.method) for m in mentions}
        self.assertIn(("Tableau", "structured_skill_field"), found)
        self.assertIn(("Power BI", "cue_phrase"), found)
        self.assertIn(("Excel", "cue_phrase"), found)          # qualifier removed
        self.assertIn(("Terraform", "skills_section_bullet"), found)
        self.assertIn(("Git", "skills_section_bullet"), found)  # "Strong ... skills" trimmed
        labels = {m.label.lower() for m in mentions}
        self.assertFalse({"free lunch", "3+ years in operations"} & labels)
        self.assertTrue(all(m.source_ref == "internal_jobs:J1" and m.company_key == "acme" for m in mentions))

    def test_clean_phrase_rejects_noise(self):
        for raw in ("", "experience", "5 years of experience", "the", "a very long phrase with far too many words in it",
                "https://example.com", "someone@example.com", "and"):
            self.assertIsNone(sd.clean_phrase(raw), raw)
        self.assertEqual(sd.clean_phrase("Excellent Microsoft Excel (pivot tables) skills"), "Microsoft Excel")

    def test_profile_evidence_keeps_no_text_or_raw_account_id(self):
        mentions = sd.mentions_from_profile_skill({"user_id": "user-123", "skill_id": None, "skill_name": "Canva"})
        self.assertEqual(len(mentions), 1)
        self.assertIsNone(mentions[0].snippet)
        self.assertNotIn("user-123", mentions[0].source_ref)
        self.assertEqual(sd.mentions_from_profile_skill({"user_id": "u", "skill_id": "SK001", "skill_name": "Python"}), [])


class ProposalTests(unittest.TestCase):
    def test_existing_names_and_aliases_are_not_proposed(self):
        found, stats = proposals_for([job("J1", "Acme", required="SQL; Python; Data Analysis; Sales Techniques")])
        self.assertEqual(found, {})
        self.assertEqual(stats["already_in_taxonomy"], 4)

    def test_repeated_new_skill_across_employers_is_a_confident_new_skill(self):
        jobs = [job(f"J{i}", company, required="Tableau") for i, company in enumerate(["Acme", "Globex", "Initech", "Umbrella"])]
        found, _ = proposals_for(jobs)
        tableau = found["tableau"]
        self.assertEqual(tableau.suggested_action, "new_skill")
        self.assertGreaterEqual(tableau.confidence, 0.85)
        self.assertEqual(tableau.review_reasons, [])
        self.assertEqual(len(tableau.job_refs), 4)

    def test_variants_are_deduplicated_to_one_proposal(self):
        jobs = [job("J1", "Acme", required="Power BI"), job("J2", "Globex", required="power-bi"),
            job("J3", "Initech", description="Proficient in Power BI.")]
        found, _ = proposals_for(jobs)
        self.assertEqual(list(found), ["power bi"])
        self.assertEqual(found["power bi"].display_label, "Power BI")

    def test_near_existing_name_is_an_alias_for_review(self):
        found, _ = proposals_for([job("J1", "Acme", required="Payroll Procesing"), job("J2", "Globex", required="Payroll Procesing")])
        proposal = found["payroll procesing"]
        self.assertEqual(proposal.suggested_action, "alias")
        self.assertEqual(proposal.suggested_skill_id, "SK014")
        self.assertIn("near_existing_skill", proposal.review_reasons)

    def test_user_text_alone_is_low_confidence_and_never_auto_approved(self):
        rows = [{"user_id": f"user-{i}", "skill_id": None, "skill_name": "Canva"} for i in range(50)]
        found, _ = proposals_for(profile_rows=rows)
        canva = found["canva"]
        self.assertLessEqual(canva.confidence, sd.PROFILE_CONFIDENCE_CAP)
        self.assertIn("profile_only", canva.review_reasons)
        self.assertEqual(canva.suggested_action, "review")
        with patch.dict(os.environ, {"KAREERLY_SKILL_AUTO_APPROVE": "1"}):
            self.assertFalse(sd.auto_approvable(canva))

    def test_single_employer_repetition_is_capped(self):
        found, _ = proposals_for([job(f"J{i}", "Acme", required="Figma") for i in range(20)])
        figma = found["figma"]
        self.assertLessEqual(figma.confidence, sd.SINGLE_COMPANY_CAP)
        self.assertIn("single_company", figma.review_reasons)

    def test_auto_approval_is_off_by_default_and_strict_when_enabled(self):
        jobs = [job(f"J{i}", f"Company {i}", required="Tableau") for i in range(6)]
        found, _ = proposals_for(jobs)
        self.assertFalse(sd.auto_approvable(found["tableau"]))
        with patch.dict(os.environ, {"KAREERLY_SKILL_AUTO_APPROVE": "1"}):
            self.assertTrue(sd.auto_approvable(found["tableau"]))
            few, _ = proposals_for(jobs[:3])
            self.assertFalse(sd.auto_approvable(few["tableau"]))


class DiscoveryRunAndReviewTests(unittest.TestCase):
    def setUp(self):
        taxonomy_additions.clear_cache()
        self.addCleanup(taxonomy_additions.clear_cache)
        self.client = FakeSupabase({
            "internal_jobs": [
                {"job_id": f"J{i}", "company_name": c, "job_description": "Experience with Tableau dashboards.",
                 "responsibilities": "", "required_skills": "Tableau", "preferred_skills": "", "posting_status": "active"}
                for i, c in enumerate(["Acme", "Globex", "Initech"])
            ] + [{"job_id": "OLD", "company_name": "Old", "job_description": "", "responsibilities": "",
                  "required_skills": "Cobol", "preferred_skills": "", "posting_status": "closed"}],
            "employer_job_posts": [],
            "user_skills": [{"user_id": "u1", "skill_id": None, "skill_name": "Canva"},
                            {"user_id": "u2", "skill_id": "SK001", "skill_name": "Python"}],
            "skill_candidates": [], "skill_candidate_evidence": [], "skill_taxonomy_additions": [],
        })

    def candidate(self, label):
        return next(row for row in self.client.rows("skill_candidates") if row["normalized_label"] == label)

    def test_run_stores_pending_proposals_with_provenance(self):
        result = sd.run_discovery(self.client)
        self.assertEqual({row["normalized_label"] for row in self.client.rows("skill_candidates")}, {"tableau", "canva"})
        self.assertTrue(all(row["status"] == "pending" for row in self.client.rows("skill_candidates")))
        evidence = self.client.rows("skill_candidate_evidence")
        tableau_evidence = [e for e in evidence if e["candidate_id"] == self.candidate("tableau")["id"]]
        self.assertEqual({e["source_ref"] for e in tableau_evidence}, {"internal_jobs:J0", "internal_jobs:J1", "internal_jobs:J2"})
        profile = [e for e in evidence if e["source_type"] == "user_profile"]
        self.assertEqual(len(profile), 1)
        self.assertIsNone(profile[0]["snippet"])
        self.assertNotIn("u1", profile[0]["source_ref"])
        self.assertEqual(result["auto_approved"], [])
        self.assertEqual(self.client.rows("skill_taxonomy_additions"), [])

    def test_rerun_keeps_review_decisions(self):
        sd.run_discovery(self.client)
        rejected = self.candidate("canva")
        sd.review_candidate(self.client, rejected["id"], "reject", "admin-1", note="too vague")
        sd.run_discovery(self.client)
        self.assertEqual(self.candidate("canva")["status"], "rejected")

    def test_scan_survives_unmigrated_responsibilities_column(self):
        # Production error before 20261005090000_internal_jobs_responsibilities.sql.
        select = self.client.select

        def select_without_column(table, params):
            if table == "internal_jobs" and "responsibilities" in params.get("select", ""):
                raise SupabaseError('GET /rest/v1/internal_jobs failed (400): {"code":"42703","message":'
                                    '"column internal_jobs.responsibilities does not exist"}', 400)
            return select(table, params)

        self.client.select = select_without_column
        refs = {m.source_ref for m in sd.collect_mentions(self.client)}
        self.assertEqual({"internal_jobs:J0", "internal_jobs:J1", "internal_jobs:J2"}, {r for r in refs if r.startswith("internal_jobs:")})

        self.client.select = lambda table, params: (_ for _ in ()).throw(SupabaseError("boom", 500))
        with self.assertRaises(SupabaseError):
            sd.collect_mentions(self.client)

    def test_dry_run_writes_nothing(self):
        result = sd.run_discovery(self.client, dry_run=True)
        self.assertEqual(self.client.rows("skill_candidates"), [])
        self.assertEqual(result["top_proposals"][0]["label"], "Tableau")

    def test_approve_new_skill_alias_and_guards(self):
        sd.run_discovery(self.client)
        tableau = self.candidate("tableau")
        approved = sd.review_candidate(self.client, tableau["id"], "approve_new", "admin-1", category_id="K02")
        self.assertEqual(approved["skill_id"], "SK5001")
        addition = self.client.rows("skill_taxonomy_additions")[0]
        self.assertEqual((addition["kind"], addition["label"], addition["category_id"]), ("skill", "Tableau", "K02"))
        self.assertEqual(addition["skill_category"], "Data, Analytics, and Artificial Intelligence")
        self.assertEqual(self.candidate("tableau")["status"], "approved")
        with self.assertRaises(sd.ReviewError) as already:
            sd.review_candidate(self.client, tableau["id"], "reject", "admin-1")
        self.assertEqual(already.exception.status, 409)

        canva = self.candidate("canva")
        with self.assertRaises(sd.ReviewError):
            sd.review_candidate(self.client, canva["id"], "approve_alias", "admin-1", skill_id="SK99999")
        with self.assertRaises(sd.ReviewError):
            sd.review_candidate(self.client, canva["id"], "approve_new", "admin-1", label="SQL")  # already a skill
        with self.assertRaises(sd.ReviewError):
            sd.review_candidate(self.client, canva["id"], "approve_new", "admin-1", category_id="bad")
        alias = sd.review_candidate(self.client, canva["id"], "approve_alias", "admin-1", skill_id="SK038", label="Canva")
        self.assertEqual((alias["kind"], alias["skill_id"]), ("alias", "SK038"))

    def test_listing_hides_profile_references(self):
        sd.run_discovery(self.client)
        listed = {row["normalized_label"]: row for row in sd.list_candidates(self.client)}
        self.assertEqual(listed["canva"]["evidence"][0]["job"], None)
        self.assertEqual(listed["tableau"]["evidence"][0]["job"].split(":")[0], "internal_jobs")


class RuntimeTaxonomyTests(unittest.TestCase):
    """Approved additions reach extraction, coverage and search with no code change."""

    ADDITIONS = [
        {"kind": "skill", "skill_id": "SK5001", "label": "Tableau", "category_id": "K02",
         "skill_category": "Data, Analytics, and Artificial Intelligence"},
        {"kind": "alias", "skill_id": "SK004", "label": "PostgreSQL queries"},
    ]

    def use_additions(self, additions):
        patcher = patch.object(taxonomy_additions, "active_additions", return_value=additions)
        patcher.start()
        self.addCleanup(patcher.stop)
        matching.ensure_taxonomy_current()

    def tearDown(self):
        with patch.object(taxonomy_additions, "active_additions", return_value=[]):
            matching.ensure_taxonomy_current()

    def test_before_approval_the_skill_is_unknown(self):
        self.use_additions([])
        names = {s["skill_name"] for s in matching.extract_skills_from_text("Built Tableau dashboards for sales.")}
        self.assertNotIn("Tableau", names)
        self.assertNotIn("SK5001", matching.canonical_skill_lookup()[0])

    def test_after_approval_extraction_coverage_and_search_use_it(self):
        self.use_additions(self.ADDITIONS)
        skills = {s["skill_id"]: s["skill_name"] for s in matching.extract_skills_from_text(
            "Built Tableau dashboards and wrote PostgreSQL queries for reporting.")}
        self.assertEqual(skills.get("SK5001"), "Tableau")
        self.assertIn("SK004", skills)
        labels, aliases = matching.canonical_skill_lookup()
        self.assertEqual(labels["SK5001"], "Tableau")
        self.assertEqual(aliases["postgresql queries"], "SK004")
        coverage = matching.compute_skill_coverage(["SK5001", "PostgreSQL queries"], ["Tableau", "SQL"])
        self.assertEqual(coverage["skill_coverage"], 1.0)
        # Confirmed skill IDs of approved skills are accepted by matching.
        _, records, _, _ = matching._prepare_candidate_context("Analyst", [{"skill_id": "SK5001"}])
        self.assertEqual(records[0]["skill_name"], "Tableau")
        with patch.object(matching.taxonomy_additions, "active_additions", return_value=self.ADDITIONS):
            results = TestClient(main.app).get("/api/skills/search", params={"q": "tableau"}).json()["results"]
        self.assertEqual(results[0]["skill_id"], "SK5001")

    def test_retired_or_conflicting_additions_cannot_override_csv(self):
        rows = taxonomy_additions.merge_reference_rows(
            [{"skill_id": "SK001", "skill_name": "Python Programming"}],
            [{"kind": "skill", "skill_id": "SK001", "label": "Hijacked"}, {"kind": "alias", "skill_id": "SK777", "label": "x"}])
        self.assertEqual(rows, [{"skill_id": "SK001", "skill_name": "Python Programming"}])


class TaxonomyFallbackTests(unittest.TestCase):
    def setUp(self):
        taxonomy_additions.clear_cache()
        self.addCleanup(taxonomy_additions.clear_cache)

    def test_unconfigured_supabase_means_csv_only(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "", "VITE_SUPABASE_URL": ""}):
            self.assertEqual(taxonomy_additions.active_additions(), [])

    def test_outage_keeps_the_last_good_additions(self):
        good = [{"kind": "skill", "skill_id": "SK5001", "label": "Tableau"}]
        env = {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_ANON_KEY": "anon", "KAREERLY_TAXONOMY_CACHE_SECONDS": "0"}
        with patch.dict(os.environ, env):
            with patch.object(taxonomy_additions, "_fetch", return_value=good):
                self.assertEqual(taxonomy_additions.active_additions(), good)
            with patch.object(taxonomy_additions, "_fetch", side_effect=SupabaseError("down")):
                self.assertEqual(taxonomy_additions.active_additions(), good)

    def test_invalid_rows_are_ignored(self):
        self.assertFalse(taxonomy_additions._valid({"kind": "skill", "skill_id": "DROP TABLE", "label": "x"}))
        self.assertFalse(taxonomy_additions._valid({"kind": "note", "skill_id": "SK5001", "label": "Tableau"}))
        self.assertTrue(taxonomy_additions._valid({"kind": "alias", "skill_id": "sk004", "label": "Postgres"}))


if __name__ == "__main__":
    unittest.main()
