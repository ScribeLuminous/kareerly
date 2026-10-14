"""Skill gaps regrouped from job -> skills into skill -> jobs.

Runs after matching (step 4 of the pipeline) and never changes a match, its
score or its list. Each job's missing skills are taken as matching reported
them, resolved to the same canonical skill IDs matching uses (so "SEO" and
"Search Engine Optimization" are one skill), then regrouped so one row says
every in-scope job that needs the skill. Tiers, order and display limits come
from skill_gap_config.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from . import skill_gap_config as config

REQUIRED = "required"
NICE_TO_HAVE = "nice_to_have"
FIT_NOW = "fit_now"
ASPIRATION = "aspiration"

# name -> (canonical key, display name, taxonomy skill ID or "")
Resolver = Callable[[str], Tuple[str, str, str]]
JobKey = Tuple[str, str]


def matching_resolver() -> Resolver:
    """Resolve a skill name exactly as matching does (verified aliases, merged ESCO duplicates)."""
    from . import matching_service as ms

    labels, _ = ms.canonical_skill_lookup()
    cache: Dict[str, Tuple[str, str, str]] = {}

    def resolve(name: str) -> Tuple[str, str, str]:
        if name not in cache:
            key = ms._skill_key(name)
            display = ms.display_skill_name(key, labels, name) or ms.clean_text(name)
            cache[name] = (key, display, key if key in labels else "")
        return cache[name]

    return resolve


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def job_key(job_source: Any, job_id: Any) -> JobKey:
    return (_text(job_source) or "internal", _text(job_id))


def gap_job_from_match(match: Dict[str, Any]) -> Dict[str, Any]:
    """The fields aggregation reads, from a run_matching match or an already compact job."""
    if "missing_required" in match:
        return match
    match_type = _text(match.get("match_type") or match.get("match_category")).lower().replace("-", "_")
    return {
        "job_id": _text(match.get("job_id")),
        "job_source": _text(match.get("job_source")) or "internal",
        "title": _text(match.get("job_title")),
        "company": _text(match.get("company_name") or match.get("company")),
        "match_pct": _number(match.get("match_percentage")),
        "match_type": FIT_NOW if match_type == FIT_NOW else ASPIRATION,
        "missing_required": list(match.get("missing_essential_skills", match.get("missing_skills", [])) or []),
        "missing_nice": list(match.get("missing_preferred_skills", []) or []),
    }


def _job_gaps(job: Dict[str, Any], resolve: Resolver) -> Dict[str, Any]:
    """One job with its missing skills resolved; a skill listed as both required and nice counts as required."""
    skills: Dict[str, Dict[str, str]] = {}
    for requirement, names in ((REQUIRED, job.get("missing_required") or []), (NICE_TO_HAVE, job.get("missing_nice") or [])):
        for raw in names:
            name = _text(raw)
            if not name:
                continue
            key, display, taxonomy_id = resolve(name)
            if key not in skills:
                skills[key] = {"skill_id": key, "taxonomy_skill_id": taxonomy_id, "skill_name": display, "requirement": requirement}
    return {
        "job_id": _text(job.get("job_id")),
        "job_source": _text(job.get("job_source")) or "internal",
        "title": _text(job.get("title")),
        "company": _text(job.get("company")),
        "match_pct": round(_number(job.get("match_pct")), 1),
        "match_type": FIT_NOW if job.get("match_type") == FIT_NOW else ASPIRATION,
        "skills": list(skills.values()),
    }


def resolve_jobs(jobs: Iterable[Dict[str, Any]], resolve: Optional[Resolver] = None) -> List[Dict[str, Any]]:
    """Every distinct job (by source and ID) with its gaps resolved to canonical skills."""
    resolve = resolve or matching_resolver()
    seen: Set[JobKey] = set()
    resolved = []
    for raw in jobs:
        job = _job_gaps(gap_job_from_match(raw), resolve)
        key = job_key(job["job_source"], job["job_id"])
        if key in seen:
            continue
        seen.add(key)
        resolved.append(job)
    return resolved


def select_scope(
    jobs: Sequence[Dict[str, Any]],
    scope: str,
    saved: Iterable[JobKey] = (),
    applied: Iterable[JobKey] = (),
) -> Tuple[List[Dict[str, Any]], int]:
    """The in-scope jobs, and how many saved or applied jobs are not among the matches (left out)."""
    if scope not in config.SCOPE_IDS:
        raise ValueError(f"Unknown scope: {scope}")
    kept = {job_key(*key) for key in [*saved, *applied]}
    listed = {job_key(job["job_source"], job["job_id"]) for job in jobs}
    unmatched = len(kept - listed)

    def in_scope(job: Dict[str, Any]) -> bool:
        is_kept = job_key(job["job_source"], job["job_id"]) in kept
        if scope == config.SCOPE_ALL:
            return True
        if scope == config.SCOPE_FIT_NOW:
            return job["match_type"] == FIT_NOW
        if scope == config.SCOPE_SAVED:
            return is_kept
        return job["match_type"] == FIT_NOW or is_kept

    return [job for job in jobs if in_scope(job)], unmatched


def _job_entry_order(entry: Dict[str, Any]) -> Tuple[Any, ...]:
    return (entry["requirement"] != REQUIRED, -entry["match_pct"], entry["title"].lower(), entry["job_id"])


def aggregate_by_skill(jobs: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One row per canonical skill with every in-scope job that needs it, tiered and sorted."""
    grouped: Dict[str, Dict[str, Any]] = {}
    for job in jobs:
        for skill in job["skills"]:
            row = grouped.setdefault(skill["skill_id"], {
                "skill_id": skill["skill_id"], "taxonomy_skill_id": skill["taxonomy_skill_id"],
                "skill_name": skill["skill_name"], "jobs": [],
            })
            row["jobs"].append({
                "job_id": job["job_id"], "job_source": job["job_source"], "title": job["title"],
                "company": job["company"], "match_pct": job["match_pct"],
                "requirement": skill["requirement"], "match_type": job["match_type"],
            })
    rows = []
    for row in grouped.values():
        required = sum(entry["requirement"] == REQUIRED for entry in row["jobs"])
        nice = len(row["jobs"]) - required
        tier = config.assign_tier(required, nice)
        impact_label, impact_bars = config.impact_for(len(row["jobs"]))
        rows.append({
            **row,
            "jobs": sorted(row["jobs"], key=_job_entry_order),
            "tier": tier,
            "tier_label": config.TIER_LABELS[tier],
            "required_jobs": required,
            "nice_jobs": nice,
            "jobs_needing": len(row["jobs"]),
            "best_match_pct": max(entry["match_pct"] for entry in row["jobs"]),
            "impact_label": impact_label,
            "impact_bars": impact_bars,
        })
    rows.sort(key=lambda row: config.skill_sort_key(row["tier"], row["jobs_needing"], row["best_match_pct"], row["skill_name"]))
    return rows


