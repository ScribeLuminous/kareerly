"""Import Philippine job listings from the Jooble API into ``internal_jobs``.

    python -m backend.scripts.import_jooble_jobs --dry-run             # fetch and report, write nothing
    python -m backend.scripts.import_jooble_jobs                        # fetch, upsert, expire stale rows
    python -m backend.scripts.import_jooble_jobs --request-budget 5 --max-queries 5
    python -m backend.scripts.import_jooble_jobs --dry-run --csv jooble_listings.csv   # every listing and its outcome

Needs JOOBLE_API_KEY (from https://jooble.org/api/about) and, unless
``--dry-run``, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The searches are in
``backend/data/jooble_queries.json``; each search is one Jooble request.

Jooble returns a short snippet, not the full posting, so an imported job is a
lead to the original listing rather than a complete requirement list:

* Required skills are only those the title names, or a snippet sentence states
  as required. Other skills in the snippet are nice-to-have. A snippet that
  names no known skill is skipped: it could not be matched on skills at all.
* The category is the search's category only when the listing reads like that
  career area; otherwise it is left blank rather than guessed.
* Work setup, level and a monthly PHP salary are filled only when stated.
* Rows are ``source_platform = 'Jooble'`` with the Jooble link as
  ``source_url``, so candidates see "Visit job site" instead of Apply, and
  ``is_synthetic_seed = false``. The research corpus already excludes Jooble
  origin (``pipeline/source_policy.py``), and skill discovery skips these rows.
* Listings not seen for ``--expire-after-days`` are set to ``expired``. Rows an
  admin closed or put in draft are never reopened.
"""
from __future__ import annotations

import argparse
import html
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

from backend.app.learning.supabase_client import SupabaseError, SupabaseRest

logger = logging.getLogger("kareerly.import_jooble_jobs")

BACKEND_DIR = Path(__file__).resolve().parents[1]
QUERIES_PATH = BACKEND_DIR / "data" / "jooble_queries.json"
CATEGORY_REFERENCE_PATH = BACKEND_DIR / "data" / "category_reference.csv"

SOURCE_PLATFORM = "Jooble"
JOB_ID_PREFIX = "JOOBLE-"
DEFAULT_HOST = "ph.jooble.org"
MIN_SNIPPET_CHARS = 40
EXPIRED_STATUS = "expired"
# Statuses an admin sets by hand; an import never overrides them.
ADMIN_STATUSES = ("closed", "draft")

HTML_TAG = re.compile(r"<[^>]+>")
WHITESPACE = re.compile(r"\s+")
REMOTE = re.compile(r"\b(?:remote|work[\s-]*from[\s-]*home|wfh|home[\s-]*based|telecommut\w*)\b", re.IGNORECASE)
HYBRID = re.compile(r"\bhybrid\b", re.IGNORECASE)
ONSITE = re.compile(r"\b(?:on[\s-]?site|onsite|office[\s-]*based|skeleton\s+work(?:force)?)\b", re.IGNORECASE)

# Title words, checked in this order; the first group that matches wins, so
# "Senior Accounting Manager" is a manager and "Junior Staff Accountant" entry.
LEVEL_PATTERNS = (
    ("Entry level", re.compile(r"\b(?:intern(?:ship)?|ojt|trainee|junior|jr\.?|entry[\s-]*level|fresh\s*grad\w*)\b", re.I)),
    ("Manager", re.compile(r"\b(?:manager|head\s+of|director|supervisor)\b", re.I)),
    ("Senior", re.compile(r"\b(?:senior|sr\.?|lead|principal)\b", re.I)),
    ("Mid", re.compile(r"\b(?:mid[\s-]*level|intermediate)\b", re.I)),
)
EMPLOYMENT_TYPES = (
    ("Internship", re.compile(r"intern|ojt", re.I)),
    ("Part-Time", re.compile(r"part[\s-]*time", re.I)),
    ("Contract", re.compile(r"contract|temporary|temp\b|fixed[\s-]*term|seasonal", re.I)),
    ("Project-Based", re.compile(r"project|freelance", re.I)),
    ("Full-Time", re.compile(r"full[\s-]*time|permanent|regular", re.I)),
)
SALARY_NUMBER = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?\b", re.IGNORECASE)
FOREIGN_CURRENCY = re.compile(r"[$€£¥]|\b(?:usd|eur|gbp|aud|sgd|cad|jpy)\b", re.IGNORECASE)


