"""Steps 1 and 2 of taxonomy repair: verify ESCO mappings, harvest alt-labels.

STEP 1 — VERIFY. Every skill carries an `esco_uri` and a `mapping_confidence`,
but 571 of 621 are flagged `validation_required=YES`, and spot-checking found
real errors: SK001 "Python Programming" points at ESCO "smart contract
programming languages" at 0.65 confidence.

The check is not string similarity against the stored URI -- that would only
find typos. Instead each skill is re-searched in ESCO from its own label, the
candidates are scored by EMBEDDING similarity against the Kareerly label plus
description, and the winner is compared to what is stored. Three outcomes:

    confirmed   stored URI is also the best candidate
    remap       a different candidate scores materially higher
    unmatched   nothing clears the floor; likely needs a local extension

STEP 2 — HARVEST. For confirmed and remapped skills, pull ESCO's real
alternativeLabel list. This is what the alias table should have contained all
along: ESCO gives 7 surface forms for Python (Python3, Py3K, Python prog, ...)
where the rule-based derivation could only guess.

Nothing here edits the workbook. Everything lands as review CSVs carrying
provenance and a confidence, so the existing `approval_status` gate still
decides what reaches production matching.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .esco_api import EscoClient
from .taxonomy import Taxonomy, normalize

REFERENCE_DIR = Path(__file__).resolve().parents[1] / "data" / "corpus" / "reference"

#: Below this the ESCO candidate is not a credible mapping at all.
MATCH_FLOOR = 0.45
#: A challenger must beat the incumbent by this much before we propose a remap.
REMAP_MARGIN = 0.12
#: Local extensions are Kareerly-controlled and are not expected to have URIs.
LOCAL_PREFIX = "LEX-"


@dataclass
class MappingVerdict:
    skill_id: str
    preferred_label: str
    k13_id: str
    stored_uri: str
    stored_confidence: float
    stored_esco_label: str
    verdict: str                 # confirmed | remap | unmatched | skipped_local
    best_uri: str
    best_esco_label: str
    best_score: float
    stored_score: float
    margin: float
    evidence: str

    def row(self) -> Dict[str, Any]:
        data = asdict(self)
        data["approval_status"] = "derived_pending_review"
        return data


class _Embedder:
    """Lazy sentence embedder; falls back to token overlap if unavailable."""

    def __init__(self) -> None:
        self._model = None
        self._ok = True

    def encode(self, texts: Sequence[str]):
        if self._model is None and self._ok:
            try:
                from sentence_transformers import SentenceTransformer

                self._model = SentenceTransformer(
                    "sentence-transformers/all-MiniLM-L6-v2", device="cpu"
                )
            except Exception:
                self._ok = False
        if not self._ok:
            return None
        return self._model.encode(
            list(texts), batch_size=32, normalize_embeddings=True, show_progress_bar=False
        )

    def similarity(self, query: str, candidates: Sequence[str]) -> List[float]:
        if not candidates:
            return []
        vectors = self.encode([query] + list(candidates))
        if vectors is None:
            qt = set(normalize(query).split())
            return [
                len(qt & set(normalize(c).split())) / max(len(qt), 1) for c in candidates
            ]
        return (vectors[1:] @ vectors[0]).tolist()


def _skill_query(skill) -> str:
    parts = [skill.label]
    if skill.description:
        parts.append(skill.description)
    return " — ".join(p for p in parts if p)[:300]


def verify_mappings(
    taxonomy: Taxonomy,
    client: Optional[EscoClient] = None,
    limit: Optional[int] = None,
    candidates_per_skill: int = 5,
    progress_every: int = 50,
) -> List[MappingVerdict]:
    """STEP 1. Re-derive the best ESCO mapping for every skill."""
    client = client or EscoClient()
    embedder = _Embedder()
    verdicts: List[MappingVerdict] = []

    skill_ids = list(taxonomy.skills)
    if limit:
        skill_ids = skill_ids[:limit]

    for position, skill_id in enumerate(skill_ids, start=1):
        skill = taxonomy.skills[skill_id]

        if skill_id.startswith(LOCAL_PREFIX):
            verdicts.append(MappingVerdict(
                skill_id=skill_id, preferred_label=skill.label, k13_id=skill.k13_id,
                stored_uri=skill.esco_uri, stored_confidence=skill.mapping_confidence,
                stored_esco_label="", verdict="skipped_local", best_uri="",
                best_esco_label="", best_score=0.0, stored_score=0.0, margin=0.0,
                evidence="Kareerly local extension; no ESCO mapping expected",
            ))
            continue

        candidates = client.search_skill(skill.label, limit=candidates_per_skill)
        if not candidates:
            verdicts.append(MappingVerdict(
                skill_id=skill_id, preferred_label=skill.label, k13_id=skill.k13_id,
                stored_uri=skill.esco_uri, stored_confidence=skill.mapping_confidence,
                stored_esco_label="", verdict="unmatched", best_uri="",
                best_esco_label="", best_score=0.0, stored_score=0.0, margin=0.0,
                evidence="ESCO search returned no candidates",
            ))
            continue

        scores = embedder.similarity(
            _skill_query(skill), [c["title"] for c in candidates]
        )
        ranked = sorted(zip(candidates, scores), key=lambda x: -x[1])
        best, best_score = ranked[0][0], float(ranked[0][1])

        stored_score = 0.0
        stored_label = ""
        for candidate, score in ranked:
            if candidate["uri"] == skill.esco_uri:
                stored_score, stored_label = float(score), candidate["title"]
                break

        if best_score < MATCH_FLOOR:
            verdict, evidence = "unmatched", (
                f"best candidate '{best['title']}' scored {best_score:.2f}, "
                f"below the {MATCH_FLOOR} floor"
            )
        elif best["uri"] == skill.esco_uri:
            verdict, evidence = "confirmed", "stored URI is also the best candidate"
        elif best_score - stored_score >= REMAP_MARGIN:
            verdict = "remap"
            evidence = (
                f"'{best['title']}' scores {best_score:.2f} vs stored "
                f"'{stored_label or '(not in top candidates)'}' at {stored_score:.2f}"
            )
        else:
            verdict, evidence = "confirmed", (
                f"stored URI within {REMAP_MARGIN} of the best candidate; left alone"
            )

        verdicts.append(MappingVerdict(
            skill_id=skill_id, preferred_label=skill.label, k13_id=skill.k13_id,
            stored_uri=skill.esco_uri, stored_confidence=skill.mapping_confidence,
            stored_esco_label=stored_label, verdict=verdict,
            best_uri=best["uri"], best_esco_label=best["title"],
            best_score=round(best_score, 4), stored_score=round(stored_score, 4),
            margin=round(best_score - stored_score, 4), evidence=evidence,
        ))

        if progress_every and position % progress_every == 0:
            print(f"    verified {position}/{len(skill_ids)}  "
                  f"(net {client.calls}, cache {client.cache_hits})", flush=True)

    return verdicts


def harvest_alt_labels(
    taxonomy: Taxonomy,
    verdicts: Sequence[MappingVerdict],
    client: Optional[EscoClient] = None,
    use_remapped: bool = True,
    progress_every: int = 50,
) -> List[Dict[str, Any]]:
    """STEP 2. Pull ESCO alternativeLabels for mapped skills."""
    client = client or EscoClient()
    rows: List[Dict[str, Any]] = []
    existing = set(taxonomy.alias_to_skill)

    usable = [
        v for v in verdicts
        if v.verdict == "confirmed" or (use_remapped and v.verdict == "remap")
    ]

    for position, verdict in enumerate(usable, start=1):
        uri = verdict.best_uri or verdict.stored_uri
        if not uri:
            continue

        record = client.skill(uri)
        if not record:
            continue

        labels = client.alt_labels(record)
        preferred = client.preferred_label(record)
        broader = client.broader(record)

        for label in [preferred] + labels:
            alias = normalize(label)
            if not alias or len(alias) < 3 or alias in existing:
                continue
            existing.add(alias)
            rows.append({
                "normalized_alias": alias,
                "alias_text": label,
                "skill_id": verdict.skill_id,
                "preferred_label": verdict.preferred_label,
                "k13_id": verdict.k13_id,
                "esco_uri": uri,
                "esco_preferred_label": preferred,
                "broader_skill": "; ".join(broader["broader_skill"][:2]),
                "broader_hierarchy": "; ".join(broader["broader_hierarchy"][:2]),
                "alias_source": "esco_api_alternative_label",
                "mapping_verdict": verdict.verdict,
                "approval_status": "derived_pending_review",
            })

        if progress_every and position % progress_every == 0:
            print(f"    harvested {position}/{len(usable)}  "
                  f"(net {client.calls}, cache {client.cache_hits})", flush=True)

    return rows


def write_csv(rows: Sequence[Dict[str, Any]], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return path
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return path


def summarise(verdicts: Sequence[MappingVerdict]) -> Dict[str, Any]:
    counts: Dict[str, int] = {}
    for verdict in verdicts:
        counts[verdict.verdict] = counts.get(verdict.verdict, 0) + 1

    remaps = [v for v in verdicts if v.verdict == "remap"]
    return {
        "total": len(verdicts),
        "by_verdict": counts,
        "worst_stored_mappings": [
            {"skill_id": v.skill_id, "label": v.preferred_label,
             "stored": v.stored_esco_label or "(absent from candidates)",
             "proposed": v.best_esco_label, "margin": v.margin}
            for v in sorted(remaps, key=lambda x: -x.margin)[:15]
        ],
    }
