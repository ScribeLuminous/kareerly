"""Seniority is read off the title, not off the description prose.

The failure this guards against: a posting titled "Junior Data Analyst" whose
description mentions "a strong path to senior analyst" was labelled `senior`,
because normalize_record matched title and description as one blob. The JSearch
adapter appends the Qualifications and Responsibilities highlights to the
description, so there is now more prose for a stray "senior" to hit.

    python3 -m unittest tests.test_normalize_seniority
"""

import unittest

from pipeline.normalize import match_seniority, normalize_record


def _raw(title, description, **payload):
    payload.update(title=title, description=description)
    return {
        "source": "test",
        "source_id": "1",
        "source_url": "",
        "access_basis": "",
        "licence": "",
        "fetched_at": "",
        "payload": payload,
    }


class SeniorityFromTitle(unittest.TestCase):
    def test_junior_title_beats_senior_in_description(self):
        """The verified regression case, end to end through normalize_record."""
        job = normalize_record(_raw(
            "Junior Data Analyst",
            "We are looking for a data analyst to join our reporting team and "
            "own recurring business intelligence dashboards. There is a strong "
            "path to senior analyst within two years.",
        ))
        self.assertEqual(job.seniority, "entry")

    def test_junior_and_senior_in_the_same_title(self):
        self.assertEqual(match_seniority("Junior / Senior Data Analyst", ""), "entry")

    def test_senior_title_still_reads_senior(self):
        self.assertEqual(
            match_seniority("Senior Backend Engineer", "Mentor junior developers."),
            "senior",
        )

    def test_description_is_used_only_when_the_title_is_silent(self):
        self.assertEqual(
            match_seniority("Data Analyst", "This is an entry-level opening."),
            "entry",
        )
        self.assertEqual(match_seniority("Data Analyst", ""), "")

    def test_description_seniority_does_not_leak_into_a_levelled_title(self):
        """A title that states any level wins outright, even a lower one."""
        self.assertEqual(
            match_seniority("Mid-level Developer", "Works alongside the lead architect."),
            "mid",
        )

    def test_weak_entry_markers_do_not_outrank_real_levels(self):
        """'associate' and 'graduate' are ambiguous, so they resolve last."""
        self.assertEqual(match_seniority("Associate Director", ""), "manager")
        self.assertEqual(match_seniority("Senior Associate", ""), "senior")
        self.assertEqual(match_seniority("Associate", ""), "entry")

    def test_existing_level_markers_still_resolve(self):
        cases = [
            ("Marketing Intern", "intern"),
            ("Accounting Officer", "mid"),
            ("Engineering Manager", "manager"),
            ("Head of People", "manager"),
            ("Principal Scientist", "senior"),
        ]
        for title, expected in cases:
            with self.subTest(title=title):
                self.assertEqual(match_seniority(title, ""), expected)

    def test_years_of_experience_still_falls_back_to_the_description(self):
        self.assertEqual(
            match_seniority("Software Engineer", "Requires 8+ years of experience."),
            "senior",
        )
        self.assertEqual(
            match_seniority("Software Engineer", "Requires 3 years of experience."),
            "mid",
        )


class NarrowedDescriptionFallback(unittest.TestCase):
    """When the title is silent, only a phrase that states the level of *this*
    vacancy counts. A bare level word in prose describes someone else."""

    def test_a_level_word_in_prose_is_not_a_level(self):
        prose = [
            "Reports to the kitchen manager and the shift supervisor.",
            "Graduate of any four-year course.",
            "The principal responsibilities are stocking and cleaning.",
            "You will mentor our junior staff and lead the morning huddle.",
            "Coordinate with the account director on weekly deliverables.",
            "Our company has 20 years in business across the region.",
            "Work alongside our specialist team and the duty officer.",
        ]
        for description in prose:
            with self.subTest(description=description):
                self.assertEqual(match_seniority("Kitchen Assistant", description), "")

    def test_explicit_level_phrases_still_fire(self):
        cases = [
            ("This is an entry-level opening.", "entry"),
            ("We are hiring a junior developer for the platform team.", "entry"),
            ("This is a junior position on the reporting team.", "entry"),
            ("Fresh graduates are welcome to apply.", "entry"),
            ("No prior experience is required.", "entry"),
            ("This is a mid-level role.", "mid"),
            ("Requires at least 3 years of hands-on experience.", "mid"),
            ("This is a senior role on the data platform.", "senior"),
            ("We are looking for a senior data engineer.", "senior"),
            ("Requires 8+ years of relevant experience.", "senior"),
            ("This is a managerial position with four direct reports.", "manager"),
            ("A paid internship running for six months.", "intern"),
        ]
        for description, expected in cases:
            with self.subTest(description=description):
                self.assertEqual(match_seniority("Store Staff", description), expected)

    def test_precedence_still_favours_the_junior_claim(self):
        self.assertEqual(
            match_seniority(
                "Data Analyst",
                "This is a junior role with a clear path to a senior position.",
            ),
            "entry",
        )

    def test_years_of_experience_must_be_about_experience(self):
        self.assertEqual(match_seniority("Welder", "We have served the region for 12 years."), "")
        self.assertEqual(
            match_seniority("Welder", "Requires 12 years of welding experience."), "senior"
        )

    def test_unclassified_is_an_acceptable_answer(self):
        job = normalize_record(_raw(
            "Kitchen Assistant",
            "Assist the kitchen team with prep, plating and cleaning during "
            "service. You will report to the kitchen manager on shift.",
        ))
        self.assertEqual(job.seniority, "")


class WorkSetupUnchanged(unittest.TestCase):
    """Work setup keeps its own last-match-wins rule; only seniority changed."""

    def test_onsite_still_overrides_remote(self):
        job = normalize_record(_raw(
            "Data Analyst",
            "A largely remote role with occasional on-site days in Makati.",
        ))
        self.assertEqual(job.work_setup, "onsite")


if __name__ == "__main__":
    unittest.main()
