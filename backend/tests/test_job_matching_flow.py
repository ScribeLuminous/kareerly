"""End-to-end regressions for the resume-to-job matching flow.

The encoder is replaced by a small bag-of-words model that, like the real
checkpoint, reads only the first 256 words of each input. That keeps the
tests offline while still exercising the real scoring path: evidence windows,
max-over-sections aggregation, the job-vector cache and classification.
"""
import io
import re
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from docx import Document

from backend.app import main
from backend.app.services import bi_encoder_service as encoder
from backend.app.services import matching_service as matching
from backend.app.services import resume_evidence
from backend.app.services.resume_analyzer import analyze_resume_bytes

LABELS = matching.get_skill_labels_by_id()

# Topic words the fake encoder embeds. Words outside the list are ignored.
VOCABULARY = [
    "sql", "python", "dashboards", "tableau", "visualization", "analytics", "reports", "data",
    "patients", "clinical", "nursing", "ward", "welding", "fabrication", "steel",
]


class BagOfWordsEncoder:
    """Counts topic words in the first 256 words, like a 256-token model."""

    def encode(self, texts, **kwargs):
        vectors = []
        for text in texts:
            words = re.findall(r"[a-z]+", text.lower())[:256]
            vectors.append([words.count(word) for word in VOCABULARY] + [0.05])
        return np.asarray(vectors, dtype=float)


def job(job_id, title, description, required_ids, must_have="", preferred="", category_id="K02",
        category="Data, Analytics, and Artificial Intelligence"):
    return dict(
        job_id=job_id, category_id=category_id, job_category=category, job_subcategory="", job_title=title,
        job_description=description, required_skills_comma_separated="", mapped_required_skill_names="",
        required_skill_ids=required_ids, must_have_skill_ids=must_have or required_ids,
        nice_to_have_skill_ids=preferred, experience_level_required="Entry level", location="Philippines",
        work_type="Remote", salary_range_monthly_php="", job_text_for_matching="",
    )


# SQL SK004, Python SK001, Data Visualization SK006, Data Analysis SK005,
# Tableau SK670, Power BI SK669, Microsoft Excel SK629, Git SK657.
CATALOGUE = pd.DataFrame([
    job("analyst", "Data Analyst", "Write SQL and Python reports and data analytics dashboards.",
        "SK004;SK001;SK005", preferred="SK629"),
    job("bi", "BI Developer", "Build Tableau dashboards and data visualization analytics reports.",
        "SK670;SK006;SK669;SK004", preferred="SK657"),
    job("nurse", "Staff Nurse", "Care for patients on a clinical nursing ward.", "SK056;SK061",
        category_id="K14", category="Healthcare and Clinical Services"),
    job("welder", "Welder", "Steel welding and fabrication.", "SK070;SK680",
        category_id="K17", category="Construction and Skilled Trades"),
])

RESUME = "\n".join([
    "Jordan Cruz",
    "SUMMARY",
    "Data analyst writing SQL and Python reports and data analytics dashboards for sales teams.",
    "SKILLS",
    "SQL, Python, Data Analysis, Microsoft Excel",
    "EXPERIENCE",
    "Data Analyst, Example Retail, 2021 - Present. Wrote SQL queries and Python reports.",
])


class MatchingFlowCase(unittest.TestCase):
    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)
        encoder._job_vectors.clear()
        self.addCleanup(encoder._job_vectors.clear)

    def run_match(self, resume=RESUME, jobs=CATALOGUE, **kwargs):
        # The catalogue is cached between reports; each call here sets its own.
        matching.clear_reference_jobs_cache()
        with patch.object(encoder, "get_bi_encoder", return_value=BagOfWordsEncoder()), \
             patch.object(matching, "load_internal_jobs_dataframe", return_value=jobs), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            return matching.run_matching(resume_text=resume, **kwargs)

    @staticmethod
    def ids(items):
        return [item["job_id"] for item in items]

    @staticmethod
    def returned(result):
        return result["all_fit_now_matches"] + result["all_aspiration_matches"]


