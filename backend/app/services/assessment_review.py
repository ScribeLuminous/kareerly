"""Helpers for the AI-drafted Candidate Assessment review.

The model only drafts. Nothing here saves a scorecard: a reviewer edits the
draft in the scorecard form and submits it themselves.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

MAX_ANSWER_CHARS = 6000
MAX_EVIDENCE_CHARS = 600
MAX_SUMMARY_CHARS = 1500
MAX_LINKS = 20

_URL_PATTERN = re.compile(r"https?://[^\s<>\"')\]]+", re.IGNORECASE)
_TRAILING_PUNCTUATION = ".,;:!?"


def extract_links(texts: Iterable[str]) -> list[str]:
    """Distinct http(s) links in the candidates' answers, in order of appearance.

    They are shown to the reviewer to check themselves; the drafting model is
    told not to open them, so a link never counts as evidence in the draft."""
    seen: list[str] = []
    for text in texts:
        for match in _URL_PATTERN.findall(text or ""):
            link = match.rstrip(_TRAILING_PUNCTUATION)
            if link and link not in seen:
                seen.append(link)
            if len(seen) >= MAX_LINKS:
                return seen
    return seen


def build_review_request(criteria: list[dict[str, Any]]) -> dict[str, Any]:
    """The model's input: each question, its rating anchors and the answer. It
    carries no candidate identity, so the draft cannot depend on who answered."""
    return {
        "scale": {"1": "Does not meet", "2": "Partly meets", "3": "Meets", "4": "Exceeds"},
        "criteria": [
            {
                "criterion_id": str(item["criterion_id"]),
                "name": str(item.get("name") or ""),
                "what_good_looks_like": str(item.get("description") or ""),
                "question": str(item.get("question") or ""),
                "weight": item.get("weight"),
                "anchors": [str(anchor) for anchor in (item.get("anchors") or [])][:4],
                "candidate_answer": str(item.get("response") or "")[:MAX_ANSWER_CHARS],
            }
            for item in criteria
        ],
    }


def _as_rating(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if 1 <= number <= 4 else None


def normalize_draft(payload: dict[str, Any], criteria: list[dict[str, Any]]) -> dict[str, Any]:
    """Keeps one rating per real criterion, whatever the model returned.

    A blank answer is always "not assessed" (no rating), never a low one, and
    ratings outside 1-4 or for unknown criteria are dropped."""
    by_id = {str(item["criterion_id"]): item for item in criteria}
    returned: dict[str, dict[str, Any]] = {}
    for item in payload.get("ratings") if isinstance(payload.get("ratings"), list) else []:
        if isinstance(item, dict) and str(item.get("criterion_id")) in by_id:
            returned.setdefault(str(item["criterion_id"]), item)

    ratings = []
    for criterion_id, criterion in by_id.items():
        item = returned.get(criterion_id, {})
        answered = bool(str(criterion.get("response") or "").strip())
        rating = _as_rating(item.get("rating")) if answered else None
        evidence = str(item.get("evidence") or "").strip()[:MAX_EVIDENCE_CHARS]
        if not answered:
            evidence = "No answer was provided."
        ratings.append({"criterion_id": criterion_id, "rating": rating, "evidence": evidence})

    summary = payload.get("summary")
    return {
        "ratings": ratings,
        "summary": summary.strip()[:MAX_SUMMARY_CHARS] if isinstance(summary, str) else "",
    }
