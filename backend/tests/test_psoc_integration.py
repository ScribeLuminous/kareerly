"""PSA PSOC API client, the published last-known-good reference, and the ISCO-08 crosswalk.

Every API call here goes through a fixture opener; no test reaches the network.
"""
import argparse
import contextlib
import csv
import datetime as dt
import importlib.util
import io
import json
import logging
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from backend.app.services import psoc_reference

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_reference_data.py"
spec = importlib.util.spec_from_file_location("import_reference_data_psoc", SCRIPT)
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)

TOKEN = "test-token-7f3a9c"

RAW = {
    "major": [{"id": 1, "majorcode": 2, "title": "Professionals", "version": "2012"}],
    "sub-major": [{"id": 2, "submajorcode": 25, "title": "Information and Communications Technology Professionals", "version": "2012"}],
    "minor": [{"id": 3, "minorcode": 251, "title": "Software and Applications Developers and Analysts", "version": "2012"}],
    "unit": [{"id": 4, "unitcode": 2512, "title": "Software Developers", "version": "2012"},
             {"id": 5, "unitcode": 2519, "title": "Software and Applications Developers and Analysts Not Elsewhere Classified", "version": "2012"}],
}


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeApi:
    """Answers like the PSA API: one list per group, paginated by page_size."""

    def __init__(self, raw=RAW, failures=None):
        self.raw, self.failures, self.urls = raw, list(failures or []), []

    def __call__(self, request, timeout):
        url = request.full_url
        self.urls.append(url)
        if self.failures:
            failure = self.failures.pop(0)
            if isinstance(failure, int):
                raise urllib.error.HTTPError(url, failure, "error", {}, None)
            raise failure
        group = url.split("/2012/")[1].split("?")[0]
        page = int(url.split("page=")[1].split("&")[0])
        items = self.raw[group] if page == 1 else []
        return Response(json.dumps({"results": items, "next": None}).encode())


def no_sleep(_seconds):
    pass


class ClientTests(unittest.TestCase):
    def test_success_reads_every_group(self):
        api = FakeApi()
        items = ref.fetch_psoc_group("unit", TOKEN, opener=api, sleep=no_sleep)
        self.assertEqual([item["unitcode"] for item in items], [2512, 2519])
        self.assertTrue(all("timeout" not in url for url in api.urls))

    def test_server_errors_are_retried_a_bounded_number_of_times(self):
        api = FakeApi(failures=[503, urllib.error.URLError("down")])
        items = ref.fetch_psoc_group("unit", TOKEN, retries=2, opener=api, sleep=no_sleep)
        self.assertEqual(len(items), 2)
        self.assertEqual(len(api.urls), 3)

    def test_persistent_failure_raises_a_clear_error(self):
        api = FakeApi(failures=[500, 502, 503, 504])
        with self.assertRaises(ref.PsocApiError) as caught:
            ref.fetch_psoc_group("unit", TOKEN, retries=2, opener=api, sleep=no_sleep)
        self.assertEqual(len(api.urls), 3)
        self.assertIn("unavailable after 3 attempts", str(caught.exception))
        self.assertIn("HTTP 503", str(caught.exception))

    def test_timeouts_are_retried_then_reported(self):
        api = FakeApi(failures=[TimeoutError(), TimeoutError()])
        with self.assertRaises(ref.PsocApiError) as caught:
            ref.fetch_psoc_group("unit", TOKEN, retries=1, opener=api, sleep=no_sleep)
        self.assertIn("TimeoutError", str(caught.exception))

    def test_rejected_token_is_not_retried(self):
        api = FakeApi(failures=[401])
        with self.assertRaises(ref.PsocApiError) as caught:
            ref.fetch_psoc_group("unit", TOKEN, retries=3, opener=api, sleep=no_sleep)
        self.assertEqual(len(api.urls), 1)
        self.assertIn("check PSA_API_TOKEN", str(caught.exception))

    def test_unexpected_body_is_an_error(self):
        api = FakeApi(raw={"unit": {"detail": "Token is required."}})
        with self.assertRaises(ref.PsocApiError):
            ref.fetch_psoc_group("unit", TOKEN, opener=api, sleep=no_sleep)


