"""Regression tests for a report that showed zero Fit-Now matches and listed
HelpScout and HubSpot CRM as gaps for a resume that names Help Scout and HubSpot.

The resume below mirrors the structure of the reported one (a "CORE SKILLS"
line of named tools, then "RELEVANT EXPERIENCE" repeating them) without its
personal details. The jobs are the report's five matches, rebuilt from the
report and from the reviewed Supabase skill IDs in
data/skill_id_review/2026-09-20_job_skill_ids.sql.
"""
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from docx import Document

from backend.app.services import matching_service as matching
from backend.app.services.resume_analyzer import analyze_resume_file, detect_resume_sections
from backend.app.services.skill_extractor import SkillExtractor

RESUME_LINES = [
    "Sample Candidate",
    "Executive & Administrative Assistant | Healthcare Coordination | Client Support",
    "PROFILE",
    "Remote administrative support professional supporting clients across healthcare, construction, customer "
    "service and professional services; experienced in inbox and email management, invoicing, billing "
    "administration and CRM maintenance.",
    "CORE SKILLS",
    "Inbox & Email Management | Document & Records Organization | Client & Patient Coordination | "
    "Calendar Management | Invoicing & Billing Administration | CRM & Tracker Management | Data Verification | "
    "Google Workspace | Microsoft 365 | HubSpot | Help Scout | Procore | Airtable | Asana | Zendesk | ChatGPT",
    "RELEVANT EXPERIENCE",
    "Customer Support Specialist | Example Co | Jun 2024 - Present",
    "Manage customer communications through Help Scout while maintaining customer records in HubSpot.",
    "Coordinate appointments using Google Calendar and CRM systems.",
    "Executive Assistant | Example Startup | Dec 2022 - Nov 2023",
    "Managed email and calendar activities, scheduling, invoicing and project documentation.",
    "Maintained project files using Procore, Microsoft 365 and Google Workspace.",
    "Patient / Telehealth Coordinator | Example Clinic | Oct 2019 - Jun 2020",
    "Coordinated patient appointments and intake, handled phone and email communication, "
    "maintained accurate patient records.",
    "Supported insurance billing administration.",
    "General Virtual Assistant | Freelance | May 2018 - Aug 2022",
    "Supported clients with inbox management, lead research, data verification and documentation.",
    "Maintained records using Podio, HubSpot, Airtable, Asana, Zendesk and Google Workspace.",
    "Managed newsletters, marketing emails, WordPress updates and e-commerce order tracking.",
    "ADDITIONAL TECHNICAL EXPERIENCE",
    "Internal App Builder | Example Studio | Jul 2026 - Present - maintain technical documentation using "
    "ChatGPT and GitHub.",
    "EDUCATION",
    "Bachelor of Science in Computer Science | Expected 2027",
]

REPORT_PREFERENCES = {
    "industry": "engineering-trades-operations", "target_role": "mid", "role_level": "mid", "role": "mid",
    "work_setup": "onsite", "salary_expectation": "unsure",
}


def job(job_id, title, category_id, category, required_ids="", required_names="", description=""):
    return dict(
        job_id=job_id, category_id=category_id, job_category=category, job_subcategory="", job_title=title,
        job_description=description or title, required_skills_comma_separated=required_names,
        mapped_required_skill_names=required_names, required_skill_ids=required_ids,
        must_have_skill_ids=required_ids, experience_level_required="Mid Level", location="Metro Manila",
        work_type="Onsite", salary_range_monthly_php="", job_text_for_matching="",
    )


