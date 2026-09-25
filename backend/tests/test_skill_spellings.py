"""Spellings of one skill: spaced, joined, hyphenated and abbreviated.

Reported: a resume listing "Help Scout" was told HelpScout was missing. Every
spelling below must (1) show in Step 1 when a DOCX resume lists it and
(2) satisfy a job requirement written in any other spelling of the same skill.
The false-positive cases keep the rules from reading ordinary words as skills.
"""
import io
import unittest

from docx import Document

from backend.app import main
from backend.app.services import matching_service as matching
from backend.app.services.resume_analyzer import analyze_resume_bytes

GROUPS = {
    "SK645": ["Help Scout", "HelpScout", "Helpscout", "Help-Scout"],
    "SK642": ["HubSpot", "Hubspot", "Hub Spot", "HubSpot CRM", "Hub-Spot"],
    "SK629": ["MS Excel", "Microsoft Excel", "Excel", "MSExcel", "MS-Excel", "Advanced Excel"],
    "SK627": ["Google Workspace", "GWorkspace", "G Workspace", "G Suite", "GSuite", "G-Suite", "Google Suite"],
    "SK276": ["CRM", "Customer Relationship Management"],
    "SK029": ["Customer Service", "Customer Support", "CS", "CS/CX"],
    "SK694": ["Customer Experience", "CX", "CX support", "Customer Experience Management"],
    "SK639": ["Customer Success", "Client Success"],
    "SK644": ["Zendesk", "Zen Desk", "ZenDesk"],
    "SK646": ["Freshdesk", "Fresh Desk", "FreshDesk"],
    "SK652": ["QuickBooks", "Quickbooks", "Quick Books", "QBO"],
    "SK643": ["Salesforce", "SalesForce", "SFDC"],
    "SK669": ["Power BI", "PowerBI", "Power-BI"],
    "SK628": ["MS Office", "Microsoft Office", "Office 365", "O365", "Microsoft 365", "M365", "MS 365", "PowerPoint", "Power Point", "MS Word"],
    "SK636": ["ClickUp", "Click Up", "Clickup"],
    "SK630": ["Airtable", "Air Table", "AirTable"],
    "SK656": ["WordPress", "Word Press", "Wordpress"],
    "SK002": ["JavaScript", "Java Script", "Javascript", "JS"],
    "SK197": ["Google Sheets", "GSheets", "G Sheets"],
    "SK649": ["E-commerce", "Ecommerce", "E commerce", "eCommerce"],
    "SK689": ["Chat Support", "Live Chat", "Chat-support"],
    "SK690": ["Email Support", "E-mail Support", "Non-voice", "Non Voice"],
    "SK626": ["Virtual Assistant", "Virtual Assistance", "VA"],
    "SK662": ["Adobe Photoshop", "Photoshop", "Photo Shop"],
    "SK671": ["Google Analytics", "GA4"],
    "SK027": ["Social Media Management", "SMM"],
    "SK641": ["Help Desk", "Helpdesk", "Help-desk"],
    "SK623": ["Email Management", "Inbox Management", "E-mail Management"],
}

# Sentences that name no skill in the given group, though they look close.
NOT_SKILLS = {
    "Education: BS CS, University of the Philippines, 2020.": "SK029",
    "Bachelor of Science in CS, 2019.": "SK029",
    "CS graduate with a thesis on compilers.": "SK029",
    "BSCS student.": "SK029",
    "Built pages with HTML and CSS.": "SK029",
    "cs and cx written in lower case": "SK029",
    "cx in lower case is not an abbreviation": "SK694",
    "Built a CXF web service in Java.": "SK694",
    "Parsed JSON responses.": "SK002",
    "Address: 123 Main St, Arlington, VA 22201": "SK626",
    "Led a sales force of 12 agents.": "SK643",
    # Spaced brand spellings that are also ordinary phrases match in Title Case only.
    "Installed power points in new homes.": "SK628",
    "Worked weekends at a photo shop.": "SK662",
    "Scroll and click up to the top.": "SK636",
    # Words that end a skill's name are part of it: "Customer Experience" is
    # not "customer", "Office software" is not "office".
    "Customer Service specialist.": "SK694",
    "Worked in a busy office.": "SK186",
    "Launched a new product line.": "SK025",
    "Handled industrial equipment.": "SK489",
}


