"""Stage 4: corpus quality report.

This is the artefact you put in Chapter 3 to answer the panel's question about
how the corpus was built and what its limits are. It reports the numbers a
reader will otherwise ask for: source mix, licence coverage, region balance,
tier split, and — most importantly — the stated/inferred ratio, which is the
single number that would have caught the v1 data problem.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from .config import LABELLED_DIR, NORMALIZED_DIR, REPORTS_DIR


def _read(path: Path) -> Iterator[Dict[str, Any]]:
    if not path.exists():
        return
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _bar(count: int, total: int, width: int = 28) -> str:
    filled = int(round(width * count / total)) if total else 0
    return "█" * filled + "·" * (width - filled)


def _table(title: str, counter: Counter, total: int) -> List[str]:
    lines = [f"### {title}", "", "| Value | Count | Share | |", "|---|---:|---:|---|"]
    for key, count in counter.most_common():
        share = count / total if total else 0
        lines.append(f"| {key or '(blank)'} | {count} | {share:.1%} | `{_bar(count, total)}` |")
    lines.append("")
    return lines


def build_report(
    normalized_path: Optional[Path] = None,
    labelled_path: Optional[Path] = None,
    out_path: Optional[Path] = None,
) -> str:
    normalized_path = normalized_path or (NORMALIZED_DIR / "jobs.jsonl")
    labelled_path = labelled_path or (LABELLED_DIR / "jobs.jsonl")
    out_path = out_path or (REPORTS_DIR / f"corpus_{date.today().isoformat()}.md")

    jobs = list(_read(normalized_path))
    labelled = list(_read(labelled_path))
    total = len(jobs)

    lines: List[str] = [
        "# Kareerly corpus report",
        "",
        f"Generated {date.today().isoformat()} · {total} normalized postings · "
        f"{len(labelled)} labelled",
        "",
    ]

    if not total:
        lines.append("No normalized postings found. Run `collect` then `normalize` first.")
        out_path.write_text("\n".join(lines), encoding="utf-8")
        return "\n".join(lines)

    tiers = Counter(job.get("corpus_tier", "?") for job in jobs)
    match_count = tiers.get("match", 0)

    lines += ["## Coverage", ""]
    lines += _table("Corpus tier", tiers, total)
    lines += [
        f"**{match_count} postings are usable for matching.** "
        f"Target is 2,000–5,000; you are at {match_count / 2000:.0%} of the lower bound.",
        "",
    ]

    lines += _table("Source", Counter(job.get("source", "?") for job in jobs), total)
    lines += _table("Region", Counter(job.get("region", "?") for job in jobs), total)
    lines += _table("Seniority", Counter(job.get("seniority") or "unclassified" for job in jobs), total)
    lines += _table("Work setup", Counter(job.get("work_setup") or "unstated" for job in jobs), total)

    # Licence hygiene
    unrecorded = sum(1 for job in jobs if str(job.get("licence", "")).startswith("UNRECORDED"))
    lines += ["## Provenance", ""]
    lines += _table("Access basis", Counter(job.get("access_basis", "?") for job in jobs), total)
    if unrecorded:
        lines += [
            f"> **{unrecorded} postings have no recorded licence.** Fix before publication — "
            "every row needs a defensible basis in the ethics appendix.",
            "",
        ]

    # Description length distribution
    buckets = Counter()
    for job in jobs:
        chars = job.get("description_chars", 0)
        if chars < 200:
            buckets["<200 (snippet)"] += 1
        elif chars < 600:
            buckets["200–599"] += 1
        elif chars < 1500:
            buckets["600–1499"] += 1
        else:
            buckets["1500+"] += 1
    lines += _table("Description length", buckets, total)

    # The number that matters
    if labelled:
        stated = inferred = 0
        essential = optional = 0
        per_job: List[int] = []
        link_methods = Counter()
        no_skills = 0

        for job in labelled:
            skills = job.get("esco_skills", [])
            per_job.append(len(skills))
            if not skills:
                no_skills += 1
            for skill in skills:
                if skill.get("provenance") == "inferred":
                    inferred += 1
                else:
                    stated += 1
                if skill.get("relation_type") == "essential":
                    essential += 1
                else:
                    optional += 1
                link_methods[skill.get("link_method", "?")] += 1

        total_skills = stated + inferred
        lines += ["## Requirement labelling", ""]
        lines += _table("Link method", link_methods, total_skills or 1)
        lines += [
            "### Provenance of requirements",
            "",
            f"- **stated** (present in the posting text): {stated} "
            f"({stated / total_skills:.1%})" if total_skills else "- no skills labelled",
        ]
        if total_skills:
            lines += [
                f"- **inferred** (added from ESCO occupation profile): {inferred} "
                f"({inferred / total_skills:.1%})",
                "",
                f"- essential (omega_r = 1.0): {essential}  ·  optional (omega_r = 0.4): {optional}",
                "",
            ]
            if inferred / total_skills > 0.5:
                lines += [
                    "> ⚠ **More than half of all requirements are inferred rather than stated.** "
                    "This is the v1 failure mode. Either tighten occupation mapping, or exclude "
                    "inferred requirements from gap analysis and report coverage on stated only.",
                    "",
                ]

        if per_job:
            per_job_sorted = sorted(per_job)
            median = per_job_sorted[len(per_job_sorted) // 2]
            lines += [
                f"Skills per job — min {min(per_job)}, median {median}, max {max(per_job)}. "
                f"{no_skills} jobs got no skills at all "
                f"({no_skills / len(labelled):.1%}).",
                "",
            ]
    else:
        lines += ["## Requirement labelling", "", "Not run yet — `python -m pipeline.cli label`.", ""]

    lines += [
        "## Readiness checklist",
        "",
        f"- [{'x' if match_count >= 2000 else ' '}] ≥2,000 match-tier postings ({match_count})",
        f"- [{'x' if len(tiers) and tiers.get('excluded', 0) / total < 0.2 else ' '}] "
        f"<20% excluded ({tiers.get('excluded', 0) / total:.1%})",
        f"- [{'x' if not unrecorded else ' '}] every row has a recorded licence",
        f"- [{'x' if labelled else ' '}] labelling run completed",
        "",
    ]

    report = "\n".join(lines)
    out_path.write_text(report, encoding="utf-8")
    return report
