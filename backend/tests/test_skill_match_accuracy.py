"""Regression tests for which skills count as held, matched and missing.

The principle under test: a requirement is met only by the same skill, named
by its label, a reviewed alias or spelling, or a reviewed one-way relation
("Excel" shows spreadsheet use). A related skill (UI Design and UX Design,
Data Analysis and Data Science) or a word that only looks like a skill name
("Java" and "JavaScript", "web", "conduct", "XPath") never meets it.

The resume below is modelled on a real executive-assistant resume that was
reported with Python, JavaScript, SQL and Bookkeeping as "skills you have"
(no contact details are kept).
"""
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from backend.app.services import matching_service as matching
from backend.app.services.skill_extractor import SkillExtractor
from backend.app.services.skill_variants import alias_exclusions
from backend.scripts import sync_reviewed_job_skills as sync

ASSISTANT_RESUME = """Sample Candidate
Executive & Administrative Assistant | Healthcare Coordination | Client Support
PROFILE
Remote executive and administrative support professional with 8+ years of experience supporting international
clients across healthcare, construction, customer service, and professional services. Experienced in inbox and
email management, appointment and client coordination, document and records organization, invoicing, billing
administration, and CRM maintenance.
CORE SKILLS
Inbox & Email Management | Document & Records Organization | Client & Patient Coordination | Calendar Management |
Invoicing & Billing Administration | Reporting | Data Verification | Google Workspace | Microsoft 365 | HubSpot |
Help Scout | Procore | Airtable | Asana | Zendesk | ChatGPT
RELEVANT EXPERIENCE
Customer Support Specialist | Sample Company | Jun 2024 - Present
Manage customer communications and website related support through Help Scout while maintaining accurate
customer, lead, and follow up records in HubSpot.
Executive Assistant | Sample Agency | Dec 2022 - Nov 2023
Managed email and calendar activities, scheduling, invoicing, project documentation, and day to day administrative
follow up for a construction startup.
Patient / Telehealth Coordinator | Sample Clinic | Oct 2019 - Jun 2020
Coordinated patient appointments and intake, handled phone and email communication, maintained accurate patient
records, and followed up on scheduling and administrative requirements.
ADDITIONAL TECHNICAL EXPERIENCE
Web Developer / Internal App Builder | Sample Studio | Jul 2026 - Present - Build and maintain an internal business
application, translate operational requirements into workflows, perform QA and troubleshooting, and maintain
technical documentation using GitHub.
EDUCATION
Bachelor of Science in Computer Science | Expected 2027
"""

# Skills the resume never shows. They were listed as "You have" on the
# dashboard, through job data from before the 2026-09-24 review.
NOT_SHOWN = {
    "SK001": "Python Programming", "SK002": "JavaScript Programming", "SK003": "Web Development",
    "SK004": "SQL", "SK005": "Data Analysis", "SK006": "Data Visualization", "SK012": "Bookkeeping",
    "SK013": "Financial Reporting", "SK098": "Inventory Management", "SK122": "Perform data mining",
    "SK125": "Cyber attack counter-measures", "SK195": "Data security principles",
    "SK213": "Agile project management", "SK332": "Identify requirements of the work in the artistic performance",
}


def coverage(held, required, resume_text=""):
    return matching.compute_skill_coverage(held, required, resume_text)


