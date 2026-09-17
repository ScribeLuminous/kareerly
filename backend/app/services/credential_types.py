"""Credential classification for learning resources.

The catalog's ``resource_type`` column carries no information: every row reads
``Course/Certification``. Nothing downstream could therefore distinguish a
proctored vendor exam (AWS Certified Solutions Architect) from an untracked
self-paced course, and the dashboard badge fell back to the *ranking* score,
which is always positive -- so every resource claimed a certificate.

``credential_type`` replaces that guess with a deterministic classification
derived from the resource title. The rules are ordered and non-overlapping:

    exam_review              licensure / board examination (PH CPA, bar review)
    professional_certificate platform program ending in a named certificate
                             (Google, Meta, IBM "Professional Certificate")
    industry_certification   vendor or professional-body credential, normally a
                             proctored exam (CompTIA, CISSP, PMP, CFA, Cisco)
    certificate_course       course issuing a completion certificate, no exam
    course                   instruction with no credential claimed

Only the first four are treated as granting a credential. A resource is never
promoted to a credential on provider reputation alone -- the title has to say
so. That keeps the badge honest for the 220 auto-generated prototype rows whose
titles are templated and whose ``status`` is still ``Generated - Review
Needed``.

The classification is *inferred*, not sourced. Record that in the methodology
alongside the catalog's provenance.
"""

from __future__ import annotations

import re
from typing import Any

#: Ordered: the first pattern that matches wins.
CREDENTIAL_RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "exam_review",
        re.compile(r"\b(board exam(?:ination)?|licensure|review (?:course|program|center))\b", re.IGNORECASE),
    ),
    (
        "professional_certificate",
        re.compile(r"\bprofessional certificate\b", re.IGNORECASE),
    ),
    (
        "industry_certification",
        re.compile(
            r"\bcertified\b"
            r"|\bcertification\b"
            r"|\baccreditation\b"
            r"|security\s*\+"
            r"|\bnetwork\s*\+"
            r"|\ba\s*\+\b"
            r"|\(\s*(?:pmp|cissp|cisa|cism|ccna|ccnp|cma|cpa|gaiq|apr)\s*\)"
            r"|\bcfa level\b"
            r"|\baz-\d{3}\b"
            r"|\bdiploma in\b",
            re.IGNORECASE,
        ),
    ),
    (
        "certificate_course",
        re.compile(r"\bcertificate\b|\bcertificate pathway\b", re.IGNORECASE),
    ),
]

DEFAULT_CREDENTIAL_TYPE = "course"

CREDENTIAL_TYPES = [name for name, _ in CREDENTIAL_RULES] + [DEFAULT_CREDENTIAL_TYPE]

#: Which classifications actually award something the candidate can show.
CREDENTIAL_GRANTING = {
    "exam_review",
    "professional_certificate",
    "industry_certification",
    "certificate_course",
}

#: Short labels for the dashboard badge.
CREDENTIAL_LABELS = {
    "exam_review": "Licensure exam review",
    "professional_certificate": "Professional certificate",
    "industry_certification": "Industry certification",
    "certificate_course": "Certificate on completion",
    "course": "Course, no certificate",
}


def _normalize_title(value: Any) -> str:
    """Collapse the embedded newlines the catalog carries inside titles."""
    return " ".join(str(value or "").split())


def classify_credential_type(title: Any) -> str:
    """Return the ``credential_type`` for a resource title."""
    text = _normalize_title(title)
    if not text:
        return DEFAULT_CREDENTIAL_TYPE

    for credential_type, pattern in CREDENTIAL_RULES:
        if pattern.search(text):
            return credential_type

    return DEFAULT_CREDENTIAL_TYPE


def resolve_credential_type(record: Any) -> str:
    """Read ``credential_type`` off a record, deriving it when absent.

    Supabase rows predating the migration, and any CSV fallback that has not
    been backfilled, simply lack the column. Deriving on read means the badge is
    correct either way.
    """
    stored = ""
    if hasattr(record, "get"):
        stored = str(record.get("credential_type") or "").strip().lower()

    if stored in CREDENTIAL_TYPES:
        return stored

    title = record.get("course_or_certification_title") if hasattr(record, "get") else record
    return classify_credential_type(title)


def grants_credential(credential_type: str) -> bool:
    return str(credential_type or "").strip().lower() in CREDENTIAL_GRANTING


def credential_label(credential_type: str) -> str:
    return CREDENTIAL_LABELS.get(
        str(credential_type or "").strip().lower(),
        CREDENTIAL_LABELS[DEFAULT_CREDENTIAL_TYPE],
    )