def aggregate_by_job(jobs: Sequence[Dict[str, Any]], skills: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One card per in-scope job that has gaps; each gap says how many other in-scope jobs need it."""
    order = {skill["skill_id"]: index for index, skill in enumerate(skills)}
    by_id = {skill["skill_id"]: skill for skill in skills}
    cards = []
    for job in jobs:
        if not job["skills"]:
            continue
        gaps = sorted(job["skills"], key=lambda skill: order[skill["skill_id"]])
        cards.append({
            "job_id": job["job_id"], "job_source": job["job_source"], "title": job["title"],
            "company": job["company"], "match_pct": job["match_pct"], "match_type": job["match_type"],
            "gaps": [{
                "skill_id": skill["skill_id"], "skill_name": skill["skill_name"],
                "requirement": skill["requirement"], "tier": by_id[skill["skill_id"]]["tier"],
                "other_jobs": by_id[skill["skill_id"]]["jobs_needing"] - 1,
            } for skill in gaps],
        })
    cards.sort(key=lambda card: (card["match_type"] != FIT_NOW, -card["match_pct"], card["title"].lower(), card["job_id"]))
    return cards


def build_gap_report(
    matches: Iterable[Dict[str, Any]],
    *,
    scope: str = config.SCOPE_DEFAULT,
    group_by: str = config.GROUP_BY_SKILL,
    saved: Iterable[JobKey] = (),
    applied: Iterable[JobKey] = (),
    resolve: Optional[Resolver] = None,
) -> Dict[str, Any]:
    """The Skills page's gaps for one scope, grouped by skill or by job."""
    if group_by not in config.GROUP_BY_IDS:
        raise ValueError(f"Unknown group_by: {group_by}")
    saved, applied = list(saved), list(applied)
    jobs = resolve_jobs(matches, resolve)
    in_scope, unmatched = select_scope(jobs, scope, saved, applied)
    skills = aggregate_by_skill(in_scope)
    with_gaps = [job for job in in_scope if job["skills"]]
    report: Dict[str, Any] = {
        "scope": scope,
        "group_by": group_by,
        "rules": config.rules_payload(),
        "totals": {
            "in_scope_jobs": len(in_scope),
            "jobs_with_gaps": len(with_gaps),
            "gap_free_jobs": len(in_scope) - len(with_gaps),
            "gap_free_fit_now_jobs": sum(1 for job in in_scope if not job["skills"] and job["match_type"] == FIT_NOW),
            "open_skills": len(skills),
            "by_tier": {tier["id"]: sum(1 for skill in skills if skill["tier"] == tier["id"]) for tier in config.TIERS},
            "unmatched_saved_jobs": unmatched,
        },
        # Open skills per scope, for the "Gaps from" select.
        "scope_counts": {
            option: len({skill["skill_id"] for job in select_scope(jobs, option, saved, applied)[0] for skill in job["skills"]})
            for option in config.SCOPE_IDS
        },
        # Every gap skill across all matches, so progress kept for a skill
        # outside this scope is not mistaken for a closed gap.
        "all_skills": [{"skill_id": skill["skill_id"], "skill_name": skill["skill_name"]}
                       for skill in aggregate_by_skill(jobs)],
    }
    if group_by == config.GROUP_BY_SKILL:
        report["skills"] = skills
    else:
        report["jobs"] = aggregate_by_job(in_scope, skills)
    return report
