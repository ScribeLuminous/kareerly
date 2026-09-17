"""Derive missing surface forms for taxonomy skills.

The alias table inherits ESCO's alternative labels, which are written for a
European classification rather than for how Filipinos write resumes. The result
is that "Python Programming" is indexed but the word *python* is not, and the
most common way a skill appears on a CV fails to resolve.

This module derives extra surface forms by rule, then refuses to auto-accept
anything ambiguous. It never edits the workbook; it writes a supplementary CSV
with provenance so the derived aliases pass through the same review your own
`approval_status` column already implements.

Rules applied, in order of confidence:

    parenthetical   "Python (computer programming)"  -> "python"
    generic head    "Python Programming"             -> "python"
    possessive/stop "Obtain healthcare user's data"  -> unchanged (too risky)
    abbreviation    "Microsoft Excel"                -> "ms excel", "excel"

Acronym generation was tried and REMOVED. ESCO labels are verb phrases, so it
produced strings like "acca" for "Analyse call centre activities" -- which would
then shadow the real ACCA accounting qualification. 352 of 416 derivations came
from that one rule and every sample inspected was unusable.

A derived alias is ACCEPTED only if it resolves to exactly one skill. Anything
that lands on two or more is written out as `ambiguous` for a human to settle,
because silently picking one is how a taxonomy starts lying.
"""

from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .taxonomy import Taxonomy, normalize

#: Trailing words that qualify a skill rather than name it. Stripping these
#: yields the term people actually type. Deliberately conservative: "management"
#: is NOT here, because "Project Management" -> "project" is wrong.
GENERIC_HEADS = {
    "programming", "software", "systems", "system", "applications",
    "application", "techniques", "technique", "principles", "fundamentals",
    "skills", "tools", "technologies", "language", "languages",
}

#: Common Filipino/English resume abbreviations.
ABBREVIATIONS = {
    "microsoft": ["ms"],
    "information technology": ["it"],
    "human resources": ["hr"],
    "quality assurance": ["qa"],
    "standard operating procedure": ["sop"],
    "customer relationship management": ["crm"],
    "search engine optimization": ["seo"],
    "search engine optimisation": ["seo"],
}

STOPWORDS = {"a", "an", "the", "of", "for", "in", "on", "to", "and", "with", "related"}

MIN_ALIAS_LENGTH = 3

#: Single words too generic to be a skill on their own. Deriving these creates
#: false positives on almost every resume.
TOO_GENERIC = {
    "computer", "business", "data", "system", "systems", "service", "services",
    "management", "support", "software", "digital", "technical", "office",
    "general", "basic", "advanced", "professional", "quality", "process",
    "product", "project", "team", "work", "health", "care", "safety", "audit",
    "design", "analysis", "assembly", "production", "operations", "planning",
    "web", "app", "apps", "code", "coding", "tech", "admin", "client", "server",
}


def _strip_parenthetical(label: str) -> Optional[str]:
    """'Python (computer programming)' -> 'Python'"""
    match = re.match(r"^\s*([^(]{2,})\s*\(", label)
    if match:
        stem = match.group(1).strip()
        if len(stem.split()) <= 3:
            return stem
    return None


def _strip_generic_head(label: str) -> Optional[str]:
    """'Python Programming' -> 'Python'. Only when the head is in the list."""
    words = re.sub(r"[()]", " ", label).split()
    if len(words) < 2:
        return None
    if words[-1].lower().strip(")") in GENERIC_HEADS:
        stem = " ".join(words[:-1]).strip()
        if stem and stem.lower() not in STOPWORDS:
            return stem
    return None


def _acronym(label: str) -> Optional[str]:
    words = [w for w in re.sub(r"[^A-Za-z\s]", " ", label).split()
             if w.lower() not in STOPWORDS]
    if len(words) < 3 or len(words) > 5:
        return None
    if any(len(w) < 3 for w in words):
        return None
    return "".join(w[0] for w in words).lower()


def _abbreviations(label: str) -> List[str]:
    lowered = label.lower()
    variants: List[str] = []
    for phrase, shorts in ABBREVIATIONS.items():
        if phrase in lowered:
            for short in shorts:
                variants.append(lowered.replace(phrase, short))
            # also the remainder alone: "Microsoft Excel" -> "excel"
            remainder = lowered.replace(phrase, "").strip()
            if len(remainder) >= MIN_ALIAS_LENGTH and " " not in remainder:
                variants.append(remainder)
    return variants


def derive_variants(label: str) -> List[Tuple[str, str]]:
    """Return [(normalized_alias, rule)] for one preferred label."""
    out: List[Tuple[str, str]] = []

    parenthetical = _strip_parenthetical(label)
    if parenthetical:
        out.append((normalize(parenthetical), "parenthetical"))
        head = _strip_generic_head(parenthetical)
        if head:
            out.append((normalize(head), "parenthetical+generic_head"))

    head = _strip_generic_head(label)
    if head:
        out.append((normalize(head), "generic_head"))

    for variant in _abbreviations(label):
        out.append((normalize(variant), "abbreviation"))

    seen: Set[str] = set()
    deduped: List[Tuple[str, str]] = []
    for alias, rule in out:
        if not alias or len(alias) < MIN_ALIAS_LENGTH or alias in seen:
            continue
        if " " not in alias and alias in TOO_GENERIC:
            continue
        # A derived alias longer than its source adds nothing.
        if len(alias.split()) > 4:
            continue
        seen.add(alias)
        deduped.append((alias, rule))
    return deduped


