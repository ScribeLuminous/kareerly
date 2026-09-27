"""PSOC and ESCO reference import: parsing, provenance, and link proposals."""
import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_reference_data.py"
spec = importlib.util.spec_from_file_location("import_reference_data", SCRIPT)
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)

PSOC_RAW = {
    "major": [{"id": 1, "majorcode": 2, "title": "PROFESSIONALS", "description": "Professionals ...", "version": "2012"},
              {"id": 9, "majorcode": 0, "title": "ARMED FORCES OCCUPATIONS", "description": "", "version": "2012"}],
    "sub-major": [{"id": 2, "submajorcode": 25, "title": "Information and Communications Technology Professionals", "version": "2012"}],
    "minor": [{"id": 3, "minorcode": "251", "title": "Software and Applications Developers and Analysts", "version": "2012"}],
    "unit": [{"id": 4, "unitcode": 2512, "title": "Software Developers", "description": "Software developers research ...", "version": "2012"},
             {"id": 5, "unitcode": 110, "title": "Commissioned Armed Forces Officers", "version": "2012"},
             {"id": 6, "unitcode": 4120, "title": "Secretaries (General)", "version": "2012"}],
}


def write_csv(path, rows):
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


class ReferenceImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        esco = self.tmp / "esco"
        esco.mkdir()
        write_csv(esco / "skills_en.csv", [
            {"conceptType": "KnowledgeSkillCompetence", "conceptUri": "http://data.europa.eu/esco/skill/python", "skillType": "knowledge",
             "reuseLevel": "cross-sector", "preferredLabel": "Python (computer programming)", "altLabels": "Python\npython programming", "description": "Python language."},
            {"conceptType": "KnowledgeSkillCompetence", "conceptUri": "http://data.europa.eu/esco/skill/calendar", "skillType": "skill/competence",
             "reuseLevel": "transversal", "preferredLabel": "manage schedule of tasks", "altLabels": "calendar management", "description": ""},
        ])
        write_csv(esco / "occupations_en.csv", [
            {"conceptType": "Occupation", "conceptUri": "http://data.europa.eu/esco/occupation/dev", "iscoGroup": "2512",
             "preferredLabel": "software developer", "altLabels": "programmer", "code": "2512.4", "description": "Develops software."},
            {"conceptType": "Occupation", "conceptUri": "http://data.europa.eu/esco/occupation/ea", "iscoGroup": "4120",
             "preferredLabel": "executive assistant", "altLabels": "", "code": "4120.1", "description": "Supports executives."},
            {"conceptType": "Occupation", "conceptUri": "http://data.europa.eu/esco/occupation/other", "iscoGroup": "9999",
             "preferredLabel": "not in PSOC", "altLabels": "", "code": "9999.1", "description": ""},
        ])
        write_csv(esco / "occupationSkillRelations_en.csv", [
            {"occupationUri": "http://data.europa.eu/esco/occupation/dev", "relationType": "essential", "skillType": "knowledge", "skillUri": "http://data.europa.eu/esco/skill/python"},
            {"occupationUri": "http://data.europa.eu/esco/occupation/ea", "relationType": "optional", "skillType": "skill/competence", "skillUri": "http://data.europa.eu/esco/skill/calendar"},
            {"occupationUri": "http://data.europa.eu/esco/occupation/ea", "relationType": "essential", "skillType": "skill/competence", "skillUri": "http://data.europa.eu/esco/skill/calendar"},
            {"occupationUri": "http://data.europa.eu/esco/occupation/dev", "relationType": "essential", "skillType": "knowledge", "skillUri": "http://data.europa.eu/esco/skill/missing"},
        ])
        self.esco_dir = esco

    def test_psoc_codes_keep_hierarchy_and_leading_zeros(self):
        rows = {row["psoc_code"]: row for row in ref.parse_psoc(PSOC_RAW)}
        self.assertEqual(rows["2512"]["level"], "unit")
        self.assertEqual(rows["2512"]["parent_code"], "251")
        self.assertEqual(rows["251"]["parent_code"], "25")
        self.assertEqual(rows["25"]["parent_code"], "2")
        self.assertIn("0110", rows)  # armed forces unit returned as the number 110
        self.assertEqual(rows["0110"]["parent_code"], "")  # its parent 011 was not in the sample
        self.assertEqual(rows["2"]["title"], "PROFESSIONALS")  # source text is kept as published

    def test_psoc_response_shapes(self):
        self.assertEqual(ref._psoc_items([{"a": 1}]), ([{"a": 1}], False))
        self.assertEqual(ref._psoc_items({"results": [{"a": 1}], "next": "url"}), ([{"a": 1}], True))
        with self.assertRaises(ValueError):
            ref._psoc_items({"error": "Token is required."})

    def test_esco_relations_keep_known_pairs_and_the_stronger_relation(self):
        skills, occupations, relations, skipped = ref.parse_esco(self.esco_dir, "esco-test")
        self.assertEqual(len(skills), 2)
        self.assertEqual(len(occupations), 3)
        by_pair = {(r["occupation_uri"], r["skill_uri"]): r["relation_type"] for r in relations}
        self.assertEqual(by_pair[("http://data.europa.eu/esco/occupation/ea", "http://data.europa.eu/esco/skill/calendar")], "essential")
        self.assertEqual(len(relations), 2)
        self.assertEqual(skipped, {"unknown occupation or skill": 1})

    def test_repeated_esco_concepts_keep_the_newest_row(self):
        path = self.esco_dir / "skills_en.csv"
        rows = list(csv.DictReader(path.open(encoding="utf-8")))
        rows.append({**rows[0], "preferredLabel": "Python (newer)", "modifiedDate": "2025-11-26T10:07:57Z"})
        rows[0]["modifiedDate"] = "2025-07-31T09:41:33Z"
        write_csv(path, rows)
        skills, _, _, _ = ref.parse_esco(self.esco_dir, "esco-test")
        self.assertEqual(len(skills), 2)
        self.assertEqual({s["preferred_label"] for s in skills} & {"Python (newer)", "Python (computer programming)"}, {"Python (newer)"})

    def test_occupation_links_join_on_isco_code_and_start_proposed(self):
        _, occupations, _, _ = ref.parse_esco(self.esco_dir, "esco-test")
        links = ref.propose_occupation_links(ref.parse_psoc(PSOC_RAW), occupations, with_similarity=False)
        self.assertEqual({(l["psoc_code"], l["occupation_uri"].rsplit("/", 1)[-1]) for l in links}, {("2512", "dev"), ("4120", "ea")})
        self.assertTrue(all(l["review_status"] == "proposed" and l["method"] == "isco_code_match" for l in links))

    def test_skill_links_prefer_existing_uri_then_exact_label(self):
        skills, _, _, _ = ref.parse_esco(self.esco_dir, "esco-test")
        reference = [
            {"skill_id": "SK134", "skill_name": "Python (computer programming)", "esco_skill_uri": "http://data.europa.eu/esco/skill/python", "mapping_status": "mapped", "mapping_confidence": "0.98"},
            {"skill_id": "SK900", "skill_name": "Manage schedule of tasks", "esco_skill_uri": ""},
            {"skill_id": "SK901", "skill_name": "Canva", "esco_skill_uri": ""},
            {"skill_id": "SK902", "skill_name": "Old", "esco_skill_uri": "http://data.europa.eu/esco/skill/retired"},
            # Only an alternative label of "manage schedule of tasks": not proposed.
            {"skill_id": "SK903", "skill_name": "Calendar Management", "esco_skill_uri": ""},
        ]
        links, outcome = ref.propose_skill_links(reference, skills)
        by_id = {l["skill_id"]: l for l in links}
        self.assertEqual(by_id["SK134"]["method"], "taxonomy_esco_uri")
        self.assertEqual(by_id["SK134"]["review_status"], "reviewed")
        self.assertEqual(by_id["SK900"]["method"], "exact_label")
        self.assertEqual(by_id["SK900"]["review_status"], "proposed")
        self.assertEqual(by_id["SK900"]["skill_uri"], "http://data.europa.eu/esco/skill/calendar")
        self.assertNotIn("SK901", by_id)
        self.assertNotIn("SK903", by_id)
        self.assertEqual(outcome["ESCO URI not in this ESCO version"], 1)

    def test_load_sql_never_overwrites_review_decisions(self):
        ref.write_table(self.tmp, "psoc_esco_occupation_links", [])
        ref.write_table(self.tmp, "kareerly_skill_esco_links", [])
        sql = ref.write_load_sql(self.tmp).read_text()
        link_insert = sql.split("insert into public.kareerly_skill_esco_links")[1].split(";")[0]
        self.assertIn("evidence = excluded.evidence", link_insert)
        self.assertNotIn("review_status = excluded", link_insert)

    def test_esco_zip_is_read_without_macos_copies_and_duplicates(self):
        import zipfile
        archive = self.tmp / "esco.zip"
        with zipfile.ZipFile(archive, "w") as handle:
            for path in self.esco_dir.iterdir():
                handle.write(path, path.name)
                handle.writestr(f"__MACOSX/._{path.name}", b"\x00\x05\x16\x07 not a csv")
        directory = ref._esco_directory(archive)
        self.assertFalse(any("__MACOSX" in str(path) for path in directory.rglob("*")))
        skills, occupations, relations, _ = ref.parse_esco(directory, "esco-test")
        self.assertEqual(len(skills), 2)
        self.assertEqual(len(occupations), 3)

    def test_sql_editor_files_upsert_in_load_order_and_keep_reviews(self):
        skills, occupations, relations, _ = ref.parse_esco(self.esco_dir, "esco-test")
        ref.write_table(self.tmp, "reference_datasets", [{"dataset_id": "esco-test", "name": "ESCO", "version": "test"}])
        ref.write_table(self.tmp, "esco_skills", skills)
        ref.write_table(self.tmp, "esco_occupations", occupations)
        ref.write_table(self.tmp, "esco_occupation_skills", relations)
        ref.write_table(self.tmp, "kareerly_skill_esco_links", [
            {"skill_id": "SK1", "skill_uri": skills[0]["concept_uri"], "method": "manual", "evidence": "O'Brien's note", "review_status": "reviewed"}])
        files = ref.write_sql_editor_files(self.tmp, max_bytes=200)
        names = [path.name for path in files]
        self.assertEqual(names, sorted(names))
        tables = [name.split("_", 1)[1].rsplit("_", 1)[0] for name in names]
        self.assertEqual(tables, sorted(tables, key=ref.LOAD_ORDER.index))
        self.assertGreater(tables.count("esco_skills"), 1)
        link_sql = files[-1].read_text()
        self.assertIn("'O''Brien''s note'", link_sql)
        self.assertIn("on conflict (skill_id, skill_uri) do update set", link_sql)
        self.assertNotIn("review_status = excluded", link_sql)
        self.assertTrue(all(path.read_text().rstrip().endswith("commit;") for path in files))


if __name__ == "__main__":
    unittest.main()