REPORT_JOBS = pd.DataFrame([
    job("KJ-0029", "Customer Success Associate", "K09", "Customer Service and Retail",
        "SK029;SK_ONBOARDING;SK276", "Customer Service, Onboarding, CRM"),
    job("saas", "Customer Success Specialist (SaaS)", "K09", "Customer Service and Retail", "",
        "Customer Service, Documentation, Email Communication, Google Workspace, Customer Success, "
        "HelpScout, HubSpot CRM, Jira, Problem Solving, SaaS"),
    job("KJ-0027", "Sales Operations Analyst", "K07", "Sales and Purchasing", "SK_SALES_OPS;SK_EXCEL;SK276",
        "Sales Ops, Excel, CRM"),
    job("KJ-0025", "Account Manager", "K07", "Sales and Purchasing", "SK_ACCOUNT_MANAGEMENT;SK276;SK032",
        "Account Management, CRM, Negotiation"),
    job("csr", "Customer Service Representative", "", "", "", "",
        "Handle customer inquiries by phone, email and chat."),
    # A patient-services job, as Supabase KJ-0055 after the 2026-09-20 ID review.
    job("KJ-0055", "Patient Services Coordinator", "K14", "Healthcare and Clinical Services",
        "SK_SCHEDULING;SK058;SK029", "Scheduling, Patient Records, Customer Service"),
])
# Role similarities in the range the fine-tuned model gives these pairs.
SEMANTIC = np.asarray([0.45, 0.43, 0.32, 0.18, 0.25, 0.41])


def resume_docx(lines=RESUME_LINES):
    document = Document()
    for line in lines:
        document.add_paragraph(line)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def analyze(lines=RESUME_LINES):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "resume.docx"
        path.write_bytes(resume_docx(lines))
        return analyze_resume_file(str(path), SkillExtractor())


class NamedToolExtractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.analysis = analyze()
        cls.skills = cls.analysis["candidate_profile"]["skills"]
        cls.names = [skill["skill_name"] for skill in cls.skills]

    def test_qualified_headings_are_sections(self):
        sections = detect_resume_sections("\n".join(RESUME_LINES))
        for heading in ["core skills", "relevant experience", "additional technical experience", "education"]:
            self.assertIn(heading, sections)
        # A sentence that ends in a heading word is not a heading.
        self.assertNotIn("managed email and calendar skills", detect_resume_sections(
            "Managed email and calendar skills\nSKILLS\nExcel"))

    def test_named_tools_from_the_skills_line_survive_the_twenty_skill_limit(self):
        self.assertEqual(len(self.skills), matching.MAX_CONFIRMED_SKILLS)
        for tool in ["HubSpot", "Help Scout", "Zendesk", "Google Workspace", "Procore", "Airtable", "Asana"]:
            self.assertIn(tool, self.names)

    def test_every_mention_is_counted(self):
        by_name = {skill["skill_name"]: skill["source_metadata"] for skill in self.skills}
        # HubSpot is named three times, Help Scout twice.
        self.assertEqual(by_name["HubSpot"]["evidence_count"], 3)
        self.assertEqual(by_name["Help Scout"]["evidence_count"], 2)
        self.assertIn("core skills", by_name["HubSpot"]["source_sections"])

    def test_ties_are_not_broken_alphabetically_backwards(self):
        # Equal scores used to sort Z to A, so Zendesk always beat HubSpot and Airtable.
        scores = [(skill["skill_priority_score"], skill["source_metadata"]["evidence_count"]) for skill in self.skills]
        self.assertEqual(scores, sorted(scores, key=lambda item: (-item[0], -item[1])))


class ReportRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.analysis = analyze()

    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)

    def report(self, preferences, confirmed=None):
        skills = confirmed if confirmed is not None else [
            {"skill_id": s["skill_id"], "skill_name": s["skill_name"]} for s in self.analysis["candidate_profile"]["skills"]]
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=REPORT_JOBS), \
             patch.object(matching, "score_jobs", return_value=SEMANTIC), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            return matching.match_text_to_jobs(
                self.analysis["normalized_for_matching"]["resume_text_for_matching"],
                confirmed_skills=skills, preferences=preferences)

    @staticmethod
    def matches(result):
        return {item["job_id"]: item for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]}

    def test_help_scout_and_hubspot_are_held_in_every_spelling(self):
        saas = self.matches(self.report({**REPORT_PREFERENCES, "industry": "sales-marketing-customer-service"}))["saas"]
        self.assertIn("Help Scout", saas["matched_skills"])
        self.assertIn("HubSpot", saas["matched_skills"])
        self.assertEqual(saas["missing_skills"], ["Customer Success", "Jira", "Problem Solving", "SaaS"])
        # Also when the candidate confirmed neither tool in Step 2: the resume names them.
        result = self.report({**REPORT_PREFERENCES, "industry": "sales-marketing-customer-service"},
            confirmed=[{"skill_id": "SK029", "skill_name": "Customer Service"}])
        self.assertIn("HubSpot", self.matches(result)["saas"]["matched_skills"])

    def test_patient_records_resume_holds_the_patient_records_requirement(self):
        result = self.report({**REPORT_PREFERENCES, "industry": "healthcare-wellness"})
        patient = self.matches(result)["KJ-0055"]
        self.assertEqual(patient["missing_skills"], [])
        self.assertEqual(patient["match_type"], "Fit-Now")
        self.assertEqual(patient["related_skill_credit"],
            [{"skill": "Clinical Documentation", "evidence": "maintained accurate patient records"}])

    def test_report_jobs_stay_out_of_fit_now_for_the_reasons_they_fail(self):
        result = self.report({**REPORT_PREFERENCES, "industry": "sales-marketing-customer-service"})
        items = self.matches(result)
        fit_now = {item["job_id"] for item in result["all_fit_now_matches"]}
        self.assertEqual(fit_now, {"KJ-0055"})
        # 2 of 3 required skills (Onboarding missing) is below the 75% rule.
        self.assertEqual(items["KJ-0029"]["missing_skills"], ["Onboarding"])
        self.assertEqual(items["KJ-0029"]["match_breakdown"]["failed_fit_now_rules"], ["required_skill_coverage"])
        self.assertEqual(items["saas"]["match_breakdown"]["failed_fit_now_rules"], ["required_skill_coverage"])
        self.assertEqual(items["KJ-0027"]["missing_skills"], ["Microsoft Excel", "Sales Operations"])
        self.assertEqual(items["KJ-0025"]["match_breakdown"]["failed_fit_now_rules"],
            ["required_skill_coverage", "semantic_similarity"])

    def test_the_career_area_decides_aspiration_but_never_skills_or_fit_now(self):
        by_area = {area: self.report({**REPORT_PREFERENCES, "industry": area}) for area in [
            "engineering-trades-operations", "sales-marketing-customer-service", "construction-maintenance", ""]}
        skills = {area: {job_id: (item["matched_skills"], item["missing_skills"])
                  for job_id, item in self.matches(result).items()} for area, result in by_area.items()}
        fit_now = {area: [item["job_id"] for item in result["all_fit_now_matches"]] for area, result in by_area.items()}
        self.assertEqual(len({tuple(ids) for ids in fit_now.values()}), 1)
        for area in by_area:
            for job_id, pair in skills[area].items():
                self.assertEqual(pair, skills["sales-marketing-customer-service"][job_id], (area, job_id))
        # The saved legacy "Engineering, Trades & Operations" area holds no customer
        # service or sales jobs, so they are not Aspiration under it. A job with no
        # category falls back to the resume rule under any area.
        self.assertEqual([item["job_id"] for item in by_area["engineering-trades-operations"]["all_aspiration_matches"]],
            ["csr"])
        self.assertEqual({item["job_id"] for item in by_area["sales-marketing-customer-service"]["all_aspiration_matches"]},
            {"KJ-0029", "saas", "KJ-0027", "KJ-0025", "csr"})


