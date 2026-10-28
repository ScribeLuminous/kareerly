"""Certificate links (for example Credly badges) and whether they point to a real badge.

Most certificates are no longer PDFs: they are shared as a link to a badge page
on a provider such as Credly. A candidate may add one as proof of a skill.

For Credly the page is fetched and read, so a link that is made up, mistyped or
points somewhere else is caught. Any other https link is accepted as a plain
link and reported as not checked. Nothing here says the badge belongs to the
candidate or that the issuer is genuine: the badge page names its recipient,
and a reviewer should read it.

Only the Credly host is ever fetched, over https, with a short timeout and a
size limit, and redirects are followed only within that host, so a candidate
cannot use this to make the server request an arbitrary address.
"""

from __future__ import annotations

import html
import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Callable, Optional

MAX_URL_LENGTH = 500
MAX_BYTES = 1_000_000
TIMEOUT_SECONDS = 8

CREDLY_HOSTS = {"credly.com", "www.credly.com"}
_CREDLY_PATH = re.compile(r"^/badges/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/public_url)?/?$", re.IGNORECASE)
_HOST_LABELS = {
    "credly.com": "Credly",
    "www.credly.com": "Credly",
    "credential.net": "Accredible",
    "www.credential.net": "Accredible",
    "badgr.com": "Badgr",
    "www.linkedin.com": "LinkedIn",
    "coursera.org": "Coursera",
    "www.coursera.org": "Coursera",
}

# Outcomes. Only "verified" means a real badge page was found and read.
VERIFIED = "verified"
NOT_FOUND = "not_found"
UNREACHABLE = "unreachable"
NOT_CHECKED = "not_checked"
INVALID = "invalid"


class CredentialLinkError(ValueError):
    """The text is not a usable certificate link."""


def normalize_credential_url(value: str) -> str:
    """The link as a clean https URL, or raises CredentialLinkError.

    Refuses anything but http(s), embedded passwords, addresses that are not
    public host names (localhost, IPs) and over-long values."""
    text = (value or "").strip()
    if not text:
        raise CredentialLinkError("Paste the link to your certificate or badge.")
    if len(text) > MAX_URL_LENGTH:
        raise CredentialLinkError("That link is too long.")
    if not re.match(r"^[a-z][a-z0-9+.\-]*://", text, re.IGNORECASE):
        text = "https://" + text
    parts = urllib.parse.urlsplit(text)
    if parts.scheme.lower() not in {"http", "https"}:
        raise CredentialLinkError("Use a web link that starts with https://.")
    if parts.username or parts.password:
        raise CredentialLinkError("The link must not contain a username or password.")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host or "." not in host or host == "localhost" or re.fullmatch(r"[0-9.]+", host) or ":" in host:
        raise CredentialLinkError("Use the public web address of the badge, not an IP address or local address.")
    if not re.fullmatch(r"[a-z0-9.\-]+", host):
        raise CredentialLinkError("That link does not look like a web address.")
    return urllib.parse.urlunsplit(("https", host + (f":{parts.port}" if parts.port and parts.port != 443 else ""), parts.path or "/", parts.query, ""))


def provider_label(url: str) -> str:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    return _HOST_LABELS.get(host, host)


def is_credly_badge_url(url: str) -> bool:
    parts = urllib.parse.urlsplit(url)
    return (parts.hostname or "").lower() in CREDLY_HOSTS and bool(_CREDLY_PATH.match(parts.path))