class ClassificationFlowTests(MatchingFlowCase):
    def test_one_report_holds_both_fit_now_and_aspiration_matches(self):
        result = self.run_match()
        self.assertEqual(self.ids(result["all_fit_now_matches"]), ["analyst"])
        self.assertEqual(self.ids(result["all_aspiration_matches"]), ["bi"])
        bi = result["all_aspiration_matches"][0]
        # The specific requirements that make it aspirational.
        self.assertEqual(bi["aspiration_gap_skills"], sorted([LABELS["SK670"], LABELS["SK006"], LABELS["SK669"]]))
        self.assertIn(LABELS["SK004"], bi["matched_skills"])

    def test_unrelated_jobs_are_in_neither_list_unless_they_are_the_chosen_area(self):
        # No career area chosen: the resume decides, and the unrelated jobs are out.
        result = self.run_match()
        self.assertFalse(set(self.ids(self.returned(result))) & {"nurse", "welder"})
        self.assertEqual(result["debug_summary"]["low_match_count"], 2)
        # Healthcare chosen in Step 3: the nurse job is the candidate's aspiration,
        # compared with the resume for its gaps; the data jobs outside it are not.
        healthcare = self.run_match(preferences={"industry": "healthcare-wellness"})
        self.assertEqual(self.ids(healthcare["all_fit_now_matches"]), ["analyst"])
        self.assertEqual(self.ids(healthcare["all_aspiration_matches"]), ["nurse"])
        nurse = healthcare["all_aspiration_matches"][0]
        self.assertEqual(nurse["matched_skills"], [])
        self.assertEqual(nurse["aspiration_gap_skills"], nurse["missing_skills"])

    def test_aspiration_notes_shared_skills_but_does_not_require_them(self):
        # Elementary Teacher shares only Microsoft Excel, a nice-to-have.
        jobs = pd.concat([CATALOGUE, pd.DataFrame([job("teacher", "Elementary Teacher",
            "Teach elementary classes.", "SK045;SK046;SK047", preferred="SK629", category_id="K12",
            category="Education and Training")])], ignore_index=True)
        education = self.run_match(jobs=jobs, preferences={"industry": "education-training"})
        self.assertEqual(self.ids(education["all_aspiration_matches"]), ["teacher"])
        teacher = education["all_aspiration_matches"][0]
        self.assertEqual(teacher["matched_preferred_skills"], [LABELS["SK629"]])
        self.assertEqual(len(teacher["missing_essential_skills"]), 3)
        # With another area chosen, the teacher job is not an Aspiration.
        technology = self.run_match(jobs=jobs, preferences={"industry": "technology-data"})
        self.assertNotIn("teacher", self.ids(self.returned(technology)))
        self.assertIn("bi", self.ids(technology["all_aspiration_matches"]))

    def test_missing_must_have_without_resume_evidence_blocks_fit_now(self):
        # Seven of eight required skills held (88%), but Git was marked must-have.
        jobs = pd.DataFrame([job("analyst", "Data Analyst", "Write SQL and Python reports and data analytics dashboards.",
            "SK004;SK001;SK005;SK629;SK006;SK670;SK669;SK657", must_have="SK004;SK657")])
        resume = RESUME + "\nBuilt Tableau and Power BI dashboards with data visualization."
        result = self.run_match(resume=resume, jobs=jobs)
        self.assertEqual(result["all_fit_now_matches"], [])
        item = result["all_aspiration_matches"][0]
        self.assertEqual(item["required_skill_coverage"], 0.875)
        self.assertEqual(item["match_breakdown"]["failed_fit_now_rules"], ["critical_skill_missing"])
        self.assertEqual(item["missing_must_have_skills"], [LABELS["SK657"]])
        self.assertEqual(item["missing_skill_status"][0]["status"], matching.MISSING_NOT_FOUND)
        self.assertIn("not found in your resume", item["explanation"])
        # With resume evidence for the must-have, the same job is Fit-Now.
        held = self.run_match(resume=resume + "\nVersion control with Git.", jobs=jobs)
        self.assertEqual(self.ids(held["all_fit_now_matches"]), ["analyst"])


