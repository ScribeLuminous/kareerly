"""K13 skill taxonomy loader.

Reads the Kareerly research-backed taxonomy workbook into the structures the
matching features need. The workbook is the thing that makes an interpretable
model possible: without a controlled vocabulary you have only free text, and
free text forces you into an opaque encoder.

What it supplies:

    622 skills        skill_id -> label, parent group, K13 category, PSOC/ISCO
    654 hierarchy     parent group -> child skills, for taxonomic partial credit
    4,198 aliases     surface form -> skill_id, for extraction
    60 extensions     TESDA / PRC / local credentials outside ESCO
    13 categories     K01..K13
    42 PSOC links     K13 <-> PSOC major group crosswalk

Quality flags are carried through, not discarded. `qc_status`, `approval_status`
and `mapping_confidence` decide what is allowed into production matching, and
`strict=True` enforces that.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

import pandas as pd

#: The taxonomy lives inside the project so the pipeline is reproducible and
#: does not depend on a file outside the repository.
DEFAULT_WORKBOOK = (
    Path(__file__).resolve().parents[1]
    / "data" / "corpus" / "reference" / "kareerly_research_backed_skills_taxonomy.xlsx"
)

#: Partial credit when a required skill is not held exactly. These are the
#: rungs of the taxonomy, so every score decomposes into a statement a
#: candidate can read: "you don't have X, but you have Y from the same group."
RELATEDNESS = {
    "exact": 1.00,
    "same_parent_group": 0.60,
    "same_subcategory": 0.40,
    "same_category": 0.15,
    "unrelated": 0.00,
}


def normalize(text: Any) -> str:
    value = re.sub(r"[’'`]+", "'", str(text or "").lower())
    value = re.sub(r"[^a-z0-9+#.'\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


@dataclass
class Skill:
    skill_id: str
    label: str
    parent_group_id: str
    k13_id: str
    subcategory: str
    psoc_code: str = ""
    isco08_code: str = ""
    esco_uri: str = ""
    description: str = ""
    mapping_confidence: float = 0.0
    qc_status: str = ""
    validation_required: bool = False
    concept_type: str = ""


@dataclass
class Taxonomy:
    skills: Dict[str, Skill] = field(default_factory=dict)
    alias_to_skill: Dict[str, str] = field(default_factory=dict)
    alias_flags: Dict[str, str] = field(default_factory=dict)
    group_to_skills: Dict[str, List[str]] = field(default_factory=dict)
    group_to_subcategory: Dict[str, str] = field(default_factory=dict)
    categories: Dict[str, str] = field(default_factory=dict)
    subcategories: Dict[str, Dict[str, str]] = field(default_factory=dict)
    extensions: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    psoc_by_k13: Dict[str, List[str]] = field(default_factory=dict)

    # ---- lookup ---------------------------------------------------------

    def resolve(self, surface: str) -> Optional[str]:
        """Surface form -> skill_id, via the alias table."""
        return self.alias_to_skill.get(normalize(surface))

    def longest_aliases(self) -> List[str]:
        """Aliases longest-first, so 'data analysis' beats 'data'."""
        return sorted(self.alias_to_skill, key=len, reverse=True)

    # ---- taxonomic distance --------------------------------------------

    def relation(self, a: str, b: str) -> str:
        """How two skill ids relate. This is the explanation primitive."""
        if a == b:
            return "exact"
        skill_a, skill_b = self.skills.get(a), self.skills.get(b)
        if not skill_a or not skill_b:
            return "unrelated"
        if skill_a.parent_group_id and skill_a.parent_group_id == skill_b.parent_group_id:
            return "same_parent_group"
        if skill_a.subcategory and skill_a.subcategory == skill_b.subcategory:
            return "same_subcategory"
        if skill_a.k13_id and skill_a.k13_id == skill_b.k13_id:
            return "same_category"
        return "unrelated"

    #: A parent group with 6 skills is informative; one with 60 is not. Partial
    #: credit is therefore scaled by group specificity, otherwise "SQL" earns
    #: 0.60 against "Implement a firewall" merely for sharing a broad
    #: subcategory. REFERENCE_GROUP_SIZE is the size at which credit is full.
    REFERENCE_GROUP_SIZE = 8

    def group_specificity(self, group_id: str) -> float:
        size = len(self.group_to_skills.get(group_id, ()))
        if size <= self.REFERENCE_GROUP_SIZE:
            return 1.0
        return float(self.REFERENCE_GROUP_SIZE) / float(size)

    def relatedness(self, a: str, b: str) -> float:
        """Credit for holding `b` against a requirement for `a`.

        Scaled by group specificity, but kept MONOTONE in the taxonomy: a
        closer relation can never score below a more distant one. Without the
        floor, a large parent group could push a sibling skill beneath a mere
        same-category match, which is incoherent as an explanation.
        """
        relation = self.relation(a, b)
        credit = RELATEDNESS[relation]
        skill = self.skills.get(a)

        if relation == "same_parent_group" and skill:
            credit = max(
                credit * self.group_specificity(skill.parent_group_id),
                RELATEDNESS["same_subcategory"] * 0.75,
            )
        elif relation == "same_subcategory":
            credit = max(credit * 0.75, RELATEDNESS["same_category"])
        return credit

    def best_match(self, required: str, held: Iterable[str]) -> Tuple[float, str, str]:
        """Best credit a candidate's skills earn against one requirement.

        Returns (credit, matched_skill_id, relation) so the caller can say
        exactly why the credit was given.
        """
        best = (0.0, "", "unrelated")
        for candidate_skill in held:
            relation = self.relation(required, candidate_skill)
            credit = self.relatedness(required, candidate_skill)
            if credit > best[0]:
                best = (credit, candidate_skill, relation)
                if credit >= 1.0:
                    break
        return best

    def category_of(self, skill_id: str) -> str:
        skill = self.skills.get(skill_id)
        return skill.k13_id if skill else ""

    def summary(self) -> Dict[str, int]:
        return {
            "skills": len(self.skills),
            "aliases": len(self.alias_to_skill),
            "parent_groups": len(self.group_to_skills),
            "categories": len(self.categories),
            "subcategories": len(self.subcategories),
            "local_extensions": len(self.extensions),
        }


#: A column name that identifies the real header row of each sheet. The
#: workbook prefixes sheets with a title and an explanatory note, and the
#: number of preamble rows is not consistent across sheets.
_HEADER_ANCHORS = (
    "skill_id", "k13_id", "skill_group_id", "alias_id", "local_id",
    "relation_id", "map_id", "psoc_major_code",
)


def _sheet(path: Path, name: str) -> pd.DataFrame:
    """Read a sheet, locating the header row rather than assuming its index."""
    raw = pd.read_excel(path, sheet_name=name, header=None)

    header_index = None
    for index in range(min(6, len(raw))):
        cells = {str(value).strip().lower() for value in raw.iloc[index].tolist()}
        if cells & set(_HEADER_ANCHORS):
            header_index = index
            break
    if header_index is None:
        header_index = 0

    frame = pd.read_excel(path, sheet_name=name, header=header_index)
    frame = frame.dropna(how="all").dropna(axis=1, how="all")
    frame.columns = [str(column).strip() for column in frame.columns]
    return frame


def _text(row: pd.Series, column: str) -> str:
    value = row.get(column)
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def load(
    path: Optional[Path] = None,
    strict: bool = False,
    include_extensions: bool = True,
) -> Taxonomy:
    """Load the workbook.

    strict=True admits only rows the workbook itself marks as production-ready
    (`qc_status == PASS`, alias `approval_status` not requiring review). Use it
    for the headline results and report the permissive numbers alongside, so a
    reader can see what the quality flags cost.
    """
    path = Path(path or DEFAULT_WORKBOOK)
    if not path.exists():
        raise FileNotFoundError(f"Taxonomy workbook not found: {path}")

    taxonomy = Taxonomy()

    # ---- categories -----------------------------------------------------
    for _, row in _sheet(path, "Categories").iterrows():
        k13 = _text(row, "k13_id")
        if k13:
            taxonomy.categories[k13] = _text(row, "category_name")

    # ---- subcategories / parent groups ----------------------------------
    for _, row in _sheet(path, "Subcategories").iterrows():
        group_id = _text(row, "skill_group_id")
        if not group_id:
            continue
        name = _text(row, "subcategory_name")
        taxonomy.group_to_subcategory[group_id] = name
        taxonomy.subcategories[_text(row, "subcategory_id") or group_id] = {
            "k13_id": _text(row, "k13_id"),
            "name": name,
            "group_id": group_id,
        }

    # ---- skills ----------------------------------------------------------
    for _, row in _sheet(path, "Skills Master").iterrows():
        skill_id = _text(row, "skill_id")
        if not skill_id:
            continue
        qc = _text(row, "qc_status").upper()
        if strict and qc and qc != "PASS":
            continue

        try:
            confidence = float(_text(row, "mapping_confidence") or 0.0)
        except ValueError:
            confidence = 0.0

        taxonomy.skills[skill_id] = Skill(
            skill_id=skill_id,
            label=_text(row, "preferred_label"),
            parent_group_id=_text(row, "parent_group_id"),
            k13_id=_text(row, "primary_k13_id"),
            subcategory=_text(row, "primary_subcategory"),
            psoc_code=_text(row, "psoc_code"),
            isco08_code=_text(row, "isco08_code"),
            esco_uri=_text(row, "esco_uri"),
            description=_text(row, "description"),
            mapping_confidence=confidence,
            qc_status=qc,
            validation_required=_text(row, "validation_required").upper() == "YES",
            concept_type=_text(row, "concept_type"),
        )

    # ---- local extensions (TESDA / PRC / proposed) -----------------------
    if include_extensions:
        for _, row in _sheet(path, "Local Extensions").iterrows():
            local_id = _text(row, "local_id")
            if not local_id:
                continue
            taxonomy.extensions[local_id] = {
                "name": _text(row, "name"),
                "record_type": _text(row, "record_type"),
                "parent_group_id": _text(row, "parent_group_id"),
                "k13_id": _text(row, "k13_id"),
                "credential_or_provider": _text(row, "credential_or_provider"),
                "official_code": _text(row, "official_code"),
                "validation_status": _text(row, "validation_status"),
            }
            # Local extensions participate in matching as first-class skills.
            taxonomy.skills.setdefault(local_id, Skill(
                skill_id=local_id,
                label=_text(row, "name"),
                parent_group_id=_text(row, "parent_group_id"),
                k13_id=_text(row, "k13_id"),
                subcategory=taxonomy.group_to_subcategory.get(
                    _text(row, "parent_group_id"), ""
                ),
                description=_text(row, "description"),
                qc_status=_text(row, "qc_status").upper(),
                concept_type=_text(row, "record_type"),
            ))

    # ---- hierarchy -------------------------------------------------------
    for _, row in _sheet(path, "Skill Hierarchy").iterrows():
        parent = _text(row, "parent_group_id")
        child = _text(row, "child_skill_id")
        if parent and child and child in taxonomy.skills:
            taxonomy.group_to_skills.setdefault(parent, []).append(child)

    # ---- aliases ---------------------------------------------------------
    for _, row in _sheet(path, "Aliases").iterrows():
        target = _text(row, "skill_or_extension_id")
        alias = _text(row, "normalized_alias") or normalize(_text(row, "alias_text"))
        if not target or not alias or target not in taxonomy.skills:
            continue

        approval = _text(row, "approval_status").lower()
        if strict and "review" in approval:
            continue
        try:
            collisions = int(float(_text(row, "collision_count") or 1))
        except ValueError:
            collisions = 1
        # An alias pointing at several skills cannot disambiguate; drop it.
        if collisions > 1:
            continue
        if len(alias) < 3:
            continue

        taxonomy.alias_to_skill.setdefault(alias, target)
        taxonomy.alias_flags[alias] = approval

    # Every skill's own label is an alias.
    for skill_id, skill in taxonomy.skills.items():
        label = normalize(skill.label)
        if len(label) >= 3:
            taxonomy.alias_to_skill.setdefault(label, skill_id)

    # ---- PSOC crosswalk --------------------------------------------------
    for _, row in _sheet(path, "Category-PSOC Map").iterrows():
        k13 = _text(row, "k13_id")
        psoc = _text(row, "psoc_major_code")
        if k13 and psoc:
            taxonomy.psoc_by_k13.setdefault(k13, []).append(psoc)

    return taxonomy


@lru_cache(maxsize=4)
def load_cached(path: Optional[str] = None, strict: bool = False) -> Taxonomy:
    return load(Path(path) if path else None, strict=strict)
