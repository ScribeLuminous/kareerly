"""Stage 2: raw postings -> canonical schema.

Everything here is deterministic and inspectable. Nothing is inferred by a
model at this stage; the point is to get a clean, comparable record so that the
labelling stage has one shape to work against.

Crucially this stage assigns `corpus_tier`, which decides whether a row is
allowed into the matching corpus at all. A snippet-only posting cannot support
requirement extraction, and letting it in was the root of the "Accounting
Assistant requires Python" failure in v1.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional

from .config import MIN_DESCRIPTION_CHARS, NORMALIZED_DIR, PH_REGIONS, RAW_DIR

WHITESPACE = re.compile(r"\s+")
HTML_TAG = re.compile(r"<[^>]+>")
BULLET = re.compile(r"^[\s•●▪◦*\-–—]+")

SALARY_NUMBER = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?", re.IGNORECASE)

# Ordered by resolution precedence, not by level: the first group that matches
# wins. An explicit statement of level outranks a seniority word used in
# passing, so "Junior Data Analyst" whose text also promises "a strong path to
# senior analyst" resolves to entry rather than to senior.
#
# A title is almost all signal, so a bare level word in one is worth trusting.
SENIORITY_TITLE_PATTERNS = [
    ("intern", [r"\bintern(ship)?\b", r"\bojt\b", r"\btrainee\b"]),
    ("entry", [r"\bjunior\b", r"\bjr\.?\b", r"\bentry[- ]level\b", r"\bfresh grad",
               r"\bno experience\b"]),
    ("manager", [r"\bmanager\b", r"\bhead of\b", r"\bdirector\b", r"\bsupervisor\b"]),
    ("senior", [r"\bsenior\b", r"\bsr\.?\b", r"\blead\b", r"\bprincipal\b",
                r"\b[6-9]\+?\s*years?\b", r"\b1[0-9]\+?\s*years?\b"]),
    ("mid", [r"\bmid[- ]level\b", r"\b[2-5]\+?\s*years?\b", r"\bintermediate\b",
             r"\bspecialist\b", r"\bofficer\b"]),
    # Weak entry markers, checked last because they are not statements of level
    # on their own: "Associate Director" is a manager, and "graduate" usually
    # belongs to a degree requirement rather than to the seniority of the role.
    ("entry", [r"\bassociate\b", r"\bgraduate\b"]),
]

# A description is mostly prose, and prose names levels that are not the
# vacancy's own: "reports to the kitchen manager", "graduate of any four-year
# course", "mentor our junior staff", "the principal responsibilities are".
# Reading bare level words out of that is what labelled a Kitchen Assistant as
# manager, and the JSearch highlights only add more prose to trip over. So the
# fallback matches phrases that state the level *of this posting* and nothing
# else -- the level word has to be attached to the vacancy, or the sentence has
# to be a requirement.
_ROLE = r"(?:role|position|level|opening|vacancy|opportunity|post|hire|candidate|applicant)"
_SEEKING = r"(?:hiring|looking for|searching for|seeking|recruiting)\s+(?:an?\s+)?"
# Anchored on a nearby "experience" so that "20 years in business" is not read
# as a requirement. This narrows the false positives rather than removing them:
# "founded 15 years ago, we bring deep experience" still slips through.
_YRS = r"\s*\+?\s*(?:years?|yrs?)\b[^.]{0,40}?\bexperience\b"

SENIORITY_DESCRIPTION_PATTERNS = [
    ("intern", [r"\binternship\b", r"\bojt\b", r"\bon[- ]the[- ]job training\b",
                rf"\btrainee (?:{_ROLE}|programme?|program)\b"]),
    ("entry", [r"\bentry[- ]level\b",
               rf"\bjunior(?:[- ]level)? {_ROLE}\b",
               rf"{_SEEKING}junior\b",
               r"\bopen to fresh grad",
               r"\bfresh grad(?:uate)?s?\b[^.]{0,30}?\b(?:welcome|encouraged|may apply|accepted)\b",
               r"\bno (?:prior |previous |work |relevant )?experience (?:is )?(?:required|needed|necessary)\b"]),
    ("manager", [rf"\bmanager(?:ial)? {_ROLE}\b", rf"\bmanagement {_ROLE}\b"]),
    ("senior", [rf"\bsenior(?:[- ]level)? {_ROLE}\b",
                rf"{_SEEKING}senior\b",
                rf"\b(?:[6-9]|1[0-9]){_YRS}"]),
    ("mid", [r"\bmid[- ]level\b", rf"\b[2-5]{_YRS}"]),
]

WORK_SETUP_PATTERNS = [
    ("remote", [r"\bremote\b", r"\bwork from home\b", r"\bwfh\b", r"\btelecommut"]),
    ("hybrid", [r"\bhybrid\b", r"\bflexible (work )?arrangement\b"]),
    ("onsite", [r"\bon[- ]?site\b", r"\bin[- ]office\b", r"\bonsite\b"]),
]


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = HTML_TAG.sub(" ", text)
    text = text.replace(" ", " ").replace("\x00", " ")
    return WHITESPACE.sub(" ", text).strip()


def clean_multiline(value: Any) -> str:
    """Like clean() but keeps line structure, which requirement lists depend on."""
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = re.sub(r"<\s*(br|/p|/li|/div)\s*/?\s*>", "\n", text, flags=re.IGNORECASE)
    text = HTML_TAG.sub(" ", text)
    text = text.replace(" ", " ")
    lines = [WHITESPACE.sub(" ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


def classify_region(location: str) -> str:
    """Longest marker wins: 'cagayan de oro' (Mindanao) must beat 'cagayan' (Luzon)."""
    lowered = clean(location).lower()
    if not lowered:
        return "unknown"

    best_region, best_length = "", 0
    for region, markers in PH_REGIONS.items():
        for marker in markers:
            if marker in lowered and len(marker) > best_length:
                best_region, best_length = region, len(marker)
    if best_region:
        return best_region
    if "philippines" in lowered:
        return "ph_unspecified"
    return "unknown"


def _first_match(text: str, patterns: List[tuple]) -> str:
    """Last matching group wins, so a group listed later overrides an earlier
    one. Work setup relies on this: "remote, with occasional on-site days"
    resolves to the on-site end rather than to whichever token appears first."""
    lowered = text.lower()
    matched = ""
    for label, regexes in patterns:
        if any(re.search(rx, lowered) for rx in regexes):
            matched = label
    return matched


def _match_by_precedence(text: str, patterns: List[tuple]) -> str:
    """First matching group wins. `patterns` is ordered by precedence, so the
    caller decides which marker outranks which rather than relying on where the
    token happens to sit in the text."""
    lowered = text.lower()
    for label, regexes in patterns:
        if any(re.search(rx, lowered) for rx in regexes):
            return label
    return ""


def match_seniority(title: str, description: str) -> str:
    """Read the level off the title; fall back to the description only if the
    title says nothing.

    The description is prose *about* the role, not a statement of its level. A
    posting titled "Junior Data Analyst" that promises "a strong path to senior
    analyst within two years" is a junior role, but matching title and
    description as one blob labelled it senior. The JSearch adapter appends the
    Qualifications and Responsibilities highlights to the description, which
    only adds prose for a stray "senior" or "lead" to hit.

    The two texts get different pattern sets because they carry different
    amounts of noise: a bare level word counts in a title, but the description
    has to actually claim the level for this vacancy. Returning "" is a fine
    outcome -- an unclassified posting is more useful than a wrong one.
    """
    return (_match_by_precedence(title, SENIORITY_TITLE_PATTERNS)
            or _match_by_precedence(description, SENIORITY_DESCRIPTION_PATTERNS))


def parse_salary_php(raw: str) -> Dict[str, Optional[float]]:
    """Best-effort monthly PHP range. Returns Nones rather than guessing."""
    text = clean(raw).lower()
    if not text:
        return {"salary_min_php": None, "salary_max_php": None, "salary_basis": ""}

    basis = "month"
    if re.search(r"\b(per hour|/hr|hourly)\b", text):
        basis = "hour"
    elif re.search(r"\b(per year|/yr|annual|p\.a\.)\b", text):
        basis = "year"
    elif re.search(r"\b(per day|/day|daily)\b", text):
        basis = "day"

    values: List[float] = []
    for number, suffix in SALARY_NUMBER.findall(text):
        try:
            amount = float(number.replace(",", ""))
        except ValueError:
            continue
        if suffix:
            amount *= 1000
        if 100 <= amount <= 5_000_000:
            values.append(amount)

    if not values:
        return {"salary_min_php": None, "salary_max_php": None, "salary_basis": basis}

    return {
        "salary_min_php": min(values),
        "salary_max_php": max(values),
        "salary_basis": basis,
    }


@dataclass
class Job:
    job_id: str
    source: str
    source_id: str
    source_url: str
    access_basis: str
    licence: str
    fetched_at: str

    title: str
    company: str
    description: str
    location_raw: str
    region: str

    seniority: str
    work_setup: str
    employment_type: str
    salary_min_php: Optional[float]
    salary_max_php: Optional[float]
    salary_basis: str

    description_chars: int
    description_is_snippet: bool
    corpus_tier: str          # "match" | "context" | "excluded"
    exclusion_reason: str

    fingerprint: str
    esco_skills: List[Dict[str, Any]] = field(default_factory=list)
    labelling: Dict[str, Any] = field(default_factory=dict)


def normalize_record(raw: Dict[str, Any]) -> Job:
    payload = raw.get("payload", {})

    title = clean(payload.get("title"))
    description = clean_multiline(payload.get("description"))
    location_raw = clean(payload.get("location"))
    combined = f"{title}\n{description}"

    is_snippet = bool(payload.get("description_is_snippet"))
    chars = len(description)

    from .source_policy import is_jooble_origin

    if is_jooble_origin(raw):
        tier, reason = "excluded", "Jooble-origin record excluded by research corpus policy"
    elif not title:
        tier, reason = "excluded", "no title"
    elif chars < 40:
        tier, reason = "excluded", "no usable description"
    elif chars < MIN_DESCRIPTION_CHARS:
        tier, reason = "context", f"description too short for requirement extraction ({chars} chars)"
    elif is_snippet:
        tier, reason = "context", "source returns a truncated snippet, not the full posting"
    else:
        tier, reason = "match", ""

    salary = parse_salary_php(payload.get("salary", ""))

    from .sources.base import RawPosting
    fingerprint = RawPosting(
        source=raw.get("source", ""), source_id=raw.get("source_id", ""),
        fetched_at="", access_basis="", payload=payload,
    ).fingerprint()

    return Job(
        job_id=f"{raw.get('source','?')}-{raw.get('source_id','?')}",
        source=raw.get("source", ""),
        source_id=str(raw.get("source_id", "")),
        source_url=raw.get("source_url", ""),
        access_basis=raw.get("access_basis", ""),
        licence=raw.get("licence", ""),
        fetched_at=raw.get("fetched_at", ""),
        title=title,
        company=clean(payload.get("company")),
        description=description,
        location_raw=location_raw,
        region=classify_region(location_raw),
        seniority=match_seniority(title, description),
        work_setup=_first_match(combined, WORK_SETUP_PATTERNS),
        employment_type=clean(payload.get("employment_type")),
        salary_min_php=salary["salary_min_php"],
        salary_max_php=salary["salary_max_php"],
        salary_basis=salary["salary_basis"],
        description_chars=chars,
        description_is_snippet=is_snippet,
        corpus_tier=tier,
        exclusion_reason=reason,
        fingerprint=fingerprint,
    )


def iter_raw(raw_dir: Path = RAW_DIR) -> Iterator[Dict[str, Any]]:
    for path in sorted(raw_dir.rglob("*.jsonl")):
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield json.loads(line)


def normalize_all(raw_dir: Path = RAW_DIR, out_path: Optional[Path] = None) -> Dict[str, int]:
    out_path = out_path or (NORMALIZED_DIR / "jobs.jsonl")
    seen_fingerprints: Dict[str, str] = {}
    counts = {"read": 0, "written": 0, "duplicate": 0, "match": 0, "context": 0, "excluded": 0}

    with out_path.open("w", encoding="utf-8") as out:
        for raw in iter_raw(raw_dir):
            counts["read"] += 1
            job = normalize_record(raw)

            if job.corpus_tier != "excluded" and job.fingerprint in seen_fingerprints:
                counts["duplicate"] += 1
                continue
            if job.corpus_tier != "excluded":
                seen_fingerprints[job.fingerprint] = job.job_id

            counts[job.corpus_tier] += 1
            counts["written"] += 1
            out.write(json.dumps(asdict(job), ensure_ascii=False) + "\n")

    return counts