def clean(value: Any) -> str:
    text = html.unescape(str(value or "")).replace("\xa0", " ")
    return WHITESPACE.sub(" ", HTML_TAG.sub(" ", text)).strip()


def work_setup(*texts: str) -> str:
    """Remote, Hybrid or Onsite when the listing says so, else "" (never guessed)."""
    joined = " ".join(texts)
    if HYBRID.search(joined):
        return "Hybrid"
    if REMOTE.search(joined):
        return "Remote"
    if ONSITE.search(joined):
        return "Onsite"
    return ""


def job_level(title: str) -> str:
    for level, pattern in LEVEL_PATTERNS:
        if pattern.search(title):
            return level
    return ""


def employment_type(value: str) -> str:
    for label, pattern in EMPLOYMENT_TYPES:
        if pattern.search(value or ""):
            return label
    return ""


def monthly_salary_php(raw: str) -> tuple[Optional[int], Optional[int]]:
    """A monthly PHP range from Jooble's salary text, or (None, None).

    Hourly pay and foreign currencies are left out: turning them into a monthly
    peso figure would be a guess.
    """
    text = clean(raw).lower()
    if not text or FOREIGN_CURRENCY.search(text) or re.search(r"\b(?:per\s+hour|/\s*h(?:ou)?r|hourly)\b", text):
        return None, None
    factor = 1.0
    if re.search(r"\b(?:per\s+(?:year|annum)|/\s*y(?:ea)?r|annual(?:ly)?|yearly|p\.a\.)", text):
        factor = 1 / 12
    elif re.search(r"\b(?:per\s+day|/\s*day|daily)\b", text):
        factor = 22
    elif re.search(r"\b(?:per\s+week|/\s*week|weekly)\b", text):
        factor = 52 / 12
    values = []
    for number, suffix in SALARY_NUMBER.findall(text):
        try:
            amount = float(number.replace(",", "")) * (1000 if suffix else 1) * factor
        except ValueError:
            continue
        if 1_000 <= amount <= 2_000_000:
            values.append(int(round(amount)))
    if not values:
        return None, None
    return min(values), max(values)


def posted_at(value: Any) -> Optional[datetime]:
    text = clean(value)
    if not text:
        return None
    # Jooble sends seven fractional digits ("2026-09-20T00:00:00.0000000"); Python reads six.
    text = re.sub(r"(\.\d{6})\d+", r"\1", text).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Jooble API
# ---------------------------------------------------------------------------

class JoobleError(RuntimeError):
    pass


class JoobleClient:
    """POST https://<host>/api/<key> with a JSON search; one call is one request of the key's quota."""

    def __init__(self, api_key: str, host: str = DEFAULT_HOST, *, request_budget: int, pause_seconds: float = 1.0,
                 opener: Callable[..., Any] = urlopen):
        if not api_key:
            raise JoobleError("JOOBLE_API_KEY is not set. Request a key at https://jooble.org/api/about.")
        self.api_key = api_key
        self.host = host
        self.request_budget = request_budget
        self.pause_seconds = pause_seconds
        self.requests_used = 0
        self._opener = opener

    @property
    def budget_left(self) -> int:
        return self.request_budget - self.requests_used

    def search(self, keywords: str, location: str, page: int = 1, per_page: int = 50) -> List[Dict[str, Any]]:
        if self.budget_left <= 0:
            raise JoobleError(f"Request budget of {self.request_budget} used up.")
        if self.requests_used and self.pause_seconds:
            time.sleep(self.pause_seconds)
        body = {"keywords": keywords, "location": location, "page": str(page), "ResultOnPage": str(per_page)}
        request = Request(f"https://{self.host}/api/{self.api_key}", data=json.dumps(body).encode("utf-8"),
                          headers={"Content-Type": "application/json"}, method="POST")
        self.requests_used += 1
        try:
            with self._opener(request, timeout=45) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            # Never echo the URL: it contains the key.
            raise JoobleError(f"Jooble answered HTTP {exc.code} for '{keywords}'.") from None
        except (URLError, TimeoutError, OSError) as exc:
            raise JoobleError(f"Jooble could not be reached: {getattr(exc, 'reason', exc)}") from None
        except json.JSONDecodeError:
            raise JoobleError(f"Jooble returned something other than JSON for '{keywords}'.") from None
        jobs = payload.get("jobs") if isinstance(payload, dict) else None
        return [job for job in jobs or [] if isinstance(job, dict)]


