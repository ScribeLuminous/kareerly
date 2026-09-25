"""Propose new skills and aliases from job posts and candidate profiles.

A scan reads active job posts and candidates' custom (unmapped) skill names,
extracts short skill-like phrases, and compares each against the current
taxonomy (skills_reference.csv plus approved additions):

* exact match on any existing name or alias  -> already known, nothing proposed
* close to an existing name (fuzzy/containment) -> proposed as an *alias*, for review
* otherwise                                    -> proposed as a *new skill*

Every proposal records provenance (which job, which extraction rule; profiles
only as a salted account hash) and a confidence from how many independent
sources mention it. Proposals are ``pending`` until an admin approves or rejects
them (``review_candidate``). Candidate-entered text alone can never reach the
taxonomy: profile evidence is capped at low confidence, is always flagged for
review and is never eligible for optional auto-approval.
"""
from __future__ import annotations

import difflib
import hashlib
import logging
import os
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from ..services.skill_extractor import SkillExtractor, _normalize_alias
from ..services import taxonomy_additions
from .supabase_client import SupabaseError, SupabaseRest

logger = logging.getLogger(__name__)

# Evidence strengths feed a noisy-OR: independent sources raise confidence.
STRENGTH = {
    "structured_skill_field": 0.45,   # employer typed it into a skills field
    "skills_section_bullet": 0.30,    # a short bullet under a skills/requirements heading
    "cue_phrase": 0.20,               # "experience with X", "proficient in X"
    "custom_profile_skill": 0.10,     # a candidate typed it as a custom skill
}
PROFILE_CONFIDENCE_CAP = 0.30
SINGLE_COMPANY_CAP = 0.60
LOW_CONFIDENCE = 0.70
NEAR_MATCH_CUTOFF = 0.86
MAX_WORDS = 4
MAX_CHARS = 40

CUE = re.compile(
    r"\b(?:proficien(?:t|cy)\s+(?:in|with)|experience\s+(?:in|with|using)|knowledge\s+of|"
    r"familiar(?:ity)?\s+with|skilled\s+in|expertise\s+in|hands-on\s+(?:experience\s+)?with|"
    r"working\s+knowledge\s+of|competen(?:t|ce)\s+in)\s+([^.;:\n()]{2,160})",
    re.IGNORECASE,
)
HEADING = re.compile(r"^\s*(?:required\s+|technical\s+|key\s+)?(?:skills?|requirements?|qualifications?|tools?|technolog(?:y|ies)|competenc(?:y|ies))\b[^\n]{0,30}:?\s*$", re.IGNORECASE)
BULLET = re.compile(r"^\s*(?:[-*•·▪●]|\d{1,2}[.)])\s+(.+)$")
LEADING_QUALIFIERS = re.compile(
    r"^(?:(?:a|an|the|strong|basic|advanced|good|excellent|solid|proven|deep|some|any|"
    r"working|practical|demonstrated|high|proficient|intermediate|expert|tools?\s+such\s+as|such\s+as|"
    r"e\.?g\.?|including|like)\s+)+",
    re.IGNORECASE,
)
TRAILING_WORDS = re.compile(r"\s+(?:skills?|knowledge|experience|tools?|software|proficiency|etc\.?)$", re.IGNORECASE)
SPLIT_ITEMS = re.compile(r"\s*(?:,|/|;|\band\b|\bor\b|&)\s*", re.IGNORECASE)
GENERIC = {
    "experience", "work", "team", "teams", "ability", "abilities", "years", "year", "degree", "bachelor",
    "bachelors", "college", "graduate", "others", "other", "related field", "field", "computer", "tools",
    "tool", "skills", "skill", "knowledge", "job", "role", "company", "business", "customers", "clients",
    "people", "time", "tasks", "task", "duties", "responsibilities", "applicants", "candidate", "candidates",
    "salary", "benefits", "full time", "part time", "remote", "onsite", "hybrid", "philippines", "manila",
    "similar", "various", "relevant", "required", "preferred", "plus", "must", "willing", "able", "etc",
}
STOPWORDS = {"a", "an", "the", "of", "in", "on", "for", "to", "with", "and", "or", "at", "by", "from", "as", "is", "be"}


