"""Refresh skills_reference.csv's ESCO labels from ESCO v1.2.1 and add reviewed links.

    python3 -m backend.scripts.refresh_esco_links --esco-dir <unzipped ESCO v1.2.1 CSV folder> [--dry-run]

For every skill with an ESCO URI, the stored preferred and alternative labels
are replaced by the v1.2.1 labels of that concept (the copy with the latest
modifiedDate) and ``esco_version`` becomes v1.2.1. URIs are never changed.

NEW_LINKS are links reviewed on 2026-09-27 against v1.2.1: the Kareerly name
is the preferred label of exactly one ESCO concept with the same meaning.
Tools that only match a broader ESCO concept (Asana, Trello, SAP ERP, Cold
Calling, Sales Operations) are not linked.

A second run changes nothing.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional

BACKEND_DIR = Path(__file__).resolve().parents[1]
SKILLS_PATH = BACKEND_DIR / "data" / "skills_reference.csv"
ESCO_VERSION = "v1.2.1"

NEW_LINKS = {
    "SK656": ("http://data.europa.eu/esco/skill/6d289e8b-2cc1-4eda-ab1f-ad1090ef98f0", "WordPress"),
    "SK662": ("http://data.europa.eu/esco/skill/14ced458-5f4b-495f-bd3d-9c240614bda0", "Adobe Photoshop"),
    "SK663": ("http://data.europa.eu/esco/skill/27b913f0-3c52-448b-ad27-fc6ef08fb326", "Adobe Illustrator"),
    "SK679": ("http://data.europa.eu/esco/skill/4350c38d-0fe9-4ca7-bab9-40ed7f72b04f", "PHP"),
    "SK672": ("http://data.europa.eu/esco/skill/eda4d727-4374-49af-ace4-118c7c906835", "search engine optimisation"),
}


def load_esco(directory: Path) -> Dict[str, Dict[str, str]]:
    path = next((p for p in sorted(directory.rglob("skills_en.csv")) if "__MACOSX" not in p.parts), None)
    if path is None:
        raise SystemExit(f"! skills_en.csv not found under {directory}")
    latest: Dict[str, Dict[str, str]] = {}
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            uri = (row.get("conceptUri") or "").strip()
            if uri and (uri not in latest or (row.get("modifiedDate") or "") >= (latest[uri].get("modifiedDate") or "")):
                latest[uri] = row
    return latest


def refresh(rows: List[Dict[str, str]], esco: Dict[str, Dict[str, str]]) -> List[str]:
    changes = []
    for row in rows:
        link = NEW_LINKS.get(row["skill_id"].strip().upper())
        if link and not row.get("esco_skill_uri", "").startswith("http"):
            uri, expected = link
            if esco.get(uri, {}).get("preferredLabel", "").strip() != expected:
                raise SystemExit(f"! {row['skill_id']}: {uri} is not '{expected}' in this ESCO release")
            row["esco_skill_uri"] = uri
            row["mapping_status"] = row.get("mapping_status") or "manual_review"
            changes.append(f"{row['skill_id']} {row['skill_name']}: linked to ESCO '{expected}'")
        uri = row.get("esco_skill_uri", "").strip()
        if not uri.startswith("http"):
            continue
        concept = esco.get(uri)
        if concept is None:
            changes.append(f"{row['skill_id']}: {uri} not in this ESCO release; left unchanged")
            continue
        preferred = concept["preferredLabel"].strip()
        new_alts = [label.strip() for label in (concept.get("altLabels") or "").splitlines() if label.strip()]
        stored = [label.strip() for label in re.split(r"[;|\n]", row.get("esco_alternative_labels", "")) if label.strip()]
        # Keep the stored text when it lists the same labels, so only real changes show.
        same = sorted(label.lower() for label in stored) == sorted(label.lower() for label in new_alts)
        alts = row.get("esco_alternative_labels", "") if same else "; ".join(new_alts)
        before = (row.get("esco_preferred_label", ""), row.get("esco_alternative_labels", ""), row.get("esco_version", ""))
        row["esco_preferred_label"], row["esco_alternative_labels"], row["esco_version"] = preferred, alts, ESCO_VERSION
        if before != (preferred, alts, ESCO_VERSION):
            changes.append(f"{row['skill_id']}: labels refreshed to {ESCO_VERSION}")
    return changes


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--esco-dir", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    with SKILLS_PATH.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        columns, rows = reader.fieldnames, list(reader)
    changes = refresh(rows, load_esco(args.esco_dir))
    print(f"{len(changes)} changes")
    for line in changes:
        if "linked" in line or "not in" in line:
            print("  " + line)
    if not args.dry_run and changes:
        with SKILLS_PATH.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
