"""Thin ESCO API client with an on-disk cache.

The public ESCO web service exposes the whole classification, so the bulk
download is optional. Two endpoints matter here:

    /search                 text -> candidate concepts
    /resource/skill?uri=    full record: alternativeLabel, broaderSkill,
                            broaderHierarchyConcept, description

Everything is cached to JSON keyed by request, because enriching 680 skills is
~1,400 calls and a re-run after a crash should cost nothing. Be polite: the
service is a public good and there is no reason to hammer it.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE = "https://ec.europa.eu/esco/api"
CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "corpus" / "reference" / "esco_cache"


class EscoClient:
    def __init__(
        self,
        cache_dir: Optional[Path] = None,
        pause: float = 0.25,
        timeout: int = 25,
        language: str = "en",
    ) -> None:
        self.cache_dir = Path(cache_dir or CACHE_DIR)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.pause = pause
        self.timeout = timeout
        self.language = language
        self.calls = 0
        self.cache_hits = 0
        self.errors = 0

    def _cache_path(self, path: str, params: Dict[str, Any]) -> Path:
        key = hashlib.sha1(
            (path + json.dumps(params, sort_keys=True)).encode("utf-8")
        ).hexdigest()[:20]
        return self.cache_dir / f"{key}.json"

    def _get(self, path: str, **params: Any) -> Optional[Dict[str, Any]]:
        params.setdefault("language", self.language)
        cache_path = self._cache_path(path, params)

        if cache_path.exists():
            self.cache_hits += 1
            try:
                return json.loads(cache_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                cache_path.unlink(missing_ok=True)

        url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
        try:
            with urllib.request.urlopen(url, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError):
            self.errors += 1
            payload = None

        self.calls += 1
        cache_path.write_text(json.dumps(payload), encoding="utf-8")
        time.sleep(self.pause)
        return payload

    # ---- endpoints -------------------------------------------------------

    def search_skill(self, text: str, limit: int = 5) -> List[Dict[str, str]]:
        data = self._get("/search", text=text[:180], type="skill", limit=limit)
        if not data:
            return []
        return [
            {"title": hit.get("title", ""), "uri": hit.get("uri", "")}
            for hit in data.get("_embedded", {}).get("results", [])
            if hit.get("uri")
        ]

    def skill(self, uri: str) -> Optional[Dict[str, Any]]:
        return self._get("/resource/skill", uri=uri)

    # ---- convenience -----------------------------------------------------

    def alt_labels(self, record: Dict[str, Any]) -> List[str]:
        if not record:
            return []
        alt = record.get("alternativeLabel", {}) or {}
        values = alt.get(self.language, [])
        if isinstance(values, str):
            values = [values]
        return [str(v).strip() for v in values if str(v).strip()]

    def preferred_label(self, record: Dict[str, Any]) -> str:
        if not record:
            return ""
        return str((record.get("preferredLabel", {}) or {}).get(self.language, "")).strip()

    def description(self, record: Dict[str, Any]) -> str:
        if not record:
            return ""
        node = (record.get("description", {}) or {}).get(self.language, {})
        if isinstance(node, dict):
            return str(node.get("literal", "")).strip()
        return str(node).strip()

    def broader(self, record: Dict[str, Any]) -> Dict[str, List[str]]:
        links = (record or {}).get("_links", {}) or {}
        return {
            "broader_skill": [b.get("title", "") for b in links.get("broaderSkill", [])],
            "broader_hierarchy": [
                b.get("title", "") for b in links.get("broaderHierarchyConcept", [])
            ],
        }

    def stats(self) -> Dict[str, int]:
        return {"network_calls": self.calls, "cache_hits": self.cache_hits, "errors": self.errors}
