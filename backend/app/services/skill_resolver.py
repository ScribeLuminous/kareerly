"""The one place that decides which text names which Kareerly skill.

Kareerly's curated skills (``data/skills_reference.csv``, ``SK###`` IDs) are
the runtime vocabulary; ESCO URIs are reference links. Every label a skill
can be recognised by is listed in ``data/skill_aliases.csv`` with its source
and a status:

* ``verified``  - names exactly this skill, in both directions: a resume
  mention, a typed skill and a job requirement with this text all resolve to
  the skill. Kareerly names, curated aliases, reviewed spellings, bare
  programming-language names and the ESCO preferred label of a reviewed link.
* ``one_way``   - a phrase whose presence shows the skill, never the reverse
  ("coordinated patient appointments" shows Appointment Scheduling). Read
  from ``skill_evidence_relations.csv`` by skill coverage only.
* ``candidate`` - an unreviewed label, mostly ESCO alternative labels and
  related-concept phrases. Not used until a person marks it verified. The
  deterministic filter result is recorded to prioritise that review; passing
  it does not make a label a synonym.
* ``excluded``  - reviewed and rejected (``skill_alias_exclusions.csv``).

Uses of the vocabulary (all through this module):

* ``extract``  - finding skills in resume, job and course text;
* ``resolve``  - turning one name (a requirement, a typed skill, a pasted-job
  skill) into a skill ID;
* ``evidence`` - names that show a held skill in resume text (coverage).

Rows from the ESCO auto-expansion (``mapping_status = auto_generated_review``)
are inactive: their labels are not searched for in text. Their IDs still
resolve, so a confirmed skill or a job requirement that already uses one keeps
its meaning (see docs/esco-skill-implementation.md for the inventory).
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
ALIASES_PATH = DATA_DIR / "skill_aliases.csv"

VERIFIED = "verified"
ONE_WAY = "one_way"
CANDIDATE = "candidate"
EXCLUDED = "excluded"
STATUSES = (VERIFIED, ONE_WAY, CANDIDATE, EXCLUDED)

# Rows whose labels are searched for in text. The 422 ESCO auto-expansion rows
# were never reviewed; see the module docstring.
UNREVIEWED_STATUS = "auto_generated_review"

# Short names that are skills on their own; any other alias under three
# characters is too ambiguous to search for.
SHORT_ALIAS_ALLOWLIST = frozenset({"sql", "git", "aws", "crm", "seo", "css", "php", "api", "ui", "ux", "c#"})

# Pairs that must never resolve to each other, whatever a taxonomy label says.
# Tests assert them; the generator refuses to verify an alias that breaks one.
PROTECTED_DISTINCT = (
    ("java", "javascript"), ("c", "c++"), ("c", "c#"), ("c++", "c#"),
    ("sql", "mysql"), ("ui design", "ux design"), ("adobe photoshop", "adobe illustrator"),
    ("search engine optimization", "search engine marketing"),
    ("microsoft excel", "microsoft office"), ("data analysis", "data science"),
)


def normalize(value: Any) -> str:
    """The only normalisation of skill text: case, quotes, dashes and slashes, punctuation.

    "E-mail" and "E mail" are "email". Characters that distinguish skills are
    kept: "+" and "#" (C++, C#) and "." (Node.js, React.js).
    """
    if not isinstance(value, str):
        return ""
    text = value.strip().lower()
    text = re.sub(r"[’'`]+", "'", text)
    text = re.sub(r"[\-_/]+", " ", text)
    text = re.sub(r"[^a-z0-9+#.'\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\be mail", "email", text)
    return text.strip()


def compact(value: str) -> str:
    """A normalised name without spaces or punctuation ("helpscout", "ms365")."""
    return re.sub(r"[^a-z0-9+#]+", "", normalize(value))


def split_list(value: Any) -> List[str]:
    """Entries of a ';'-, '|'- or newline-separated taxonomy field. Commas belong to labels."""
    if value is None or (isinstance(value, float) and value != value):
        return []
    return [part.strip() for part in re.split(r"[;|\n]", str(value)) if part.strip()]


def is_group_label(value: str) -> bool:
    """Taxonomy group labels such as "Healthcare, Caregiving, and Wellness"."""
    return bool(re.search(r",\s*(?:and|&)\s+\S", value))


def category_terms(rows: Iterable[Dict[str, Any]]) -> Set[str]:
    """Words that only name a taxonomy category ("data", "business", "healthcare")."""
    terms: Set[str] = set()
    for row in rows:
        labels = [str(row.get("skill_category", "")), str(row.get("skill_subcategory", ""))]
        labels += [part for part in split_list(row.get("related_skills", "")) if is_group_label(part)]
        for label in labels:
            terms.add(normalize(label))
            terms.update(normalize(part) for part in re.split(r",|\band\b|&", label))
    terms.discard("")
    return terms


@dataclass(frozen=True)
class AliasEntry:
    skill_id: str
    alias: str
    source: str
    status: str
    # Matched in text only as written (upper or title case), by skill_variants;
    # any case when resolving a single name such as a job requirement.
    exact_case: bool = False
    filter_result: str = ""
    reason: str = ""
    esco_uri: str = ""
    reviewed_by: str = ""

    @property
    def key(self) -> str:
        return normalize(self.alias)


@lru_cache(maxsize=1)
def load_alias_entries(path: Path = ALIASES_PATH) -> Tuple[AliasEntry, ...]:
    if not path.is_file():
        return ()
    with path.open(encoding="utf-8", newline="") as handle:
        rows = [row for row in csv.DictReader(line for line in handle if not line.startswith("#"))]
    entries = []
    for row in rows:
        skill_id = (row.get("skill_id") or "").strip().upper()
        alias = (row.get("alias") or "").strip()
        status = (row.get("status") or "").strip()
        if skill_id and alias and status in STATUSES:
            entries.append(AliasEntry(
                skill_id=skill_id, alias=alias, source=(row.get("source") or "").strip(), status=status,
                exact_case=(row.get("exact_case") or "").strip().lower() == "true",
                filter_result=(row.get("filter_result") or "").strip(), reason=(row.get("reason") or "").strip(),
                esco_uri=(row.get("esco_uri") or "").strip(), reviewed_by=(row.get("reviewed_by") or "").strip(),
            ))
    return tuple(entries)


@dataclass
class SkillVocabulary:
    """The skills Kareerly knows and the names each one answers to."""

    labels: Dict[str, str]
    mapping_status: Dict[str, str]
    # normalised alias -> skill IDs, per use
    extract_aliases: Dict[str, Set[str]] = field(default_factory=dict)
    resolve_aliases: Dict[str, str] = field(default_factory=dict)
    evidence_names: Dict[str, List[str]] = field(default_factory=dict)
    # Extraction names that are unreviewed candidates (see PROVISIONAL_CANDIDATE_EXTRACTION).
    provisional_aliases: Set[str] = field(default_factory=set)

    def is_active(self, skill_id: str) -> bool:
        return self.mapping_status.get(skill_id, "") != UNREVIEWED_STATUS

    def resolve(self, name: str) -> str:
        """The skill ID a name resolves to through verified names, or ""."""
        key = normalize(name)
        if not key:
            return ""
        if key.upper() in self.labels:
            return key.upper()
        return self.resolve_aliases.get(key) or self.resolve_aliases.get(compact(name), "")


# Whether unreviewed candidate names that pass the deterministic filter may be
# read in text as one-way evidence of an active, reviewed skill. They never
# resolve a requirement or typed skill, never make two skills equivalent and
# never count as course evidence. Decided by the evaluation in
# docs/esco-skill-implementation.md.
PROVISIONAL_CANDIDATE_EXTRACTION = False


def build_vocabulary(
    rows: List[Dict[str, Any]],
    entries: Optional[Iterable[AliasEntry]] = None,
    extra_verified: Optional[Dict[str, List[str]]] = None,
    provisional: Optional[bool] = None,
    include_inactive: bool = False,
) -> SkillVocabulary:
    """Build the vocabulary from taxonomy rows and the reviewed alias file.

    ``rows`` are taxonomy rows (skills_reference.csv plus approved additions);
    ``extra_verified`` are names a reviewer approved at runtime (skill
    discovery's approved aliases) that are not yet in the alias file.
    ``include_inactive`` also reads unreviewed skills' verified names in text;
    it is for course evidence ("does this course name the skill"), never for
    crediting a candidate.
    """
    entries = list(load_alias_entries() if entries is None else entries)
    labels = {str(row.get("skill_id", "")).strip().upper(): str(row.get("skill_name", "")).strip()
              for row in rows if str(row.get("skill_id", "")).strip() and str(row.get("skill_name", "")).strip()}
    statuses = {str(row.get("skill_id", "")).strip().upper(): str(row.get("mapping_status", "")).strip()
                for row in rows}
    categories = category_terms(rows)

    excluded = {(entry.skill_id, entry.key) for entry in entries if entry.status == EXCLUDED}
    verified: Dict[str, Set[str]] = {}
    case_sensitive: Dict[str, Set[str]] = {}
    display: Dict[Tuple[str, str], str] = {}

    def add(skill_id: str, name: str, exact_case: bool = False) -> None:
        key = normalize(name)
        if not key or skill_id not in labels or (skill_id, key) in excluded:
            return
        (case_sensitive if exact_case else verified).setdefault(skill_id, set()).add(key)
        display.setdefault((skill_id, key), name.strip())

    for skill_id, label in labels.items():
        add(skill_id, label)
    for entry in entries:
        if entry.status == VERIFIED:
            add(entry.skill_id, entry.alias, entry.exact_case)
    for skill_id, names in (extra_verified or {}).items():
        for name in names:
            add(skill_id.upper(), name)

    vocabulary = SkillVocabulary(labels=labels, mapping_status=statuses)

    # Extraction: verified names of active skills, three characters or more
    # or on SHORT_ALIAS_ALLOWLIST ("C#"); other short ones only as upper-case
    # variants, handled by skill_variants; never a bare category word.
    for skill_id, keys in verified.items():
        if not include_inactive and not vocabulary.is_active(skill_id):
            continue
        own = normalize(labels[skill_id])
        for key in keys:
            if (len(key) < 3 and key not in SHORT_ALIAS_ALLOWLIST) or (key in categories and key != own):
                continue
            vocabulary.extract_aliases.setdefault(key, set()).add(skill_id)

    if PROVISIONAL_CANDIDATE_EXTRACTION if provisional is None else provisional:
        verified_keys = {key for keys in verified.values() for key in keys}
        for entry in entries:
            key = entry.key
            if (entry.status == CANDIDATE and entry.filter_result == "pass" and entry.skill_id in labels
                    and vocabulary.is_active(entry.skill_id) and key not in verified_keys
                    and (entry.skill_id, key) not in excluded and len(key) >= 3 and key not in categories):
                vocabulary.extract_aliases.setdefault(key, set()).add(entry.skill_id)
                vocabulary.provisional_aliases.add(key)

    # Resolution: a name owned by exactly one skill; the canonical label wins a
    # conflict. Joined spellings ("msexcel") resolve when unambiguous.
    owners: Dict[str, Set[str]] = {}
    for skill_id, keys in verified.items():
        for key in keys:
            owners.setdefault(key, set()).add(skill_id)
    resolve = {key: next(iter(ids)) for key, ids in owners.items() if len(ids) == 1}
    for skill_id, label in labels.items():
        resolve[normalize(label)] = skill_id
    # A requirement is a name on its own, so "JS" or "React" there names the
    # skill; in running text these match only as written (skill_variants).
    for skill_id, keys in case_sensitive.items():
        for key in keys:
            resolve.setdefault(key, skill_id)
    joined: Dict[str, Set[str]] = {}
    for key, skill_id in resolve.items():
        if " " in key and len(compact(key)) >= 5:
            joined.setdefault(compact(key), set()).add(skill_id)
    for key, ids in joined.items():
        if len(ids) == 1:
            resolve.setdefault(key, next(iter(ids)))
    vocabulary.resolve_aliases = resolve

    # Evidence names for coverage: the label first, then other verified names as written.
    for skill_id, keys in verified.items():
        names = [labels[skill_id]] + sorted(display[(skill_id, key)] for key in keys if key != normalize(labels[skill_id]))
        vocabulary.evidence_names[skill_id] = list(dict.fromkeys(names))
    return vocabulary


def protected_pair_violations(vocabulary: SkillVocabulary) -> List[Tuple[str, str, str]]:
    """Protected look-alike pairs that resolve to the same skill (should be empty)."""
    problems = []
    for left, right in PROTECTED_DISTINCT:
        a, b = vocabulary.resolve(left), vocabulary.resolve(right)
        if a and a == b:
            problems.append((left, right, a))
    return problems
