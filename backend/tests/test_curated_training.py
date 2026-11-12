import unittest
from types import SimpleNamespace

from backend.pipeline.curated_training import Page, extract, job_nodes, skill_evidence


class CuratedTrainingTests(unittest.TestCase):
    def test_smartrecruiters_negotiated_json(self):
        import json
        data = {"jobTitle": " Laboratory Analyst", "jobAdLocation": "Subic, Philippines",
                "isApplyAvailable": True,
                "content": {"sections": {"companyDescription": {"text": "NOT A JOB DUTY"},
                                         "jobDescription": {"title": "Duties", "text": "<p>Test samples</p>"},
                                         "qualifications": {"title": "Qualifications", "text": "Licensed chemist"}}}}
        title, loc, body, _ = extract({"source": "smartrecruiters_html"}, json.dumps(data))
        self.assertEqual(title, "Laboratory Analyst")
        self.assertEqual(loc, "Subic, Philippines")
        self.assertIn("Test samples", body)
        self.assertNotIn("NOT A JOB DUTY", body)
        data["isApplyAvailable"] = False
        with self.assertRaisesRegex(ValueError, "no longer accepting"):
            extract({"source": "smartrecruiters_html"}, json.dumps(data))

    def test_scripts_not_visible_and_jsonld_kept(self):
        page = Page()
        page.feed('<h1>Job</h1><script>secret()</script><style>css</style>'
                  '<script type="application/ld+json">{"@type":"JobPosting","title":"Job"}</script>'
                  '<p>Real duties</p>')
        self.assertEqual(page.text, "Job\nReal duties")
        self.assertEqual(len(page.scripts), 1)

    def test_nested_jsonld_and_iso_location(self):
        import json
        node = {"@type": "JobPosting", "title": "Fitness Instructor",
                "jobLocation": {"address": {"addressLocality": "Manila", "addressCountry": "PH"}},
                "description": "<p>Fitness assessments</p><p>Training</p>"}
        self.assertEqual(list(job_nodes({"@graph": [node]})), [node])
        title, loc, body, _ = extract(
            {"source": "employer_jsonld", "expected_title": "Fitness Instructor"},
            '<script type="application/ld+json">' + json.dumps(node) + '</script>')
        self.assertEqual(loc, "Manila, Philippines")
        self.assertEqual(body, "Fitness assessments\nTraining")

    def test_expired_posting_rejected(self):
        with self.assertRaisesRegex(ValueError, "expired"):
            extract({"source": "employer_jsonld", "expected_title": "Old Job"},
                    '<script type="application/ld+json">{"@type":"JobPosting","title":"Old Job",'
                    '"validThrough":"2020-01-01"}</script>')

    def test_evidence_offsets_and_absent_evidence(self):
        skill = SimpleNamespace(skill_id="LEX-021", label="Fitness assessment",
                                k13_id="K13", concept_type="proposed_skill")
        taxonomy = SimpleNamespace(skills={"LEX-021": skill})
        entry = {"skills": [{"id": "LEX-021", "evidence": "fitness assessments"}]}
        text = "Conduct fitness\nassessments for guests."
        annotation = skill_evidence(entry, text, taxonomy)[0]
        self.assertEqual(text[annotation["start"]:annotation["end"]], annotation["evidence_text"])
        self.assertEqual(annotation["review_status"], "pending_human_review")
        missing = skill_evidence(entry, "Unrelated job", taxonomy)[0]
        self.assertFalse(missing["evidence_found"])
        self.assertIsNone(missing["evidence_text"])

    def test_site_navigation_not_added_as_duties(self):
        entry = {"source": "employer_html", "expected_title": "FIELD AGRONOMIST"}
        content = ('<p>Navigation</p><h1>FIELD AGRONOMIST</h1><h2>Full Time</h2>'
                   '<p>Benguet</p><p>Apply for this Position</p><h2>Job Description</h2>'
                   '<p>Crop production</p><h2>Qualifications</h2><p>No qualifications listed.</p>'
                   '<h2>Other Career Opportunities</h2><p>Banking skills</p>')
        _, loc, body, _ = extract(entry, content)
        self.assertEqual(loc, "Benguet")
        self.assertNotIn("Banking", body)
        self.assertNotIn("Navigation", body)


if __name__ == "__main__":
    unittest.main()