def step_one(spelling):
    document = Document()
    for line in ["Jamie Cruz", "SUMMARY", "Remote administrative professional supporting online businesses.",
                 "SKILLS", f"Tools: {spelling}, Canva", "EXPERIENCE", "Assistant, Example Co, 2021 - Present."]:
        document.add_paragraph(line)
    buffer = io.BytesIO()
    document.save(buffer)
    analysis = analyze_resume_bytes(buffer.getvalue(), "resume.docx", matching.current_skill_extractor())
    return (analysis["normalized_for_matching"]["resume_text_for_matching"],
            analysis["normalized_for_matching"]["all_skill_ids"])


class SkillSpellingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.step_one = {spelling: step_one(spelling) for spellings in GROUPS.values() for spelling in spellings}

    def test_every_spelling_is_extracted_in_step_one(self):
        missed = [f"{skill_id} {spelling!r}" for skill_id, spellings in GROUPS.items() for spelling in spellings
                  if skill_id not in self.step_one[spelling][1]]
        self.assertEqual(missed, [])

    def test_every_spelling_meets_a_requirement_written_in_any_other(self):
        missed = []
        for skill_id, spellings in GROUPS.items():
            for resume_spelling in spellings:
                text, held = self.step_one[resume_spelling]
                for requirement in spellings:
                    if matching.compute_skill_coverage(held, [requirement], text)["missing_skills"]:
                        missed.append(f"requirement {requirement!r} vs resume {resume_spelling!r}")
        self.assertEqual(missed, [])

    def test_the_reported_help_scout_case(self):
        text, held = self.step_one["Help Scout"]
        coverage = matching.compute_skill_coverage(held, ["HelpScout", "HubSpot CRM"], text + "\nCRM: Hub Spot")
        self.assertEqual(coverage["missing_skills"], [])
        # Also from the text alone, with nothing confirmed.
        self.assertEqual(matching.compute_skill_coverage([], ["HelpScout"], "Tickets in Help Scout.")["missing_skills"], [])

    def test_look_alike_words_are_not_skills(self):
        for text, skill_id in NOT_SKILLS.items():
            with self.subTest(text=text):
                extracted = {skill["skill_id"] for skill in matching.extract_skills_from_text(text, max_skills=None)}
                self.assertNotIn(skill_id, extracted)
                self.assertEqual(matching.compute_skill_coverage([], [skill_id], text)["matched_skills"], [])

    def test_upper_case_abbreviations_in_context(self):
        for text in ["Skills: CS, CX, Zendesk", "Handled CS/CX tickets for an online store."]:
            with self.subTest(text=text):
                found = {s["skill_id"] for s in matching.extract_skills_from_text(text, max_skills=None)}
                # CS is Customer Service and CX is Customer Experience, two skills.
                self.assertLessEqual({"SK029", "SK694"}, found)

    def test_customer_experience_is_its_own_skill(self):
        labels = matching.get_skill_labels_by_id()
        self.assertEqual(labels["SK694"], "Customer Experience")
        self.assertEqual(matching._skill_key("CX"), "SK694")
        self.assertEqual(matching._skill_key("CS"), "SK029")
        # Neither stands in for the other.
        self.assertEqual(matching.compute_skill_coverage([], ["SK694"], "Customer Service specialist.")["missing_skills"],
                         ["Customer Experience"])
        self.assertEqual(matching.compute_skill_coverage([], ["SK029"], "Led the CX team.")["missing_skills"],
                         ["Customer Service"])
        self.assertEqual(main.search_skills(q="CX", limit=3)["results"][0]["skill_id"], "SK694")
        self.assertIn("SK626", {s["skill_id"] for s in matching.extract_skills_from_text("Remote VA for US clients.")})

    def test_skill_search_finds_every_spelling(self):
        labels = matching.get_skill_labels_by_id()
        for skill_id, spellings in GROUPS.items():
            for spelling in spellings:
                with self.subTest(spelling=spelling):
                    found = [item["skill_id"] for item in main.search_skills(q=spelling, limit=5)["results"]]
                    self.assertIn(skill_id, found, labels[skill_id])

    def test_search_lists_one_entry_per_skill(self):
        found = [item["skill_id"] for item in main.search_skills(q="python", limit=10)["results"]]
        self.assertIn("SK001", found)
        self.assertNotIn("SK134", found)  # the auto-generated copy of SK001


if __name__ == "__main__":
    unittest.main()
