"""Resolve a posting to an ESCO occupation, and use it for requirement weighting.

Why this exists. When labelling moved from ESCO to the K13 taxonomy, one thing
regressed: `relation_type`. The ESCO path read essential/optional from
`occupationSkillRelations` -- published data. The taxonomy has no
occupation->skill relations, so the replacement derived it from NER confidence,
which is a poor proxy and demonstrably wrong: on a developer posting it marked
JavaScript, Python and SQL *optional* while Web Development came out essential.

`relation_type` sets omega_r in the matching score, so getting it backwards
mis-weights coverage on every job.

The fix keeps linking in the taxonomy and borrows ESCO only for the thing ESCO
is actually good at. Essential/optional is a property of the OCCUPATION-SKILL
PAIR, not of the skill, so the posting must first be resolved to an occupation:

    title + NER occupation spans  ->  ESCO occupation
    occupation                    ->  essential / optional skill URIs
    taxonomy skill.esco_uri       ->  membership test  ->  relation_type

It also restores enrichment. Essential skills for the occupation that the
posting never mentions can be added as `provenance="inferred"` -- the documented
response to Bhola et al.'s finding that postings omit up to 65% of relevant
skills -- while staying distinguishable from what the text actually stated.
"""

from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from models.crosswalk import esco_key  # noqa: E402
from models.esco_api import EscoClient  # noqa: E402

#: Below this the occupation match is too weak to trust for weighting.
MIN_OCCUPATION_SCORE = 0.55
#: Cap enrichment so a broad occupation cannot swamp what the posting said.
#: Set low deliberately: at 8 a web-developer posting acquired "Technical
#: Drafting" as an essential requirement, which is the v1 failure in miniature.
MAX_INFERRED_PER_JOB = 4

#: Inferred skills never reach full weight. They describe what is TYPICAL of the
#: occupation, not what this employer asked for, and gap analysis should not
#: send a candidate on a course for a skill nobody demanded.
INFERRED_WEIGHT = 0.3


@lru_cache(maxsize=1)
def _client() -> EscoClient:
    return EscoClient()


@lru_cache(maxsize=1)
def _embedder():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cpu")


def resolve_occupation(
    title: str,
    occupation_spans: Optional[Sequence[str]] = None,
    candidates: int = 5,
) -> Optional[Dict[str, Any]]:
    """Best ESCO occupation for a posting, verified by embedding similarity.

    ESCO search alone is too loose -- "Senior Junior Software Developer" will
    return plausible-looking rubbish. The query is scored against candidate
    titles and anything under the floor is rejected rather than guessed.
    """
    query = " ".join([str(title or "")] + list(occupation_spans or [])).strip()
    if not query:
        return None

    data = _client()._get("/search", text=query[:180], type="occupation", limit=candidates)
    results = (data or {}).get("_embedded", {}).get("results", [])
    if not results:
        return None

    titles = [r.get("title", "") for r in results]
    vectors = _embedder().encode(
        [query] + titles, normalize_embeddings=True, show_progress_bar=False
    )
    scores = (vectors[1:] @ vectors[0]).tolist()
    best = max(range(len(scores)), key=lambda i: scores[i])

    if float(scores[best]) < MIN_OCCUPATION_SCORE:
        return None
    return {
        "uri": results[best].get("uri", ""),
        "title": titles[best],
        "score": round(float(scores[best]), 4),
        "query": query[:120],
    }


@lru_cache(maxsize=512)
def occupation_skill_sets(uri: str) -> Tuple[frozenset, frozenset]:
    """(essential_keys, optional_keys) for one ESCO occupation."""
    record = _client()._get("/resource/occupation", uri=uri)
    links = (record or {}).get("_links", {}) or {}

    def keys(name: str) -> frozenset:
        return frozenset(
            esco_key(item.get("uri", ""))
            for item in links.get(name, [])
            if item.get("uri")
        )

    return keys("hasEssentialSkill"), keys("hasOptionalSkill")


def apply_relations(
    skills: List[Dict[str, Any]],
    occupation: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Re-weight linked skills using the occupation's ESCO relations.

    Skills the occupation does not list at all keep their NER-derived guess but
    are marked `relation_source="ner_proxy"`, so a reader can tell which weights
    rest on published data and which on a heuristic.
    """
    if not occupation or not occupation.get("uri"):
        for skill in skills:
            skill["relation_source"] = "ner_proxy"
        return {"occupation": None, "reweighted": 0, "from_esco": 0}

    essential, optional = occupation_skill_sets(occupation["uri"])
    reweighted = 0

    for skill in skills:
        # A skill the posting explicitly states is a requirement OF THIS JOB.
        # ESCO describes the occupation in general -- it lists specific
        # programming languages as "optional" for software developer because no
        # particular one is universal. Letting that override an explicit demand
        # would down-weight the very skill the employer asked for.
        if skill.get("provenance") == "stated":
            skill["relation_type"] = "essential"
            skill["requirement_weight"] = 1.0
            skill["relation_source"] = "stated_in_posting"
            continue

        key = esco_key(skill.get("esco_uri", ""))
        if key and key in essential:
            skill["relation_type"] = "typical_essential"
            skill["requirement_weight"] = INFERRED_WEIGHT
            skill["relation_source"] = "esco_occupation_relation"
            reweighted += 1
        elif key and key in optional:
            skill["relation_type"] = "typical_optional"
            skill["requirement_weight"] = INFERRED_WEIGHT / 2
            skill["relation_source"] = "esco_occupation_relation"
            reweighted += 1
        else:
            skill["relation_source"] = "ner_proxy"

    return {
        "occupation": occupation,
        "reweighted": reweighted,
        "from_esco": reweighted,
        "essential_in_occupation": len(essential),
        "optional_in_occupation": len(optional),
    }


def enrich(
    skills: List[Dict[str, Any]],
    occupation: Optional[Dict[str, Any]],
    taxonomy,
    crosswalk,
    max_inferred: int = MAX_INFERRED_PER_JOB,
) -> int:
    """Add occupation-essential skills the posting never mentioned.

    Every addition is flagged `provenance="inferred"`. Unmarked enrichment is
    what produced "Accounting Assistant requires Python" in v1; gap analysis
    must be able to exclude these or weight them down.
    """
    if not occupation or not occupation.get("uri"):
        return 0

    essential, _ = occupation_skill_sets(occupation["uri"])
    present = {esco_key(s.get("esco_uri", "")) for s in skills}
    added = 0

    for key in sorted(essential):
        if added >= max_inferred:
            break
        if key in present:
            continue
        skill_id = crosswalk.esco_to_kareerly.get(key)
        if not skill_id:
            continue          # essential for the occupation but absent from K13
        record = taxonomy.skills.get(skill_id)
        if not record:
            continue

        skills.append({
            "skill_id": skill_id,
            "preferred_label": record.label,
            "k13_id": record.k13_id,
            "subcategory": record.subcategory,
            "parent_group_id": record.parent_group_id,
            "esco_uri": record.esco_uri,
            "matched_span": "",
            "ner_score": None,
            "link_method": "occupation_profile",
            "link_score": None,
            "provenance": "inferred",
            "relation_type": "typical_essential",
            "requirement_weight": INFERRED_WEIGHT,
            "relation_source": "esco_occupation_relation",
            "inferred_from_occupation": occupation.get("title", ""),
            "mention_count": 0,
        })
        present.add(key)
        added += 1

    return added
