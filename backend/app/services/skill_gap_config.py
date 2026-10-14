"""Every rule the Skills page uses to group, rank and show skill gaps.

The rules live here, and only here, so the system documentation can state them
exactly. Nothing in this module is learned or scored: a skill's tier follows
from how many of the candidate's in-scope jobs list it, and the order inside a
tier follows from the same counts and the jobs' match percentages.

Terms
-----
* In-scope jobs: the matches the candidate chose under "Gaps from" (see SCOPES).
* Required by N jobs: N in-scope jobs list the skill as required (or must-have)
  and the resume does not show it.
* Nice to have for N jobs: N in-scope jobs list the skill only as nice to have.
  A job that lists a skill as both counts as required.
* Jobs needing the skill: required jobs plus nice-to-have jobs.
"""
from __future__ import annotations

from typing import Any, Dict, Tuple

# ---------------------------------------------------------------------------
# Tiers, checked top to bottom; a skill takes the first tier whose rule it meets.
# ---------------------------------------------------------------------------
TIER_CLOSE_FIRST = "close_first"
TIER_WORTH_NEXT = "worth_next"
TIER_NICE_EXTRAS = "nice_extras"

# Close these first: required by at least this many in-scope jobs.
CLOSE_FIRST_MIN_REQUIRED_JOBS = 2
# Worth doing next: required by at least this many jobs (so exactly 1, since
# 2 or more is already Close these first) ...
WORTH_NEXT_MIN_REQUIRED_JOBS = 1
# ... or nice to have for at least this many jobs.
WORTH_NEXT_MIN_NICE_JOBS = 2
# Nice extras: everything else, which is nice to have for exactly 1 job.

TIERS: Tuple[Dict[str, str], ...] = (
    {"id": TIER_CLOSE_FIRST, "label": "Close these first", "rule": "Required by 2 or more of your jobs."},
    {"id": TIER_WORTH_NEXT, "label": "Worth doing next", "rule": "Required by 1 job, or nice to have for 2 or more."},
    {"id": TIER_NICE_EXTRAS, "label": "Nice extras", "rule": "Nice to have for 1 job."},
)
TIER_ORDER = {tier["id"]: index for index, tier in enumerate(TIERS)}
TIER_LABELS = {tier["id"]: tier["label"] for tier in TIERS}


def assign_tier(required_jobs: int, nice_jobs: int) -> str:
    """The tier for a skill required by ``required_jobs`` and nice to have for ``nice_jobs`` in-scope jobs."""
    if required_jobs >= CLOSE_FIRST_MIN_REQUIRED_JOBS:
        return TIER_CLOSE_FIRST
    if required_jobs >= WORTH_NEXT_MIN_REQUIRED_JOBS or nice_jobs >= WORTH_NEXT_MIN_NICE_JOBS:
        return TIER_WORTH_NEXT
    return TIER_NICE_EXTRAS


# ---------------------------------------------------------------------------
# Order inside a tier, compared key by key.
# ---------------------------------------------------------------------------
SORT_ORDER: Tuple[str, ...] = (
    "tier (Close these first, Worth doing next, Nice extras)",
    "jobs needing the skill, most first",
    "highest match % among those jobs, highest first",
    "skill name, A to Z (only so ties always come out the same way)",
)


def skill_sort_key(tier: str, jobs_needing: int, best_match_pct: float, skill_name: str) -> Tuple[Any, ...]:
    return (TIER_ORDER[tier], -jobs_needing, -best_match_pct, skill_name.lower())


# ---------------------------------------------------------------------------
# Impact: how many in-scope jobs closing the gap helps (the 3-bar meter).
# ---------------------------------------------------------------------------
# (minimum jobs needing the skill, label, bars), checked top to bottom.
IMPACT_LEVELS: Tuple[Tuple[int, str, int], ...] = (
    (3, "High impact", 3),
    (2, "Medium impact", 2),
    (1, "Low impact", 1),
)


def impact_for(jobs_needing: int) -> Tuple[str, int]:
    for minimum, label, bars in IMPACT_LEVELS:
        if jobs_needing >= minimum:
            return label, bars
    return IMPACT_LEVELS[-1][1], IMPACT_LEVELS[-1][2]


# ---------------------------------------------------------------------------
# Which matches the gaps come from ("Gaps from").
# ---------------------------------------------------------------------------
SCOPE_DEFAULT = "default"
SCOPE_FIT_NOW = "fit_now"
SCOPE_SAVED = "saved"
SCOPE_ALL = "all"
SCOPES: Tuple[Dict[str, str], ...] = (
    {"id": SCOPE_DEFAULT, "label": "Fit-Now, saved and applied jobs"},
    {"id": SCOPE_FIT_NOW, "label": "Fit-Now matches"},
    {"id": SCOPE_SAVED, "label": "Saved and applied jobs"},
    {"id": SCOPE_ALL, "label": "All matches"},
)
SCOPE_IDS = tuple(scope["id"] for scope in SCOPES)
# Saved or applied jobs that are not among the candidate's matches have no
# missing-skill data; they are left out and counted (unmatched_saved_jobs).

GROUP_BY_SKILL = "skill"
GROUP_BY_JOB = "job"
GROUP_BY_IDS = (GROUP_BY_SKILL, GROUP_BY_JOB)

# ---------------------------------------------------------------------------
# What the Gaps and Learning tabs show before the candidate expands anything.
# ---------------------------------------------------------------------------
# Skills shown per tier; the rest sit behind "Show N more". 0 = the tier starts
# collapsed and shows only its heading, count and a "Show N skills" button.
TIER_DISPLAY_LIMITS = {TIER_CLOSE_FIRST: 5, TIER_WORTH_NEXT: 3, TIER_NICE_EXTRAS: 0}
# The skill search box appears only when more open gaps than this exist.
SEARCH_MIN_OPEN_GAPS = 10
# Courses shown per skill on the Learning tab; the rest sit behind "Show N more courses".
COURSES_PER_SKILL_VISIBLE = 3
# Skills with courses shown on the Learning tab; the rest sit behind "Show N more skills".
LEARNING_SKILLS_VISIBLE = 5
# Courses looked up per skill at most.
COURSES_PER_SKILL_MAX = 10


def rules_payload() -> Dict[str, Any]:
    """The rules above, sent with every gaps response so the page shows exactly these."""
    return {
        "tiers": [dict(tier) for tier in TIERS],
        "thresholds": {
            "close_first_min_required_jobs": CLOSE_FIRST_MIN_REQUIRED_JOBS,
            "worth_next_min_required_jobs": WORTH_NEXT_MIN_REQUIRED_JOBS,
            "worth_next_min_nice_jobs": WORTH_NEXT_MIN_NICE_JOBS,
        },
        "sort_order": list(SORT_ORDER),
        "impact_levels": [{"min_jobs": minimum, "label": label, "bars": bars} for minimum, label, bars in IMPACT_LEVELS],
        "scopes": [dict(scope) for scope in SCOPES],
        "display": {
            "tier_limits": dict(TIER_DISPLAY_LIMITS),
            "search_min_open_gaps": SEARCH_MIN_OPEN_GAPS,
            "courses_per_skill_visible": COURSES_PER_SKILL_VISIBLE,
            "learning_skills_visible": LEARNING_SKILLS_VISIBLE,
        },
    }