def normalize_label(value: str) -> str:
    return _normalize_alias(value)


def compact(value: str) -> str:
    return re.sub(r"[^a-z0-9+#]", "", value.lower())


def clean_phrase(raw: str) -> Optional[str]:
    """Reduce a raw fragment to a candidate skill label, or None if unusable."""
    text = re.sub(r"\([^)]*\)", " ", raw)
    text = re.sub(r"https?://\S+|\S+@\S+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .,:;-*•\t")
    text = LEADING_QUALIFIERS.sub("", text)
    text = TRAILING_WORDS.sub("", text).strip(" .,:;-")
    words = text.split()
    if not words or len(words) > MAX_WORDS or len(text) < 2 or len(text) > MAX_CHARS:
        return None
    lowered = text.lower()
    if lowered in GENERIC or all(word.lower() in STOPWORDS | GENERIC for word in words):
        return None
    if not re.search(r"[a-z]", lowered) or re.search(r"\d+\s*\+?\s*(?:years?|yrs?|months?)", lowered):
        return None
    if words[0].lower() in STOPWORDS or words[-1].lower() in STOPWORDS:
        return None
    return text


def _split_items(fragment: str) -> List[str]:
    return [item for item in (clean_phrase(part) for part in SPLIT_ITEMS.split(fragment)) if item]


@dataclass
class Mention:
    label: str
    source_type: str          # job_structured | job_description | user_profile
    source_ref: str
    method: str
    company_key: Optional[str] = None
    snippet: Optional[str] = None


def mentions_from_job(job: Dict[str, Any]) -> List[Mention]:
    job_ref = f"{job.get('_table', 'job')}:{job.get('job_id')}"
    company = normalize_label(str(job.get("company_name") or "")) or None
    found: List[Mention] = []
    for field_name in ("required_skills", "preferred_skills"):
        for part in re.split(r"[;,|\n]", str(job.get(field_name) or "")):
            label = clean_phrase(part)
            if label:
                found.append(Mention(label, "job_structured", job_ref, "structured_skill_field", company, part.strip()[:240]))
    text = "\n".join(str(job.get(key) or "") for key in ("job_description", "responsibilities"))
    for match in CUE.finditer(text):
        for label in _split_items(match.group(1)):
            found.append(Mention(label, "job_description", job_ref, "cue_phrase", company, match.group(0).strip()[:240]))
    in_skills_section = False
    for line in text.splitlines():
        if HEADING.match(line):
            in_skills_section = True
            continue
        bullet = BULLET.match(line)
        if not bullet:
            if line.strip():
                in_skills_section = False
            continue
        if in_skills_section:
            for label in _split_items(bullet.group(1)):
                found.append(Mention(label, "job_description", job_ref, "skills_section_bullet", company, line.strip()[:240]))
    return found


def account_hash(user_id: str) -> str:
    salt = os.getenv("KAREERLY_EVIDENCE_SALT", "kareerly-skill-evidence")
    return hashlib.sha256(f"{salt}:{user_id}".encode()).hexdigest()[:24]


def mentions_from_profile_skill(row: Dict[str, Any]) -> List[Mention]:
    # Only custom names (no taxonomy ID). No snippet: the text stays in user_skills.
    if str(row.get("skill_id") or "").strip():
        return []
    label = clean_phrase(str(row.get("skill_name") or ""))
    if not label or not row.get("user_id"):
        return []
    return [Mention(label, "user_profile", account_hash(str(row["user_id"])), "custom_profile_skill")]


