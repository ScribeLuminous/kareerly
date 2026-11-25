"""Build Kareerly's occupation and skill reference data from PSOC and ESCO.

PSOC (PSA) classifies occupations; ESCO describes skills and which skills each
occupation needs. PSOC 2012 follows ISCO-08, and every ESCO occupation carries
its ISCO-08 unit group, so a PSOC unit links to ESCO occupations, and through
them to skills, with the shared code as evidence.

    python3 scripts/import_reference_data.py psoc
        Downloads all PSOC 2012 groups from the PSA API (token: PSA_API_TOKEN in
        backend/.env) and keeps the raw responses for provenance.

        Add --publish to replace the last-known-good reference in data/psoc/
        that the backend reads; nothing is published when the records fail
        validation or the API cannot be read. The backend never calls the API.

    python3 scripts/import_reference_data.py psoc-compare --against <file> --code-column C --title-column T
    python3 scripts/import_reference_data.py psoc-check
        Report differences between the reference and another list (the PSA 2022
        updates, stored psoc_groups) or skills_reference.csv. Nothing is rewritten.

    python3 scripts/import_reference_data.py psoc-crosswalk --isco <ESCO ISCOGroups_en.csv>
        Classify each PSOC group against ISCO-08: isco_match, ambiguous or
        philippine_specific. link then proposes ESCO occupations for isco_match
        units only.

    python3 scripts/import_reference_data.py esco --dir <ESCO CSV zip or folder> --version v1.2.1
        Reads the English ESCO CSV download (skills_en.csv, occupations_en.csv,
        occupationSkillRelations_en.csv). A zip is read directly; macOS
        __MACOSX copies are skipped; a concept listed twice keeps the row with
        the latest modifiedDate.

    python3 scripts/import_reference_data.py link
        Proposes PSOC unit -> ESCO occupation links (same ISCO-08 code) and
        Kareerly SK skill -> ESCO skill links (the URI already in
        skills_reference.csv, or an exact label match). All links start as
        'proposed'; only a reviewer marks them 'reviewed'.

Each step writes table-shaped CSVs to data/corpus/reference/import/, and link
also writes load.sql (for psql) and sql_editor/NN_<table>.sql (to paste into
the Supabase SQL Editor, in order), which upsert every CSV into the tables
created by supabase/migrations/20260918090000_occupation_skill_reference.sql.
Re-running them is safe: rows are inserted or updated, and a reviewer's
decision on a link is never overwritten. Nothing is written to Supabase by
this script.
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable, Iterable

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

REFERENCE_DIR = BACKEND_DIR / "data" / "corpus" / "reference"
OUT_DIR = REFERENCE_DIR / "import"
SKILLS_REFERENCE_PATH = BACKEND_DIR / "data" / "skills_reference.csv"

PSOC_BASE = "https://classification.psa.gov.ph/psoc"
PSOC_VERSION = "2012"
PSOC_DATASET = f"psoc-{PSOC_VERSION}"
# Level -> (API group, code field, code length). Codes are zero-padded because the
# API may return them as numbers, and armed forces codes start with 0.
PSOC_LEVELS = {
    "major": ("major", "majorcode", 1),
    "sub_major": ("sub-major", "submajorcode", 2),
    "minor": ("minor", "minorcode", 3),
    "unit": ("unit", "unitcode", 4),
}
PAGE_SIZE = 500
# The last-known-good reference the backend reads; see app/services/psoc_reference.py.
PSOC_REFERENCE_DIR = BACKEND_DIR / "data" / "psoc"
PSOC_GROUPS_FILE = f"psoc_{PSOC_VERSION}_groups.csv"
PSOC_META_FILE = "psoc_reference_meta.json"
PSOC_CROSSWALK_FILE = "psoc_isco_crosswalk.csv"

TABLE_COLUMNS = {
    "reference_datasets": ["dataset_id", "name", "version", "source_url", "retrieved_at", "source_sha256", "license_note", "notes"],
    "psoc_groups": ["psoc_code", "level", "title", "description", "parent_code", "dataset_id"],
    "esco_occupations": ["concept_uri", "preferred_label", "alt_labels", "isco_group", "esco_code", "description", "dataset_id"],
    "esco_skills": ["concept_uri", "preferred_label", "alt_labels", "skill_type", "reuse_level", "description", "dataset_id"],
    "esco_occupation_skills": ["occupation_uri", "skill_uri", "relation_type", "dataset_id"],
    "psoc_esco_occupation_links": ["psoc_code", "occupation_uri", "method", "evidence", "title_similarity", "review_status"],
    "kareerly_skill_esco_links": ["skill_id", "skill_uri", "method", "evidence", "confidence", "review_status"],
}
PRIMARY_KEYS = {
    "reference_datasets": ["dataset_id"],
    "psoc_groups": ["psoc_code"],
    "esco_occupations": ["concept_uri"],
    "esco_skills": ["concept_uri"],
    "esco_occupation_skills": ["occupation_uri", "skill_uri"],
    "psoc_esco_occupation_links": ["psoc_code", "occupation_uri"],
    "kareerly_skill_esco_links": ["skill_id", "skill_uri"],
}
LOAD_ORDER = list(TABLE_COLUMNS)
# skills_reference.csv mapping statuses that record a person's review of the ESCO link.
REVIEWED_LINK_STATUSES = {"reviewed", "mapped"}
# Largest SQL Editor file; the editor rejects very large pastes.
SQL_EDITOR_MAX_BYTES = 900_000
# A re-import refreshes the evidence but never overwrites a reviewer's decision.
REVIEW_COLUMNS = {"review_status", "reviewer", "reviewed_at"}


def clean(value: Any) -> str:
    return re.sub(r"[ \t]+", " ", str(value or "")).strip()


def normalize_label(value: str) -> str:
    value = value.lower().replace("’", "'")
    value = re.sub(r"[^a-z0-9+#.'\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def write_table(out_dir: Path, table: str, rows: Iterable[dict[str, Any]]) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    columns = TABLE_COLUMNS[table]
    count = 0
    with (out_dir / f"{table}.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in columns})
            count += 1
    return count


def read_table(out_dir: Path, table: str) -> list[dict[str, str]]:
    path = out_dir / f"{table}.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def upsert_dataset(out_dir: Path, dataset: dict[str, Any]) -> None:
    rows = {row["dataset_id"]: row for row in read_table(out_dir, "reference_datasets")}
    rows[dataset["dataset_id"]] = dataset
    write_table(out_dir, "reference_datasets", sorted(rows.values(), key=lambda row: row["dataset_id"]))


# ---------------------------------------------------------------- PSOC


def _psoc_token() -> str:
    token = os.getenv("PSA_API_TOKEN", "").strip()
    env_path = BACKEND_DIR / ".env"
    if not token and env_path.exists():
        # Read .env directly so this step also runs on a Python without python-dotenv.
        for line in env_path.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "PSA_API_TOKEN":
                token = value.strip().strip("'\"")
    if not token:
        raise SystemExit("! Set PSA_API_TOKEN in backend/.env (never commit it).")
    return token


class PsocApiError(RuntimeError):
    """The PSA API could not be read. The message never contains the token."""


class PsocResponseError(PsocApiError, ValueError):
    """The PSA API answered, but not with the expected JSON shape."""


_TOKEN_IN_TEXT = re.compile(r"(token=)[^&\s'\"]+", re.IGNORECASE)


def redact(text: Any, token: str = "") -> str:
    """Text safe to print or log: the token query value and the token itself are removed."""
    value = _TOKEN_IN_TEXT.sub(r"\1[REDACTED]", str(text))
    return value.replace(token, "[REDACTED]") if token else value


def _psoc_items(body: Any) -> tuple[list[dict[str, Any]], bool]:
    """Items in one API response, and whether the response says more pages exist."""
    if isinstance(body, list):
        return body, False
    if isinstance(body, dict):
        for key in ("results", "data", "items"):
            if isinstance(body.get(key), list):
                return body[key], bool(body.get("next"))
    raise PsocResponseError(f"Unexpected PSOC response shape: {redact(str(body)[:200])}")


PSOC_TIMEOUT_SECONDS = 30.0
PSOC_RETRIES = 2  # after the first attempt; 4xx answers other than 429 are not retried


def _get_json(url: str, token: str, *, timeout: float, retries: int, backoff: float,
              opener: Callable[..., Any] | None = None, sleep: Callable[[float], None] = time.sleep) -> Any:
    opener = opener or urllib.request.urlopen
    safe_url = redact(url, token)
    last = ""
    for attempt in range(retries + 1):
        request = urllib.request.Request(url, headers={"User-Agent": "Kareerly reference import"})
        try:
            with opener(request, timeout=timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if 400 <= error.code < 500 and error.code != 429:
                hint = " (check PSA_API_TOKEN)" if error.code in (401, 403) else ""
                raise PsocApiError(f"PSA API answered HTTP {error.code} for {safe_url}{hint}") from None
            last = f"HTTP {error.code}"
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = type(error).__name__
        except json.JSONDecodeError:
            last = "invalid JSON"
        if attempt < retries:
            sleep(backoff * (2 ** attempt))
    raise PsocApiError(f"PSA API unavailable after {retries + 1} attempts ({last}) for {safe_url}") from None


def fetch_psoc_group(group: str, token: str, pause: float = 0.5, *, timeout: float = PSOC_TIMEOUT_SECONDS,
                     retries: int = PSOC_RETRIES, opener: Callable[..., Any] | None = None,
                     sleep: Callable[[float], None] = time.sleep) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen_ids: set[Any] = set()
    for page in range(1, 1000):
        query = urllib.parse.urlencode({"token": token, "page": page, "page_size": PAGE_SIZE})
        url = f"{PSOC_BASE}/{PSOC_VERSION}/{group}?{query}"
        batch, has_next = _psoc_items(_get_json(url, token, timeout=timeout, retries=retries, backoff=max(pause, 0.1),
                                                opener=opener, sleep=sleep))
        fresh = [item for item in batch if item.get("id", json.dumps(item, sort_keys=True)) not in seen_ids]
        seen_ids.update(item.get("id", json.dumps(item, sort_keys=True)) for item in fresh)
        items.extend(fresh)
        # Unpaginated endpoints return the same list for every page, so stop on no new items.
        if not fresh or (not has_next and len(batch) < PAGE_SIZE):
            break
        sleep(pause)
    return items


def parse_psoc(raw: dict[str, list[dict[str, Any]]]) -> list[dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    for level, (group, code_field, width) in PSOC_LEVELS.items():
        for item in raw.get(group, []):
            if str(item.get("version", PSOC_VERSION)) != PSOC_VERSION:
                continue
            code_value = item.get(code_field)
            if code_value in (None, ""):
                continue
            code = str(code_value).strip().split(".")[0].zfill(width)
            rows[code] = {
                "psoc_code": code,
                "level": level,
                "title": clean(item.get("title")),
                "description": "\n".join(line.strip() for line in clean(item.get("description")).splitlines()),
                "parent_code": code[:-1] if width > 1 else "",
                "dataset_id": PSOC_DATASET,
            }
    for row in rows.values():
        # The table's foreign key needs an existing parent; validate_psoc reports
        # every orphan so it is reviewed rather than silently accepted.
        if row["parent_code"] and row["parent_code"] not in rows:
            row["parent_code"] = ""
    return sorted(rows.values(), key=lambda row: (len(row["psoc_code"]), row["psoc_code"]))


def validate_psoc(raw: dict[str, list[dict[str, Any]]]) -> list[dict[str, str]]:
    """Problems in raw API records, one row each. An empty list means the download is usable.

    Nothing is corrected here: a code with the wrong length, a missing title,
    a group whose parent is absent, a duplicate code or another version is
    reported for review.
    """
    problems: list[dict[str, str]] = []
    seen: dict[str, str] = {}
    widths = {level: width for level, (_, _, width) in PSOC_LEVELS.items()}

    def report(level: str, code: str, problem: str, detail: str = "") -> None:
        problems.append({"level": level, "psoc_code": code, "problem": problem, "detail": detail})

    for level, (group, code_field, width) in PSOC_LEVELS.items():
        for item in raw.get(group, []):
            if str(item.get("version", PSOC_VERSION)) != PSOC_VERSION:
                report(level, str(item.get(code_field, "")), "other_version", str(item.get("version")))
                continue
            raw_value = item.get(code_field)
            value = "" if raw_value is None else str(raw_value).strip().split(".")[0]
            if not value.isdigit():
                report(level, value, "invalid_code", f"{code_field} is not a number")
                continue
            if len(value) > width:
                report(level, value, "invalid_code", f"longer than {width} digits for a {level} group")
                continue
            code = value.zfill(width)
            if not clean(item.get("title")):
                report(level, code, "missing_title")
            if code in seen:
                report(level, code, "duplicate_code", f"also a {seen[code]} group")
            seen[code] = level
    for code, level in seen.items():
        if widths[level] > 1 and code[:-1] not in seen:
            report(level, code, "missing_parent", f"no group {code[:-1]}")
    return problems


def _write_csv(path: Path, columns: list[str], rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in columns})
            count += 1
    return count


PSOC_PROBLEM_COLUMNS = ["level", "psoc_code", "problem", "detail"]


def publish_psoc_reference(rows: list[dict[str, str]], raw_sha256: str, retrieved: dt.datetime,
                           reference_dir: Path = PSOC_REFERENCE_DIR) -> Path:
    """Replace the last-known-good reference the backend reads (no network at runtime).

    Both files are written beside the old ones and swapped in only when complete,
    so a failed run leaves the previous reference in place.
    """
    reference_dir.mkdir(parents=True, exist_ok=True)
    groups = reference_dir / PSOC_GROUPS_FILE
    meta_path = reference_dir / PSOC_META_FILE
    staged_groups = groups.with_suffix(".csv.tmp")
    count = _write_csv(staged_groups, ["psoc_code", "level", "title", "description", "parent_code"], rows)
    meta = {
        "classification": "PSOC",
        "version": PSOC_VERSION,
        "source": "PSA Classifications API",
        # The token is a query parameter of every request; it is never stored.
        "source_url": f"{PSOC_BASE}/{PSOC_VERSION}/{{major,sub-major,minor,unit}}",
        "retrieved_at": retrieved.isoformat(timespec="seconds"),
        "raw_sha256": raw_sha256,
        "groups_sha256": hashlib.sha256(staged_groups.read_bytes()).hexdigest(),
        "rows": count,
        "levels": dict(collections.Counter(row["level"] for row in rows)),
        "notes": "PSOC 2012 as served by the API. The PSA 2022 updates are not applied here; compare them with psoc-compare.",
    }
    staged_meta = meta_path.with_suffix(".json.tmp")
    staged_meta.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    staged_groups.replace(groups)
    staged_meta.replace(meta_path)
    return groups


def command_psoc(args: argparse.Namespace) -> int:
    token = _psoc_token()
    raw = {}
    try:
        for level, (group, _, _) in PSOC_LEVELS.items():
            raw[group] = fetch_psoc_group(group, token, timeout=args.timeout, retries=args.retries)
            print(f"  {group}: {len(raw[group])} items")
    except PsocApiError as error:
        # The message is already redacted; redact again in case a caller changed it.
        print(f"! {redact(error, token)}", file=sys.stderr)
        print("! Nothing was written; the published reference in data/psoc/ is unchanged.", file=sys.stderr)
        return 2
    raw_bytes = json.dumps(raw, ensure_ascii=False, sort_keys=True, indent=1).encode("utf-8")
    if token in raw_bytes.decode("utf-8"):
        print("! The API response contains the token; it was not saved.", file=sys.stderr)
        return 2
    raw_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    raw_dir = REFERENCE_DIR / "psoc"
    raw_dir.mkdir(parents=True, exist_ok=True)
    retrieved = dt.datetime.now(dt.timezone.utc)
    (raw_dir / f"psoc_{PSOC_VERSION}_{retrieved.date().isoformat()}.json").write_bytes(raw_bytes)

    problems = validate_psoc(raw)
    _write_csv(args.out_dir / "psoc_validation.csv", PSOC_PROBLEM_COLUMNS, problems)
    rows = parse_psoc(raw)
    count = write_table(args.out_dir, "psoc_groups", rows)
    upsert_dataset(args.out_dir, {
        "dataset_id": PSOC_DATASET,
        "name": "Philippine Standard Occupational Classification",
        "version": PSOC_VERSION,
        "source_url": f"{PSOC_BASE}/{PSOC_VERSION}",
        "retrieved_at": retrieved.isoformat(timespec="seconds"),
        "source_sha256": raw_sha256,
        "license_note": "Philippine Statistics Authority. Used under the PSA Classifications API terms.",
        "notes": "PSA lists 2022 updates in the PSOC technical notes; reconcile before calling this current.",
    })
    levels = collections.Counter(row["level"] for row in rows)
    print(f"psoc_groups: {count} rows ({', '.join(f'{k} {v}' for k, v in levels.items())}) -> {args.out_dir}")
    if problems:
        print(f"! {len(problems)} problems in the API records: {collections.Counter(p['problem'] for p in problems)}")
        print(f"  see {args.out_dir / 'psoc_validation.csv'}")
    if args.publish:
        if problems or not levels.get("unit"):
            print("! Not published: review the problems first. The previous reference is unchanged.", file=sys.stderr)
            return 3
        print(f"published {publish_psoc_reference(rows, raw_sha256, retrieved, args.reference_dir)}")
    return 0


def _code_digits(value: Any) -> str:
    text = clean(value)
    return text[:-2] if text.endswith(".0") else text


def load_code_table(path: Path, code_column: str, title_column: str, level_column: str = "",
                    sheet: str = "") -> list[dict[str, str]]:
    """Rows of a CSV or Excel file as {code, title, level}; codes stay exactly as written."""
    if path.suffix.lower() in {".xlsx", ".xlsm", ".xls"}:
        import pandas as pd

        frame = pd.read_excel(path, sheet_name=sheet or 0, dtype=str).fillna("")
        records = frame.to_dict(orient="records")
    else:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            records = list(csv.DictReader(handle))
    missing = [c for c in (code_column, title_column, level_column) if c and records and c not in records[0]]
    if missing:
        raise SystemExit(f"! {path.name} has no column {', '.join(missing)}")
    return [{"code": _code_digits(r.get(code_column)), "title": clean(r.get(title_column)),
             "level": clean(r.get(level_column)) if level_column else ""}
            for r in records if _code_digits(r.get(code_column))]


def compare_psoc(reference: list[dict[str, str]], other: list[dict[str, str]]) -> list[dict[str, str]]:
    """Differences between the published reference and another code list. Nothing is rewritten.

    A code in the other list that only matches after zero-padding (110 vs 0110)
    is reported as code_format, because spreadsheets drop leading zeros.
    """
    by_code = {row["psoc_code"]: row for row in reference}
    widths = {level: width for level, (_, _, width) in PSOC_LEVELS.items()}
    found: set[str] = set()
    out: list[dict[str, str]] = []

    def add(code: str, other_code: str, kind: str, reference_value: str = "", other_value: str = "") -> None:
        out.append({"psoc_code": code, "other_code": other_code, "discrepancy": kind,
                    "reference_value": reference_value, "other_value": other_value})

    for row in other:
        code = row["code"]
        match = by_code.get(code)
        if match is None and code.isdigit():
            level_width = widths.get(row["level"].lower().replace("-", "_").replace(" ", "_"))
            padded = [code.zfill(w) for w in ([level_width] if level_width else range(len(code) + 1, 5))]
            candidates = [c for c in padded if c in by_code]
            if len(candidates) == 1:
                match = by_code[candidates[0]]
                add(match["psoc_code"], code, "code_format", match["psoc_code"], code)
        if match is None:
            add("", code, "missing_in_reference", "", row["title"])
            continue
        found.add(match["psoc_code"])
        if row["title"] and normalize_label(row["title"]) != normalize_label(match["title"]):
            add(match["psoc_code"], code, "title_differs", match["title"], row["title"])
        level = row["level"].lower().replace("-", "_").replace(" ", "_")
        if level and level in widths and level != match["level"]:
            add(match["psoc_code"], code, "level_differs", match["level"], row["level"])
    for code, row in by_code.items():
        if code not in found:
            add(code, "", "missing_in_other", row["title"], "")
    return out


PSOC_DISCREPANCY_COLUMNS = ["psoc_code", "other_code", "discrepancy", "reference_value", "other_value"]


def read_psoc_reference(args: argparse.Namespace) -> list[dict[str, str]]:
    path = args.reference_dir / PSOC_GROUPS_FILE
    if path.exists():
        with path.open(encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))
    rows = read_table(args.out_dir, "psoc_groups")
    if not rows:
        raise SystemExit("! No PSOC reference: run the psoc step (with --publish) first.")
    return rows


def command_psoc_compare(args: argparse.Namespace) -> int:
    reference = read_psoc_reference(args)
    other = load_code_table(args.against, args.code_column, args.title_column, args.level_column, args.sheet)
    rows = compare_psoc(reference, other)
    out = args.output or args.out_dir / f"psoc_discrepancies_{args.against.stem}.csv"
    _write_csv(out, PSOC_DISCREPANCY_COLUMNS, rows)
    counts = collections.Counter(row["discrepancy"] for row in rows)
    print(f"{len(other)} codes in {args.against.name} vs {len(reference)} reference groups")
    print(f"discrepancies: {dict(counts) or 'none'} -> {out}")
    print("Nothing was changed; review the file and update the source you trust.")
    return 0


def command_psoc_check(args: argparse.Namespace) -> int:
    """Check the PSOC codes stored in skills_reference.csv against the reference."""
    reference = read_psoc_reference(args)
    groups = [{"code": row["psoc_code"], "title": row["title"], "level": "unit"} for row in stored_skill_psoc_groups()]
    rows = [row for row in compare_psoc(reference, groups) if row["discrepancy"] != "missing_in_other"]
    out = args.output or args.out_dir / "psoc_discrepancies_skills_reference.csv"
    _write_csv(out, PSOC_DISCREPANCY_COLUMNS, rows)
    print(f"{len(groups)} PSOC codes in skills_reference.csv; discrepancies: "
          f"{dict(collections.Counter(r['discrepancy'] for r in rows)) or 'none'} -> {out}")
    return 0


# ---------------------------------------------------------------- PSOC -> ISCO-08


CROSSWALK_COLUMNS = ["psoc_code", "psoc_title", "isco_code", "isco_title", "status", "title_overlap", "note", "review_status"]


def _title_overlap(a: str, b: str) -> float:
    stop = {"and", "of", "the", "not", "elsewhere", "classified", "other", "related", "n.e.c", "nec"}
    left = {w for w in normalize_label(a).split() if w not in stop}
    right = {w for w in normalize_label(b).split() if w not in stop}
    if not left or not right:
        return 0.0
    return round(len(left & right) / len(left | right), 3)


def read_isco_groups(path: Path) -> dict[str, str]:
    """ISCO-08 code -> title from ESCO's ISCOGroups_en.csv."""
    if path.is_dir():
        path = _esco_file(path, "ISCOGroups")
    return {clean(row["code"]): clean(row["preferredLabel"]) for row in _read_csv(path) if clean(row.get("code"))}


