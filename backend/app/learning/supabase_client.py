"""Minimal PostgREST client for the learning jobs.

The jobs run outside FastAPI (cron, CLI), so they cannot use main._supabase_request.
Unlike supabase_jobs.py there is no built-in project default: the learning code
only talks to Supabase when SUPABASE_URL is configured, which keeps tests and
local runs offline unless a project is chosen explicitly.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional


class SupabaseError(RuntimeError):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def configured_url() -> str:
    return (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").rstrip("/")


def configured_anon_key() -> str:
    return os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or ""


class SupabaseRest:
    def __init__(self, url: str, key: str, timeout: float = 15.0):
        if not url or not key:
            raise SupabaseError("SUPABASE_URL and a Supabase key are required.")
        self.url = url.rstrip("/")
        self.key = key
        self.timeout = timeout

    @classmethod
    def service_role(cls) -> "SupabaseRest":
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        if not key:
            raise SupabaseError("SUPABASE_SERVICE_ROLE_KEY is required for learning jobs.")
        return cls(configured_url(), key)

    @classmethod
    def anon(cls, timeout: float = 5.0) -> "SupabaseRest":
        return cls(configured_url(), configured_anon_key(), timeout=timeout)

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, str]] = None,
        body: Any = None,
        prefer: Optional[str] = None,
    ) -> Any:
        query = f"?{urllib.parse.urlencode(params)}" if params else ""
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body, default=str).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        request = urllib.request.Request(f"{self.url}{path}{query}", method=method, headers=headers, data=data)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore") or str(exc.reason)
            raise SupabaseError(f"{method} {path} failed ({exc.code}): {detail[:300]}", exc.code) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise SupabaseError(f"Unable to reach Supabase: {exc}") from exc
        return json.loads(raw) if raw else None

    def select(self, table: str, params: dict[str, str]) -> list[dict]:
        data = self.request("GET", f"/rest/v1/{table}", params=params)
        return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

    def select_all(self, table: str, params: dict[str, str], page_size: int = 1000, limit: int = 50_000) -> list[dict]:
        rows: list[dict] = []
        while len(rows) < limit:
            page = self.select(table, {**params, "limit": str(page_size), "offset": str(len(rows))})
            rows.extend(page)
            if len(page) < page_size:
                break
        return rows[:limit]

    def insert(self, table: str, body: Any, *, upsert_on: Optional[str] = None, returning: bool = True) -> list[dict]:
        params = {"on_conflict": upsert_on} if upsert_on else None
        prefer = ",".join(filter(None, [
            "resolution=merge-duplicates" if upsert_on else "",
            "return=representation" if returning else "return=minimal",
        ]))
        data = self.request("POST", f"/rest/v1/{table}", params=params, body=body, prefer=prefer)
        return data if isinstance(data, list) else []

    def update(self, table: str, filters: dict[str, str], body: dict) -> list[dict]:
        data = self.request("PATCH", f"/rest/v1/{table}", params=filters, body=body, prefer="return=representation")
        return data if isinstance(data, list) else []

    def rpc(self, function: str, body: Optional[dict] = None) -> Any:
        return self.request("POST", f"/rest/v1/rpc/{function}", body=body or {})