class RelatedEvidenceTests(unittest.TestCase):
    def test_named_crm_tools_show_crm_software_use_one_way(self):
        crm_software = "Use customer relationship management software"
        for candidate, text in [([], "Kept lead records in HubSpot."), (["SK642"], "Kept lead records."),
                                ([], "Coordinated workflows using CRM systems.")]:
            self.assertEqual(matching.compute_skill_coverage(candidate, ["SK300"], text)["matched_skills"], [crm_software])
        # A bare "CRM" does not show the software, and CRM software does not show HubSpot.
        self.assertEqual(matching.compute_skill_coverage([], ["SK300"], "Built CRM dashboards.")["missing_skills"], [crm_software])
        self.assertEqual(matching.compute_skill_coverage(["SK300"], ["HubSpot"], "Used CRM systems.")["missing_skills"], ["HubSpot"])

    def test_maintaining_patient_records_shows_clinical_documentation(self):
        held = matching.compute_skill_coverage([], ["SK058"], "Maintained accurate patient records.")
        self.assertEqual(held["matched_skills"], ["Clinical Documentation"])
        # Only the activity counts, not a mention of patient records.
        for text in ["Accessed patient records for billing.", "Handled sensitive patient related records."]:
            self.assertEqual(matching.compute_skill_coverage([], ["SK058"], text)["missing_skills"], ["Clinical Documentation"])


class CareerAreaTests(unittest.TestCase):
    def test_thirteen_areas_cover_every_job_category_once(self):
        self.assertEqual(len(matching.CAREER_AREA_JOB_CATEGORIES), 13)
        self.assertEqual(set(matching.CAREER_AREA_JOB_CATEGORIES), set(matching.CAREER_AREA_LABELS))
        areas = {f"K{number:02d}": matching.career_area_by_category_id().get(f"K{number:02d}") for number in range(1, 25)}
        self.assertNotIn(None, areas.values())
        self.assertEqual(areas["K16"], "engineering-architecture")
        self.assertEqual(areas["K17"], "construction-maintenance")
        self.assertEqual(areas["K19"], "hospitality-tourism-food-services")
        self.assertEqual(areas["K13"], "community-social-services")
        self.assertEqual(areas["K15"], "healthcare-wellness")

    def test_labels_and_slugs_resolve_to_the_same_area(self):
        for slug, label in matching.CAREER_AREA_LABELS.items():
            self.assertEqual(matching.normalize_career_area(slug), slug)
            self.assertEqual(matching.normalize_career_area(label), slug)
        # The dashboard saved legacy labels before the split.
        self.assertEqual(matching.normalize_career_area("Engineering, Trades & Operations"), "engineering-trades-operations")
        self.assertEqual(matching.normalize_career_area("Something else"), "")

    def test_legacy_areas_cover_exactly_what_they_covered(self):
        engineering = matching.preferred_career_areas("engineering-trades-operations")
        self.assertEqual({category for area in engineering for category in matching.CAREER_AREA_JOB_CATEGORIES[area]}, {
            "engineering and architecture", "construction and skilled trades", "hospitality and tourism",
            "food service and personal care", "logistics, transport, and warehousing",
            "manufacturing and quality operations", "agriculture, forestry, fishery, and environment"})
        education = matching.preferred_career_areas("Education, Health & Community")
        self.assertEqual(education, {"education-training", "healthcare-wellness", "community-social-services"})
        self.assertEqual(matching.preferred_career_areas("business-office"), {"business-office"})
        self.assertEqual(matching.preferred_career_areas(""), frozenset())

    def test_preference_alignment_uses_the_chosen_area(self):
        job_record = {"job_category": "Construction and Skilled Trades", "job_title": "Site Engineer", "job_description": "",
            "experience_level_required": "", "work_type": "", "salary_range_monthly_php": ""}
        self.assertEqual(matching.compute_preference_alignment(job_record, {"industry": "construction-maintenance"}), 1.0)
        self.assertEqual(matching.compute_preference_alignment(job_record, {"industry": "engineering-trades-operations"}), 1.0)
        self.assertEqual(matching.compute_preference_alignment(job_record, {"industry": "healthcare-wellness"}), 0.0)


if __name__ == "__main__":
    unittest.main()