class _MetaReader(HTMLParser):
    """Collects <title>, og:/twitter: meta tags and JSON-LD blocks."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta: dict[str, str] = {}
        self.json_ld: list[str] = []
        self._in_title = False
        self._in_ld = False

    def handle_starttag(self, tag: str, attrs: list) -> None:
        attributes = {name.lower(): (value or "") for name, value in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (attributes.get("property") or attributes.get("name") or "").lower()
            if key and "content" in attributes:
                self.meta.setdefault(key, attributes["content"])
        elif tag == "script" and attributes.get("type", "").lower() == "application/ld+json":
            self._in_ld = True
            self.json_ld.append("")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "script":
            self._in_ld = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif self._in_ld and self.json_ld:
            self.json_ld[-1] += data


_ISSUED = re.compile(r"^(?P<badge>.+?)\s+was issued by\s+(?P<issuer>.+?)(?:\s+to\s+(?P<recipient>.+?))?\.?$", re.IGNORECASE | re.DOTALL)
_GENERIC_TITLES = {"", "credly", "page not found", "not found", "404", "404 not found", "error", "access denied", "just a moment..."}


def read_badge_page(page: str) -> Optional[dict]:
    """The badge's name, issuer and recipient from a Credly badge page, or None when the page is not a badge."""
    reader = _MetaReader()
    try:
        reader.feed(page)
    except Exception:  # malformed HTML: judge what was read so far
        pass
    heading = html.unescape(reader.meta.get("og:title") or reader.meta.get("twitter:title") or "").strip()
    match = _ISSUED.match(" ".join(heading.split()))
    if match:
        return {
            "badge_name": match.group("badge").strip()[:200],
            "issuer": match.group("issuer").strip()[:200],
            "recipient": (match.group("recipient") or "").strip()[:200],
        }
    # Without the "was issued by" sentence, a real badge page still names itself in its title.
    title = " ".join(html.unescape(reader.title).split())
    cleaned = re.sub(r"\s*[-|–]\s*Credly\s*$", "", title, flags=re.IGNORECASE).strip()
    if cleaned.lower() in _GENERIC_TITLES or title.lower() in _GENERIC_TITLES or not re.search(r"\s[-|–]\s*Credly\s*$", title, re.IGNORECASE):
        return None
    return {"badge_name": cleaned[:200], "issuer": "", "recipient": ""}


class _SameHostRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N802 (stdlib signature)
        target = urllib.parse.urlsplit(newurl)
        if target.scheme != "https" or (target.hostname or "").lower() not in CREDLY_HOSTS:
            raise urllib.error.HTTPError(newurl, code, "Redirect to another site was refused.", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_page(url: str) -> tuple[int, str]:
    """(status, body text) of a Credly page. Raises URLError or TimeoutError when it cannot be reached."""
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; KareerlyBadgeCheck/1.0)", "Accept": "text/html"})
    opener = urllib.request.build_opener(_SameHostRedirects())
    try:
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status, response.read(MAX_BYTES).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""


def check_credential_link(value: str, fetch: Callable[[str], tuple[int, str]] = fetch_page) -> dict:
    """Normalises the link and, for Credly, checks that it is a real badge page."""
    try:
        url = normalize_credential_url(value)
    except CredentialLinkError as exc:
        return {"status": INVALID, "url": "", "provider": "", "message": str(exc)}
    provider = provider_label(url)
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host in CREDLY_HOSTS:
        if not is_credly_badge_url(url):
            return {"status": NOT_FOUND, "url": url, "provider": provider,
                    "message": "That is a Credly link but not a badge link. Use the badge's public link, which looks like credly.com/badges/…"}
        try:
            code, page = fetch(url)
        except (urllib.error.URLError, TimeoutError, OSError):
            return {"status": UNREACHABLE, "url": url, "provider": provider,
                    "message": "We couldn't reach Credly to check this badge. The link was saved without being checked."}
        if code in {404, 410}:
            return {"status": NOT_FOUND, "url": url, "provider": provider, "message": "Credly has no badge at this link. Check that you copied the whole link."}
        if code != 200:
            return {"status": UNREACHABLE, "url": url, "provider": provider,
                    "message": "Credly didn't let us check this badge right now. The link was saved without being checked."}
        details = read_badge_page(page)
        if details is None:
            return {"status": NOT_FOUND, "url": url, "provider": provider, "message": "That page doesn't look like a Credly badge."}
        return {"status": VERIFIED, "url": url, "provider": provider, "message": "Credly badge found.", **details}
    return {"status": NOT_CHECKED, "url": url, "provider": provider,
            "message": f"Link saved. Kareerly can only check Credly badges, so {provider} links are shown as unchecked."}
