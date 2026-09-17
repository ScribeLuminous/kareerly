"""Append-only judgement store.

Append-only because annotation is long and interruptible, and because a
judgement that is silently overwritten is a judgement you cannot audit. Later
records for the same (annotator, pool_id) supersede earlier ones on read, but
the earlier ones stay on disk -- so a corrected judgement is visible as a
correction rather than vanishing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

from .schema import Judgement, RELEVANT_AT


class JudgementStore:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, judgement: Judgement) -> None:
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(judgement.to_json() + "\n")

    def _raw(self) -> Iterator[Judgement]:
        if not self.path.exists():
            return
        with self.path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield Judgement.from_dict(json.loads(line))

    def latest(self) -> Dict[Tuple[str, str], Judgement]:
        """(annotator, pool_id) -> most recent judgement."""
        current: Dict[Tuple[str, str], Judgement] = {}
        for judgement in self._raw():
            current[(judgement.annotator, judgement.pool_id)] = judgement
        return current

    def by_annotator(self, annotator: str) -> Dict[str, Judgement]:
        return {
            pool_id: judgement
            for (name, pool_id), judgement in self.latest().items()
            if name == annotator
        }

    def done_ids(self, annotator: str) -> set:
        return set(self.by_annotator(annotator))

    def revision_count(self) -> int:
        total = sum(1 for _ in self._raw())
        return total - len(self.latest())

    def statistics(self) -> Dict[str, Any]:
        latest = self.latest()
        by_annotator: Dict[str, Dict[str, int]] = {}
        grade_totals: Dict[int, int] = {0: 0, 1: 0, 2: 0}
        durations: List[int] = []

        for (annotator, _), judgement in latest.items():
            bucket = by_annotator.setdefault(annotator, {0: 0, 1: 0, 2: 0})
            bucket[judgement.grade] = bucket.get(judgement.grade, 0) + 1
            grade_totals[judgement.grade] = grade_totals.get(judgement.grade, 0) + 1
            if judgement.duration_ms:
                durations.append(judgement.duration_ms)

        total = len(latest)
        relevant = sum(count for grade, count in grade_totals.items() if grade >= RELEVANT_AT)

        return {
            "judgements": total,
            "revisions": self.revision_count(),
            "annotators": {
                name: {"total": sum(counts.values()), "by_grade": counts}
                for name, counts in by_annotator.items()
            },
            "grade_totals": grade_totals,
            "relevant_rate": round(relevant / total, 4) if total else 0.0,
            "median_seconds": (
                round(sorted(durations)[len(durations) // 2] / 1000, 1)
                if durations else None
            ),
        }
