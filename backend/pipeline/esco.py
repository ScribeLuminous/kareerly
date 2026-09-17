"""ESCO reference loader.

The one thing this module exists for: `occupationSkillRelations` carries a
`relationType` of "essential" or "optional". That field is the `omega_r` weight
the matching algorithm needs and the old hand-built corpus could not supply.
Deriving must-have vs nice-to-have by heuristic is what produced 67% synthetic
requirements in v1; here it is read from the taxonomy instead.

Setup:
    1. Download ESCO (CSV, English) from
       https://esco.ec.europa.eu/en/use-esco/download
    2. Unzip into  backend/data/corpus/reference/esco/
    3. Confirm with:  python -m pipeline.cli esco-check
"""

from __future__ import annotations

import csv
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from .config import ESCO_DIR, ESCO_OCCUPATIONS_CSV, ESCO_RELATIONS_CSV, ESCO_SKILLS_CSV


def _read_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing ESCO file: {path}\n"
            f"Download the English CSV bundle from "
            f"https://esco.ec.europa.eu/en/use-esco/download and unzip into {ESCO_DIR}"
        )
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return [
            {str(k).strip(): (v or "").strip() for k, v in row.items() if k}
            for row in csv.DictReader(handle)
        ]


def _find(directory: Path, *stems: str) -> Optional[Path]:
    """ESCO filenames vary by version (skills_en.csv, skills_en_v1.2.0.csv, ...)."""
    if not directory.exists():
        return None
    for stem in stems:
        for candidate in sorted(directory.glob(f"{stem}*.csv")):
            return candidate
    return None


@lru_cache(maxsize=1)
def load_skills() -> Dict[str, Dict[str, Any]]:
    """conceptUri -> skill record, with all alternative labels flattened."""
    path = _find(ESCO_DIR, "skills_en", "skills") or ESCO_SKILLS_CSV
    skills: Dict[str, Dict[str, Any]] = {}

    for row in _read_csv(path):
        uri = row.get("conceptUri", "")
        if not uri:
            continue
        preferred = row.get("preferredLabel", "")
        alternatives = [
            label.strip()
            for label in re.split(r"[\n|;]", row.get("altLabels", ""))
            if label.strip()
        ]
        skills[uri] = {
            "skill_uri": uri,
            "skill_id": uri.rsplit("/", 1)[-1],
            "preferred_label": preferred,
            "alt_labels": alternatives,
            "all_labels": [preferred] + alternatives if preferred else alternatives,
            "skill_type": row.get("skillType", ""),
            "reuse_level": row.get("reuseLevel", ""),
            "description": row.get("description", ""),
        }
    return skills


@lru_cache(maxsize=1)
def load_occupations() -> Dict[str, Dict[str, Any]]:
    path = _find(ESCO_DIR, "occupations_en", "occupations") or ESCO_OCCUPATIONS_CSV
    occupations: Dict[str, Dict[str, Any]] = {}

    for row in _read_csv(path):
        uri = row.get("conceptUri", "")
        if not uri:
            continue
        occupations[uri] = {
            "occupation_uri": uri,
            "preferred_label": row.get("preferredLabel", ""),
            "alt_labels": [
                label.strip()
                for label in re.split(r"[\n|;]", row.get("altLabels", ""))
                if label.strip()
            ],
            "isco_group": row.get("iscoGroup", ""),
            "description": row.get("description", ""),
        }
    return occupations


@lru_cache(maxsize=1)
def load_relations() -> Dict[str, Dict[str, List[str]]]:
    """occupation_uri -> {"essential": [skill_uri...], "optional": [...]}.

    This is the payload. `relationType` gives you must-have vs nice-to-have as
    published data rather than as a guess.
    """
    path = _find(ESCO_DIR, "occupationSkillRelations_en", "occupationSkillRelations") \
        or ESCO_RELATIONS_CSV
    relations: Dict[str, Dict[str, List[str]]] = {}

    for row in _read_csv(path):
        occupation = row.get("occupationUri", "")
        skill = row.get("skillUri", "")
        relation = (row.get("relationType", "") or "").strip().lower()
        if not occupation or not skill:
            continue
        bucket = relations.setdefault(occupation, {"essential": [], "optional": []})
        bucket.setdefault(relation if relation in bucket else "optional", []).append(skill)

    return relations


def requirement_weight(relation_type: str) -> float:
    """omega_r in the matching score. Essential skills dominate coverage."""
    return 1.0 if str(relation_type).strip().lower() == "essential" else 0.4


@lru_cache(maxsize=1)
def label_index() -> Dict[str, str]:
    """normalized label -> skill_uri, for exact-label linking. Longest labels win."""
    index: Dict[str, str] = {}
    for uri, skill in load_skills().items():
        for label in skill["all_labels"]:
            key = re.sub(r"[^a-z0-9+#. ]+", " ", label.lower())
            key = re.sub(r"\s+", " ", key).strip()
            if len(key) >= 3:
                index.setdefault(key, uri)
    return index


def status() -> Dict[str, Any]:
    """Human-readable readiness check, used by `cli esco-check`."""
    report: Dict[str, Any] = {"esco_dir": str(ESCO_DIR), "ready": False}
    try:
        skills = load_skills()
        occupations = load_occupations()
        relations = load_relations()
    except FileNotFoundError as exc:
        report["error"] = str(exc)
        return report

    essential = sum(len(v["essential"]) for v in relations.values())
    optional = sum(len(v["optional"]) for v in relations.values())

    report.update({
        "ready": True,
        "skills": len(skills),
        "occupations": len(occupations),
        "occupations_with_relations": len(relations),
        "essential_relations": essential,
        "optional_relations": optional,
        "labels_indexed": len(label_index()),
    })
    return report
