"""Deprecated Jooble adapter, retained for historical reproducibility.

The collection CLI blocks this source and normalization excludes Jooble-origin
records. This adapter returns snippets, unsuitable for skill requirements.
No claim about current subscription quotas is made here.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Iterator, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ..config import JOOBLE_API_KEY, JOOBLE_HOST
from .base import JobSource, RawPosting, register


@register
class JoobleSource(JobSource):
    name = "jooble"
    access_basis = "public API (registered key)"
    licence = "Jooble API terms; postings remain Jooble/partner content"
    tos_url = "https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation"

    def __init__(
        self,
        api_key: Optional[str] = None,
        host: Optional[str] = None,
        results_per_page: int = 100,
        request_budget: int = 400,
        pause_seconds: float = 1.0,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.api_key = (api_key or JOOBLE_API_KEY).strip()
        self.host = (host or JOOBLE_HOST).strip()
        self.results_per_page = results_per_page
        self.request_budget = request_budget
        self.pause_seconds = pause_seconds
        self.requests_used = 0

        if not self.api_key:
            raise ValueError(
                "No Jooble API key. Register at https://jooble.org/api/about for the "
                "Philippine domain and export JOOBLE_API_KEY. Note the free plan is a "
                "500-request LIFETIME quota, so do not burn it on exploratory calls."
            )

    def _post(self, body: Dict[str, Any]) -> Dict[str, Any]:
        if self.requests_used >= self.request_budget:
            raise RuntimeError(
                f"Request budget of {self.request_budget} exhausted. Raise it only if "
                f"you know how much of the 500-request lifetime quota remains."
            )

        request = Request(
            f"https://{self.host}/api/{self.api_key}",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        self.requests_used += 1

        try:
            with urlopen(request, timeout=45) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            raise RuntimeError(f"Jooble HTTP {exc.code}: {exc.read()[:400]!r}") from exc
        except URLError as exc:
            raise RuntimeError(f"Jooble unreachable: {exc.reason}") from exc

    def fetch(
        self,
        keywords: Optional[List[str]] = None,
        locations: Optional[List[str]] = None,
        max_pages_per_query: int = 3,
        seen_queries: Optional[set] = None,
        **kwargs: Any,
    ) -> Iterator[RawPosting]:
        keywords = keywords or ["*"]
        locations = locations or ["Philippines"]
        seen_queries = seen_queries if seen_queries is not None else set()

        for keyword in keywords:
            for location in locations:
                for page in range(1, max_pages_per_query + 1):
                    query_key = f"{keyword}|{location}|{page}"
                    if query_key in seen_queries:
                        continue

                    try:
                        data = self._post({
                            "keywords": keyword,
                            "location": location,
                            "page": page,
                            "ResultOnPage": self.results_per_page,
                        })
                    except RuntimeError as exc:
                        print(f"  ! {query_key}: {exc}")
                        return

                    jobs = data.get("jobs") or []
                    seen_queries.add(query_key)

                    if not jobs:
                        break

                    for job in jobs:
                        snippet = str(job.get("snippet", "") or "")
                        yield self._stamp(
                            source_id=job.get("id", ""),
                            payload={
                                "title": job.get("title", ""),
                                "company": job.get("company", ""),
                                "location": job.get("location", ""),
                                "description": snippet,
                                "description_is_snippet": True,
                                "salary": job.get("salary", ""),
                                "employment_type": job.get("type", ""),
                                "posted": job.get("updated", ""),
                                "origin_board": job.get("source", ""),
                                "query_keyword": keyword,
                                "query_location": location,
                            },
                            source_url=job.get("link", ""),
                            notes=f"page={page} of query '{keyword}' @ {location}",
                        )

                    if len(jobs) < self.results_per_page:
                        break

                    time.sleep(self.pause_seconds)
