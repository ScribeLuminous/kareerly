"""Provenance-based exclusions; never infer origin from description text."""
import re
from urllib.parse import urlsplit


def _jooble_url(value):
    host = (urlsplit(str(value or "")).hostname or "").lower()
    return bool(re.search(r"(?:^|\.)jooble\.[a-z.]+$", host))


def is_jooble_origin(raw):
    payload = raw.get("payload") or {}
    provider = payload.get("provider_record") or {}
    names = [raw.get("source"), payload.get("origin_board"), provider.get("job_publisher")]
    if any(re.search(r"\bjooble\b", str(name or ""), re.I) for name in names):
        return True
    urls = [raw.get("source_url"), provider.get("job_apply_link"), provider.get("job_google_link")]
    # If any alternate application origin is Jooble, conservatively exclude it.
    for option in provider.get("apply_options") or []:
        if isinstance(option, dict):
            if re.search(r"\bjooble\b", str(option.get("publisher", "")), re.I):
                return True
            urls.append(option.get("apply_link"))
    return any(_jooble_url(url) for url in urls)
