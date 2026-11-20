"""Per-client request limits for the expensive public endpoints (audit SEC-06).

Resume reading (with OCR) and matching cost seconds of CPU per request and
need no account, so a script could keep an instance busy or run up the bill.
Each listed endpoint belongs to a bucket with a number of requests allowed per
client in a sliding window. The limits are generous on purpose: a classroom
testing Kareerly from one campus address shares one client address, and must
not be blocked. They stop scripted floods, not normal use.

Limits are counted per instance (Cloud Run may run several), so the effective
limit is a little higher; a load balancer rule (Cloud Armor) is the stronger
option if one is ever put in front of the service.

Override a bucket with KAREERLY_RATE_LIMIT_<BUCKET>="<requests>/<seconds>",
for example KAREERLY_RATE_LIMIT_MATCHING="200/600", or "off" to disable it.
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from collections import OrderedDict, deque
from typing import Deque, Dict, Optional, Tuple

# POST endpoints and the bucket each counts against.
LIMITED_PATHS: Dict[str, str] = {
    "/api/resume/analyze": "resume",
    "/api/matches/from-resume": "matching",
    "/api/matches/run": "matching",
    "/api/matches/run-form": "matching",
    "/api/certificates/validate": "certificate",
    "/api/candidate/external-jobs/analyze": "matching",
    "/api/candidate/applications": "matching",
}
DEFAULT_LIMITS: Dict[str, Tuple[int, float]] = {
    "resume": (60, 600.0),
    "matching": (120, 600.0),
    "certificate": (60, 600.0),
}
MAX_TRACKED_CLIENTS = 20_000


def configured_limit(bucket: str) -> Optional[Tuple[int, float]]:
    """(requests, window seconds) for a bucket, or None when it is turned off."""
    raw = os.getenv(f"KAREERLY_RATE_LIMIT_{bucket.upper()}", "").strip().lower()
    if raw in {"off", "0", "none", "false"}:
        return None
    if raw:
        try:
            count, window = raw.split("/", 1)
            if int(count) > 0 and float(window) > 0:
                return int(count), float(window)
        except ValueError:
            pass
    return DEFAULT_LIMITS[bucket]


def client_address(scope) -> str:
    """The caller's address. Behind Cloud Run, Google's front end appends the
    address it received the request from to X-Forwarded-For, so the last entry
    is the one a client cannot forge."""
    for name, value in scope.get("headers") or []:
        if name == b"x-forwarded-for":
            parts = [part.strip() for part in value.decode("latin-1").split(",") if part.strip()]
            if parts:
                return parts[-1]
    client = scope.get("client")
    return str(client[0]) if client else "unknown"


class RateLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: "OrderedDict[Tuple[str, str], Deque[float]]" = OrderedDict()

    def check(self, bucket: str, client: str, now: Optional[float] = None) -> Optional[int]:
        """Records a request; returns None if allowed, else seconds until one is."""
        limit = configured_limit(bucket)
        if limit is None:
            return None
        count, window = limit
        now = time.monotonic() if now is None else now
        key = (bucket, client)
        with self._lock:
            hits = self._hits.get(key)
            if hits is None:
                hits = self._hits[key] = deque()
                while len(self._hits) > MAX_TRACKED_CLIENTS:
                    self._hits.popitem(last=False)
            else:
                self._hits.move_to_end(key)
            while hits and now - hits[0] >= window:
                hits.popleft()
            if len(hits) >= count:
                return max(1, math.ceil(window - (now - hits[0])))
            hits.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


class RateLimitMiddleware:
    """Answers 429 with Retry-After when a client exceeds its bucket's limit.
    Added inside the CORS middleware so the browser can read the message."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http" and scope.get("method") == "POST":
            bucket = LIMITED_PATHS.get(scope.get("path", "").rstrip("/"))
            if bucket:
                retry_after = limiter.check(bucket, client_address(scope))
                if retry_after is not None:
                    body = json.dumps({"detail": "Too many requests from your network. Please wait a few minutes and try again."}).encode()
                    await send({"type": "http.response.start", "status": 429, "headers": [
                        (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                        (b"retry-after", str(retry_after).encode()),
                    ]})
                    await send({"type": "http.response.body", "body": body})
                    return
        await self.app(scope, receive, send)