class SkillEquivalenceTests(unittest.TestCase):
    """Held skill (or resume text) -> requirement. MATCH means the requirement is met."""

    MATCH = [
        ("React.js", "React"), ("React", "React.js"), ("ReactJS", "React.js"), ("React JS", "React.js"),
        ("Excel", "Microsoft Excel"), ("MS Excel", "Microsoft Excel"),
        ("Node.js", "NodeJS"), ("NodeJS", "Node.js"),
        ("Python", "Python Programming"), ("JavaScript", "JavaScript Programming"), ("JS", "JavaScript"),
        ("GitHub", "Git Version Control"), ("HubSpot CRM", "HubSpot"),
        # One-way relations: a named tool shows the general skill.
        ("Microsoft Excel", "Use spreadsheets software"), ("Google Sheets", "Use spreadsheets software"),
        ("Microsoft 365", "Office software"),
    ]
    NO_MATCH = [
        ("Java", "JavaScript"), ("JavaScript", "Java"), ("Java Script", "Java"),
        ("C", "C++"), ("C++", "C#"), ("C#", "C"),
        ("Microsoft Office", "Microsoft Excel"), ("Microsoft 365", "Microsoft Excel"),
        ("Use spreadsheets software", "Microsoft Excel"), ("Office software", "Microsoft 365"),
        ("UI Design", "UX Design"), ("UX Design", "UI Design"),
        ("Data Analysis", "Data science"), ("Data science", "Data Analysis"), ("Data Analysis", "Statistics"),
        ("Recruiting", "Candidate Screening"),
        ("SQL", "MySQL"), ("MySQL", "SQL"), ("XPath", "SQL"),
        ("Machine learning", "Deep Learning"),
        ("Adobe Photoshop", "Adobe Illustrator"), ("Adobe Illustrator", "Adobe Photoshop"),
        ("Power BI", "Tableau"), ("Tableau", "Data Visualization"),
        ("Mocha", "JavaScript"), ("Escript", "JavaScript"), ("TypeScript", "JavaScript"),
        ("Invoicing and Billing", "Bookkeeping"), ("Data Verification", "Perform data mining"),
        ("Web Developer", "Web Development"), ("Computer Science", "Python Programming"),
        ("Google Workspace", "Use spreadsheets software"),
    ]

    def test_equivalent_names_meet_the_requirement(self):
        for held, required in self.MATCH:
            with self.subTest(held=held, required=required):
                self.assertEqual(coverage([held], [required])["missing_skills"], [])
                self.assertEqual(coverage([], [required], f"Skills: {held}")["missing_skills"], [])

    def test_related_or_lookalike_names_do_not(self):
        for held, required in self.NO_MATCH:
            with self.subTest(held=held, required=required):
                self.assertEqual(coverage([held], [required])["matched_skills"], [])
                self.assertEqual(coverage([], [required], f"Skills: {held}")["matched_skills"], [])


class ExtractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.extractor = SkillExtractor()

    def ids(self, text):
        return {item["skill_id"] for item in self.extractor.extract_skills(text, limit=None)}

    def test_lookalike_words_are_not_skills(self):
        cases = {
            "Conducted weekly training and conducted audits.": "SK047",  # Student Assessment
            "Ran a customer survey after every ticket.": "SK077",  # Surveying Support
            "Built the tracker from scratch.": "SK175",  # Scratch (computer programming)
            "Handled trouble shooting for printers.": "SK038",  # Photography
            "Served mocha and latte orders.": "SK002",  # JavaScript
            "Queried XML files with XPath.": "SK004",  # SQL
            "Programming languages: Java, C#": "SK001",  # Python
            "Prepared monthly financials for the bank; banking operations.": "SK259",  # Economics
            "Managed data collection for the clinic.": "SK127",  # Statistics
            "Packing and labelling of orders.": "SK559",  # Packaging engineering
            "Worked with the web team on the website.": "SK003",  # Web Development
        }
        for text, skill_id in cases.items():
            with self.subTest(text=text):
                self.assertNotIn(skill_id, self.ids(text))

    def test_names_that_are_skills_still_are(self):
        cases = {
            "Skills: React": "SK678", "Skills: ReactJS": "SK678", "Java Script developer": "SK002",
            "Skills: Java": "SK133", "Skills: Python": "SK001", "Skills: SQL, subqueries": "SK004",
            "Skills: Data Analysis": "SK005", "Web Development projects": "SK003", "Photography": "SK038",
            "Land surveying assistant": "SK077", "MS Excel": "SK629",
        }
        for text, skill_id in cases.items():
            with self.subTest(text=text):
                self.assertIn(skill_id, self.ids(text))

    def test_react_as_a_verb_is_not_react_js(self):
        self.assertNotIn("SK678", self.ids("Trained to react to customer complaints. React to escalations calmly."))

    def test_java_script_is_javascript_not_java(self):
        found = self.ids("Skills: Java Script, HTML")
        self.assertIn("SK002", found)
        self.assertNotIn("SK133", found)

    def test_assistant_resume_shows_none_of_the_reported_skills(self):
        found = self.ids(ASSISTANT_RESUME)
        self.assertFalse(found & set(NOT_SHOWN), [NOT_SHOWN[skill_id] for skill_id in found & set(NOT_SHOWN)])
        for skill_id in ("SK623", "SK622", "SK627", "SK642", "SK625", "SK651"):
            self.assertIn(skill_id, found)


