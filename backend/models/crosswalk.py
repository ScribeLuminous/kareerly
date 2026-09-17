"""ESCO URI <-> Kareerly skill_id crosswalk.

Two ID spaces meet in this system and do not join on their own:

    pipeline/label.py  tags job requirements with ESCO ids   ('s001', or the
                       tail of http://data.europa.eu/esco/skill/<uuid>)
    the K13 taxonomy   identifies skills as 'SK001' / 'LEX-001'

Without a bridge, `job_from_record` hands the matcher ESCO ids, none of which
exist in the taxonomy, so every requirement scores as an unfillable gap and
every match collapses to zero. The bug is silent -- nothing errors, the numbers
are simply wrong.

The Skills Master already carries `esco_uri` on 621 of 680 rows, so the bridge
is data you have. This module builds it, and is explicit about the three
outcomes:

    mapped      ESCO requirement has a Kareerly skill
    unmapped    ESCO requirement has no Kareerly skill -- a genuine taxonomy
                gap, kept visible rather than dropped
    local       Kareerly-only skill (LEX-), no ESCO counterpart expected

Dropping unmapped requirements would be the tempting shortcut and the wrong
one: it shrinks the denominator and makes coverage look better precisely on the
jobs the taxonomy understands least.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .taxonomy import Taxonomy

REFERENCE_DIR = Path(__file__).resolve().parents[1] / "data" / "corpus" / "reference"
MAPPING_REVIEW = REFERENCE_DIR / "esco_mapping_review.csv"

_URI_TAIL = re.compile(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_.-]+)$")


def esco_key(value: Any) -> str:
    """Normalise an ESCO reference to a comparable key.

    Accepts a full URI, a bare uuid, or the short ids the fixture uses ('s001').
    """
    text = str(value or "").strip()
    if not text:
        return ""
    match = _URI_TAIL.search(text.rstrip("/"))
    return match.group(1).lower() if match else text.lower()


@dataclass
class Translation:
    kareerly_ids: List[str]
    unmapped_esco: List[str]

    @property
    def coverage(self) -> float:
        total = len(self.kareerly_ids) + len(self.unmapped_esco)
        return len(self.kareerly_ids) / total if total else 0.0


class Crosswalk:
    def __init__(
        self,
        taxonomy: Taxonomy,
        apply_proposed_remaps: bool = False,
        review_path: Optional[Path] = None,
    ) -> None:
        self.taxonomy = taxonomy
        self.esco_to_kareerly: Dict[str, str] = {}
        self.kareerly_to_esco: Dict[str, str] = {}
        self.collisions: Dict[str, List[str]] = {}
        self.remaps_applied = 0

        for skill_id, skill in taxonomy.skills.items():
            key = esco_key(skill.esco_uri)
            if not key:
                continue
            self.kareerly_to_esco[skill_id] = key
            if key in self.esco_to_kareerly and self.esco_to_kareerly[key] != skill_id:
                # Two Kareerly skills claiming one ESCO concept: a duplicate.
                self.collisions.setdefault(key, [self.esco_to_kareerly[key]]).append(skill_id)
                continue
            self.esco_to_kareerly[key] = skill_id

        if apply_proposed_remaps:
            self.remaps_applied = self._apply_remaps(review_path or MAPPING_REVIEW)

    def _apply_remaps(self, path: Path) -> int:
        """Overlay the verified mappings from esco_mapping_review.csv.

        Off by default. The remaps are proposals pending human review, and
        silently trusting 106 of them would defeat the review gate.
        """
        if not path.exists():
            return 0
        applied = 0
        with path.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                if row.get("verdict") != "remap":
                    continue
                skill_id = str(row.get("skill_id", "")).strip()
                key = esco_key(row.get("best_uri", ""))
                if not skill_id or not key or skill_id not in self.taxonomy.skills:
                    continue
                old = self.kareerly_to_esco.get(skill_id)
                if old and self.esco_to_kareerly.get(old) == skill_id:
                    del self.esco_to_kareerly[old]
                self.kareerly_to_esco[skill_id] = key
                self.esco_to_kareerly.setdefault(key, skill_id)
                applied += 1
        return applied

    # ---- translation -----------------------------------------------------

    def to_kareerly(self, esco_ids: Iterable[Any]) -> Translation:
        mapped: List[str] = []
        unmapped: List[str] = []
        for value in esco_ids:
            raw = str(value or "").strip()
            if not raw:
                continue
            # Already a Kareerly id: pass through.
            if raw in self.taxonomy.skills:
                mapped.append(raw)
                continue
            skill_id = self.esco_to_kareerly.get(esco_key(raw))
            (mapped if skill_id else unmapped).append(skill_id or raw)
        return Translation(
            kareerly_ids=list(dict.fromkeys(mapped)),
            unmapped_esco=list(dict.fromkeys(unmapped)),
        )

    def to_esco(self, kareerly_id: str) -> str:
        return self.kareerly_to_esco.get(kareerly_id, "")

    def stats(self) -> Dict[str, Any]:
        return {
            "taxonomy_skills": len(self.taxonomy.skills),
            "with_esco_uri": len(self.kareerly_to_esco),
            "unique_esco_concepts": len(self.esco_to_kareerly),
            "collisions": len(self.collisions),
            "collision_examples": {
                key: ids for key, ids in list(self.collisions.items())[:5]
            },
            "remaps_applied": self.remaps_applied,
        }


@lru_cache(maxsize=4)
def load_crosswalk(apply_proposed_remaps: bool = False) -> Crosswalk:
    from . import taxonomy as tx

    return Crosswalk(tx.load(), apply_proposed_remaps=apply_proposed_remaps)
