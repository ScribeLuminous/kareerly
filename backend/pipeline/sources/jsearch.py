"""JSearch (RapidAPI) discovery adapter.

Returns Google for Jobs/public-source listings. API access is not blanket
permission to train on or redistribute originating publishers' content.
Description completeness, Philippine location and category require review.
Use a subscription-specific request budget; num_pages may affect billing.
The original provider record is retained alongside canonical fields.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Iterator, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ..config import JSEARCH_API_KEY, JSEARCH_HOST
from .base import JobSource, RawPosting, register


def _first(record: Dict[str, Any], *keys: str, default: Any = "") -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", [], {}):
            return value
    return default


def _join_location(job: Dict[str, Any]) -> str:
    parts = [
        str(_first(job, "job_city", "city") or "").strip(),
        str(_first(job, "job_state", "state") or "").strip(),
        str(_first(job, "job_country", "country") or "").strip(),
    ]
    seen: List[str] = []
    for part in parts:
        if part and part not in seen:
            seen.append(part)
    return ", ".join(seen)


def _salary_text(job: Dict[str, Any]) -> str:
    """Rebuild a salary string the normalizer's parse_salary_php can read."""
    minimum = _first(job, "job_min_salary", "job_salary_min", default=None)
    maximum = _first(job, "job_max_salary", "job_salary_max", default=None)
    if minimum is None and maximum is None:
        return str(_first(job, "job_salary", default="") or "")

    currency = str(_first(job, "job_salary_currency", default="PHP") or "PHP")
    period = str(_first(job, "job_salary_period", default="") or "").lower()
    if minimum is not None and maximum is not None:
        amount = f"{currency} {int(float(minimum)):,} - {int(float(maximum)):,}"
    else:
        value = minimum if minimum is not None else maximum
        amount = f"{currency} {int(float(value)):,}"
    return f"{amount} per {period}" if period else amount


def _description_with_highlights(job: Dict[str, Any]) -> str:
    """Full description, with the qualifications section appended if separate.

    JSearch splits requirements into job_highlights.Qualifications. Those lines
    are usually *also* present in job_description, but not always -- appending
    them under an explicit heading is cheap and makes the requirement span
    findable by the skill extractor either way.
    """
    description = str(_first(job, "job_description", "description") or "").strip()
    highlights = job.get("job_highlights") or {}
    if not isinstance(highlights, dict):
        return description

    sections: List[str] = []
    for heading, key in (("Key Responsibilities", "Responsibilities"), ("Qualifications", "Qualifications")):
        items = highlights.get(key) or []
        if isinstance(items, list) and items:
            body = "\n".join(f"- {str(item).strip()}" for item in items if str(item).strip())
            if body and body not in description:
                sections.append(f"{heading}:\n{body}")

    return "\n\n".join([description, *sections]).strip() if sections else description


@register
class JSearchSource(JobSource):
    name = "jsearch"
    access_basis = "public API (RapidAPI subscription key)"
    licence = "RapidAPI/JSearch terms; postings remain the originating board's content"
    tos_url = "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch"

    def __init__(
        self,
        api_key: Optional[str] = None,
        host: Optional[str] = None,
        country: str = "ph",
        request_budget: int = 50,
        pause_seconds: float = 1.0,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.api_key = (api_key or JSEARCH_API_KEY).strip()
        self.host = (host or JSEARCH_HOST).strip()
        self.country = country.strip().lower()
        self.request_budget = request_budget
        self.pause_seconds = pause_seconds
        self.requests_used = 0

        if not self.api_key:
            raise ValueError(
                "No JSearch API key. Subscribe at "
                "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch and export "
                "JSEARCH_API_KEY (your X-RapidAPI-Key). Check your subscription "
                "quota before running collection."
            )

    def _get(self, params: Dict[str, Any]) -> Dict[str, Any]:
        if self.requests_used >= self.request_budget:
            raise RuntimeError(
                f"Request budget of {self.request_budget} exhausted this run. Raise "
                f"request_budget only if your RapidAPI plan has the headroom."
            )

        request = Request(
            f"https://{self.host}/search?{urlencode(params)}",
            headers={
                "X-RapidAPI-Key": self.api_key,
                "X-RapidAPI-Host": self.host,
                "Accept": "application/json",
            },
            method="GET",
        )
        self.requests_used += 1

        try:
            with urlopen(request, timeout=45) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            body = exc.read()[:400]
            if exc.code == 429:
                raise RuntimeError(f"JSearch quota exceeded (HTTP 429): {body!r}") from exc
            if exc.code in (401, 403):
                raise RuntimeError(f"JSearch rejected the key (HTTP {exc.code}): {body!r}") from exc
            raise RuntimeError(f"JSearch HTTP {exc.code}: {body!r}") from exc
        except URLError as exc:
            raise RuntimeError(f"JSearch unreachable: {exc.reason}") from exc

    def fetch(
        self,
        keywords: Optional[List[str]] = None,
        locations: Optional[List[str]] = None,
        pages_per_query: int = 1,
        date_posted: str = "all",
        employment_types: str = "",
        seen_queries: Optional[set] = None,
        **kwargs: Any,
    ) -> Iterator[RawPosting]:
        keywords = keywords or ["jobs"]
        locations = locations or ["Philippines"]
        seen_queries = seen_queries if seen_queries is not None else set()

        for keyword in keywords:
            for location in locations:
                query = f"{keyword} in {location}".strip()
                query_key = f"{query}|{pages_per_query}"
                if query_key in seen_queries:
                    continue

                params: Dict[str, Any] = {
                    "query": query,
                    "page": 1,
                    # API-call count is not a guarantee of billable units.
                    # Use one page per query for the bounded discovery pilot.
                    "num_pages": max(1, pages_per_query),
                    "country": self.country,
                    "date_posted": date_posted,
                }
                if employment_types:
                    params["employment_types"] = employment_types

                try:
                    data = self._get(params)
                except RuntimeError:
                    # The CLI must report failure, not a successful empty collection.
                    raise

                seen_queries.add(query_key)
                jobs = data.get("data") or []
                if not isinstance(jobs, list) or not jobs:
                    continue

                for job in jobs:
                    if not isinstance(job, dict):
                        continue
                    description = _description_with_highlights(job)
                    highlights = job.get("job_highlights") or {}
                    if not isinstance(highlights, dict):
                        highlights = {}
                    yield self._stamp(
                        source_id=str(_first(job, "job_id", "id") or ""),
                        payload={
                            "title": _first(job, "job_title", "title"),
                            "company": _first(job, "employer_name", "company_name"),
                            "location": _join_location(job),
                            "provider_record": job,
                            "description": description,
                            # The whole point of choosing JSearch over Jooble.
                            "description_is_snippet": False,
                            "salary": _salary_text(job),
                            "employment_type": _first(job, "job_employment_type", "employment_type"),
                            "posted": _first(job, "job_posted_at_datetime_utc", "job_posted_at"),
                            "is_remote": bool(_first(job, "job_is_remote", default=False)),
                            "origin_board": _first(job, "job_publisher", "publisher"),
                            "qualifications": highlights.get("Qualifications", []),
                            "responsibilities": highlights.get("Responsibilities", []),
                            "query_keyword": keyword,
                            "query_location": location,
                        },
                        source_url=str(_first(job, "job_apply_link", "job_google_link") or ""),
                        notes=f"query '{query}', num_pages={pages_per_query}, country={self.country}",
                    )

                time.sleep(self.pause_seconds)
