"""Checks the learning resource loader makes before pushing rows to Supabase."""
import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "load_learning_resources.py"
spec = importlib.util.spec_from_file_location("load_learning_resources", SCRIPT)
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class LearningResourceLoaderTests(unittest.TestCase):
    def write(self, rows):
        handle = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="", encoding="utf-8")
        self.addCleanup(Path(handle.name).unlink)
        writer = csv.DictWriter(handle, fieldnames=["resource_id", "course_or_certification_title", "provider_trust_score_auto",
                                                    "credential_type", "status", "not_a_column"])
        writer.writeheader()
        writer.writerows(rows)
        handle.close()
        return Path(handle.name)

    def test_the_bundled_catalog_is_valid_apart_from_untitled_rows(self):
        rows, problems, skipped = loader.read_rows(loader.CSV_PATH)
        self.assertEqual(problems, [])
        self.assertTrue(rows)
        self.assertTrue(all(row["course_or_certification_title"] for row in rows))
        self.assertEqual(len(rows) + len(skipped), sum(1 for _ in csv.DictReader(loader.CSV_PATH.open(encoding="utf-8"))))

    def test_rows_supabase_would_reject_are_reported(self):
        path = self.write([
            {"resource_id": "LR-1", "course_or_certification_title": "TESDA NC II", "provider_trust_score_auto": "88",
             "credential_type": "industry_certification", "status": "Active", "not_a_column": "x"},
            {"resource_id": "LR-2", "course_or_certification_title": "", "credential_type": "course"},
            {"resource_id": "LR-1", "course_or_certification_title": "Duplicate", "credential_type": "course"},
            {"resource_id": "LR-3", "course_or_certification_title": "Bad", "provider_trust_score_auto": "high",
             "credential_type": "diploma"},
            {"resource_id": "LR-4", "course_or_certification_title": "No type", "credential_type": ""},
        ])
        rows, problems, skipped = loader.read_rows(path)
        self.assertEqual(rows[0], {"resource_id": "LR-1", "course_or_certification_title": "TESDA NC II",
                                   "provider_trust_score_auto": 88.0, "credential_type": "industry_certification",
                                   "status": "Active"})
        self.assertEqual(skipped, ["line 3: LR-2 has no course_or_certification_title"])
        self.assertEqual(len(problems), 3)
        self.assertIn("appears twice", problems[0])
        # A blank credential type is left to the column default instead of null.
        self.assertNotIn("credential_type", rows[-1])


if __name__ == "__main__":
    unittest.main()
