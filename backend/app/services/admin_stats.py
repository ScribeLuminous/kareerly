"""Aggregate candidate match feedback (good/bad votes) for the admin dashboard.

Pure functions over match_feedback rows so the numbers can be tested without
Supabase. Rows carry only the numeric context the matcher showed, never resume
text, so nothing here is personal data.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

SCORE_BANDS = (
    ("0-39%", 0.0, 0.40),
    ("40-59%", 0.40, 0.60),
    ("60-79%", 0.60, 0.80),
    ("80-100%", 0.80, 1.01),
)
WEEKS_SHOWN = 8
TOP_JOBS = 10


def _bucket() -> dict:
    return {"good": 0, "bad": 0}


def _finish(bucket: dict) -> dict:
    total = bucket["good"] + bucket["bad"]
    return {**bucket, "total": total, "good_rate": round(bucket["good"] / total, 4) if total else None}


def _score_band(score) -> str | None:
    try:
        value = float(score)
    except (TypeError, ValueError):
        return None
    for label, low, high in SCORE_BANDS:
        if low <= value < high:
            return label
    return None


def _parse_time(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def summarize_match_feedback(rows: list[dict], now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    totals = _bucket()
    by_category: dict[str, dict] = defaultdict(_bucket)
    by_band: dict[str, dict] = {label: _bucket() for label, _, _ in SCORE_BANDS}
    by_ranker: dict[str, dict] = defaultdict(_bucket)
    by_job: dict[tuple[str, str], dict] = defaultdict(_bucket)
    voters: set[str] = set()

    this_week = (now - timedelta(days=now.weekday())).date()
    week_starts = [this_week - timedelta(weeks=offset) for offset in range(WEEKS_SHOWN - 1, -1, -1)]
    by_week: dict[str, dict] = {start.isoformat(): _bucket() for start in week_starts}

    for row in rows:
        vote = row.get("vote")
        if vote not in (1, -1):
            continue
        key = "good" if vote == 1 else "bad"
        totals[key] += 1
        if row.get("user_id"):
            voters.add(str(row["user_id"]))
        by_category[str(row.get("match_category") or "Unknown")][key] += 1
        band = _score_band(row.get("match_score"))
        if band:
            by_band[band][key] += 1
        by_ranker[str(row.get("ranker_version") or "unknown")][key] += 1
        by_job[(str(row.get("job_id") or ""), str(row.get("job_source") or "internal"))][key] += 1
        stamp = _parse_time(row.get("updated_at") or row.get("created_at"))
        if stamp:
            day = stamp.date()
            week = (day - timedelta(days=day.weekday())).isoformat()
            if week in by_week:
                by_week[week][key] += 1

    flagged = sorted(
        (item for item in by_job.items() if item[1]["bad"] > 0),
        key=lambda item: (-item[1]["bad"], item[1]["good"], item[0]),
    )[:TOP_JOBS]

    return {
        "totals": {**_finish(totals), "voters": len(voters)},
        "by_category": {name: _finish(bucket) for name, bucket in sorted(by_category.items())},
        "by_score_band": [{"band": label, **_finish(by_band[label])} for label, _, _ in SCORE_BANDS],
        "by_ranker_version": [
            {"version": name, **_finish(bucket)}
            for name, bucket in sorted(by_ranker.items(), key=lambda item: -(item[1]["good"] + item[1]["bad"]))
        ],
        "by_week": [{"week_start": week, **_finish(bucket)} for week, bucket in by_week.items()],
        "most_downvoted_jobs": [
            {"job_id": job_id, "job_source": source, **_finish(bucket)}
            for (job_id, source), bucket in flagged
        ],
    }