class RedactionTests(unittest.TestCase):
    def test_redact_removes_the_query_value_and_the_token_itself(self):
        url = f"https://classification.psa.gov.ph/psoc/2012/unit?token={TOKEN}&page=1"
        self.assertNotIn(TOKEN, ref.redact(url))
        self.assertIn("token=[REDACTED]&page=1", ref.redact(url))
        self.assertNotIn(TOKEN, ref.redact(f"bad token {TOKEN}", TOKEN))

    def test_errors_never_carry_the_token(self):
        for failures in ([403], [500, 500, 500], [urllib.error.URLError(f"refused token={TOKEN}")] * 3):
            api = FakeApi(failures=failures)
            with self.subTest(failures=failures), self.assertRaises(ref.PsocApiError) as caught:
                ref.fetch_psoc_group("unit", TOKEN, retries=2, opener=api, sleep=no_sleep)
            self.assertNotIn(TOKEN, str(caught.exception))
            self.assertIn("[REDACTED]", str(caught.exception))
            # The original exception, whose URL has the token, is not chained into tracebacks.
            self.assertIsNone(caught.exception.__cause__)
            self.assertTrue(caught.exception.__suppress_context__)

    def test_command_output_never_carries_the_token(self):
        tmp = Path(tempfile.mkdtemp())
        args = argparse.Namespace(out_dir=tmp / "out", reference_dir=tmp / "ref", timeout=1.0, retries=0, publish=True)
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.dict("os.environ", {"PSA_API_TOKEN": TOKEN}), \
                mock.patch.object(ref.urllib.request, "urlopen", FakeApi(failures=[500] * 10)), \
                self.assertLogs(level=logging.DEBUG) as logs, \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            logging.getLogger("psoc-test").debug("start")
            code = ref.command_psoc(args)
        self.assertEqual(code, 2)
        self.assertNotIn(TOKEN, stdout.getvalue() + stderr.getvalue() + "\n".join(logs.output))
        self.assertIn("unchanged", stderr.getvalue())


class ValidationTests(unittest.TestCase):
    def test_clean_records_have_no_problems(self):
        self.assertEqual(ref.validate_psoc(RAW), [])

    def test_invalid_codes_are_reported_not_corrected(self):
        raw = {**RAW, "unit": RAW["unit"] + [
            {"unitcode": "25A1", "title": "Bad", "version": "2012"},
            {"unitcode": 25123, "title": "Too long", "version": "2012"},
            {"unitcode": 3999, "title": "", "version": "2012"},
            {"unitcode": 2512, "title": "Software Developers again", "version": "2012"},
            {"unitcode": 2411, "title": "Accountants", "version": "2022"},
        ]}
        problems = {(p["psoc_code"], p["problem"]) for p in ref.validate_psoc(raw)}
        self.assertIn(("25A1", "invalid_code"), problems)
        self.assertIn(("25123", "invalid_code"), problems)
        self.assertIn(("3999", "missing_title"), problems)
        self.assertIn(("3999", "missing_parent"), problems)
        self.assertIn(("2512", "duplicate_code"), problems)
        self.assertIn(("2411", "other_version"), problems)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.args = argparse.Namespace(out_dir=self.tmp / "out", reference_dir=self.tmp / "ref", timeout=1.0, retries=0, publish=True)
        psoc_reference.load_reference.cache_clear()

    def run_command(self, api):
        with mock.patch.dict("os.environ", {"PSA_API_TOKEN": TOKEN}), \
                mock.patch.object(ref, "REFERENCE_DIR", self.tmp / "raw"), \
                mock.patch.object(ref.urllib.request, "urlopen", api), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return ref.command_psoc(self.args)

    def test_publish_writes_a_token_free_reference_with_provenance(self):
        self.assertEqual(self.run_command(FakeApi()), 0)
        meta = json.loads((self.args.reference_dir / ref.PSOC_META_FILE).read_text())
        self.assertEqual(meta["version"], "2012")
        self.assertEqual(meta["rows"], 5)
        self.assertTrue(meta["retrieved_at"])
        for path in [*self.args.reference_dir.iterdir(), *self.args.out_dir.iterdir(), *(self.tmp / "raw").rglob("*.json")]:
            self.assertNotIn(TOKEN, path.read_text(), path)
        status = psoc_reference.reference_status(self.args.reference_dir)
        self.assertTrue(status["available"])
        self.assertFalse(status["stale"])

    def test_api_failure_keeps_the_last_known_good_reference(self):
        self.assertEqual(self.run_command(FakeApi()), 0)
        before = (self.args.reference_dir / ref.PSOC_GROUPS_FILE).read_bytes()
        self.assertEqual(self.run_command(FakeApi(failures=[500] * 10)), 2)
        self.assertEqual((self.args.reference_dir / ref.PSOC_GROUPS_FILE).read_bytes(), before)

    def test_invalid_records_are_not_published(self):
        self.assertEqual(self.run_command(FakeApi()), 0)
        before = (self.args.reference_dir / ref.PSOC_GROUPS_FILE).read_bytes()
        broken = {**RAW, "unit": RAW["unit"] + [{"unitcode": "12X4", "title": "Bad", "version": "2012"}]}
        self.assertEqual(self.run_command(FakeApi(raw=broken)), 3)
        self.assertEqual((self.args.reference_dir / ref.PSOC_GROUPS_FILE).read_bytes(), before)
        with (self.args.out_dir / "psoc_validation.csv").open() as handle:
            self.assertEqual([row["psoc_code"] for row in csv.DictReader(handle)], ["12X4"])


class ReferenceServiceTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        rows = ref.parse_psoc(RAW)
        ref.publish_psoc_reference(rows, "0" * 64, dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc), self.dir)
        psoc_reference.load_reference.cache_clear()

    def tearDown(self):
        psoc_reference.load_reference.cache_clear()

    def test_stale_reference_is_flagged_but_still_used(self):
        status = psoc_reference.reference_status(self.dir, now=dt.datetime(2027, 6, 1, tzinfo=dt.timezone.utc))
        self.assertTrue(status["available"])
        self.assertTrue(status["stale"])
        self.assertGreater(status["age_days"], 365)
        self.assertTrue(psoc_reference.validate_occupation_code("2512", self.dir)["valid"])

    def test_missing_reference_is_reported_without_network(self):
        empty = Path(tempfile.mkdtemp())
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("network used")):
            self.assertFalse(psoc_reference.reference_status(empty)["available"])
            self.assertEqual(psoc_reference.validate_occupation_code("2512", empty)["reason"], "reference_unavailable")

    def test_occupation_codes(self):
        self.assertEqual(psoc_reference.validate_occupation_code(2512, self.dir)["title"], "Software Developers")
        self.assertEqual(psoc_reference.validate_occupation_code("251", self.dir)["level"], "minor")
        self.assertEqual(psoc_reference.validate_occupation_code("9999", self.dir)["reason"], "unknown_code")
        self.assertEqual(psoc_reference.validate_occupation_code("SK004", self.dir)["reason"], "not_a_psoc_code")
        self.assertEqual(psoc_reference.validate_occupation_code("12345", self.dir)["reason"], "not_a_psoc_code")