class TaxonomyIndex:
    """Normalized names and aliases of the current taxonomy, for dedup."""

    def __init__(self, extractor: SkillExtractor):
        self.labels: Dict[str, str] = {}
        self.owners: Dict[str, Set[str]] = defaultdict(set)
        self.compact_owners: Dict[str, Set[str]] = defaultdict(set)
        for row in extractor.rows:
            self.labels[row["skill_id"].upper()] = row["skill_name"]
        for alias, row_indexes in extractor.alias_map.items():
            for index in row_indexes:
                skill_id = extractor.rows[index]["skill_id"].upper()
                self.owners[alias].add(skill_id)
                self.compact_owners[compact(alias)].add(skill_id)
        for skill_id, label in self.labels.items():
            self.owners[normalize_label(label)].add(skill_id)
            self.compact_owners[compact(label)].add(skill_id)
        self._aliases = sorted(self.owners)

    def exact(self, normalized: str) -> Set[str]:
        variants = {normalized, normalized[:-1] if normalized.endswith("s") and len(normalized) > 3 else normalized}
        owners: Set[str] = set()
        for variant in variants:
            owners |= self.owners.get(variant, set())
        return owners or self.compact_owners.get(compact(normalized), set())

    def nearest(self, normalized: str) -> Tuple[Optional[str], float, Set[str], str]:
        """(alias, similarity, owning skill IDs, reason) of the closest existing name."""
        close = difflib.get_close_matches(normalized, self._aliases, n=1, cutoff=NEAR_MATCH_CUTOFF)
        if close:
            ratio = difflib.SequenceMatcher(None, normalized, close[0]).ratio()
            return close[0], ratio, self.owners[close[0]], "near_existing_skill"
        tokens = normalized.split()
        if len(tokens) > 1:
            for size in range(len(tokens) - 1, 0, -1):
                for start in range(0, len(tokens) - size + 1):
                    piece = " ".join(tokens[start:start + size])
                    if len(piece) >= 3 and piece in self.owners:
                        return piece, round(len(piece) / len(normalized), 4), self.owners[piece], "contains_existing_skill"
        return None, 0.0, set(), ""


@dataclass
class Proposal:
    normalized_label: str
    display_label: str
    mentions: List[Mention] = field(default_factory=list)
    confidence: float = 0.0
    suggested_action: str = "review"
    suggested_skill_id: Optional[str] = None
    suggestion_similarity: Optional[float] = None
    review_reasons: List[str] = field(default_factory=list)

    @property
    def job_refs(self) -> Set[str]:
        return {m.source_ref for m in self.mentions if m.source_type != "user_profile"}

    @property
    def profile_refs(self) -> Set[str]:
        return {m.source_ref for m in self.mentions if m.source_type == "user_profile"}

    @property
    def companies(self) -> Set[str]:
        return {m.company_key for m in self.mentions if m.company_key}


def score_confidence(mentions: Sequence[Mention]) -> float:
    """Noisy-OR over independent sources, strongest mention per source."""
    best: Dict[Tuple[str, str], float] = {}
    for m in mentions:
        key = (m.source_type == "user_profile" and "profile" or "job", m.source_ref)
        best[key] = max(best.get(key, 0.0), STRENGTH[m.method])
    job_miss, profile_miss = 1.0, 1.0
    for (kind, _), strength in best.items():
        if kind == "profile":
            profile_miss *= 1 - strength
        else:
            job_miss *= 1 - strength
    profile_part = min(1 - profile_miss, PROFILE_CONFIDENCE_CAP)
    confidence = 1 - job_miss * (1 - profile_part)
    companies = {m.company_key for m in mentions if m.company_key}
    if len(companies) <= 1:
        confidence = min(confidence, SINGLE_COMPANY_CAP)
    if all(m.source_type == "user_profile" for m in mentions):
        confidence = min(confidence, PROFILE_CONFIDENCE_CAP)
    return round(min(confidence, 0.99), 4)


FREE_TEXT_METHODS = {"cue_phrase", "skills_section_bullet"}