def classify_crosswalk(psoc_rows: list[dict[str, str]], isco: dict[str, str],
                       min_overlap: float = 0.34) -> list[dict[str, str]]:
    """PSOC group -> ISCO-08 group with the same code, and how sure that is.

    PSOC 2012 adopts ISCO-08 codes, but the PSA added and renamed groups for the
    Philippines. The code alone is therefore not proof:

    - isco_match: the same code exists in ISCO-08 and the titles share words.
    - ambiguous: the same code exists but the titles differ; a person decides.
    - philippine_specific: the code is not in ISCO-08.

    Every row starts 'proposed'. Only isco_match rows are used to propose ESCO
    occupation links, and those are proposals too.
    """
    out = []
    for row in psoc_rows:
        code = row["psoc_code"]
        isco_title = isco.get(code, "")
        overlap = _title_overlap(row["title"], isco_title) if isco_title else 0.0
        if not isco_title:
            status, note = "philippine_specific", "code not in ISCO-08"
        elif overlap >= min_overlap or normalize_label(row["title"]) == normalize_label(isco_title):
            status, note = "isco_match", ""
        else:
            status, note = "ambiguous", "same code, different title"
        out.append({"psoc_code": code, "psoc_title": row["title"], "isco_code": code if isco_title else "",
                    "isco_title": isco_title, "status": status, "title_overlap": overlap, "note": note,
                    "review_status": "proposed"})
    return out