# ---------------------------------------------------------------------------
# Listing -> internal_jobs row
# ---------------------------------------------------------------------------

def _category_names() -> Dict[str, str]:
    import csv

    with CATEGORY_REFERENCE_PATH.open(newline="", encoding="utf-8") as handle:
        return {row["category_id"].strip().upper(): row["category_name"].strip() for row in csv.DictReader(handle)}


@dataclass
class Skills:
    required: List[str] = field(default_factory=list)
    preferred: List[str] = field(default_factory=list)
    required_ids: List[str] = field(default_factory=list)


def listing_skills(title: str, snippet: str) -> Skills:
    """Skills the title names or the snippet states as required; the rest of the snippet's are nice-to-have."""
    from backend.app.services.external_job_analysis import REQUIRED, PREFERRED, UNCLASSIFIED, _requirement_names, classify_requirements
    from backend.app.services.matching_service import extract_skills_from_text

    title_skills = [item["skill_name"] for item in extract_skills_from_text(title, max_skills=None) if item.get("skill_name")]
    # Snippets are one run of text; split sentences so "X is a plus" applies to its own sentence only.
    classified = classify_requirements("\n".join(re.split(r"(?<=[.;!?])\s+", snippet)))
    required_names, required_ids = _requirement_names(title_skills + classified[REQUIRED])
    required_keys = {name.casefold() for name in required_names}
    preferred_names, _ = _requirement_names(
        [name for name in classified[PREFERRED] + classified[UNCLASSIFIED] if name.casefold() not in required_keys])
    # As for pasted jobs: IDs only when every requirement has one, so coverage
    # is never computed over fewer requirements than were listed.
    return Skills(required_names, preferred_names, required_ids if len(required_ids) == len(required_names) else [])


def listing_category(title: str, snippet: str, category_code: str, names: Dict[str, str]) -> tuple[str, str]:
    """The search's category when the listing reads like its career area, else ("", "")."""
    from backend.app.services.matching_service import CAREER_AREA_JOB_CATEGORIES, _closest_area, career_area_by_category_id

    code = (category_code or "").strip().upper()
    area = career_area_by_category_id().get(code, "")
    if not area or code not in names:
        return "", ""
    closest = _closest_area({"job_title": title, "job_description": snippet}, list(CAREER_AREA_JOB_CATEGORIES))
    return (code, names[code]) if closest == area else ("", "")


def listing_to_row(listing: Dict[str, Any], query: Dict[str, Any], *, names: Dict[str, str], now: datetime,
                   today: str) -> tuple[Optional[Dict[str, Any]], str]:
    """(row, "") for an importable listing, or (None, reason it was skipped)."""
    jooble_id = clean(listing.get("id"))
    title = clean(listing.get("title"))
    snippet = clean(listing.get("snippet"))
    link = clean(listing.get("link"))
    if not jooble_id or not title or not link.startswith("https://"):
        return None, "missing id, title or link"
    if len(snippet) < MIN_SNIPPET_CHARS:
        return None, "snippet too short"
    skills = listing_skills(title, snippet)
    if not skills.required and not skills.preferred:
        return None, "no known skill in title or snippet"

    location = clean(listing.get("location"))
    category_code, category_name = listing_category(title, snippet, query.get("category_code", ""), names)
    salary_min, salary_max = monthly_salary_php(listing.get("salary", ""))
    origin = clean(listing.get("source"))
    return {
        "job_id": f"{JOB_ID_PREFIX}{jooble_id}",
        "job_title": title,
        "company_name": clean(listing.get("company")) or None,
        "location": location or None,
        "category_code": category_code or None,
        "category_name": category_name or None,
        "work_setup": work_setup(title, location, snippet) or None,
        "employment_type": employment_type(clean(listing.get("type"))) or None,
        "job_level": job_level(title) or None,
        "salary_min_php": salary_min,
        "salary_max_php": salary_max,
        "job_description": snippet,
        "required_skills": "; ".join(skills.required) or None,
        "preferred_skills": "; ".join(skills.preferred) or None,
        "must_have_skill_ids": ";".join(skills.required_ids) or None,
        "source_platform": SOURCE_PLATFORM,
        "source_url": link,
        "source_note": f"Jooble listing (snippet only), last imported {today}"
                       + (f"; originally posted on {origin}" if origin else "")
                       + f"; search '{query.get('keywords', '')}'",
        "is_synthetic_seed": False,
        "posting_status": "active",
        "updated_at": now.isoformat(),
    }, ""


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