class LaterSectionTests(MatchingFlowCase):
    # A long opening pushes the projects section past what one model input reads.
    OPENING = "\n".join([
        "Taylor Reyes",
        "SUMMARY",
        "Registered nurse caring for patients on a busy clinical ward. " * 12,
        "EXPERIENCE",
        "Staff Nurse, City Hospital, 2016 - 2023. Clinical nursing care for ward patients. " * 12,
        "EDUCATION",
        "Bachelor of Science in Nursing, 2016.",
    ])
    LATER = "\n".join([
        "PROJECTS",
        "Built Tableau dashboards and data visualization analytics reports on ward data, "
        "with SQL queries feeding Power BI reports.",
    ])

    def test_the_later_section_is_beyond_the_single_model_input(self):
        profile = encoder.build_model_input(self.OPENING + "\n" + self.LATER)
        self.assertNotIn("Tableau dashboards", profile)
        self.assertGreater(len(self.OPENING), 1400)

    def test_a_skill_in_a_later_section_changes_the_match(self):
        with_projects = self.run_match(resume=self.OPENING + "\n" + self.LATER)
        without = self.run_match(resume=self.OPENING)
        bi_with = next(item for item in with_projects["debug_summary"]["top_10_scores"] if item["job_title"] == "BI Developer")
        self.assertIn("bi", self.ids(self.returned(with_projects)))
        self.assertNotIn("bi", self.ids(self.returned(without)))
        # The relevance came from the projects section, not the opening.
        self.assertEqual(bi_with["semantic_evidence_section"], "projects")
        bi = next(item for item in self.returned(with_projects) if item["job_id"] == "bi")
        self.assertIn(LABELS["SK670"], bi["matched_skills"])
        evidence = {item["skill"]: item for item in bi["matched_skill_evidence"]}
        self.assertEqual(evidence[LABELS["SK670"]]["source_section"], "projects")
        self.assertIn("projects section", bi["explanation"])
        # The opening alone is unrelated to the job; only the projects window
        # makes it relevant enough for Aspiration.
        self.assertLess(bi["semantic_score_profile_only"], matching.MatchThresholds.from_env().aspiration_min_semantic)
        self.assertGreaterEqual(bi["semantic_score"], matching.MatchThresholds.from_env().aspiration_min_semantic)

    def test_every_evidence_input_fits_the_encoder_and_the_resume_is_covered(self):
        text = self.OPENING + "\n" + self.LATER
        evidence = resume_evidence.candidate_model_inputs(text)
        self.assertEqual(evidence.inputs[0], encoder.build_model_input(text))
        self.assertIn("projects", evidence.sections)
        chunks = resume_evidence.resume_evidence_chunks(text)
        joined = " ".join(chunk.text for chunk in chunks)
        for sentence in ["Bachelor of Science in Nursing", "Power BI reports"]:
            self.assertIn(sentence, joined)
        self.assertTrue(all(len(chunk.text) <= resume_evidence.CHUNK_CHARS + resume_evidence.MIN_CHUNK_CHARS + 20
                            for chunk in chunks))
        try:
            from transformers import AutoTokenizer
            tokenizer = AutoTokenizer.from_pretrained(str(encoder.model_path()), local_files_only=True)
        except Exception:
            self.skipTest("checkpoint tokenizer not available")
        for model_input in evidence.inputs[1:]:
            self.assertLessEqual(len(tokenizer(model_input)["input_ids"]), 256)


class DocxTableTests(MatchingFlowCase):
    def resume_with_table(self):
        document = Document()
        for line in ["Jordan Cruz", "SUMMARY", "Data analyst writing SQL and Python reports and data analytics dashboards.",
                     "EXPERIENCE", "Data Analyst, Example Retail, 2021 - Present."]:
            document.add_paragraph(line)
        table = document.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "SKILLS"
        table.cell(0, 1).text = "Tools"
        table.cell(1, 0).text = "Data Analysis"
        table.cell(1, 1).text = "Tableau and Power BI"
        buffer = io.BytesIO()
        document.save(buffer)
        return buffer.getvalue()

    def test_a_table_skill_is_in_the_analysis_and_in_both_matching_routes(self):
        data = self.resume_with_table()
        analysis = analyze_resume_bytes(data, "resume.docx", matching.current_skill_extractor())
        self.assertIn("SK670", analysis["normalized_for_matching"]["skill_ids"])
        step_one_text = analysis["normalized_for_matching"]["resume_text_for_matching"]
        # Both routes read exactly the text Step 1 read.
        self.assertEqual(matching.extract_resume_text(data, "resume.docx"), step_one_text)
        with patch.object(encoder, "get_bi_encoder", return_value=BagOfWordsEncoder()), \
             patch.object(matching, "load_internal_jobs_dataframe", return_value=CATALOGUE), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]):
            from_file = matching.run_matching(file_bytes=data, filename="resume.docx")
            from_text = matching.run_matching(resume_text=step_one_text)
        for result in (from_file, from_text):
            bi = next(item for item in result["debug_summary"]["top_10_scores"] if item["job_title"] == "BI Developer")
            self.assertIn(LABELS["SK670"], bi["matched_skills"])
            self.assertNotIn(LABELS["SK670"], bi["missing_skills"])
        self.assertEqual(from_file["all_aspiration_matches"], from_text["all_aspiration_matches"])
        self.assertEqual(from_file["all_fit_now_matches"], from_text["all_fit_now_matches"])