class ProgrammingLanguageNameTests(unittest.TestCase):
    def test_only_real_language_names_are_bare_evidence(self):
        phrases = matching.skill_evidence_phrases()
        self.assertIn("Python", phrases["SK001"])
        self.assertIn("JavaScript", phrases["SK002"])
        self.assertIn("Java", phrases["SK133"])
        # "web programming" is a paradigm, not a language called "Web".
        self.assertNotIn("web", [phrase.lower() for phrase in phrases["SK003"]])
        self.assertNotIn("web", [phrase.lower() for phrase in phrases["SK124"]])
        self.assertNotIn("use scripting", [phrase.lower() for phrase in phrases["SK129"]])

    def test_the_word_web_does_not_meet_web_development(self):
        result = coverage([], ["SK003", "SK124"], "Web Developer. Managed website support and web research.")
        self.assertEqual(result["matched_skills"], [])


class AliasExclusionDataTests(unittest.TestCase):
    def test_every_exclusion_names_an_existing_skill_and_label(self):
        raw = matching._load_base_skills_reference()
        rows = {row["skill_id"].upper(): row for row in raw.to_dict(orient="records")}
        for skill_id, aliases in alias_exclusions().items():
            self.assertIn(skill_id, rows)
            listed = " ; ".join(str(rows[skill_id].get(field, "")) for field in ("related_skills", "esco_alternative_labels"))
            listed_keys = {matching.normalize_for_match(part) for part in listed.split(";")}
            for alias in aliases:
                with self.subTest(skill_id=skill_id, alias=alias):
                    self.assertIn(alias, listed_keys, "stale exclusion: the label is no longer listed")

    def test_excluded_labels_are_gone_everywhere_but_names_stay(self):
        skills = matching.load_skills_reference().set_index("skill_id")
        self.assertNotIn("XPath", skills.loc["SK004", "esco_alternative_labels"] + skills.loc["SK004", "related_skills"])
        self.assertEqual(skills.loc["SK004", "skill_name"], "SQL")
        _, aliases = matching.canonical_skill_lookup()
        self.assertNotIn("mocha", aliases)
        self.assertEqual(aliases["javascript"], "SK002")


# Skill lists as they were before the 2026-09-24 data review, which production
# Supabase rows may still carry (see scripts/sync_reviewed_job_skills.py).
def job(job_id, title, category, required_ids, preferred_ids=""):
    labels = matching.get_skill_labels_by_id()
    names = "; ".join(labels.get(skill_id, skill_id) for skill_id in required_ids.split(";") if skill_id)
    preferred = "; ".join(labels.get(skill_id, skill_id) for skill_id in preferred_ids.split(";") if skill_id)
    return dict(
        job_id=job_id, category_id=category, job_category="", job_subcategory="", job_title=title,
        job_description=f"{title} role.", required_skills_comma_separated=names, mapped_required_skill_names=names,
        required_skill_ids=required_ids, must_have_skill_ids=required_ids, nice_to_have_skill_ids=preferred_ids,
        mapped_nice_to_have_skill_names=preferred, nice_to_have_skills_optional=preferred,
        experience_level_required="Entry Level", location="Remote", work_type="Remote",
        salary_range_monthly_php="", job_text_for_matching="",
    )


UNREVIEWED_JOBS = pd.DataFrame([
    job("JOB-002", "Accounting Assistant", "K04", "SK012;SK005;SK013;SK001;SK002;SK003"),
    job("JOB-013", "Business Intelligence Developer", "K02", "SK004;SK006;SK195;SK122;SK098;SK012"),
    job("JOB-015", "Digital Project Manager", "K06", "SK021;SK213;SK020;SK008;SK125;SK048;SK001;SK332"),
    job("EA-1", "Executive Assistant", "K05", "SK631;SK622;SK623;SK627", "SK197"),
    job("RC-1", "Receptionist and Admin Clerk", "K05", "SK202;SK624;SK015"),
])