def load_queries(path: Path = QUERIES_PATH) -> tuple[str, List[Dict[str, Any]]]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    queries = [q for q in plan.get("queries", []) if isinstance(q, dict) and clean(q.get("keywords"))]
    return clean(plan.get("location")) or "Philippines", queries


def _fingerprint(row: Dict[str, Any]) -> str:
    return "|".join(re.sub(r"[^a-z0-9]+", " ", str(row.get(key) or "").lower()).strip()
                    for key in ("job_title", "company_name", "location"))


def collect(client: JoobleClient, queries: Iterable[Dict[str, Any]], location: str, *, pages: int, per_page: int,
            max_age_days: int, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    today = now.date().isoformat()
    oldest = now - timedelta(days=max_age_days)
    names = _category_names()
    rows: Dict[str, Dict[str, Any]] = {}
    fingerprints: set[str] = set()
    skipped: Dict[str, int] = {}
    errors: List[str] = []
    listings_log: List[Dict[str, Any]] = []
    seen = 0

    def skip(reason: str) -> None:
        skipped[reason] = skipped.get(reason, 0) + 1
        listings_log[-1]["skip_reason"] = reason

    for query in queries:
        for page in range(1, pages + 1):
            if client.budget_left <= 0:
                break
            try:
                listings = client.search(query["keywords"], location, page=page, per_page=per_page)
            except JoobleError as exc:
                errors.append(str(exc))
                break
            seen += len(listings)
            for listing in listings:
                listings_log.append({"query": query, "page": page, "listing": listing, "row": None, "skip_reason": ""})
                posted = posted_at(listing.get("updated"))
                if posted and posted < oldest:
                    skip(f"older than {max_age_days} days")
                    continue
                row, reason = listing_to_row(listing, query, names=names, now=now, today=today)
                if row is None:
                    skip(reason)
                    continue
                fingerprint = _fingerprint(row)
                if row["job_id"] in rows or fingerprint in fingerprints:
                    skip("duplicate")
                    continue
                rows[row["job_id"]] = row
                fingerprints.add(fingerprint)
                listings_log[-1]["row"] = row
            if len(listings) < per_page:
                break
    return {"rows": list(rows.values()), "listings": listings_log, "listings_seen": seen, "skipped": skipped,
            "errors": errors, "requests_used": client.requests_used}


CSV_COLUMNS = (
    "outcome", "skip_reason", "search_keywords", "search_category_code", "page", "jooble_id", "title", "company",
    "location", "salary", "type", "updated", "original_source", "link", "snippet", "job_id", "category_code",
    "category_name", "work_setup", "employment_type", "job_level", "salary_min_php", "salary_max_php",
    "required_skills", "preferred_skills", "must_have_skill_ids",
)
ROW_COLUMNS = ("job_id", "category_code", "category_name", "work_setup", "employment_type", "job_level",
               "salary_min_php", "salary_max_php", "required_skills", "preferred_skills", "must_have_skill_ids")


def write_csv(path: Path, listings: List[Dict[str, Any]]) -> int:
    """Every listing Jooble returned, as it came, with what the import did with it."""
    import csv

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:  # BOM so Excel reads ₱ and accents
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for entry in listings:
            listing, row = entry["listing"], entry["row"] or {}
            writer.writerow({
                "outcome": "imported" if entry["row"] else "skipped",
                "skip_reason": entry["skip_reason"],
                "search_keywords": entry["query"].get("keywords", ""),
                "search_category_code": entry["query"].get("category_code", ""),
                "page": entry["page"],
                "jooble_id": clean(listing.get("id")),
                "title": clean(listing.get("title")),
                "company": clean(listing.get("company")),
                "location": clean(listing.get("location")),
                "salary": clean(listing.get("salary")),
                "type": clean(listing.get("type")),
                "updated": clean(listing.get("updated")),
                "original_source": clean(listing.get("source")),
                "link": clean(listing.get("link")),
                "snippet": clean(listing.get("snippet")),
                **{column: "" if row.get(column) is None else row.get(column) for column in ROW_COLUMNS},
            })
    return len(listings)


def _in_filter(values: List[str]) -> str:
    return "in.(" + ",".join('"' + value.replace('"', '') + '"' for value in values) + ")"


def save(supabase: SupabaseRest, rows: List[Dict[str, Any]], *, expire_after_days: int,
         now: Optional[datetime] = None) -> Dict[str, int]:
    """Upsert the rows (leaving admin-closed ones alone) and expire listings not seen lately."""
    now = now or datetime.now(timezone.utc)
    held_back: set[str] = set()
    for start in range(0, len(rows), 200):
        ids = [row["job_id"] for row in rows[start:start + 200]]
        for existing in supabase.select("internal_jobs", {"select": "job_id", "job_id": _in_filter(ids),
                                                          "posting_status": _in_filter(list(ADMIN_STATUSES))}):
            held_back.add(str(existing["job_id"]))
    to_write = [row for row in rows if row["job_id"] not in held_back]
    for start in range(0, len(to_write), 200):
        supabase.insert("internal_jobs", to_write[start:start + 200], upsert_on="job_id", returning=False)

    cutoff = (now - timedelta(days=expire_after_days)).isoformat()
    expired = supabase.update("internal_jobs", {
        "source_platform": f"eq.{SOURCE_PLATFORM}",
        "posting_status": "eq.active",
        "updated_at": f"lt.{cutoff}",
    }, {"posting_status": EXPIRED_STATUS, "updated_at": now.isoformat()})
    return {"upserted": len(to_write), "left_closed_by_admin": len(held_back), "expired": len(expired)}


def main(argv: Optional[List[str]] = None) -> int:
    load_dotenv(BACKEND_DIR.parent / ".env")
    load_dotenv(BACKEND_DIR / ".env")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    parser.add_argument("--queries", type=Path, default=QUERIES_PATH, help="search plan (JSON)")
    parser.add_argument("--max-queries", type=int, default=0, help="run only the first N searches (0 = all)")
    parser.add_argument("--pages", type=int, default=1, help="result pages per search (each page is one request)")
    parser.add_argument("--per-page", type=int, default=50, help="results per page")
    parser.add_argument("--request-budget", type=int, default=40,
                        help="most Jooble requests this run may make; keep it within your key's quota")
    parser.add_argument("--max-age-days", type=int, default=30, help="skip listings Jooble dates older than this")
    parser.add_argument("--expire-after-days", type=int, default=21,
                        help="set imported listings not seen again for this long to expired")
    parser.add_argument("--sample", type=int, default=5, help="rows to print in the report")
    parser.add_argument("--csv", type=Path, help="also write every listing Jooble returned, and its outcome, to this CSV")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    try:
        client = JoobleClient(os.getenv("JOOBLE_API_KEY", "").strip(), os.getenv("JOOBLE_HOST", DEFAULT_HOST).strip(),
                              request_budget=max(0, args.request_budget))
    except JoobleError as exc:
        print(json.dumps({"skipped": True, "reason": str(exc)}))
        return 0
    supabase = None
    if not args.dry_run:
        try:
            supabase = SupabaseRest.service_role()
        except SupabaseError as exc:
            print(json.dumps({"skipped": True, "reason": str(exc)}))
            return 0

    location, queries = load_queries(args.queries)
    if args.max_queries > 0:
        queries = queries[:args.max_queries]
    result = collect(client, queries, location, pages=max(1, args.pages), per_page=max(1, args.per_page),
                     max_age_days=args.max_age_days)
    rows = result.pop("rows")
    listings = result.pop("listings")
    report: Dict[str, Any] = {**result, "importable": len(rows), "dry_run": args.dry_run,
                              "with_required_skills": sum(1 for row in rows if row["required_skills"]),
                              "with_category": sum(1 for row in rows if row["category_code"]),
                              "sample": [{key: row[key] for key in ("job_id", "job_title", "company_name", "location",
                                                                    "category_name", "required_skills", "preferred_skills")}
                                         for row in rows[:max(0, args.sample)]]}
    if args.csv:
        report["csv"] = {"path": str(args.csv), "listings": write_csv(args.csv, listings)}
    failed = bool(result["errors"]) and not rows
    if supabase is not None and rows:
        # Expiry runs only after a run that found listings, so an outage or a
        # spent quota never closes the whole Jooble catalogue.
        try:
            report["saved"] = save(supabase, rows, expire_after_days=args.expire_after_days)
        except SupabaseError as exc:
            report["save_error"] = str(exc)
            failed = True
    print(json.dumps(report, indent=2, default=str))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