class SkillGapTests(MatchingFlowCase):
    def test_per_job_and_aggregate_gaps_only_come_from_returned_jobs(self):
        result = self.run_match()
        returned = self.returned(result)
        returned_ids = set(self.ids(returned))
        required = {}
        for item in returned:
            required[item["job_id"]] = set(item["matched_skills"] + item["missing_essential_skills"]
                                           + item["matched_preferred_skills"] + item["missing_preferred_skills"])
            # Per-job gaps are that job's own requirements.
            self.assertLessEqual(set(item["missing_essential_skills"]) | set(item["missing_preferred_skills"]),
                                 required[item["job_id"]])
        unrelated = {LABELS[skill_id] for skill_id in ("SK056", "SK061", "SK070", "SK680") if skill_id in LABELS}
        gap_names = {gap["skill_name"] for gap in matching.prioritize_skill_gaps(returned, limit=None)}
        self.assertEqual(result["total_skill_gap_count"], len(gap_names))
        self.assertFalse(gap_names & unrelated)
        for gap in result["skill_gaps"]:
            affected = {job["job_id"] for job in gap["affected_job_details"]}
            self.assertTrue(affected and affected <= returned_ids, gap)
            self.assertTrue(all(gap["skill_name"] in required[job_id] for job_id in affected), gap)

    def test_essential_gaps_come_before_optional_gaps(self):
        gaps = self.run_match()["skill_gaps"]
        types = [gap["gap_type"] for gap in gaps]
        self.assertEqual(types, sorted(types, key=lambda value: value != "essential"))
        self.assertIn("optional", types)
        optional = next(gap for gap in gaps if gap["gap_type"] == "optional")
        self.assertEqual(optional["skill_name"], LABELS["SK657"])
        self.assertEqual(optional["affected_job_details"][0]["job_id"], "bi")

    def test_limited_reports_show_gaps_of_the_jobs_they_show(self):
        result = self.run_match()
        limited = main._apply_report_access_control(result, "guest", "initial")["limited_report"]
        shown = set(self.ids(limited["fit_now_matches"] + limited["aspiration_matches"]))
        for gap in limited["skill_gaps"]:
            self.assertLessEqual({job["job_id"] for job in gap["affected_job_details"]}, shown)


