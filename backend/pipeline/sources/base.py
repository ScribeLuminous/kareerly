"""Source adapter contract.

Every job source returns RawPosting records. Sources never normalize, never
clean and never label — they only fetch and stamp provenance, so that the
question "where did this row come from and under what terms" is always
answerable from the raw file alone. That provenance block is what your ethics
appendix and your limitations section are written from.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional


@dataclass
class RawPosting:
    source: str                      # adapter name, e.g. "jooble"
    source_id: str                   # id within that source
    fetched_at: str                  # ISO-8601 UTC
    access_basis: str                # "public API", "licensed dataset", "employer-submitted"
    payload: Dict[str, Any]          # verbatim source record, unmodified
    source_url: str = ""
    licence: str = ""
    notes: str = ""

    def fingerprint(self) -> str:
        """Stable id for cross-source dedupe: title + company + location."""
        parts = [
            str(self.payload.get("title", "")).strip().lower(),
            str(self.payload.get("company", "")).strip().lower(),
            str(self.payload.get("location", "")).strip().lower(),
        ]
        return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)


class JobSource:
    """Base adapter. Subclasses implement fetch()."""

    name = "base"
    access_basis = "unspecified"
    licence = ""

    #: Sources that need the researcher to confirm terms of use before running.
    requires_tos_acknowledgement = False
    tos_url = ""

    def __init__(self, tos_acknowledged: bool = False) -> None:
        if self.requires_tos_acknowledgement and not tos_acknowledged:
            raise PermissionError(
                f"Source '{self.name}' requires you to review its terms of use at "
                f"{self.tos_url or '<no URL on record>'} and pass "
                f"tos_acknowledged=True. This gate exists so that the decision to "
                f"collect from this source is recorded as yours, not the tool's."
            )
        self.tos_acknowledged = tos_acknowledged

    def fetch(self, **kwargs: Any) -> Iterator[RawPosting]:
        raise NotImplementedError

    def _stamp(
        self,
        source_id: str,
        payload: Dict[str, Any],
        source_url: str = "",
        notes: str = "",
    ) -> RawPosting:
        return RawPosting(
            source=self.name,
            source_id=str(source_id),
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            access_basis=self.access_basis,
            licence=self.licence,
            payload=payload,
            source_url=source_url,
            notes=notes,
        )


_REGISTRY: Dict[str, type] = {}


def register(cls: type) -> type:
    _REGISTRY[cls.name] = cls
    return cls


def get_source(name: str, **kwargs: Any) -> JobSource:
    if name not in _REGISTRY:
        raise KeyError(f"Unknown source '{name}'. Available: {sorted(_REGISTRY)}")
    return _REGISTRY[name](**kwargs)


def available_sources() -> List[str]:
    return sorted(_REGISTRY)
