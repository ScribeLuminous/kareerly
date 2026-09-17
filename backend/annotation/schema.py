"""Record types for the judgement pipeline.

Three grades, not two. Binary relevance throws away the distinction between
"I would apply to this" and "this is in the right field but not for me", and
nDCG needs the gradation to be worth computing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

GRADES: Dict[int, str] = {
    0: "Not relevant — wrong field, or the candidate could not do this job",
    1: "Marginally relevant — right field, but a poor fit right now",
    2: "Highly relevant — this candidate should see this job",
}

#: Judgements at or above this grade count as "relevant" for binary metrics
#: (precision, recall, MRR) and as the positive class for calibration.
RELEVANT_AT = 1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class PoolItem:
    """One candidate-job pair placed in front of an annotator."""
    pool_id: str
    resume_id: str
    job_id: str
    resume_text: str
    job_title: str
    job_text: str
    #: Which systems retrieved this pair, and at what rank. Held for analysis
    #: but NEVER shown during annotation -- see pool.py on blinding.
    contributed_by: Dict[str, int] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PoolItem":
        return cls(**{k: data.get(k) for k in cls.__dataclass_fields__})


@dataclass
class Judgement:
    pool_id: str
    resume_id: str
    job_id: str
    grade: int
    annotator: str
    judged_at: str = field(default_factory=_now)
    duration_ms: Optional[int] = None
    note: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Judgement":
        return cls(**{k: data.get(k) for k in cls.__dataclass_fields__ if k in data})