class ConfirmedSkillTests(MatchingFlowCase):
    # More than twenty skills. "Customer care" (Customer Service, found through
    # an alias rather than its label) is named once, in Education, so it ranks
    # well below the twenty Step 2 shows.
    RESUME = "\n".join([
        "Sam Lee",
        "SKILLS",
        "SQL, Python, JavaScript, HTML and CSS, Data Analysis, Data Visualization, Microsoft Excel, Tableau, Power BI, "
        "HubSpot, Salesforce, Zendesk, Jira, Asana, Airtable, QuickBooks, Bookkeeping, Calendar Management, "
        "Email Management, Google Workspace, Help Scout, Invoicing and Billing, Project Coordination, Figma",
        "EXPERIENCE",
        "Data Analyst, 2020 - Present. Wrote SQL and Python reports and data analytics dashboards in Tableau.",
        "EDUCATION",
        "BS Statistics, 2019. Student assistant handling customer care at the university library.",
    ])
    JOBS = pd.DataFrame([job("support-analyst", "Support Data Analyst", "SQL and Python data reports for support teams.",
        "SK004;SK001;SK029;SK629")])

    def step_two(self):
        skills = matching.extract_skills_from_text(self.RESUME, max_skills=None)
        return skills[:matching.MAX_CONFIRMED_SKILLS], skills[matching.MAX_CONFIRMED_SKILLS:]

    def test_a_skill_beyond_the_twenty_shown_is_not_reported_missing(self):
        shown, beyond = self.step_two()
        self.assertIn("SK029", [skill["skill_id"] for skill in beyond])
        confirmed = [{"skill_id": skill["skill_id"], "skill_name": skill["skill_name"]} for skill in shown]
        # The earlier rule (confirmed skills plus canonical labels in the text)
        # reported this documented skill missing.
        self.assertEqual(matching.compute_skill_coverage([skill["skill_id"] for skill in shown], ["SK029"],
            self.RESUME)["missing_skills"], [LABELS["SK029"]])
        result = self.run_match(resume=self.RESUME, jobs=self.JOBS, confirmed_skills=confirmed)
        item = self.returned(result)[0]
        self.assertIn(LABELS["SK029"], item["matched_skills"])
        self.assertEqual(item["missing_skills"], [])
        evidence = next(entry for entry in item["matched_skill_evidence"] if entry["skill"] == LABELS["SK029"])
        self.assertEqual((evidence["source"], evidence["source_section"], evidence["matched_text"]),
                         (matching.EVIDENCE_RESUME, "education", "customer care"))
        self.assertIn("customer care", evidence["evidence_text"])
        # The Step 2 list in the response is unchanged: still the twenty confirmed.
        self.assertEqual(result["confirmed_skills"], [skill["skill_name"] for skill in shown])

    def test_removed_and_added_skills_are_respected(self):
        shown, _ = self.step_two()
        kept = [skill for skill in shown if skill["skill_id"] not in {"SK629"}]
        confirmed = [{"skill_id": skill["skill_id"], "skill_name": skill["skill_name"]} for skill in kept]
        result = self.run_match(resume=self.RESUME, jobs=self.JOBS, confirmed_skills=confirmed,
                                removed_skill_ids=["SK629"])
        item = self.returned(result)[0]
        # Excel is named in the resume, but the candidate removed it in Step 2.
        self.assertEqual(item["missing_skills"], [LABELS["SK629"]])
        self.assertEqual(item["missing_skill_status"], [
            {"skill": LABELS["SK629"], "requirement": "essential", "status": matching.MISSING_REMOVED}])
        self.assertIn("you removed", item["explanation"])
        self.assertEqual(result["skill_gaps"][0]["evidence_status"], matching.MISSING_REMOVED)
        # A skill the candidate added holds a requirement the resume never names.
        jobs = pd.DataFrame([job("pm", "Analytics Coordinator", "SQL data reports.", "SK004;SK021;SK633")])
        resume = self.RESUME.replace("Asana, ", "")
        shown_without_asana = matching.extract_skills_from_text(resume)[:19]
        added = [{"skill_id": skill["skill_id"], "skill_name": skill["skill_name"]} for skill in shown_without_asana] + [
            {"skill_id": "SK633", "skill_name": LABELS["SK633"]}]
        held = self.returned(self.run_match(resume=resume, jobs=jobs, confirmed_skills=added))[0]
        asana = next(entry for entry in held["matched_skill_evidence"] if entry["skill"] == LABELS["SK633"])
        self.assertEqual(asana["source"], matching.EVIDENCE_CONFIRMED)

    def test_omitting_a_skill_from_the_confirmed_list_is_not_a_removal(self):
        # An older client sends only some skills and no removal list.
        result = self.run_match(resume=self.RESUME, jobs=self.JOBS,
                                confirmed_skills=[{"skill_id": "SK004", "skill_name": "SQL"}])
        item = self.returned(result)[0]
        self.assertEqual(item["missing_skills"], [])
        self.assertEqual(result["removed_skill_ids"], [])

    def test_the_confirmed_list_is_still_limited_to_twenty(self):
        with self.assertRaises(ValueError):
            self.run_match(confirmed_skills=[{"skill_id": "SK004"}] * 21)


class EncoderMatrixTests(unittest.TestCase):
    def setUp(self):
        encoder._job_vectors.clear()
        self.addCleanup(encoder._job_vectors.clear)

    def test_several_candidate_inputs_score_as_a_matrix(self):
        with patch.object(encoder, "get_bi_encoder", return_value=BagOfWordsEncoder()):
            matrix = encoder.score_jobs(["sql reports", "nursing patients"], ["sql data reports", "clinical nursing"])
            single = encoder.score_jobs("sql reports", ["sql data reports", "clinical nursing"])
        self.assertEqual(matrix.shape, (2, 2))
        self.assertTrue(np.allclose(matrix[0], single))
        self.assertGreater(matrix[0, 0], matrix[0, 1])
        self.assertGreater(matrix[1, 1], matrix[1, 0])


if __name__ == "__main__":
    unittest.main()