class CompareTests(unittest.TestCase):
    def test_discrepancies_are_listed_and_nothing_is_rewritten(self):
        reference = ref.parse_psoc({**RAW, "unit": RAW["unit"] + [{"unitcode": 110, "title": "Commissioned Armed Forces Officers", "version": "2012"}]})
        before = [dict(row) for row in reference]
        other = [
            {"code": "2512", "title": "Software Developers", "level": ""},
            {"code": "2519", "title": "Web and Multimedia Developers", "level": ""},
            {"code": "110", "title": "Commissioned Armed Forces Officers", "level": "unit"},
            {"code": "2434", "title": "ICT Sales Professionals", "level": ""},
            {"code": "251", "title": "Software and Applications Developers and Analysts", "level": "unit group"},
        ]
        found = {(row["psoc_code"] or row["other_code"], row["discrepancy"]) for row in ref.compare_psoc(reference, other)}
        self.assertIn(("2519", "title_differs"), found)
        self.assertIn(("0110", "code_format"), found)
        self.assertIn(("2434", "missing_in_reference"), found)
        self.assertIn(("2", "missing_in_other"), found)
        self.assertNotIn(("2512", "title_differs"), found)
        self.assertEqual(reference, before)

    def test_compare_reads_csv_with_configurable_columns(self):
        path = Path(tempfile.mkdtemp()) / "updates.csv"
        path.write_text("PSOC Code,Occupation Title\n2512.0,Software Developers\n", encoding="utf-8")
        self.assertEqual(ref.load_code_table(path, "PSOC Code", "Occupation Title"),
                         [{"code": "2512", "title": "Software Developers", "level": ""}])
        with self.assertRaises(SystemExit):
            ref.load_code_table(path, "Code", "Occupation Title")


class CrosswalkTests(unittest.TestCase):
    ISCO = {"2512": "Software developers", "2519": "Software and applications developers and analysts not elsewhere classified",
            "4120": "Secretaries (general)", "251": "Software and applications developers and analysts"}

    def test_statuses(self):
        psoc = [
            {"psoc_code": "2512", "title": "Software Developers", "level": "unit"},
            {"psoc_code": "4120", "title": "Barangay Health Workers", "level": "unit"},
            {"psoc_code": "5419", "title": "Tanod and Other Protective Service Workers", "level": "unit"},
        ]
        by_code = {row["psoc_code"]: row for row in ref.classify_crosswalk(psoc, self.ISCO)}
        self.assertEqual(by_code["2512"]["status"], "isco_match")
        self.assertEqual(by_code["4120"]["status"], "ambiguous")
        self.assertEqual(by_code["5419"]["status"], "philippine_specific")
        self.assertEqual({row["review_status"] for row in by_code.values()}, {"proposed"})

    def test_only_agreed_units_get_esco_occupation_proposals(self):
        psoc = [{"psoc_code": "2512", "title": "Software Developers", "level": "unit"},
                {"psoc_code": "4120", "title": "Barangay Health Workers", "level": "unit"}]
        occupations = [{"concept_uri": "dev", "isco_group": "2512", "preferred_label": "software developer"},
                       {"concept_uri": "secretary", "isco_group": "4120", "preferred_label": "secretary"}]
        crosswalk = ref.classify_crosswalk(psoc, self.ISCO)
        links = ref.propose_occupation_links(psoc, occupations, with_similarity=False, crosswalk=crosswalk)
        self.assertEqual([link["occupation_uri"] for link in links], ["dev"])
        self.assertEqual(links[0]["review_status"], "proposed")
        # Without a crosswalk the old behaviour (same code only) is unchanged.
        self.assertEqual(len(ref.propose_occupation_links(psoc, occupations, with_similarity=False)), 2)

    def test_crosswalk_is_exposed_read_only(self):
        directory = Path(tempfile.mkdtemp())
        rows = ref.parse_psoc(RAW)
        ref.publish_psoc_reference(rows, "0" * 64, dt.datetime.now(dt.timezone.utc), directory)
        ref._write_csv(directory / ref.PSOC_CROSSWALK_FILE, ref.CROSSWALK_COLUMNS, ref.classify_crosswalk(rows, self.ISCO))
        psoc_reference.load_reference.cache_clear()
        try:
            self.assertEqual(psoc_reference.validate_occupation_code("2512", directory)["crosswalk_status"], "isco_match")
            self.assertEqual(psoc_reference.isco_crosswalk("2", directory)["status"], "philippine_specific")
        finally:
            psoc_reference.load_reference.cache_clear()


class NoRuntimeNetworkTests(unittest.TestCase):
    def test_runtime_code_never_imports_the_api_client(self):
        app = Path(__file__).resolve().parents[1] / "app"
        for path in app.rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("classification.psa.gov.ph", text, path)
            self.assertNotIn("PSA_API_TOKEN", text, path)


if __name__ == "__main__":
    unittest.main()