def stored_skill_psoc_groups() -> list[dict[str, str]]:
    """The PSOC unit codes and titles hand-entered in skills_reference.csv."""
    with SKILLS_REFERENCE_PATH.open(encoding="utf-8-sig", newline="") as handle:
        stored = list(csv.DictReader(handle))
    groups: dict[str, dict[str, str]] = {}
    for row in stored:
        if row.get("psoc_code"):
            groups.setdefault(row["psoc_code"], {"psoc_code": row["psoc_code"], "title": row.get("psoc_category", ""), "level": "unit"})
    return sorted(groups.values(), key=lambda row: row["psoc_code"])


def command_psoc_crosswalk(args: argparse.Namespace) -> int:
    if args.stored_skill_codes:
        # Offline check of the codes already in skills_reference.csv; the result is
        # a report, not the published crosswalk.
        rows = classify_crosswalk(stored_skill_psoc_groups(), read_isco_groups(args.isco))
        path = args.output or args.out_dir / "psoc_isco_crosswalk_skills_reference.csv"
    else:
        rows = classify_crosswalk(read_psoc_reference(args), read_isco_groups(args.isco))
        path = args.output or args.reference_dir / PSOC_CROSSWALK_FILE
    _write_csv(path, CROSSWALK_COLUMNS, rows)
    counts = collections.Counter(row["status"] for row in rows)
    print(f"{len(rows)} PSOC groups: {dict(counts)} -> {path}")
    return 0


