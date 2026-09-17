"""Adapter for licensed tabular sources: local CSV, or a Hugging Face dataset.

Use this for anything already published as a dataset (the Philippine Job
Listings Dataset, a Kaggle JobStreet export, an employer CSV). It does no
fetching of its own beyond reading the file, which keeps the licence question
where it belongs: you record it once, at collection time, and it travels with
every row.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

from ..config import MIN_DESCRIPTION_CHARS
from .base import JobSource, RawPosting, register

#: Column aliases seen across the public PH/SEA job datasets.
COLUMN_ALIASES = {
    "title": ["title", "job_title", "position", "jobtitle", "job title", "role"],
    "company": ["company", "company_name", "employer", "organization", "hiring_company"],
    "location": ["location", "job_location", "city", "area", "region", "work_location"],
    "description": ["description", "job_description", "jobdescription", "details",
                    "job_details", "summary", "requirements", "responsibilities"],
    "salary": ["salary", "salary_range", "compensation", "pay", "salary_text"],
    "employment_type": ["employment_type", "job_type", "type", "work_type", "contract_type"],
    "category": ["category", "job_category", "industry", "function", "classification"],
    "url": ["url", "link", "job_url", "apply_link", "job_link", "source_url"],
}


def _resolve(row: Dict[str, Any], field: str) -> str:
    lowered = {str(k).strip().lower().lstrip("﻿"): v for k, v in row.items()}
    for alias in COLUMN_ALIASES.get(field, [field]):
        value = lowered.get(alias)
        if value not in (None, ""):
            return str(value).strip()
    return ""


@register
class TabularSource(JobSource):
    name = "tabular"
    access_basis = "licensed dataset"

    def __init__(
        self,
        path: Optional[str] = None,
        hf_dataset: Optional[str] = None,
        hf_split: str = "train",
        licence: str = "",
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.path = Path(path) if path else None
        self.hf_dataset = hf_dataset
        self.hf_split = hf_split
        self.licence = licence or "UNRECORDED - fill this in before using the rows"

        if not self.path and not self.hf_dataset:
            raise ValueError("TabularSource needs either path= or hf_dataset=")
        if self.licence.startswith("UNRECORDED"):
            print(
                "  ! No licence recorded for this source. Every row will carry the "
                "placeholder, and the quality report will flag it."
            )

    def _rows(self) -> Iterator[Dict[str, Any]]:
        if self.path:
            suffix = self.path.suffix.lower()
            if suffix == ".jsonl":
                with self.path.open(encoding="utf-8") as handle:
                    for line in handle:
                        if line.strip():
                            yield json.loads(line)
            else:
                with self.path.open(encoding="utf-8-sig", newline="") as handle:
                    yield from csv.DictReader(handle)
            return

        try:
            from datasets import load_dataset  # type: ignore
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "hf_dataset= needs the 'datasets' package: pip install datasets"
            ) from exc

        for row in load_dataset(self.hf_dataset, split=self.hf_split):
            yield dict(row)

    def fetch(self, **kwargs: Any) -> Iterator[RawPosting]:
        origin = str(self.path) if self.path else f"hf://{self.hf_dataset}"

        for index, row in enumerate(self._rows()):
            description = _resolve(row, "description")
            yield self._stamp(
                source_id=str(row.get("id") or row.get("job_id") or index),
                payload={
                    "title": _resolve(row, "title"),
                    "company": _resolve(row, "company"),
                    "location": _resolve(row, "location"),
                    "description": description,
                    "description_is_snippet": len(description) < MIN_DESCRIPTION_CHARS,
                    "salary": _resolve(row, "salary"),
                    "employment_type": _resolve(row, "employment_type"),
                    "category": _resolve(row, "category"),
                    "raw_columns": sorted(str(k) for k in row.keys()),
                },
                source_url=_resolve(row, "url"),
                notes=f"row {index} of {origin}",
            )