class EndToEndConsistencyTests(unittest.TestCase):
    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)

    def run_matching(self, jobs=UNREVIEWED_JOBS, cosine=0.45, **kwargs):
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=jobs), \
             patch.object(matching, "score_jobs", return_value=np.full(len(jobs), cosine)), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            return matching.run_matching(resume_text=ASSISTANT_RESUME, preferences={}, **kwargs)

    def all_scored(self, result):
        return {item["job_id"]: item for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]}

    def test_skills_the_resume_does_not_show_are_never_matched(self):
        result = self.run_matching()
        for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]:
            with self.subTest(job=item["job_id"]):
                self.assertFalse(set(item["matched_skills"]) & set(NOT_SHOWN.values()))
        # With the old job data those jobs are not Fit-Now for this resume.
        fit_now = {item["job_id"] for item in result["all_fit_now_matches"]}
        self.assertFalse(fit_now & {"JOB-002", "JOB-013", "JOB-015"})

    def test_the_assistant_jobs_are_matched_from_resume_evidence(self):
        scored = self.all_scored(self.run_matching())
        self.assertEqual(scored["EA-1"]["missing_skills"], [])
        self.assertEqual(scored["EA-1"]["match_type"], "Fit-Now")
        # "Coordinated patient appointments" shows Appointment Scheduling.
        self.assertIn("Appointment Scheduling", scored["RC-1"]["matched_skills"])

    def test_matched_missing_and_gaps_never_contradict(self):
        result = self.run_matching()
        held = set()
        for item in result["all_fit_now_matches"] + result["all_aspiration_matches"]:
            with self.subTest(job=item["job_id"]):
                matched = set(item["matched_skills"]) | set(item.get("matched_preferred_skills", []))
                missing = set(item["missing_skills"]) | set(item.get("missing_preferred_skills", []))
                self.assertFalse(matched & missing)
                evidence = {entry["skill"] for entry in item["matched_skill_evidence"]}
                self.assertEqual(evidence, matched)
                self.assertEqual({entry["skill"] for entry in item["missing_skill_status"]}, missing)
                for name in item["matched_skills"]:
                    self.assertNotIn(f"not found in your resume: {name}", item["explanation"])
                held |= matched
        gaps = {gap["skill_name"] for gap in result["skill_gaps"]}
        self.assertFalse(gaps & held, "a skill shown as held is also listed as a gap")

    def test_pasted_external_job_follows_the_same_rules(self):
        pasted = job("pasted", "Front-End Developer", "K01", "")
        pasted.update(required_skill_ids="", must_have_skill_ids="",
                      required_skills_for_eval="React; Java; Microsoft Excel; Google Workspace")
        with patch.object(matching, "score_jobs", return_value=np.asarray([0.4])), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            result = matching.analyze_candidate_job_match(
                ASSISTANT_RESUME + "\nSkills: ReactJS, JavaScript", pasted)["match"]
        self.assertEqual(sorted(result["matched_skills"]), ["Google Workspace", "React.js"])
        self.assertEqual(sorted(result["missing_skills"]), ["Java (computer programming)", "Microsoft Excel"])


class _ExtractingGemma:
    """Stands in for Gemma's job parsing; the numeric score never comes from it."""

    def __init__(self, required, preferred=()):
        self.required, self.preferred = list(required), list(preferred)

    def extract_external_job(self, description, title, company):
        from backend.app.services.gemma_service import ExternalJobExtraction

        return ExternalJobExtraction(job_title=title, summary=description[:100],
                                     required_skills=self.required, preferred_skills=self.preferred)

    def explain_match(self, *_args, **_kwargs):
        from backend.app.services.gemma_service import GemmaUnavailable

        raise GemmaUnavailable("test")


class PastedJobRequirementTests(unittest.TestCase):
    def analyze(self, required, preferred=()):
        from backend.app.services import external_job_analysis

        with patch.object(external_job_analysis, "gemma_service", _ExtractingGemma(required, preferred)), \
             patch.object(matching, "score_jobs", return_value=np.asarray([0.45])), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            return external_job_analysis.analyze_external_job(
                job_description="Executive assistant for a growing clinic. " * 5, job_title="Executive Assistant",
                resume_text=ASSISTANT_RESUME)

    def test_requirements_without_a_taxonomy_skill_are_not_dropped(self):
        result = self.analyze(["Calendar Management", "Google Workspace", "Canva", "Node.js"])
        self.assertEqual(sorted(result["matched_skills"]), ["Calendar Management", "Google Workspace"])
        self.assertEqual(sorted(result["missing_skills"]), ["Canva", "Node.js"])
        self.assertEqual(result["match"]["skill_coverage"], 0.5)
        self.assertNotEqual(result["match"]["match_type"], "Fit-Now")

    def test_taxonomy_only_requirements_keep_their_ids(self):
        result = self.analyze(["Calendar Management", "Email Management", "MS Excel"])
        self.assertEqual(result["match"]["missing_skill_ids"], ["SK629"])
        self.assertEqual(result["missing_skills"], ["Microsoft Excel"])
        self.assertEqual(result["warnings"], [])