# ---------------------------------------------------------------- ESCO


def _esco_directory(source: Path) -> Path:
    """The folder holding the ESCO CSVs; a zip is unpacked to a temporary folder first."""
    if source.is_file() and zipfile.is_zipfile(source):
        target = Path(tempfile.mkdtemp(prefix="esco-"))
        with zipfile.ZipFile(source) as archive:
            for member in archive.namelist():
                if member.endswith(".csv") and "__MACOSX" not in member:
                    archive.extract(member, target)
        return target
    return source


def _esco_file(directory: Path, stem: str) -> Path:
    candidates = sorted(directory.rglob(f"{stem}_en.csv")) or sorted(directory.rglob(f"{stem}*.csv"))
    matches = [path for path in candidates if "__MACOSX" not in path.parts and not path.name.startswith("._")]
    if not matches:
        raise SystemExit(f"! {stem}_en.csv not found under {directory}")
    return matches[0]


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _latest_by_uri(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """ESCO publishes a few concepts twice, differing only in modifiedDate."""
    newest: dict[str, dict[str, str]] = {}
    for row in rows:
        uri = (row.get("conceptUri") or "").strip()
        if not uri:
            continue
        previous = newest.get(uri)
        if previous is None or (row.get("modifiedDate") or "") >= (previous.get("modifiedDate") or ""):
            newest[uri] = row
    return list(newest.values())


def parse_esco(directory: Path, dataset_id: str) -> tuple[list[dict], list[dict], list[dict], dict[str, int]]:
    skills = [
        {
            "concept_uri": row["conceptUri"].strip(),
            "preferred_label": clean(row.get("preferredLabel")),
            "alt_labels": "\n".join(label.strip() for label in (row.get("altLabels") or "").splitlines() if label.strip()),
            "skill_type": clean(row.get("skillType")),
            "reuse_level": clean(row.get("reuseLevel")),
            "description": clean(row.get("description") or row.get("definition")),
            "dataset_id": dataset_id,
        }
        for row in _latest_by_uri(_read_csv(_esco_file(directory, "skills")))
        if row.get("conceptUri") and row.get("preferredLabel")
    ]
    occupations = [
        {
            "concept_uri": row["conceptUri"].strip(),
            "preferred_label": clean(row.get("preferredLabel")),
            "alt_labels": "\n".join(label.strip() for label in (row.get("altLabels") or "").splitlines() if label.strip()),
            "isco_group": clean(row.get("iscoGroup")),
            "esco_code": clean(row.get("code")),
            "description": clean(row.get("description") or row.get("definition")),
            "dataset_id": dataset_id,
        }
        for row in _latest_by_uri(_read_csv(_esco_file(directory, "occupations")))
        if row.get("conceptUri") and row.get("preferredLabel")
    ]
    skill_uris = {row["concept_uri"] for row in skills}
    occupation_uris = {row["concept_uri"] for row in occupations}
    relations: dict[tuple[str, str], dict[str, str]] = {}
    skipped = collections.Counter()
    for row in _read_csv(_esco_file(directory, "occupationSkillRelations")):
        occupation_uri, skill_uri = row.get("occupationUri", "").strip(), row.get("skillUri", "").strip()
        relation = clean(row.get("relationType")).lower()
        if occupation_uri not in occupation_uris or skill_uri not in skill_uris:
            skipped["unknown occupation or skill"] += 1
            continue
        if relation not in {"essential", "optional"}:
            skipped[f"relation type {relation or 'blank'}"] += 1
            continue
        key = (occupation_uri, skill_uri)
        # A pair listed as both keeps the stronger relation.
        if key not in relations or relation == "essential":
            relations[key] = {"occupation_uri": occupation_uri, "skill_uri": skill_uri, "relation_type": relation, "dataset_id": dataset_id}
    return skills, occupations, list(relations.values()), dict(skipped)


def _hash_files(paths: Iterable[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def command_esco(args: argparse.Namespace) -> int:
    directory = _esco_directory(Path(args.dir))
    dataset_id = f"esco-{args.version}"
    skills, occupations, relations, skipped = parse_esco(directory, dataset_id)
    write_table(args.out_dir, "esco_skills", skills)
    write_table(args.out_dir, "esco_occupations", occupations)
    write_table(args.out_dir, "esco_occupation_skills", relations)
    files = [_esco_file(directory, stem) for stem in ("skills", "occupations", "occupationSkillRelations")]
    upsert_dataset(args.out_dir, {
        "dataset_id": dataset_id,
        "name": "European Skills, Competences, Qualifications and Occupations (ESCO), English CSV",
        "version": args.version,
        "source_url": "https://esco.ec.europa.eu/en/use-esco/download",
        "retrieved_at": dt.datetime.fromtimestamp(Path(args.dir).stat().st_mtime, dt.timezone.utc).isoformat(timespec="seconds"),
        "source_sha256": _hash_files(files),
        "license_note": "European Union. ESCO is free to reuse with attribution.",
        "notes": "",
    })
    print(f"esco_skills: {len(skills)} | esco_occupations: {len(occupations)} | esco_occupation_skills: {len(relations)}")
    if skipped:
        print(f"skipped relations: {skipped}")
    return 0


# ---------------------------------------------------------------- links


def _title_similarity(pairs: list[tuple[str, str]]) -> list[float]:
    if not pairs:
        return []
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    left = model.encode([a for a, _ in pairs], batch_size=128, normalize_embeddings=True, show_progress_bar=False)
    right = model.encode([b for _, b in pairs], batch_size=128, normalize_embeddings=True, show_progress_bar=False)
    return [round(float(score), 3) for score in (left * right).sum(axis=1)]


def propose_occupation_links(psoc_rows: list[dict], occupations: list[dict], with_similarity: bool = True,
                             crosswalk: list[dict] | None = None) -> list[dict]:
    """PSOC unit -> ESCO occupation proposals through the shared ISCO-08 code.

    With a crosswalk (classify_crosswalk), only units whose code and title agree
    with ISCO-08 are linked; Philippine-specific and ambiguous units are left
    for a reviewer. These links say which ESCO occupations a PSOC group
    resembles. They are never a source of a vacancy's required skills.
    """
    units = {row["psoc_code"]: row for row in psoc_rows if row["level"] == "unit"}
    if crosswalk is not None:
        agreed = {row["psoc_code"] for row in crosswalk if row["status"] == "isco_match"}
        units = {code: row for code, row in units.items() if code in agreed}
    links = []
    for occupation in occupations:
        code = occupation["isco_group"].strip()
        unit = units.get(code)
        if not unit:
            continue
        links.append({
            "psoc_code": code,
            "occupation_uri": occupation["concept_uri"],
            "method": "isco_code_match",
            "evidence": f"ESCO occupation '{occupation['preferred_label']}' is in ISCO-08 unit group {code}; PSOC {code} is '{unit['title']}'.",
            "review_status": "proposed",
            "_titles": (unit["title"], occupation["preferred_label"]),
        })
    # Title similarity is supporting evidence only: a low score flags a link to check first.
    scores = _title_similarity([link["_titles"] for link in links]) if with_similarity else [""] * len(links)
    for link, score in zip(links, scores):
        link["title_similarity"] = score
        link.pop("_titles")
    return sorted(links, key=lambda link: (link["psoc_code"], link["occupation_uri"]))


def propose_skill_links(reference_rows: list[dict], skills: list[dict]) -> tuple[list[dict], collections.Counter]:
    by_uri = {row["concept_uri"]: row for row in skills}
    by_label: dict[str, list[str]] = collections.defaultdict(list)
    # Preferred labels only: ESCO alternative labels also list narrower
    # products and related concepts ("Trello" under "use personal
    # organization software"), which are not the same skill.
    for row in skills:
        by_label[normalize_label(row["preferred_label"])].append(row["concept_uri"])
    links, outcome = [], collections.Counter()
    for row in reference_rows:
        skill_id = row["skill_id"].strip()
        uri = row.get("esco_skill_uri", "").strip()
        if uri and uri in by_uri:
            links.append({
                "skill_id": skill_id,
                "skill_uri": uri,
                "method": "taxonomy_esco_uri",
                "evidence": f"skills_reference.csv esco_skill_uri; mapping_status={row.get('mapping_status', '')}; ESCO label '{by_uri[uri]['preferred_label']}'",
                "confidence": row.get("mapping_confidence", ""),
                # skills_reference.csv records which links a person reviewed.
                "review_status": "reviewed" if row.get("mapping_status", "").strip() in REVIEWED_LINK_STATUSES else "proposed",
            })
            outcome["linked by existing ESCO URI"] += 1
            continue
        if uri:
            outcome["ESCO URI not in this ESCO version"] += 1
        exact = list(dict.fromkeys(by_label.get(normalize_label(row.get("skill_name", "")), [])))
        if len(exact) == 1:
            links.append({
                "skill_id": skill_id,
                "skill_uri": exact[0],
                "method": "exact_label",
                "evidence": f"Kareerly name '{row['skill_name']}' equals ESCO label of '{by_uri[exact[0]]['preferred_label']}'",
                "confidence": "",
                "review_status": "proposed",
            })
            outcome["linked by exact label"] += 1
        else:
            outcome["no ESCO link" if not exact else "ambiguous label (several ESCO skills)"] += 1
    return links, outcome


def write_load_sql(out_dir: Path) -> Path:
    lines = [
        "-- Load Kareerly reference data. Run with psql from this folder:",
        "--   psql \"$SUPABASE_DB_URL\" -f load.sql",
        "-- Requires supabase/migrations/20260918090000_occupation_skill_reference.sql.",
        "\\set ON_ERROR_STOP on",
        "begin;",
    ]
    for table in LOAD_ORDER:
        if not (out_dir / f"{table}.csv").exists():
            continue
        columns = TABLE_COLUMNS[table]
        keys = PRIMARY_KEYS[table]
        column_list = ", ".join(columns)
        updates = [column for column in columns if column not in keys and column not in REVIEW_COLUMNS]
        conflict = f"do update set {', '.join(f'{c} = excluded.{c}' for c in updates)}" if updates else "do nothing"
        staging = f"_load_{table}"
        lines += [
            f"create temp table {staging} (like public.{table} including defaults) on commit drop;",
            f"\\copy {staging} ({column_list}) from '{table}.csv' with (format csv, header true, null '')",
            f"insert into public.{table} ({column_list}) select {column_list} from {staging}",
            f"  on conflict ({', '.join(keys)}) {conflict};",
        ]
    lines.append("commit;")
    path = out_dir / "load.sql"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _sql_literal(value: Any) -> str:
    text = "" if value is None else str(value)
    if text == "":
        return "null"
    return "'" + text.replace("'", "''") + "'"


def write_sql_editor_files(out_dir: Path, max_bytes: int = SQL_EDITOR_MAX_BYTES) -> list[Path]:
    """Upsert files for the Supabase SQL Editor, run in file-name order.

    Each file is one transaction of INSERT ... ON CONFLICT statements; the
    same conflict rules as load.sql, so running a file twice changes nothing.
    """
    folder = out_dir / "sql_editor"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.sql"):
        old.unlink()
    written: list[Path] = []
    for table in LOAD_ORDER:
        rows = read_table(out_dir, table)
        if not rows:
            continue
        columns = TABLE_COLUMNS[table]
        keys = PRIMARY_KEYS[table]
        updates = [column for column in columns if column not in keys and column not in REVIEW_COLUMNS]
        conflict = f"do update set {', '.join(f'{c} = excluded.{c}' for c in updates)}" if updates else "do nothing"
        head = f"insert into public.{table} ({', '.join(columns)}) values\n"
        tail = f"\non conflict ({', '.join(keys)}) {conflict};\n"
        part, chunk, size = 1, [], 0

        def flush() -> None:
            nonlocal part, chunk, size
            if not chunk:
                return
            path = folder / f"{len(written) + 1:02d}_{table}_{part:02d}.sql"
            path.write_text(f"-- {table}, part {part}. Safe to re-run.\nbegin;\n" + head + ",\n".join(chunk) + tail + "commit;\n",
                            encoding="utf-8")
            written.append(path)
            part, chunk, size = part + 1, [], 0

        for row in rows:
            values = "(" + ", ".join(_sql_literal(row.get(column, "")) for column in columns) + ")"
            if chunk and size + len(values) > max_bytes:
                flush()
            chunk.append(values)
            size += len(values) + 2
        flush()
    return written


def command_link(args: argparse.Namespace) -> int:
    psoc_rows = read_table(args.out_dir, "psoc_groups")
    occupations = read_table(args.out_dir, "esco_occupations")
    skills = read_table(args.out_dir, "esco_skills")
    if not skills or not occupations:
        raise SystemExit("! Run the esco step first.")
    with SKILLS_REFERENCE_PATH.open(encoding="utf-8-sig", newline="") as handle:
        reference_rows = list(csv.DictReader(handle))

    skill_links, outcome = propose_skill_links(reference_rows, skills)
    write_table(args.out_dir, "kareerly_skill_esco_links", skill_links)
    summary = [f"# Reference import summary ({dt.date.today().isoformat()})", "", "## Kareerly skills -> ESCO skills", ""]
    summary += [f"- {key}: {value}" for key, value in outcome.most_common()]

    crosswalk_path = args.reference_dir / PSOC_CROSSWALK_FILE
    crosswalk = _read_csv(crosswalk_path) if crosswalk_path.exists() else None
    if psoc_rows:
        occupation_links = propose_occupation_links(psoc_rows, occupations, with_similarity=not args.no_similarity,
                                                    crosswalk=crosswalk)
        write_table(args.out_dir, "psoc_esco_occupation_links", occupation_links)
        units = [row for row in psoc_rows if row["level"] == "unit"]
        linked_units = {link["psoc_code"] for link in occupation_links}
        weak = [link for link in occupation_links if link["title_similarity"] != "" and float(link["title_similarity"]) < 0.4]
        unmatched_isco = sorted({o["isco_group"] for o in occupations if o["isco_group"] and o["isco_group"] not in {u["psoc_code"] for u in units}})
        summary += [
            "", "## PSOC units -> ESCO occupations", "",
            f"- PSOC unit groups: {len(units)}; with at least one ESCO occupation: {len(linked_units)}",
            f"- proposed links: {len(occupation_links)}; with title similarity below 0.4 (check first): {len(weak)}",
            f"- PSOC units with no ESCO occupation: {', '.join(sorted({u['psoc_code'] for u in units} - linked_units)) or 'none'}",
            f"- ISCO-08 groups used by ESCO but absent from PSOC: {', '.join(unmatched_isco) or 'none'}",
        ]
        if crosswalk is None:
            summary.append("- No PSOC -> ISCO-08 crosswalk: every same-code unit was proposed. Run psoc-crosswalk to hold back ambiguous and Philippine-specific units.")
        else:
            held = collections.Counter(row["status"] for row in crosswalk if row["status"] != "isco_match")
            summary.append(f"- held back by the crosswalk (not linked): {dict(held) or 'none'}")
    else:
        summary += ["", "PSOC not imported yet: run the psoc step, then link again."]

    load_path = write_load_sql(args.out_dir)
    editor_files = write_sql_editor_files(args.out_dir)
    summary += ["", f"## Load", "", f"- psql: {load_path.name}",
                f"- Supabase SQL Editor: {len(editor_files)} files in sql_editor/, run in name order"]
    (args.out_dir / "SUMMARY.md").write_text("\n".join(summary) + "\n", encoding="utf-8")
    print("\n".join(summary))
    print(f"\nwrote {load_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    commands = parser.add_subparsers(dest="command", required=True)
    parser.add_argument("--reference-dir", type=Path, default=PSOC_REFERENCE_DIR,
                        help="the published PSOC reference the backend reads (default data/psoc)")
    psoc = commands.add_parser("psoc", help="download PSOC 2012 from the PSA API")
    psoc.add_argument("--timeout", type=float, default=PSOC_TIMEOUT_SECONDS, help="seconds per request")
    psoc.add_argument("--retries", type=int, default=PSOC_RETRIES, help="retries after a failed request (not for 4xx)")
    psoc.add_argument("--publish", action="store_true",
                      help="replace the last-known-good reference in --reference-dir when the download validates")
    compare = commands.add_parser("psoc-compare", help="list differences between the reference and another PSOC list")
    compare.add_argument("--against", type=Path, required=True, help="CSV or Excel file, e.g. the PSA 2022 updates workbook")
    compare.add_argument("--code-column", required=True)
    compare.add_argument("--title-column", required=True)
    compare.add_argument("--level-column", default="")
    compare.add_argument("--sheet", default="")
    compare.add_argument("--output", type=Path)
    check = commands.add_parser("psoc-check", help="check the PSOC codes stored in skills_reference.csv")
    check.add_argument("--output", type=Path)
    crosswalk = commands.add_parser("psoc-crosswalk", help="classify PSOC groups against ISCO-08")
    crosswalk.add_argument("--isco", type=Path, required=True, help="ESCO ISCOGroups_en.csv or the ESCO CSV folder")
    crosswalk.add_argument("--stored-skill-codes", action="store_true",
                           help="classify the PSOC codes in skills_reference.csv instead (works without the API)")
    crosswalk.add_argument("--output", type=Path)
    esco = commands.add_parser("esco", help="read the ESCO English CSV download")
    esco.add_argument("--dir", required=True)
    esco.add_argument("--version", required=True, help="ESCO version of the download, e.g. v1.2.1")
    link = commands.add_parser("link", help="propose PSOC-ESCO and Kareerly-ESCO links, write load.sql")
    link.add_argument("--no-similarity", action="store_true", help="skip title similarity (no model download)")
    args = parser.parse_args(argv)
    handler = {"psoc": command_psoc, "psoc-compare": command_psoc_compare, "psoc-check": command_psoc_check,
               "psoc-crosswalk": command_psoc_crosswalk, "esco": command_esco, "link": command_link}[args.command]
    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
