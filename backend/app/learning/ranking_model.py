"""Feedback re-ranking applied inside the Fit-Now and Aspiration lists.

Eligibility never changes here: match_scoring.classify decides which list a job
belongs to, and this module only reorders jobs *within* a list. The displayed
match percentage stays the transparent composite score; the learned model only
adds a bounded adjustment to each list's existing primary sort key:

* Fit-Now primary key:     match_score
* Aspiration primary key:  preference_alignment

With no active model (cold start, kill switch, Supabase unavailable, invalid
parameters) the adjustment is zero and the order is exactly the baseline order.
"""
from __future__ import annotations

import logging
import math
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from ..services.match_scoring import aspiration_relevant_min_score
from .supabase_client import SupabaseError, SupabaseRest, configured_anon_key, configured_url

logger = logging.getLogger(__name__)

BASELINE_VERSION = "baseline-composite-v1"
MODEL_TYPE = "feedback_rerank_logistic_v1"
FIT_NOW = "Fit-Now"
ASPIRATION = "Aspiration"

FEATURES = (
    "match_score",
    "semantic_similarity",
    "required_skill_coverage",
    "preferred_skill_coverage",
    "preference_alignment",
    "learning_readiness",
    "critical_missing",
    "is_aspiration",
    "in_preferred_career_area",
)
# Hard limits enforced on load, whatever the stored parameters say, so a bad or
# tampered row can nudge the order but never overturn the baseline.
MAX_ADJUSTMENT_LIMIT = 0.15
ADJUSTMENT_SCALE_LIMIT = 0.5

# Same keys and directions as the pre-feedback pandas sort in matching_service.
TIE_BREAKERS = ("semantic_score_raw", "skill_coverage", "preference_alignment", "learning_readiness")


