"""The shared skill resolver and the reviewed alias file (data/skill_aliases.csv)."""
import collections
import csv
import json
import unittest

from backend.app.services import matching_service as matching
from backend.app.services import skill_resolver as resolver
from backend.app.services.skill_extractor import SkillExtractor
from backend.scripts import build_skill_alias_review as generator
from backend.scripts import refresh_esco_links
from backend.scripts import unreviewed_skill_dependencies as inventory

DATA = generator.DATA


def read(name):
    with (DATA / name).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


class AliasFileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = read("skill_aliases.csv")
        cls.by_key = {(row["skill_id"], resolver.normalize(row["alias"])): row for row in cls.rows}
        cls.skills = {row["skill_id"]: row for row in read("skills_reference.csv")}

    def test_every_row_has_a_known_skill_source_and_status(self):
        for row in self.rows:
            with self.subTest(row=row["skill_id"] + " " + row["alias"]):
                self.assertIn(row["skill_id"], self.skills)
                self.assertIn(row["status"], resolver.STATUSES)
                self.assertTrue(row["source"])

    def test_reviewed_files_are_reflected(self):
        for exclusion in read("skill_alias_exclusions.csv"):
            self.assertEqual(self.by_key[(exclusion["skill_id"], resolver.normalize(exclusion["alias"]))]["status"], resolver.EXCLUDED)
        for relation in read("skill_evidence_relations.csv"):
            expected = resolver.VERIFIED if relation["relation"] == generator.EQUIVALENT_RELATION else resolver.ONE_WAY
            row = self.by_key[(relation["skill_id"], resolver.normalize(relation["evidence_phrase"]))]
            # A phrase that is already a verified name elsewhere keeps that stronger status.
            self.assertIn(row["status"], {expected, resolver.VERIFIED})
        for variant in read("skill_name_variants.csv"):
            row = self.by_key[(variant["skill_id"], resolver.normalize(variant["variant"]))]
            self.assertEqual(row["status"], resolver.VERIFIED)
            self.assertEqual(row["exact_case"] == "true", variant["exact_case"].lower() == "true")

    def test_esco_alternative_labels_are_never_verified_automatically(self):
        for row in self.rows:
            if row["source"] in {"esco_alt", "kareerly_related"} and row["status"] == resolver.VERIFIED:
                with self.subTest(alias=row["alias"]):
                    self.assertTrue(row["reviewed_by"], "an ESCO alternative label was verified without a reviewer")

    def test_file_matches_the_data_it_is_generated_from(self):
        # Regenerating from the stored labels gives the same status for every name,
        # so a data file edit without regeneration is caught.
        fresh = generator.keep_reviews(generator.build_rows(generator.EscoIndex(None)), self.rows)
        fresh_status = {(row["skill_id"], resolver.normalize(row["alias"])): row["status"] for row in fresh}
        stored_status = {key: row["status"] for key, row in self.by_key.items()}
        self.assertEqual(fresh_status, stored_status)

    def test_metadata_records_the_esco_release(self):
        meta = json.loads((DATA / "skill_aliases_meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["esco_version"], "v1.2.1")
        self.assertEqual(meta["esco_archive_sha256"], "9608b20a6a6ee0b3ca0a31cecff850c870c66c76040b241bd1e34b0e214221ad")
        self.assertEqual(meta["rows"], len(self.rows))


class ResolverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vocabulary = matching.skill_vocabulary()

    def test_protected_look_alikes_never_resolve_together(self):
        self.assertEqual(resolver.protected_pair_violations(self.vocabulary), [])

    def test_esco_traps(self):
        # SQL is also an ESCO alternative label of "database management systems".
        self.assertEqual(self.vocabulary.resolve("SQL"), "SK004")
        # "bookkeeping" is also an ESCO alternative label of "accounting".
        self.assertEqual(self.vocabulary.resolve("Bookkeeping"), "SK012")
        # MS Excel is an ESCO label of "use spreadsheets software"; here it is Microsoft Excel.
        self.assertEqual(self.vocabulary.resolve("MS Excel"), "SK629")
        # ESCO lists SEM and search engine marketing under search engine optimisation.
        self.assertEqual(self.vocabulary.resolve("search engine optimisation"), "SK672")
        self.assertEqual(self.vocabulary.resolve("search engine marketing"), "")
        self.assertEqual(self.vocabulary.resolve("SEM"), "")

    def test_look_alike_languages_and_databases_are_separate_skills(self):
        # Node.js, MySQL, C++ and C# are skills of their own, so each side of a
        # look-alike pair resolves, to a different skill.
        self.assertEqual(self.vocabulary.resolve("NodeJS"), "SK695")
        self.assertEqual(self.vocabulary.resolve("Node JS"), self.vocabulary.resolve("Node.js"))
        self.assertEqual(self.vocabulary.resolve("MySQL"), "SK696")
        self.assertEqual(self.vocabulary.resolve("C++"), "SK697")
        self.assertEqual(self.vocabulary.resolve("C Sharp"), self.vocabulary.resolve("C#"))
        self.assertEqual(self.vocabulary.resolve("C"), "")
        for left, right in [("SQL", "MySQL"), ("C++", "C#"), ("Java", "JavaScript"), ("Node.js", "JavaScript")]:
            with self.subTest(left=left, right=right):
                self.assertNotEqual(self.vocabulary.resolve(left), self.vocabulary.resolve(right))
        found = {item["skill_id"] for item in SkillExtractor().extract_skills("Administered MySQL servers; wrote C# services.", limit=None)}
        self.assertTrue({"SK696", "SK698"} <= found)
        self.assertFalse({"SK004", "SK697"} & found)
        self.assertEqual(matching.compute_skill_coverage([], ["SK696"], "Wrote SQL queries daily.")["missing_skills"], ["MySQL"])
        self.assertEqual(matching.compute_skill_coverage(["NodeJS"], ["Node.js"])["missing_skills"], [])

    def test_candidates_and_exclusions_do_not_resolve(self):
        rows = read("skill_aliases.csv")
        verified = collections.defaultdict(set)
        for row in rows:
            if row["status"] == resolver.VERIFIED:
                verified[row["skill_id"]].add(resolver.compact(row["alias"]))
        for skill_id, label in self.vocabulary.labels.items():
            verified[skill_id].add(resolver.compact(label))
        for row in rows:
            if row["status"] in {resolver.CANDIDATE, resolver.EXCLUDED}:
                with self.subTest(alias=row["alias"]):
                    # It may spell a verified name of the skill ("health care" for
                    # "healthcare"), but it never resolves through its own row.
                    if self.vocabulary.resolve(row["alias"]) == row["skill_id"]:
                        self.assertIn(resolver.compact(row["alias"]), verified[row["skill_id"]])

    def test_unreviewed_skills_resolve_but_are_not_read_in_text(self):
        extractor = SkillExtractor()
        self.assertEqual(self.vocabulary.resolve("Statistics"), "SK127")
        self.assertFalse(self.vocabulary.is_active("SK127"))
        self.assertNotIn("SK127", {item["skill_id"] for item in extractor.extract_skills("BS Statistics, 2019.", limit=None)})
        # A confirmed unreviewed skill is still held and still meets a requirement for it.
        self.assertEqual(matching.compute_skill_coverage(["SK127"], ["SK127"])["missing_skills"], [])

    def test_one_normalisation_everywhere(self):
        # Matching and extraction share the vocabulary rules and normalisation.
        self.assertIs(matching.skill_vocabulary(), self.vocabulary)
        extractor = matching.get_weighted_skill_extractor()
        self.assertEqual(extractor.vocabulary.resolve_aliases, self.vocabulary.resolve_aliases)
        self.assertEqual(resolver.normalize("E-mail  Management"), "email management")
        self.assertNotEqual(resolver.normalize("C++"), resolver.normalize("C#"))

    def test_case_sensitive_spellings_resolve_names_but_not_running_text(self):
        self.assertEqual(self.vocabulary.resolve("React"), "SK678")
        self.assertNotIn("react", self.vocabulary.extract_aliases)
        self.assertEqual(self.vocabulary.resolve("JS"), "SK002")

    def test_approved_runtime_aliases_are_verified(self):
        extractor = SkillExtractor(extra_rows=[{"kind": "skill", "skill_id": "SK9001", "label": "Zapier Automation"},
                                               {"kind": "alias", "skill_id": "SK9001", "label": "Zapier"}])
        self.assertEqual(extractor.vocabulary.resolve("Zapier"), "SK9001")
        self.assertIn("SK9001", {item["skill_id"] for item in extractor.extract_skills("Built Zapier flows.", limit=None)})


class EscoLinkTests(unittest.TestCase):
    def test_reviewed_new_links_are_applied(self):
        skills = {row["skill_id"]: row for row in read("skills_reference.csv")}
        for skill_id, (uri, label) in refresh_esco_links.NEW_LINKS.items():
            with self.subTest(skill_id=skill_id):
                self.assertEqual(skills[skill_id]["esco_skill_uri"], uri)
                self.assertEqual(skills[skill_id]["esco_preferred_label"], label)
                self.assertEqual(skills[skill_id]["esco_version"], "v1.2.1")

    def test_every_linked_skill_records_v121(self):
        linked = [row for row in read("skills_reference.csv") if row["esco_skill_uri"].startswith("http")]
        self.assertEqual({row["esco_version"] for row in linked}, {"v1.2.1"})


class UnreviewedInventoryTests(unittest.TestCase):
    def test_live_counts_only_count_unreviewed_ids(self):
        tables = {
            "user_skills": [{"skill_id": "SK127"}, {"skill_id": "SK004"}, {"skill_id": "SK127"}],
            "match_history": [{"results_json": {"matched_skill_ids": ["SK127", "SK134"], "x": "SK127"}}],
        }

        def fetch(table, column):
            return [row[column] for row in tables.get(table, [])]

        counts = inventory.live_counts({"SK127", "SK134"}, fetch)
        self.assertEqual(counts["confirmed_skills"], collections.Counter({"SK127": 2}))
        self.assertEqual(counts["saved_matches"], collections.Counter({"SK127": 1, "SK134": 1}))
        self.assertEqual(counts["live_internal_jobs"], collections.Counter())

    def test_proposed_actions(self):
        counts = {"confirmed_skills": collections.Counter({"SK1": 1}), "reference_jobs": collections.Counter({"SK2": 1}),
                  "tests": collections.Counter({"SK3": 1})}
        self.assertTrue(inventory.proposed_action("SK1", "", counts).startswith("review_before_retiring"))
        self.assertTrue(inventory.proposed_action("SK2", "", counts).startswith("review"))
        self.assertTrue(inventory.proposed_action("SK4", "", counts).startswith("inactive_ok"))
        self.assertTrue(inventory.proposed_action("SK1", "SK9", counts).startswith("map_to_SK9"))


if __name__ == "__main__":
    unittest.main()


class EvaluationSetTests(unittest.TestCase):
    def test_gold_labels_name_real_skills_and_resources(self):
        from backend.evaluation import run_skill_resolution_eval as evaluation

        skills = {row["skill_id"] for row in read("skills_reference.csv")}
        resources = {row["resource_id"] for row in read("learning_resources.csv")}
        for name in ("requirements.csv", "lookalikes.csv"):
            for item in evaluation.read(name):
                self.assertIn(item["gold_skill_id"], skills | {"NONE"}, item)
        for item in evaluation.read("resume_mentions.csv"):
            self.assertLessEqual({value for value in item["gold_skill_ids"].split(";") if value}, skills, item)
        for item in evaluation.read("course_links.csv"):
            self.assertIn(item["resource_id"], resources, item)
            self.assertIn(item["gold_teaches"], {"yes", "no"}, item)


class SkillSearchTests(unittest.TestCase):
    """Step 2 skill search reads the same verified names as matching."""

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        from backend.app import main
        cls.client = TestClient(main.app)

    def search(self, q):
        response = self.client.get("/api/skills/search", params={"q": q, "limit": 5})
        self.assertEqual(response.status_code, 200)
        return [item["skill_id"] for item in response.json()["results"]]

    def test_the_route_answers_the_query(self):
        # The route was attached to a helper and did not accept "q".
        self.assertEqual(self.search("React")[0], "SK678")
        self.assertEqual(self.search("NodeJS")[0], "SK695")

    def test_unreviewed_labels_and_skills_are_not_offered(self):
        # An ESCO alternative label left as a candidate (a product under a broad concept).
        self.assertEqual(self.search("Gnumeric"), [])
        # SK127 Statistics is an unreviewed auto-expansion skill.
        self.assertNotIn("SK127", self.search("Statistics"))
