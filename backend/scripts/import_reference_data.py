"""Build Kareerly's occupation and skill reference data from PSOC and ESCO.

PSOC (PSA) classifies occupations; ESCO describes skills and which skills each
occupation needs. PSOC 2012 follows ISCO-08, and every ESCO occupation carries
its ISCO-08 unit group, so a PSOC unit links to ESCO occupations, and through
them to skills, with the shared code as evidence.

    python3 scripts/import_reference_data.py psoc
        Downloads all PSOC 2012 groups from the PSA API (token: PSA_API_TOKEN in
        backend/.env) and keeps the raw responses for provenance.

    python3 scripts/import_reference_data.py esco --dir <unzipped ESCO CSV folder> --version v1.2.0
        Reads the English ESCO CSV download (skills_en.csv, occupations_en.csv,
        occupationSkillRelations_en.csv).

    python3 scripts/import_reference_data.py link
        Proposes PSOC unit -> ESCO occupation links (same ISCO-08 code) and
        Kareerly SK skill -> ESCO skill links (the URI already in
        skills_reference.csv, or an exact label match). All links start as
        'proposed'; only a reviewer marks them 'reviewed'.

Each step writes table-shaped CSVs to data/corpus/reference/import/, and link
also writes load.sql, which loads every CSV into the tables created by
supabase/migrations/20260918090000_occupation_skill_reference.sql. Nothing is
written to Supabase by this script.
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
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

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
    try:
        from dotenv import load_dotenv

        load_dotenv(BACKEND_DIR / ".env")
    except ImportError:
        pass
    token = os.getenv("PSA_API_TOKEN", "").strip()
    if not token:
        raise SystemExit("! Set PSA_API_TOKEN in backend/.env (never commit it).")
    return token


def _psoc_items(body: Any) -> tuple[list[dict[str, Any]], bool]:
    """Items in one API response, and whether the response says more pages exist."""
    if isinstance(body, list):
        return body, False
    if isinstance(body, dict):
        for key in ("results", "data", "items"):
            if isinstance(body.get(key), list):
                return body[key], bool(body.get("next"))
    raise ValueError(f"Unexpected PSOC response shape: {str(body)[:200]}")


def fetch_psoc_group(group: str, token: str, pause: float = 0.5) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen_ids: set[Any] = set()
    for page in range(1, 1000):
        query = urllib.parse.urlencode({"token": token, "page": page, "page_size": PAGE_SIZE})
        request = urllib.request.Request(f"{PSOC_BASE}/{PSOC_VERSION}/{group}?{query}", headers={"User-Agent": "Kareerly thesis research"})
        with urllib.request.urlopen(request, timeout=60) as response:
            batch, has_next = _psoc_items(json.loads(response.read()))
        fresh = [item for item in batch if item.get("id", json.dumps(item, sort_keys=True)) not in seen_ids]
        seen_ids.update(item.get("id", json.dumps(item, sort_keys=True)) for item in fresh)
        items.extend(fresh)
        # Unpaginated endpoints return the same list for every page, so stop on no new items.
        if not fresh or (not has_next and len(batch) < PAGE_SIZE):
            break
        time.sleep(pause)
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
                "description": clean(item.get("description")),
                "parent_code": code[:-1] if width > 1 else "",
                "dataset_id": PSOC_DATASET,
            }
    for row in rows.values():
        if row["parent_code"] and row["parent_code"] not in rows:
            row["parent_code"] = ""
    return sorted(rows.values(), key=lambda row: (len(row["psoc_code"]), row["psoc_code"]))


def command_psoc(args: argparse.Namespace) -> int:
    token = _psoc_token()
    raw = {}
    for level, (group, _, _) in PSOC_LEVELS.items():
        raw[group] = fetch_psoc_group(group, token)
        print(f"  {group}: {len(raw[group])} items")
    raw_bytes = json.dumps(raw, ensure_ascii=False, sort_keys=True, indent=1).encode("utf-8")
    raw_dir = REFERENCE_DIR / "psoc"
    raw_dir.mkdir(parents=True, exist_ok=True)
    retrieved = dt.datetime.now(dt.timezone.utc)
    (raw_dir / f"psoc_{PSOC_VERSION}_{retrieved.date().isoformat()}.json").write_bytes(raw_bytes)

    rows = parse_psoc(raw)
    count = write_table(args.out_dir, "psoc_groups", rows)
    upsert_dataset(args.out_dir, {
        "dataset_id": PSOC_DATASET,
        "name": "Philippine Standard Occupational Classification",
        "version": PSOC_VERSION,
        "source_url": f"{PSOC_BASE}/{PSOC_VERSION}",
        "retrieved_at": retrieved.isoformat(timespec="seconds"),
        "source_sha256": hashlib.sha256(raw_bytes).hexdigest(),
        "license_note": "Philippine Statistics Authority. Used under the PSA Classifications API terms.",
        "notes": "PSA lists 2022 updates in the PSOC technical notes; reconcile before calling this current.",
    })
    levels = collections.Counter(row["level"] for row in rows)
    print(f"psoc_groups: {count} rows ({', '.join(f'{k} {v}' for k, v in levels.items())}) -> {args.out_dir}")
    return 0


# ---------------------------------------------------------------- ESCO


def _esco_file(directory: Path, stem: str) -> Path:
    matches = sorted(directory.rglob(f"{stem}_en.csv")) or sorted(directory.rglob(f"{stem}*.csv"))
    if not matches:
        raise SystemExit(f"! {stem}_en.csv not found under {directory}")
    return matches[0]


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


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
        for row in _read_csv(_esco_file(directory, "skills"))
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
        for row in _read_csv(_esco_file(directory, "occupations"))
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
    directory = Path(args.dir)
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
        "retrieved_at": dt.datetime.fromtimestamp(files[0].stat().st_mtime, dt.timezone.utc).isoformat(timespec="seconds"),
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


def propose_occupation_links(psoc_rows: list[dict], occupations: list[dict], with_similarity: bool = True) -> list[dict]:
    units = {row["psoc_code"]: row for row in psoc_rows if row["level"] == "unit"}
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
    for row in skills:
        for label in [row["preferred_label"], *row["alt_labels"].splitlines()]:
            if label.strip():
                by_label[normalize_label(label)].append(row["concept_uri"])
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
                "review_status": "proposed",
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

    if psoc_rows:
        occupation_links = propose_occupation_links(psoc_rows, occupations, with_similarity=not args.no_similarity)
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
    else:
        summary += ["", "PSOC not imported yet: run the psoc step, then link again."]

    load_path = write_load_sql(args.out_dir)
    (args.out_dir / "SUMMARY.md").write_text("\n".join(summary) + "\n", encoding="utf-8")
    print("\n".join(summary))
    print(f"\nwrote {load_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("psoc", help="download PSOC 2012 from the PSA API")
    esco = commands.add_parser("esco", help="read the ESCO English CSV download")
    esco.add_argument("--dir", required=True)
    esco.add_argument("--version", required=True, help="ESCO version of the download, e.g. v1.2.0")
    link = commands.add_parser("link", help="propose PSOC-ESCO and Kareerly-ESCO links, write load.sql")
    link.add_argument("--no-similarity", action="store_true", help="skip title similarity (no model download)")
    args = parser.parse_args(argv)
    handler = {"psoc": command_psoc, "esco": command_esco, "link": command_link}[args.command]
    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