class JobSkillSyncTests(unittest.TestCase):
    def test_plans_guarded_updates_only_for_jobs_that_differ(self):
        reference = [
            {"job_id": "JOB-002", "job_title": "Accounting Assistant", "required_skill_ids": "SK012;SK013;SK197",
             "mapped_required_skill_names": "Bookkeeping; Financial Reporting; Use spreadsheets software",
             "mapped_nice_to_have_skill_names": ""},
            {"job_id": "JOB-003", "job_title": "CSR", "required_skill_ids": "SK029",
             "mapped_required_skill_names": "Customer Service", "mapped_nice_to_have_skill_names": ""},
        ]
        live = [
            {"job_id": "JOB-002", "job_title": "Accounting\nAssistant", "must_have_skill_ids": "SK012;SK005;SK013;SK001;SK002;SK003"},
            {"job_id": "JOB-003", "job_title": "CSR", "must_have_skill_ids": "SK029"},
            {"job_id": "KJ-0001", "job_title": "Other", "must_have_skill_ids": "SK999;SK_EXCEL"},
        ]
        updates = sync.plan_updates(live, reference)
        self.assertEqual([update["job_id"] for update in updates], ["JOB-002"])
        sql = sync.update_sql(updates)
        self.assertIn("must_have_skill_ids = 'SK012;SK013;SK197'", sql)
        self.assertIn("is not distinct from 'SK012;SK005;SK013;SK001;SK002;SK003'", sql)
        self.assertNotIn("\nAssistant", sql)
        findings = sync.unusable_skill_ids(live, {"SK012": "reviewed", "SK029": "reviewed"})
        self.assertEqual([(item["job_id"], item["skill_id"]) for item in findings][-1], ("KJ-0001", "SK999"))


if __name__ == "__main__":
    unittest.main()


class PastedJobFallbackTests(unittest.TestCase):
    """Without Gemma, requirement levels come from the posting's headings, not from every mention."""

    POSTING = """About us
We are a fintech startup that uses Python and Power BI internally.
Responsibilities
- Keep calendar management and email management running for the finance team.
Requirements:
- Microsoft Excel and Bookkeeping
Nice to have
- Power BI
Tableau experience is a plus.
Benefits: free Canva Pro license"""

    def test_headings_decide_required_preferred_and_ignored(self):
        from backend.app.services.external_job_analysis import classify_requirements

        result = classify_requirements(self.POSTING)
        self.assertEqual(sorted(result["required"]), ["Bookkeeping", "Microsoft Excel"])
        self.assertEqual(sorted(result["preferred"]), ["Power BI", "Tableau"])
        # Responsibilities do not say whether the employer requires a skill.
        self.assertEqual(sorted(result["unclassified"]), ["Calendar Management", "Email Management"])
        # "About us" and "Benefits" name no requirement.
        flat = result["required"] + result["preferred"] + result["unclassified"]
        self.assertNotIn("Python Programming", flat)
        self.assertNotIn("Canva", flat)

    def test_inline_markers_apply_to_their_sentence(self):
        from backend.app.services.external_job_analysis import classify_requirements

        result = classify_requirements("We need someone with SQL and Excel. Tableau is a plus. The role requires Python.")
        self.assertEqual(result["preferred"], ["Tableau"])
        self.assertEqual(result["required"], ["Python Programming"])
        self.assertEqual(sorted(result["unclassified"]), ["Microsoft Excel", "SQL"])

    def test_unclassified_skills_are_never_required_and_are_reported(self):
        from backend.app.services import external_job_analysis
        from backend.app.services.gemma_service import GemmaUnavailable

        class Unavailable:
            def extract_external_job(self, *args, **kwargs):
                raise GemmaUnavailable("test")

            explain_match = extract_external_job

        with patch.object(external_job_analysis, "gemma_service", Unavailable()), \
             patch.object(matching, "score_jobs", return_value=np.asarray([0.45])), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            result = external_job_analysis.analyze_external_job(job_description=self.POSTING, resume_text=ASSISTANT_RESUME)
        self.assertEqual(result["metadata"]["extraction_source"], "deterministic_fallback")
        self.assertEqual(sorted(result["metadata"]["unclassified_skills"]), ["Calendar Management", "Email Management"])
        self.assertTrue(any("does not say whether it requires" in warning for warning in result["warnings"]))
        # Only the two skills under "Requirements" are required.
        self.assertEqual(sorted(result["matched_skills"] + result["missing_skills"]), ["Bookkeeping", "Microsoft Excel"])
        self.assertEqual(result["match"]["match_breakdown"]["required_skill_count"], 2)