def _fold_contained_phrases(grouped: Dict[str, "Proposal"]) -> None:
    """Merge "tableau dashboards" into "tableau" when the shorter phrase is well supported.

    Only free-text mentions move, and only into a proposal that has structured
    evidence or several jobs behind it, so two real skills are never merged.
    """
    anchors = [
        label for label, p in grouped.items()
        if any(m.method == "structured_skill_field" for m in p.mentions) or len(p.job_refs) >= 2
    ]
    for label in sorted(grouped, key=lambda value: -len(value.split())):
        proposal = grouped[label]
        tokens = f" {label} "
        if len(label.split()) < 2 or any(m.method not in FREE_TEXT_METHODS for m in proposal.mentions):
            continue
        target = next((anchor for anchor in sorted(anchors, key=len, reverse=True)
            if anchor != label and f" {anchor} " in tokens), None)
        if target:
            grouped[target].mentions.extend(proposal.mentions)
            del grouped[label]


def build_proposals(mentions: Iterable[Mention], taxonomy: TaxonomyIndex) -> Tuple[List[Proposal], Dict[str, int]]:
    grouped: Dict[str, Proposal] = {}
    stats = defaultdict(int)
    for mention in mentions:
        stats["mentions"] += 1
        normalized = normalize_label(mention.label)
        if not normalized or len(normalized) < 2:
            continue
        if taxonomy.exact(normalized):
            stats["already_in_taxonomy"] += 1
            continue
        proposal = grouped.setdefault(normalized, Proposal(normalized, mention.label))
        proposal.mentions.append(mention)
    _fold_contained_phrases(grouped)
    proposals = list(grouped.values())
    for proposal in proposals:
        # The most common surface form is the display label.
        forms = defaultdict(int)
        for m in proposal.mentions:
            forms[m.label] += 1
        proposal.display_label = max(sorted(forms), key=lambda form: forms[form])
        proposal.confidence = score_confidence(proposal.mentions)
        alias, similarity, owners, reason = taxonomy.nearest(proposal.normalized_label)
        reasons = []
        if alias:
            reasons.append(reason)
            if len(owners) == 1:
                proposal.suggested_action = "alias"
                proposal.suggested_skill_id = next(iter(owners))
            else:
                reasons.append("ambiguous_existing_match")
            proposal.suggestion_similarity = round(similarity, 4)
        if not proposal.job_refs:
            reasons.append("profile_only")
        elif len(proposal.companies) <= 1:
            reasons.append("single_company")
        if proposal.confidence < LOW_CONFIDENCE:
            reasons.append("low_confidence")
        if not alias and proposal.job_refs and len(proposal.job_refs) >= 2:
            proposal.suggested_action = "new_skill"
        proposal.review_reasons = reasons
    stats["proposals"] = len(proposals)
    return sorted(proposals, key=lambda p: (-p.confidence, p.normalized_label)), dict(stats)


def auto_approvable(proposal: Proposal) -> bool:
    """Optional, off by default (KAREERLY_SKILL_AUTO_APPROVE=1)."""
    return (
        os.getenv("KAREERLY_SKILL_AUTO_APPROVE", "0").strip() == "1"
        and proposal.suggested_action == "new_skill"
        and not proposal.review_reasons
        and proposal.confidence >= 0.85
        and len(proposal.job_refs) >= 5
        and len(proposal.companies) >= 3
    )


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------

JOB_COLUMNS = "job_id,company_name,job_description,responsibilities,required_skills,preferred_skills"


def load_taxonomy(client: SupabaseRest) -> SkillExtractor:
    rows = client.select("skill_taxonomy_additions", {
        "select": "kind,skill_id,label,category_id,skill_category", "status": "eq.active", "limit": "5000"})
    additions = [
        {**row, "skill_id": str(row["skill_id"]).upper(), "label": str(row["label"]).strip()}
        for row in rows if taxonomy_additions._valid(row)
    ]
    return SkillExtractor(extra_rows=additions)


def collect_mentions(client: SupabaseRest) -> List[Mention]:
    mentions: List[Mention] = []
    for table in ("internal_jobs", "employer_job_posts"):
        for job in client.select_all(table, {"select": JOB_COLUMNS, "posting_status": "in.(active,open)"}, limit=10_000):
            mentions.extend(mentions_from_job({**job, "_table": table}))
    for row in client.select_all("user_skills", {"select": "user_id,skill_id,skill_name", "skill_id": "is.null"}, limit=20_000):
        mentions.extend(mentions_from_profile_skill(row))
    return mentions


