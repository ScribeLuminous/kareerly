"""Reviewed spellings of skill names: spacing, joining and abbreviations.

People write the same tool several ways: "Help Scout" and "HelpScout",
"Zendesk" and "Zen Desk", "Google Workspace", "G Suite" and "GWorkspace",
"CS" for customer service. The taxonomy lists some of these; the rest are in
``data/skill_name_variants.csv``, one reviewed row per spelling.

* Variants matched in any case are merged into each skill's
  ``approved_aliases``, so resume extraction (Step 1), skill search (Step 2)
  and job requirement matching all read them the same way.
* Short abbreviations ("CS", "CX", "VA", "JS") are ordinary letter pairs in
  lower case, so they match only as written in upper case, as a whole token,
  and not in the contexts the row excludes (``not_after``/``not_before``,
  for example "BS CS" where CS means Computer Science).

Joining words that are separate ("sales force" -> Salesforce) is never done
here. Brands written with a capital inside ("Hub Spot", "Quick Books") are
joined by the split-word repair (split_words.py), which checks the
capitalisation. A spaced spelling is listed here only where that repair
cannot join it (Zendesk has no capital D), in any case when the phrase is not
ordinary English ("Zen Desk") and in Title Case only when it is ("Power
Point", not "installed power points").
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

VARIANTS_PATH = Path(__file__).resolve().parents[2] / "data" / "skill_name_variants.csv"
APPROVED_ALIASES_FIELD = "approved_aliases"


@dataclass(frozen=True)
class SkillVariant:
    skill_id: str
    variant: str
    exact_case: bool
    not_after: Optional[re.Pattern]
    not_before: Optional[re.Pattern]


@lru_cache(maxsize=1)
def load_skill_variants() -> Tuple[SkillVariant, ...]:
    if not VARIANTS_PATH.is_file():
        return ()
    variants = []
    with VARIANTS_PATH.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            skill_id = (row.get("skill_id") or "").strip().upper()
            variant = (row.get("variant") or "").strip()
            if not skill_id or not variant:
                continue
            not_after = (row.get("not_after") or "").strip()
            not_before = (row.get("not_before") or "").strip()
            variants.append(SkillVariant(
                skill_id=skill_id,
                variant=variant,
                exact_case=(row.get("exact_case") or "").strip().lower() == "true",
                not_after=re.compile(not_after) if not_after else None,
                not_before=re.compile(not_before) if not_before else None,
            ))
    return tuple(variants)


def any_case_variants() -> Dict[str, List[str]]:
    """Skill ID -> spellings matched in any case, like any other alias."""
    result: Dict[str, List[str]] = {}
    for item in load_skill_variants():
        if not item.exact_case:
            result.setdefault(item.skill_id, []).append(item.variant)
    return result


def merge_variants_into_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Add the any-case spellings to each taxonomy row's approved aliases, in place."""
    variants = any_case_variants()
    for row in rows:
        extra = variants.get(str(row.get("skill_id", "")).strip().upper())
        if not extra:
            continue
        current = [part.strip() for part in str(row.get(APPROVED_ALIASES_FIELD, "") or "").split(";") if part.strip()]
        row[APPROVED_ALIASES_FIELD] = "; ".join(dict.fromkeys([*current, *extra]))
    return rows


@lru_cache(maxsize=1)
def _exact_case_patterns() -> Tuple[Tuple[SkillVariant, re.Pattern], ...]:
    return tuple(
        (item, re.compile(r"(?<![A-Za-z0-9])" + re.escape(item.variant) + r"(?![A-Za-z0-9])"))
        for item in load_skill_variants() if item.exact_case
    )


def exact_case_matches(text: str) -> List[Tuple[str, str, int]]:
    """(skill ID, spelling, position) for each spelling matched as written in ``text``.

    ``text`` must keep its original case; lower-cased text never matches.
    """
    found = []
    for item, pattern in _exact_case_patterns():
        for match in pattern.finditer(text or ""):
            before, after = text[:match.start()], text[match.end():]
            if item.not_after and item.not_after.search(before[-60:]):
                continue
            if item.not_before and item.not_before.search(after[:60]):
                continue
            found.append((item.skill_id, item.variant, match.start()))
    return found


def exact_case_skill_ids(text: str) -> set:
    return {skill_id for skill_id, _, _ in exact_case_matches(text)}