def expand(taxonomy: Taxonomy) -> Dict[str, List[Dict[str, Any]]]:
    """Derive aliases for every skill and partition by outcome.

    Returns {"accepted": [...], "ambiguous": [...], "existing": [...]}
    """
    proposals: Dict[str, List[Tuple[str, str]]] = defaultdict(list)

    for skill_id, skill in taxonomy.skills.items():
        if not skill.label:
            continue
        for alias, rule in derive_variants(skill.label):
            proposals[alias].append((skill_id, rule))

    accepted: List[Dict[str, Any]] = []
    ambiguous: List[Dict[str, Any]] = []
    existing: List[Dict[str, Any]] = []

    for alias, targets in sorted(proposals.items()):
        unique_targets = sorted({skill_id for skill_id, _ in targets})

        if alias in taxonomy.alias_to_skill:
            existing.append({
                "normalized_alias": alias,
                "skill_id": taxonomy.alias_to_skill[alias],
                "rule": targets[0][1],
                "note": "already present in the workbook",
            })
            continue

        if len(unique_targets) > 1:
            ambiguous.append({
                "normalized_alias": alias,
                "candidate_skill_ids": ";".join(unique_targets),
                "candidate_labels": " | ".join(
                    taxonomy.skills[s].label for s in unique_targets
                ),
                "rule": targets[0][1],
                "note": "resolves to more than one skill; needs a human decision",
            })
            continue

        skill_id = unique_targets[0]
        accepted.append({
            "normalized_alias": alias,
            "skill_id": skill_id,
            "preferred_label": taxonomy.skills[skill_id].label,
            "k13_id": taxonomy.skills[skill_id].k13_id,
            "rule": targets[0][1],
            "alias_source": "derived_rule",
            "approval_status": "derived_pending_review",
        })

    return {"accepted": accepted, "ambiguous": ambiguous, "existing": existing}


def write_supplement(
    result: Dict[str, List[Dict[str, Any]]],
    out_dir: Path,
) -> Dict[str, Path]:
    """Write review-ready CSVs. The workbook is never modified."""
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: Dict[str, Path] = {}

    for bucket in ("accepted", "ambiguous"):
        rows = result.get(bucket, [])
        if not rows:
            continue
        path = out_dir / f"derived_aliases_{bucket}.csv"
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        paths[bucket] = path

    return paths


def apply_supplement(taxonomy: Taxonomy, path: Path) -> int:
    """Overlay an approved supplement onto a loaded taxonomy."""
    if not path.exists():
        return 0
    added = 0
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            alias = normalize(row.get("normalized_alias", ""))
            skill_id = str(row.get("skill_id", "")).strip()
            if not alias or skill_id not in taxonomy.skills:
                continue
            if alias in taxonomy.alias_to_skill:
                continue
            taxonomy.alias_to_skill[alias] = skill_id
            taxonomy.alias_flags[alias] = row.get("approval_status", "derived")
            added += 1
    return added


def coverage_probe(taxonomy: Taxonomy, terms: Sequence[str]) -> List[Dict[str, Any]]:
    """Which common resume terms resolve, and which have no skill at all."""
    rows = []
    for term in terms:
        skill_id = taxonomy.resolve(term)
        substring_hits = [
            s.skill_id for s in taxonomy.skills.values()
            if term.lower() in s.label.lower()
        ][:3]
        rows.append({
            "term": term,
            "resolves_to": skill_id or "",
            "label": taxonomy.skills[skill_id].label if skill_id else "",
            "status": (
                "resolved" if skill_id
                else "alias_gap" if substring_hits
                else "vocabulary_gap"
            ),
            "near_skill_ids": ";".join(substring_hits),
        })
    return rows


def find_duplicate_skills(taxonomy: Taxonomy) -> List[Dict[str, Any]]:
    """Skills whose labels reduce to the same stem.

    `python` could not be auto-accepted as an alias because SK001 "Python
    Programming" and SK134 "Python (computer programming)" both claim it. That
    is not an alias problem, it is a duplicate in the Skills Master, and no
    alias rule can resolve it -- the two rows need merging.
    """
    stems: Dict[str, List[str]] = defaultdict(list)

    for skill_id, skill in taxonomy.skills.items():
        label = skill.label
        for reduced in (
            _strip_parenthetical(label),
            _strip_generic_head(label),
            label,
        ):
            if reduced:
                stems[normalize(reduced)].append(skill_id)
                break

    duplicates: List[Dict[str, Any]] = []
    for stem, skill_ids in sorted(stems.items()):
        unique = sorted(set(skill_ids))
        if len(unique) < 2:
            continue
        duplicates.append({
            "stem": stem,
            "skill_ids": ";".join(unique),
            "labels": " | ".join(taxonomy.skills[s].label for s in unique),
            "same_parent_group": len({
                taxonomy.skills[s].parent_group_id for s in unique
            }) == 1,
            "note": "candidate duplicate rows in Skills Master; merge before matching",
        })
    return duplicates