def _chunks(items: List[Any], size: int = 200):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def run_discovery(client: SupabaseRest, *, dry_run: bool = False, limit: int = 500) -> Dict[str, Any]:
    extractor = load_taxonomy(client)
    proposals, stats = build_proposals(collect_mentions(client), TaxonomyIndex(extractor))
    proposals = proposals[:limit]
    result: Dict[str, Any] = {"stats": stats, "dry_run": dry_run, "auto_approved": [],
        "top_proposals": [
            {"label": p.display_label, "confidence": p.confidence, "suggested_action": p.suggested_action,
             "suggested_skill_id": p.suggested_skill_id, "jobs": len(p.job_refs), "profiles": len(p.profile_refs),
             "review_reasons": p.review_reasons}
            for p in proposals[:25]
        ]}
    if dry_run or not proposals:
        return result

    now = datetime.now(timezone.utc).isoformat()
    existing = {
        row["normalized_label"]: row for row in client.select_all("skill_candidates", {"select": "id,normalized_label,status"})
    }
    payload = [{
        "normalized_label": p.normalized_label, "display_label": p.display_label,
        "suggested_action": p.suggested_action, "suggested_skill_id": p.suggested_skill_id,
        "suggestion_similarity": p.suggestion_similarity, "confidence": p.confidence,
        "job_source_count": len(p.job_refs), "profile_source_count": len(p.profile_refs),
        "company_count": len(p.companies), "review_reasons": p.review_reasons, "last_seen_at": now,
    } for p in proposals]
    ids: Dict[str, str] = {}
    for chunk in _chunks(payload):
        # status is not sent, so approved or rejected proposals keep their decision.
        for row in client.insert("skill_candidates", chunk, upsert_on="normalized_label"):
            ids[row["normalized_label"]] = row["id"]
    evidence = []
    for p in proposals:
        seen = set()
        for m in p.mentions:
            key = (m.source_type, m.source_ref)
            if key in seen or p.normalized_label not in ids:
                continue
            seen.add(key)
            evidence.append({
                "candidate_id": ids[p.normalized_label], "source_type": m.source_type, "source_ref": m.source_ref,
                "company_key": m.company_key, "extraction_method": m.method,
                "snippet": m.snippet if m.source_type != "user_profile" else None, "seen_at": now,
            })
    for chunk in _chunks(evidence):
        client.insert("skill_candidate_evidence", chunk, upsert_on="candidate_id,source_type,source_ref", returning=False)
    result["stats"]["stored_proposals"] = len(ids)
    result["stats"]["stored_evidence"] = len(evidence)

    for p in proposals:
        previous = existing.get(p.normalized_label)
        if auto_approvable(p) and (previous is None or previous.get("status") == "pending"):
            try:
                approved = review_candidate(client, ids[p.normalized_label], "approve_new", reviewer_id=None,
                    note="auto-approved: high-confidence job evidence from several employers")
                result["auto_approved"].append(approved)
            except (ValueError, SupabaseError) as exc:
                logger.warning("Auto-approval of %s skipped: %s", p.display_label, exc)
    return result


class ReviewError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _category_name(extractor: SkillExtractor, category_id: str) -> str:
    return next((row.get("skill_category", "") for row in extractor.rows
        if str(row.get("category_id", "")).upper() == category_id), "")