def _unit(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(number):
        return default
    return min(max(number, 0.0), 1.0)


def feature_vector(item: Dict[str, Any], category: Optional[str] = None) -> List[float]:
    """Model features from a match dict or a feedback row; all on 0..1.

    Unknown coverage or career area is neutral (0.5) rather than zero, matching
    how score_match leaves out components that have no data.
    """
    category = category or item.get("match_category") or item.get("match_type")
    in_area = item.get("in_preferred_career_area")
    critical = item.get("critical_missing_count")
    if critical is None and isinstance(item.get("critical_missing_skill_ids"), list):
        critical = len(item["critical_missing_skill_ids"])
    return [
        _unit(item.get("match_score"), 0.0),
        _unit(item.get("semantic_similarity", item.get("semantic_score")), 0.0),
        _unit(item.get("required_skill_coverage"), 0.5),
        _unit(item.get("preferred_skill_coverage"), 0.5),
        _unit(item.get("preference_alignment"), 0.0),
        _unit(item.get("learning_readiness"), 0.0),
        min(max(_unit(float(critical or 0) / 2.0, 0.0), 0.0), 1.0),
        1.0 if category == ASPIRATION else 0.0,
        0.5 if in_area is None else (1.0 if in_area else 0.0),
    ]


@dataclass(frozen=True)
class RankerParams:
    mean: tuple
    scale: tuple
    coef: tuple
    intercept: float
    p_mean: float
    adjustment_scale: float
    max_adjustment: float

    @classmethod
    def from_dict(cls, raw: Any) -> "RankerParams":
        if not isinstance(raw, dict):
            raise ValueError("Ranker params must be an object.")
        if tuple(raw.get("features") or ()) != FEATURES:
            raise ValueError("Ranker features do not match this backend version.")
        vectors = {}
        for key in ("mean", "scale", "coef"):
            values = [float(v) for v in raw.get(key) or []]
            if len(values) != len(FEATURES) or not all(math.isfinite(v) for v in values):
                raise ValueError(f"Ranker {key} is invalid.")
            vectors[key] = tuple(values)
        if any(v <= 0 for v in vectors["scale"]):
            raise ValueError("Ranker scale must be positive.")
        scalars = {key: float(raw.get(key)) for key in ("intercept", "p_mean", "adjustment_scale", "max_adjustment")}
        if not all(math.isfinite(v) for v in scalars.values()):
            raise ValueError("Ranker scalars are invalid.")
        return cls(
            mean=vectors["mean"], scale=vectors["scale"], coef=vectors["coef"],
            intercept=scalars["intercept"],
            p_mean=min(max(scalars["p_mean"], 0.0), 1.0),
            adjustment_scale=min(max(scalars["adjustment_scale"], 0.0), ADJUSTMENT_SCALE_LIMIT),
            max_adjustment=min(max(scalars["max_adjustment"], 0.0), MAX_ADJUSTMENT_LIMIT),
        )

    def as_dict(self) -> Dict[str, Any]:
        return {
            "features": list(FEATURES), "mean": list(self.mean), "scale": list(self.scale),
            "coef": list(self.coef), "intercept": self.intercept, "p_mean": self.p_mean,
            "adjustment_scale": self.adjustment_scale, "max_adjustment": self.max_adjustment,
        }

    def probability(self, features: Sequence[float]) -> float:
        z = self.intercept + sum(c * (x - m) / s for c, x, m, s in zip(self.coef, features, self.mean, self.scale))
        z = min(max(z, -30.0), 30.0)
        return 1.0 / (1.0 + math.exp(-z))

    def adjustment(self, features: Sequence[float]) -> float:
        delta = self.adjustment_scale * (self.probability(features) - self.p_mean)
        return min(max(delta, -self.max_adjustment), self.max_adjustment)


@dataclass(frozen=True)
class Ranker:
    version: str
    params: Optional[RankerParams] = None
    fallback_reason: str = ""

    @property
    def is_baseline(self) -> bool:
        return self.params is None


BASELINE = Ranker(BASELINE_VERSION)


def primary_key(item: Dict[str, Any], category: str) -> float:
    return float(item.get("preference_alignment" if category == ASPIRATION else "match_score") or 0.0)


def rank_category(items: List[Dict[str, Any]], category: str, ranker: Ranker = BASELINE) -> List[Dict[str, Any]]:
    """Order one list. Annotates each item with its adjustment and ranker version."""
    adjustments = [0.0] * len(items)
    effective = ranker
    if not ranker.is_baseline:
        try:
            adjustments = [ranker.params.adjustment(feature_vector(item, category)) for item in items]
        except Exception:  # noqa: BLE001 - a broken model must never break matching
            logger.exception("Ranker %s failed; using the baseline order", ranker.version)
            adjustments = [0.0] * len(items)
            effective = Ranker(BASELINE_VERSION, None, "ranker_error")

    # Aspiration's baseline order is relevance (match score at or above
    # ASPIRATION_RELEVANT_MIN_SCORE first), then preference_alignment, then
    # match_score, then the shared tie-breakers; Fit-Now's is match_score then
    # the tie-breakers. A learned adjustment moves jobs within a relevance band only.
    secondary = ("match_score",) if category == ASPIRATION else ()
    relevance_floor = aspiration_relevant_min_score() if category == ASPIRATION else 0.0

    def key(pair):
        item, adjustment = pair
        below_floor = float(item.get("match_score") or 0.0) < relevance_floor
        return (
            below_floor,
            -(primary_key(item, category) + adjustment),
            *(-float(item.get(name) or 0.0) for name in (*secondary, *TIE_BREAKERS)),
            str(item.get("job_id", "")),
        )

    ordered = sorted(zip(items, adjustments), key=key)
    ranked = []
    for position, (item, adjustment) in enumerate(ordered, start=1):
        ranked.append({**item, "rank_position": position, "ranking_adjustment": round(adjustment, 6),
            "ranker_version": effective.version})
    return ranked


# ---------------------------------------------------------------------------
# Active model loading
# ---------------------------------------------------------------------------

_cache_lock = threading.Lock()
_cache: Dict[str, Any] = {"ranker": None, "loaded_at": 0.0}


def _cache_seconds() -> float:
    try:
        return max(0.0, float(os.getenv("KAREERLY_RANKER_CACHE_SECONDS", "300")))
    except ValueError:
        return 300.0


def clear_ranker_cache() -> None:
    with _cache_lock:
        _cache.update(ranker=None, loaded_at=0.0)


def load_active_ranker_uncached() -> Ranker:
    mode = os.getenv("KAREERLY_RANKER", "auto").strip().lower()
    if mode in {"baseline", "off", "0", "false"}:
        return Ranker(BASELINE_VERSION, None, "forced_baseline")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not configured_url() or not (service_key or configured_anon_key()):
        return Ranker(BASELINE_VERSION, None, "supabase_not_configured")
    try:
        # ranking_models is not a public table: migration 20261028090000 took
        # anon's access away, so the backend reads it with its service key.
        # The public key remains a fallback for setups without one.
        client = SupabaseRest(configured_url(), service_key, timeout=5.0) if service_key else SupabaseRest.anon()
        rows = client.select("ranking_models", {
            "select": "version,model_type,params", "status": "eq.active", "limit": "1",
        })
    except SupabaseError as exc:
        logger.warning("Active ranking model unavailable, using baseline: %s", exc)
        return Ranker(BASELINE_VERSION, None, "model_fetch_failed")
    if not rows:
        return Ranker(BASELINE_VERSION, None, "no_active_model")
    row = rows[0]
    if row.get("model_type") != MODEL_TYPE:
        return Ranker(BASELINE_VERSION, None, "unsupported_model_type")
    try:
        return Ranker(str(row.get("version")), RankerParams.from_dict(row.get("params")))
    except (TypeError, ValueError) as exc:
        logger.warning("Active ranking model %s is invalid, using baseline: %s", row.get("version"), exc)
        return Ranker(BASELINE_VERSION, None, "invalid_model_params")


def cached_ranker_status() -> Dict[str, Any]:
    """The ranker matching last used, without contacting Supabase (for health checks)."""
    with _cache_lock:
        ranker = _cache["ranker"]
    if ranker is None:
        return {"loaded": False, "version": None, "fallback_reason": None}
    return {"loaded": True, "version": ranker.version, "fallback_reason": ranker.fallback_reason or None}


def active_ranker() -> Ranker:
    with _cache_lock:
        cached = _cache["ranker"]
        if cached is not None and time.monotonic() - _cache["loaded_at"] < _cache_seconds():
            return cached
    ranker = load_active_ranker_uncached()
    with _cache_lock:
        _cache.update(ranker=ranker, loaded_at=time.monotonic())
    return ranker
