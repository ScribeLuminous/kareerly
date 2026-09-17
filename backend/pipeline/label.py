"""Stage 3: Tabiya NER -> Kareerly K13 taxonomy linking.

Previously this linked spans to ESCO and the matcher crosswalked back to the
K13 taxonomy. That round-trip is what produced the silent ID mismatch: the
corpus spoke ESCO uuids, the taxonomy spoke SK###, nothing joined, and every
requirement scored as an unfillable gap without raising an error.

The taxonomy IS the controlled vocabulary here -- ESCO is a reference layer
inside it, reachable through each skill's `esco_uri`. So linking targets the
taxonomy directly and the ESCO hop disappears.

Two link methods, cheapest first:

    alias      exact hit in the 5,000+ alias table (rule-derived + ESCO
               alternativeLabels + hand overrides). Precise and free.
    embedding  nearest taxonomy label above a floor. Catches the verb-phrase
               phrasing NER produces -- "Assist with bookkeeping" -> Bookkeeping
               -- which exact lookup structurally cannot bridge.

Every linked skill records how it was linked and with what score, and every
requirement records `provenance`:

    stated     the span appeared in the posting text
    inferred   added from a profile, not present in the text

Bhola et al. (2020) found up to 65% of postings omit relevant skills, so
enrichment is necessary -- but unmarked enrichment is what produced
"Accounting Assistant requires Python" in v1. Gap analysis must be able to
tell the two apart.

REQUIREMENT WEIGHTING. essential/optional is a property of the occupation-skill
pair, not of the skill, and the K13 taxonomy has no occupation relations. So the
posting is resolved to an ESCO occupation and the relations are read from there
(see pipeline/occupation.py). Skills the occupation does not list keep an
NER-confidence guess, flagged `relation_source="ner_proxy"` so weights resting
on a heuristic stay distinguishable from weights resting on published data.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

from .config import LABELLED_DIR, NORMALIZED_DIR, TABIYA_EMBED_MODEL, TABIYA_NER_MODEL

ALIAS_LINK_SCORE = 1.0
MIN_EMBED_SCORE = 0.60
MIN_NER_SCORE = 0.60          # below this the span is usually a verb fragment
MAX_SKILLS_PER_JOB = 40

#: NER confidence at or above this marks a requirement essential rather than
#: optional. A weak detection should not become a hard requirement.
ESSENTIAL_NER_FLOOR = 0.75

REFERENCE_DIR = Path(__file__).resolve().parents[1] / "data" / "corpus" / "reference"


@lru_cache(maxsize=1)
def _taxonomy():
    """Load the K13 taxonomy with every reviewed alias supplement applied."""
    import sys

    backend = Path(__file__).resolve().parents[1]
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))

    from models import taxonomy as tx
    from models.alias_expansion import apply_supplement

    taxonomy = tx.load()
    for name in ("derived_aliases_accepted.csv", "alias_overrides.csv", "esco_alt_labels.csv"):
        apply_supplement(taxonomy, REFERENCE_DIR / name)
    return taxonomy


@lru_cache(maxsize=1)
def _ner_pipeline():
    from transformers import pipeline

    return pipeline(
        "token-classification",
        model=TABIYA_NER_MODEL,
        aggregation_strategy="simple",
        device=-1,          # CPU: measurably not slower here, and far more predictable
    )


@lru_cache(maxsize=1)
def _embedder():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(TABIYA_EMBED_MODEL, device="cpu")


@lru_cache(maxsize=1)
def _skill_matrix():
    """Embed every taxonomy label once; reused across the whole corpus."""
    taxonomy = _taxonomy()
    skill_ids = list(taxonomy.skills)
    texts = [
        f"{taxonomy.skills[s].label}. {taxonomy.skills[s].description}".strip(". ")
        for s in skill_ids
    ]
    matrix = _embedder().encode(
        texts, batch_size=64, convert_to_numpy=True,
        normalize_embeddings=True, show_progress_bar=True,
    )
    return skill_ids, matrix


def extract_spans(text: str) -> List[Dict[str, Any]]:
    """Run Tabiya NER, chunked on paragraph boundaries for the 512-token cap."""
    if not text.strip():
        return []

    chunks, current = [], ""
    for paragraph in text.split("\n"):
        if len(current) + len(paragraph) > 1200:
            chunks.append(current)
            current = paragraph
        else:
            current = f"{current}\n{paragraph}" if current else paragraph
    if current:
        chunks.append(current)

    spans: List[Dict[str, Any]] = []
    for chunk in chunks:
        for entity in _ner_pipeline()(chunk):
            spans.append({
                "entity_group": str(entity.get("entity_group", "")),
                "text": str(entity.get("word", "")).strip(),
                "score": round(float(entity.get("score", 0.0)), 4),
            })
    return spans


def link_span(span_text: str, embed: bool = True) -> Optional[Dict[str, Any]]:
    """Link one span to a taxonomy skill. Alias first, then embedding."""
    taxonomy = _taxonomy()

    skill_id = taxonomy.resolve(span_text)
    if skill_id:
        return {"skill_id": skill_id, "link_method": "alias", "link_score": ALIAS_LINK_SCORE}

    if not embed or len(span_text.strip()) < 4:
        return None

    import numpy as np

    skill_ids, matrix = _skill_matrix()
    query = _embedder().encode(
        [span_text], convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False
    )
    scores = matrix @ query[0]
    best = int(np.argmax(scores))
    score = float(scores[best])

    if score < MIN_EMBED_SCORE:
        return None
    return {"skill_id": skill_ids[best], "link_method": "embedding",
            "link_score": round(score, 4)}


@lru_cache(maxsize=1)
def _crosswalk():
    from models.crosswalk import Crosswalk

    return Crosswalk(_taxonomy())


def label_job(
    job: Dict[str, Any],
    embed: bool = True,
    use_occupation: bool = True,
    enrich_inferred: bool = True,
) -> Dict[str, Any]:
    """Attach K13 taxonomy skills to one normalized job record."""
    taxonomy = _taxonomy()
    text = f"{job.get('title','')}\n{job.get('description','')}"
    spans = extract_spans(text)

    linked: Dict[str, Dict[str, Any]] = {}
    occupation_spans: List[str] = []
    unlinked: List[str] = []

    for span in spans:
        group = span["entity_group"].lower()
        if "occupation" in group:
            occupation_spans.append(span["text"])
            continue
        if "skill" not in group or span["score"] < MIN_NER_SCORE:
            continue

        result = link_span(span["text"], embed=embed)
        if not result:
            unlinked.append(span["text"])
            continue

        skill_id = result["skill_id"]
        skill = taxonomy.skills.get(skill_id)
        if not skill:
            continue

        existing = linked.get(skill_id)
        if existing and existing["link_score"] >= result["link_score"]:
            existing["mention_count"] += 1
            continue

        linked[skill_id] = {
            "skill_id": skill_id,
            "preferred_label": skill.label,
            "k13_id": skill.k13_id,
            "subcategory": skill.subcategory,
            "parent_group_id": skill.parent_group_id,
            "esco_uri": skill.esco_uri,
            "matched_span": span["text"],
            "ner_score": span["score"],
            "provenance": "stated",
            "relation_type": (
                "essential" if span["score"] >= ESSENTIAL_NER_FLOOR else "optional"
            ),
            "requirement_weight": 1.0 if span["score"] >= ESSENTIAL_NER_FLOOR else 0.4,
            "mention_count": (existing or {}).get("mention_count", 0) + 1,
            **result,
        }

    skills = sorted(
        linked.values(),
        key=lambda item: (-item["link_score"], -item["mention_count"]),
    )[:MAX_SKILLS_PER_JOB]

    # Requirement weighting from the occupation's ESCO relations.
    occupation_meta: Dict[str, Any] = {"occupation": None, "reweighted": 0}
    inferred_added = 0
    if use_occupation:
        from . import occupation as occ

        resolved = occ.resolve_occupation(job.get("title", ""), occupation_spans)
        if enrich_inferred and resolved:
            inferred_added = occ.enrich(skills, resolved, taxonomy, _crosswalk())
        # After enrichment, so every skill carries `provenance` when weighted.
        occupation_meta = occ.apply_relations(skills, resolved)

    labelled = dict(job)
    labelled["skills"] = skills
    labelled["labelling"] = {
        "vocabulary": "kareerly_k13_taxonomy",
        "ner_model": TABIYA_NER_MODEL,
        "embed_model": TABIYA_EMBED_MODEL if embed else None,
        "span_count": len(spans),
        "occupation_spans": occupation_spans[:5],
        "stated_skill_count": sum(1 for s in skills if s.get("provenance") == "stated"),
        "inferred_skill_count": inferred_added,
        "occupation": occupation_meta.get("occupation"),
        "relations_from_esco": occupation_meta.get("reweighted", 0),
        "unlinked_span_count": len(unlinked),
        "unlinked_spans": unlinked[:15],
        "link_methods": {
            method: sum(1 for s in skills if s["link_method"] == method)
            for method in ("alias", "embedding")
        },
    }
    return labelled


def label_all(
    in_path: Optional[Path] = None,
    out_path: Optional[Path] = None,
    tiers: Tuple[str, ...] = ("match",),
    embed: bool = True,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    in_path = in_path or (NORMALIZED_DIR / "jobs.jsonl")
    out_path = out_path or (LABELLED_DIR / "jobs.jsonl")
    counts = {"read": 0, "labelled": 0, "skipped_tier": 0, "no_skills": 0,
              "linked_by_alias": 0, "linked_by_embedding": 0, "unlinked_spans": 0,
              "occupation_resolved": 0, "relations_from_esco": 0, "inferred_added": 0}

    with in_path.open(encoding="utf-8") as source, out_path.open("w", encoding="utf-8") as out:
        for line in source:
            if not line.strip():
                continue
            counts["read"] += 1
            job = json.loads(line)

            if job.get("corpus_tier") not in tiers:
                counts["skipped_tier"] += 1
                continue
            if limit and counts["labelled"] >= limit:
                break

            labelled = label_job(job, embed=embed)
            meta = labelled["labelling"]
            if not labelled["skills"]:
                counts["no_skills"] += 1
            counts["linked_by_alias"] += meta["link_methods"]["alias"]
            counts["linked_by_embedding"] += meta["link_methods"]["embedding"]
            counts["unlinked_spans"] += meta["unlinked_span_count"]
            counts["occupation_resolved"] += int(bool(meta.get("occupation")))
            counts["relations_from_esco"] += meta.get("relations_from_esco", 0)
            counts["inferred_added"] += meta.get("inferred_skill_count", 0)
            counts["labelled"] += 1
            out.write(json.dumps(labelled, ensure_ascii=False) + "\n")

            if counts["labelled"] % 100 == 0:
                print(f"  labelled {counts['labelled']}...", flush=True)

    total_links = counts["linked_by_alias"] + counts["linked_by_embedding"]
    counts["link_rate"] = (
        round(total_links / (total_links + counts["unlinked_spans"]), 4)
        if (total_links + counts["unlinked_spans"]) else 0.0
    )
    return counts