def review_candidate(
    client: SupabaseRest,
    candidate_id: str,
    action: str,
    reviewer_id: Optional[str],
    *,
    skill_id: Optional[str] = None,
    label: Optional[str] = None,
    category_id: Optional[str] = None,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """approve_new | approve_alias | reject a pending proposal."""
    if action not in {"approve_new", "approve_alias", "reject"}:
        raise ReviewError("Unknown review action.")
    rows = client.select("skill_candidates", {"select": "*", "id": f"eq.{candidate_id}", "limit": "1"})
    if not rows:
        raise ReviewError("Skill proposal was not found.", 404)
    candidate = rows[0]
    if candidate.get("status") != "pending":
        raise ReviewError(f"Skill proposal is already {candidate.get('status')}.", 409)
    now = datetime.now(timezone.utc).isoformat()
    decision = {"reviewer": reviewer_id, "reviewed_at": now, "review_note": (note or "")[:500] or None}

    if action == "reject":
        client.update("skill_candidates", {"id": f"eq.{candidate_id}"}, {**decision, "status": "rejected"})
        return {"candidate_id": candidate_id, "status": "rejected"}

    final_label = clean_phrase(label or candidate["display_label"])
    if not final_label:
        raise ReviewError("The skill name must be 2 to 40 characters and up to four words.")
    normalized = normalize_label(final_label)
    extractor = load_taxonomy(client)
    taxonomy = TaxonomyIndex(extractor)
    if taxonomy.exact(normalized):
        raise ReviewError("That name is already in the skill taxonomy.", 409)

    if action == "approve_alias":
        target = str(skill_id or candidate.get("suggested_skill_id") or "").strip().upper()
        if target not in taxonomy.labels:
            raise ReviewError("Choose an existing skill ID for the alias.")
        addition = {"kind": "alias", "skill_id": target, "label": final_label, "normalized_label": normalized,
            "category_id": None, "skill_category": None}
    else:
        new_id = str(client.rpc("next_skill_addition_id") or "").strip().upper()
        if not taxonomy_additions.SKILL_ID_PATTERN.match(new_id) or new_id in taxonomy.labels:
            raise ReviewError("Could not allocate a new skill ID.", 500)
        category = str(category_id or "").strip().upper() or None
        if category and not re.fullmatch(r"K\d{2}", category):
            raise ReviewError("Category must look like K01.")
        target = new_id
        addition = {"kind": "skill", "skill_id": new_id, "label": final_label, "normalized_label": normalized,
            "category_id": category, "skill_category": _category_name(extractor, category) if category else None}

    client.insert("skill_taxonomy_additions", {
        **addition, "status": "active", "source_candidate_id": candidate_id,
        "approved_by": reviewer_id, "approved_at": now,
    }, returning=False)
    client.update("skill_candidates", {"id": f"eq.{candidate_id}"},
        {**decision, "status": "approved", "resolved_skill_id": target})
    taxonomy_additions.clear_cache()
    return {"candidate_id": candidate_id, "status": "approved", "kind": addition["kind"],
        "skill_id": target, "label": final_label}


def list_candidates(client: SupabaseRest, status: str = "pending", limit: int = 100) -> List[Dict[str, Any]]:
    if status not in {"pending", "approved", "rejected"}:
        raise ReviewError("Unknown status filter.")
    candidates = client.select("skill_candidates", {
        "select": "id,normalized_label,display_label,status,suggested_action,suggested_skill_id,suggestion_similarity,"
                  "confidence,job_source_count,profile_source_count,company_count,review_reasons,last_seen_at,"
                  "resolved_skill_id,reviewed_at",
        "status": f"eq.{status}", "order": "confidence.desc,last_seen_at.desc", "limit": str(max(1, min(limit, 200))),
    })
    if candidates:
        ids = ",".join(row["id"] for row in candidates)
        evidence = client.select("skill_candidate_evidence", {
            "select": "candidate_id,source_type,extraction_method,snippet,source_ref",
            "candidate_id": f"in.({ids})", "order": "seen_at.desc", "limit": "1000"})
        by_candidate: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for row in evidence:
            if len(by_candidate[row["candidate_id"]]) < 3:
                # Job references are public job IDs; profile refs are hashes, not shown.
                by_candidate[row["candidate_id"]].append({
                    "source_type": row["source_type"], "method": row["extraction_method"],
                    "snippet": row.get("snippet"),
                    "job": row["source_ref"] if row["source_type"] != "user_profile" else None,
                })
        for row in candidates:
            row["evidence"] = by_candidate.get(row["id"], [])
    return candidates
