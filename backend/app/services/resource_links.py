"""Resolve a usable link for a learning resource.

The catalog's stored links are mostly not links to anything. Of 243 rows, two
were real course pages; the rest were provider search URLs frozen at generation
time, bare provider homepages, or empty. Storing a search URL as though it were
a course page is the worst of both: it goes stale like a deep link, but it never
had a deep link's precision.

So stop storing them. A search URL is a pure function of (provider, subject) and
is better computed at read time, when the candidate's actual skill gap is known
and can steer the query. Only genuine course pages are worth persisting.

Every resolved link carries a ``kind`` saying what it really is:

    canonical        a real page for this specific resource
    provider_search  a live search of the named provider's catalog
    web_search       a general web search; the provider is unknown or unnamed

The UI labels the button from the kind, so a search never presents itself as the
course. That is the same principle as credential_type: say what is actually
known, and let the interface be honest about the rest.
"""

from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import quote_plus, urlparse

LINK_CANONICAL = "canonical"
LINK_PROVIDER_SEARCH = "provider_search"
LINK_WEB_SEARCH = "web_search"

#: Search endpoints verified 2026-08-27. Udemy answers 403 to scripted requests
#: but serves the page normally in a browser.
PROVIDER_SEARCH_TEMPLATES: dict[str, str] = {
    "coursera": "https://www.coursera.org/search?query={query}",
    "edx": "https://www.edx.org/search?q={query}",
    "udemy": "https://www.udemy.com/courses/search/?q={query}",
    "microsoft": "https://learn.microsoft.com/en-us/search/?terms={query}",
    "cisco networking academy": "https://www.netacad.com/catalog?search={query}",
    "tesda": "https://e-tesda.gov.ph/course/search.php?search={query}",
    "upou model": "https://model.upou.edu.ph/course/search.php?search={query}",
    "ibm skillsbuild": "https://skillsbuild.org/",
}

WEB_SEARCH_TEMPLATE = "https://duckduckgo.com/?q={query}"

#: Providers whose template ignores {query} -- a search there is no better than
#: the homepage, so do not dress it up as one.
_QUERYLESS_PROVIDERS = {"ibm skillsbuild"}

#: Titles in the generated rows read "Certificate Pathway: SQL". The subject is
#: what follows the colon; the prefix is boilerplate.
_TITLE_PREFIX = re.compile(
    r"^\s*(?:certificate pathway|foundations course|practical skills certificate|career readiness course)\s*:\s*",
    re.IGNORECASE,
)

_SEARCH_URL = re.compile(r"/search|[?&]q=|[?&]query=|[?&]terms=|[?&]search=", re.IGNORECASE)


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def normalize_provider(value: Any) -> str:
    """Map a catalog provider string onto a search template key.

    'Coursera / Google' and 'Coursera' are the same catalog; 'Other Trusted
    Provider' is not a provider at all.
    """
    name = _text(value).lower()
    if not name or name.startswith("other"):
        return ""

    for key in PROVIDER_SEARCH_TEMPLATES:
        if key in name:
            return key

    # 'Coursera / Google' -> try the leading segment.
    head = re.split(r"[/|,]", name)[0].strip()
    return head if head in PROVIDER_SEARCH_TEMPLATES else ""


def classify_stored_link(url: Any) -> str:
    """Say what a stored link actually is, without trusting that it is a page."""
    text = _text(url)
    if not text:
        return ""
    if _SEARCH_URL.search(text):
        return LINK_PROVIDER_SEARCH
    try:
        parsed = urlparse(text)
    except ValueError:
        return ""
    if not parsed.netloc:
        return ""
    # A bare homepage identifies a provider, not a resource.
    return LINK_CANONICAL if parsed.path.strip("/") else LINK_PROVIDER_SEARCH


def subject_from_title(title: Any) -> str:
    """Strip the generated-title boilerplate down to the subject."""
    text = _text(title)
    return _TITLE_PREFIX.sub("", text).strip() or text


def build_query(record: Any, gap_skill: Optional[str] = None) -> str:
    """Best available search term, most specific first.

    The candidate's own gap skill wins: it is why this resource is on screen at
    all, and it is more useful than a title the generator wrote.
    """
    for candidate in (
        _text(gap_skill),
        subject_from_title(record.get("course_or_certification_title") if hasattr(record, "get") else record),
        _text(record.get("skills_youll_gain")).split(",")[0] if hasattr(record, "get") else "",
        _text(record.get("category_name")) if hasattr(record, "get") else "",
    ):
        if candidate:
            return candidate
    return ""


def build_resource_url(record: Any, gap_skill: Optional[str] = None) -> tuple[str, str]:
    """Return ``(url, kind)`` for a resource.

    A stored canonical page always wins -- those are the hand-curated
    certification links and they are the whole reason to keep the column. A
    stored *search* URL is discarded and rebuilt, because a fresh query aimed at
    the candidate's actual gap beats one frozen at generation time.
    """
    stored = _text(record.get("external_course_or_certification_link") if hasattr(record, "get") else "")
    if stored and classify_stored_link(stored) == LINK_CANONICAL:
        return stored, LINK_CANONICAL

    query = build_query(record, gap_skill)
    provider_key = normalize_provider(record.get("offered_by_provider") if hasattr(record, "get") else "")

    if provider_key:
        template = PROVIDER_SEARCH_TEMPLATES[provider_key]
        if provider_key in _QUERYLESS_PROVIDERS or not query:
            return template.format(query=""), LINK_PROVIDER_SEARCH
        return template.format(query=quote_plus(query)), LINK_PROVIDER_SEARCH

    if stored:
        # Unknown provider but a stored search/homepage URL: better than nothing.
        return stored, LINK_PROVIDER_SEARCH

    if not query:
        return "", ""

    provider_name = _text(record.get("offered_by_provider") if hasattr(record, "get") else "")
    terms = query if provider_name.lower().startswith("other") or not provider_name else f"{query} {provider_name}"
    return WEB_SEARCH_TEMPLATE.format(query=quote_plus(f"{terms} course certification")), LINK_WEB_SEARCH


#: Button copy, so the interface never calls a search a course.
LINK_LABELS = {
    LINK_CANONICAL: "Open Resource",
    LINK_PROVIDER_SEARCH: "Find on provider site",
    LINK_WEB_SEARCH: "Search the web",
}


#: Long provider names overflow the button; these are the display forms.
PROVIDER_SHORT_NAMES = {
    "cisco networking academy": "Cisco NetAcad",
    "ibm skillsbuild": "SkillsBuild",
    "upou model": "UPOU MODeL",
}


def link_label(kind: str, provider: Any = "") -> str:
    if kind != LINK_PROVIDER_SEARCH:
        return LINK_LABELS.get(kind, "Open Resource")

    name = _text(provider)
    if not name or name.lower().startswith("other"):
        return LINK_LABELS[LINK_PROVIDER_SEARCH]

    key = normalize_provider(name)
    display = PROVIDER_SHORT_NAMES.get(key) or name.split("/")[0].strip()
    return f"Find on {display}"
