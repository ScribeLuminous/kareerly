"""Batch training, evaluation and promotion of the feedback re-ranker.

One run (scheduled, or started by an admin):

1. Load current votes (service role) and keep only settled votes from candidate
   accounts with valid context.
2. Limit each account's and each job's influence, and drop accounts that vote
   the same way on everything, so a single account cannot steer the model.
3. Stop with ``insufficient_data`` below the minimum volume. Nothing changes.
4. Fit an L2-regularised logistic model on the older 75% of votes and evaluate
   on the newest 25%: weighted AUC inside each list (Fit-Now, Aspiration) for
   the baseline order, the candidate order and the current active order.
5. Promote only when the candidate beats the baseline by at least MIN_AUC_GAIN
   and the bootstrap 10th percentile of the gain is above zero, and it is not
   worse than the current model. Otherwise keep what is active.
6. If the current active model is now measurably worse than the baseline,
   retire it so matching falls back to the baseline automatically.

Every run is logged in ranking_training_runs; every fitted model is stored in
ranking_models with its metrics, so any version can be inspected or restored.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .ranking_model import (
    ASPIRATION,
    BASELINE_VERSION,
    FEATURES,
    FIT_NOW,
    MODEL_TYPE,
    RankerParams,
    feature_vector,
    primary_key,
)
from .supabase_client import SupabaseError, SupabaseRest

logger = logging.getLogger(__name__)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class TrainingConfig:
    min_users: int = 10
    min_effective_votes: float = 100.0
    min_class_weight: float = 20.0
    min_eval_votes: int = 30
    min_eval_users: int = 5
    eval_fraction: float = 0.25          # of total vote weight, newest first
    max_eval_account_share: float = 0.10  # no account decides more than this much of the evaluation
    user_vote_cap: float = 20.0          # an account counts as at most this many votes
    job_weight_cap: float = 10.0         # one job counts as at most this many votes
    uniform_voter_min_votes: int = 15    # all-same votes beyond this are ignored
    settle_minutes: int = 60             # votes changed more recently wait for the next run
    l2_c: float = 1.0
    shrinkage_votes: float = 200.0       # adjustment grows as n / (n + this)
    base_adjustment_scale: float = 0.2
    max_adjustment: float = 0.10
    min_auc_gain: float = 0.01
    bootstrap_samples: int = 300
    seed: int = 20260925

    @classmethod
    def from_env(cls) -> "TrainingConfig":
        base = cls()
        return cls(
            min_users=int(_env_float("KAREERLY_LEARN_MIN_USERS", base.min_users)),
            min_effective_votes=_env_float("KAREERLY_LEARN_MIN_VOTES", base.min_effective_votes),
            min_auc_gain=_env_float("KAREERLY_LEARN_MIN_AUC_GAIN", base.min_auc_gain),
        )


@dataclass
class Example:
    user_id: str
    job_key: str
    category: str
    vote: int
    updated_at: datetime
    features: List[float]
    primary: float
    weight: float = 1.0


@dataclass
class PreparedData:
    examples: List[Example]
    summary: Dict[str, Any] = field(default_factory=dict)


def _parse_time(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def prepare_examples(
    rows: Sequence[Dict[str, Any]],
    candidate_user_ids: Optional[set],
    now: datetime,
    config: TrainingConfig,
) -> PreparedData:
    """Validate, filter and weight feedback rows."""
    dropped = Counter()
    settled_before = now - timedelta(minutes=config.settle_minutes)
    examples: List[Example] = []
    for row in rows:
        vote = row.get("vote")
        category = row.get("match_category")
        updated = _parse_time(row.get("updated_at"))
        user_id = str(row.get("user_id") or "")
        if vote not in (-1, 1) or category not in (FIT_NOW, ASPIRATION) or not user_id or updated is None:
            dropped["invalid"] += 1
            continue
        if candidate_user_ids is not None and user_id not in candidate_user_ids:
            dropped["not_candidate_account"] += 1
            continue
        if updated > settled_before:
            dropped["not_settled"] += 1
            continue
        if row.get("match_score") is None:
            dropped["missing_context"] += 1
            continue
        examples.append(Example(
            user_id=user_id,
            job_key=f"{row.get('job_source') or 'internal'}:{row.get('job_id')}",
            category=category,
            vote=int(vote),
            updated_at=updated,
            features=feature_vector(row, category),
            primary=primary_key(row, category),
        ))

    by_user: Dict[str, List[Example]] = defaultdict(list)
    for example in examples:
        by_user[example.user_id].append(example)
    kept: List[Example] = []
    for user_examples in by_user.values():
        votes = {example.vote for example in user_examples}
        if len(user_examples) >= config.uniform_voter_min_votes and len(votes) == 1:
            dropped["uniform_voter"] += len(user_examples)
            continue
        weight = min(1.0, config.user_vote_cap / len(user_examples))
        for example in user_examples:
            example.weight = weight
            kept.append(example)

    by_job: Dict[str, float] = defaultdict(float)
    for example in kept:
        by_job[example.job_key] += example.weight
    for example in kept:
        total = by_job[example.job_key]
        if total > config.job_weight_cap:
            example.weight *= config.job_weight_cap / total

    positive = sum(e.weight for e in kept if e.vote > 0)
    negative = sum(e.weight for e in kept if e.vote < 0)
    return PreparedData(kept, {
        "rows_read": len(rows),
        "rows_used": len(kept),
        "dropped": dict(dropped),
        "users": len({e.user_id for e in kept}),
        "effective_votes": round(positive + negative, 3),
        "positive_weight": round(positive, 3),
        "negative_weight": round(negative, 3),
    })


def sufficiency_problem(data: PreparedData, config: TrainingConfig) -> Optional[str]:
    s = data.summary
    if s["users"] < config.min_users:
        return f"needs votes from at least {config.min_users} accounts (has {s['users']})"
    if s["effective_votes"] < config.min_effective_votes:
        return f"needs at least {config.min_effective_votes:g} effective votes (has {s['effective_votes']:g})"
    if min(s["positive_weight"], s["negative_weight"]) < config.min_class_weight:
        return f"needs at least {config.min_class_weight:g} effective good and bad votes each"
    return None


def weighted_auc(scores: np.ndarray, labels: np.ndarray, weights: np.ndarray) -> Optional[float]:
    """Probability a random good vote outranks a random bad one (ties count half)."""
    pos, neg = labels > 0, labels <= 0
    wp, wn = weights[pos].sum(), weights[neg].sum()
    if wp <= 0 or wn <= 0:
        return None
    order = np.argsort(scores, kind="mergesort")
    s, y, w = scores[order], labels[order], weights[order]
    auc = 0.0
    neg_below = 0.0
    i = 0
    while i < len(s):
        j = i
        while j < len(s) and s[j] == s[i]:
            j += 1
        block_pos = w[i:j][y[i:j] > 0].sum()
        block_neg = w[i:j][y[i:j] <= 0].sum()
        auc += block_pos * (neg_below + 0.5 * block_neg)
        neg_below += block_neg
        i = j
    return float(auc / (wp * wn))


def within_list_auc(examples: Sequence[Example], scores: np.ndarray, index: Optional[np.ndarray] = None) -> Optional[float]:
    """AUC computed separately for Fit-Now and Aspiration, averaged by weight.

    The ranker only reorders jobs inside a list, so pairs across lists are not
    something it can change and are not scored.
    """
    idx = np.arange(len(examples)) if index is None else index
    total, weight_sum = 0.0, 0.0
    for category in (FIT_NOW, ASPIRATION):
        members = np.asarray([i for i in idx if examples[i].category == category], dtype=int)
        if members.size == 0:
            continue
        labels = np.asarray([examples[i].vote for i in members])
        weights = np.asarray([examples[i].weight for i in members])
        auc = weighted_auc(scores[members], labels, weights)
        if auc is None:
            continue
        total += auc * weights.sum()
        weight_sum += weights.sum()
    return total / weight_sum if weight_sum else None


def split_train_eval(examples: Sequence[Example], config: TrainingConfig) -> Tuple[List[Example], List[Example]]:
    """Newest votes (by weight, not row count) evaluate; the rest train.

    Splitting by weight stops one busy account from filling the evaluation
    window, and capping each account's share of the evaluation weight stops it
    from grading a model trained on its own votes.
    """
    ordered = sorted(examples, key=lambda e: (e.updated_at, e.user_id, e.job_key))
    total = sum(e.weight for e in ordered)
    evaluation: List[Example] = []
    acc = 0.0
    while ordered and acc < total * config.eval_fraction:
        example = ordered.pop()
        evaluation.append(example)
        acc += example.weight
    evaluation.reverse()
    eval_total = sum(e.weight for e in evaluation)
    per_user: Dict[str, float] = defaultdict(float)
    for example in evaluation:
        per_user[example.user_id] += example.weight
    cap = config.max_eval_account_share * eval_total
    # Copies so the training weights are untouched.
    capped = [
        Example(e.user_id, e.job_key, e.category, e.vote, e.updated_at, e.features, e.primary,
            e.weight * min(1.0, cap / per_user[e.user_id]) if per_user[e.user_id] > 0 else e.weight)
        for e in evaluation
    ]
    return ordered, capped


def fit_params(train: Sequence[Example], config: TrainingConfig) -> RankerParams:
    from sklearn.linear_model import LogisticRegression

    X = np.asarray([e.features for e in train], dtype=float)
    y = np.asarray([1 if e.vote > 0 else 0 for e in train])
    w = np.asarray([e.weight for e in train], dtype=float)
    mean = np.average(X, axis=0, weights=w)
    scale = np.sqrt(np.average((X - mean) ** 2, axis=0, weights=w))
    scale = np.where(scale < 1e-6, 1.0, scale)
    model = LogisticRegression(C=config.l2_c, max_iter=1000)
    model.fit((X - mean) / scale, y, sample_weight=w)
    effective = float(w.sum())
    adjustment_scale = config.base_adjustment_scale * effective / (effective + config.shrinkage_votes)
    params = RankerParams(
        mean=tuple(float(v) for v in mean), scale=tuple(float(v) for v in scale),
        coef=tuple(float(v) for v in model.coef_[0]), intercept=float(model.intercept_[0]),
        p_mean=0.5, adjustment_scale=adjustment_scale, max_adjustment=config.max_adjustment,
    )
    p_mean = float(np.average([params.probability(e.features) for e in train], weights=w))
    return RankerParams(params.mean, params.scale, params.coef, params.intercept, p_mean,
        params.adjustment_scale, params.max_adjustment)


def order_scores(examples: Sequence[Example], params: Optional[RankerParams]) -> np.ndarray:
    return np.asarray([e.primary + (params.adjustment(e.features) if params else 0.0) for e in examples])


def bootstrap_gain(examples: Sequence[Example], a: np.ndarray, b: np.ndarray, config: TrainingConfig) -> Dict[str, float]:
    """Distribution of within-list AUC(a) - AUC(b) over resampled evaluation votes."""
    rng = np.random.default_rng(config.seed)
    gains = []
    n = len(examples)
    for _ in range(config.bootstrap_samples):
        sample = rng.integers(0, n, n)
        auc_a, auc_b = within_list_auc(examples, a, sample), within_list_auc(examples, b, sample)
        if auc_a is not None and auc_b is not None:
            gains.append(auc_a - auc_b)
    if not gains:
        return {"mean": 0.0, "p10": 0.0, "p90": 0.0, "samples": 0}
    arr = np.asarray(gains)
    return {"mean": float(arr.mean()), "p10": float(np.percentile(arr, 10)),
        "p90": float(np.percentile(arr, 90)), "samples": int(arr.size)}


@dataclass
class TrainingDecision:
    outcome: str                       # promoted | kept_current | insufficient_data | rolled_back
    reason: str
    candidate: Optional[RankerParams] = None
    candidate_version: Optional[str] = None
    demote_current: bool = False
    metrics: Dict[str, Any] = field(default_factory=dict)


def model_version(params: RankerParams, now: datetime) -> str:
    digest = hashlib.sha256(json.dumps(params.as_dict(), sort_keys=True).encode()).hexdigest()[:8]
    return f"rank-{now.strftime('%Y%m%d-%H%M%S')}-{digest}"


def decide(
    data: PreparedData,
    current: Optional[RankerParams],
    now: datetime,
    config: TrainingConfig,
) -> TrainingDecision:
    """Pure decision step: no I/O, fully testable."""
    metrics: Dict[str, Any] = {"data": data.summary, "config": {
        "min_users": config.min_users, "min_effective_votes": config.min_effective_votes,
        "min_auc_gain": config.min_auc_gain, "user_vote_cap": config.user_vote_cap,
    }}
    problem = sufficiency_problem(data, config)
    if problem:
        return TrainingDecision("insufficient_data", problem, metrics=metrics)

    train, evaluation = split_train_eval(data.examples, config)
    if (len(evaluation) < config.min_eval_votes or len({e.user_id for e in evaluation}) < config.min_eval_users
            or len({e.vote for e in evaluation}) < 2 or len({e.vote for e in train}) < 2):
        return TrainingDecision("insufficient_data",
            "evaluation window needs more recent good and bad votes from several accounts", metrics=metrics)

    candidate = fit_params(train, config)
    baseline_scores = order_scores(evaluation, None)
    candidate_scores = order_scores(evaluation, candidate)
    baseline_auc = within_list_auc(evaluation, baseline_scores)
    candidate_auc = within_list_auc(evaluation, candidate_scores)
    if baseline_auc is None or candidate_auc is None:
        return TrainingDecision("insufficient_data", "evaluation lists need both good and bad votes", metrics=metrics)
    gain = bootstrap_gain(evaluation, candidate_scores, baseline_scores, config)
    metrics["evaluation"] = {
        "train_votes": len(train), "eval_votes": len(evaluation),
        "eval_window_start": evaluation[0].updated_at.isoformat(),
        "baseline_auc": round(baseline_auc, 4), "candidate_auc": round(candidate_auc, 4),
        "candidate_vs_baseline": {k: round(v, 4) if isinstance(v, float) else v for k, v in gain.items()},
        "metric": "weighted AUC of votes within the Fit-Now and Aspiration lists",
    }

    demote = False
    current_auc = None
    if current is not None:
        current_scores = order_scores(evaluation, current)
        current_auc = within_list_auc(evaluation, current_scores)
        current_gain = bootstrap_gain(evaluation, current_scores, baseline_scores, config)
        metrics["evaluation"]["current_auc"] = None if current_auc is None else round(current_auc, 4)
        metrics["evaluation"]["current_vs_baseline"] = {k: round(v, 4) if isinstance(v, float) else v for k, v in current_gain.items()}
        # Retire the active model when fresh votes show it is worse than baseline.
        demote = current_gain["samples"] > 0 and current_gain["p90"] < 0

    beats_baseline = gain["mean"] >= config.min_auc_gain and gain["p10"] > 0
    beats_current = current_auc is None or candidate_auc >= current_auc
    version = model_version(candidate, now)
    if beats_baseline and beats_current:
        return TrainingDecision("promoted", "candidate beats the baseline on recent votes", candidate, version, demote, metrics)
    reason = ("candidate did not beat the baseline reliably" if not beats_baseline
        else "candidate did not beat the current model")
    if demote:
        return TrainingDecision("rolled_back", f"{reason}; the current model is worse than the baseline and was retired",
            candidate, version, True, metrics)
    return TrainingDecision("kept_current", reason, candidate, version, False, metrics)


# ---------------------------------------------------------------------------
# I/O: load votes, persist decisions, roll back
# ---------------------------------------------------------------------------

FEEDBACK_COLUMNS = ("user_id,job_id,job_source,vote,match_category,match_score,semantic_similarity,"
    "required_skill_coverage,preferred_skill_coverage,preference_alignment,learning_readiness,"
    "critical_missing_count,in_preferred_career_area,updated_at")


def load_feedback(client: SupabaseRest) -> Tuple[List[Dict[str, Any]], set]:
    rows = client.select_all("match_feedback", {"select": FEEDBACK_COLUMNS, "order": "updated_at.asc"})
    candidates = {
        str(row.get("id")) for row in client.select_all("profiles", {"select": "id", "role": "eq.candidate"})
    }
    return rows, candidates


def load_active(client: SupabaseRest) -> Tuple[Optional[str], Optional[RankerParams]]:
    rows = client.select("ranking_models", {"select": "version,params", "status": "eq.active", "limit": "1"})
    if not rows:
        return None, None
    try:
        return str(rows[0]["version"]), RankerParams.from_dict(rows[0].get("params"))
    except (KeyError, TypeError, ValueError):
        # An unreadable active model is treated as absent; matching already falls back.
        return str(rows[0].get("version")), None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _retire_active(client: SupabaseRest) -> None:
    client.update("ranking_models", {"status": "eq.active"}, {"status": "retired", "retired_at": _now_iso()})


def _log_run(client: SupabaseRest, *, trigger: str, started: str, outcome: str, reason: str,
        candidate_version: Optional[str], active_after: Optional[str], metrics: Dict[str, Any]) -> None:
    client.insert("ranking_training_runs", {
        "trigger": trigger, "started_at": started, "finished_at": _now_iso(), "outcome": outcome,
        "reason": reason[:500], "candidate_version": candidate_version,
        "active_version_after": active_after or BASELINE_VERSION, "metrics": metrics,
    }, returning=False)


def run_training(client: SupabaseRest, *, trigger: str = "scheduled", dry_run: bool = False,
        config: Optional[TrainingConfig] = None, now: Optional[datetime] = None) -> Dict[str, Any]:
    config = config or TrainingConfig.from_env()
    now = now or datetime.now(timezone.utc)
    started = now.isoformat()
    try:
        rows, candidate_ids = load_feedback(client)
        active_version, active_params = load_active(client)
        data = prepare_examples(rows, candidate_ids, now, config)
        decision = decide(data, active_params, now, config)
    except Exception as exc:  # noqa: BLE001 - record the failure, keep the active model
        logger.exception("Ranking training failed")
        if not dry_run:
            try:
                _log_run(client, trigger=trigger, started=started, outcome="failed", reason=str(exc),
                    candidate_version=None, active_after=None, metrics={})
            except SupabaseError:
                logger.exception("Could not record the failed training run")
        return {"outcome": "failed", "reason": str(exc), "active_version": None, "dry_run": dry_run}

    active_after = active_version
    if not dry_run:
        if decision.candidate is not None:
            if decision.demote_current or decision.outcome == "promoted":
                _retire_active(client)
                active_after = None
            client.insert("ranking_models", {
                "version": decision.candidate_version,
                "status": "active" if decision.outcome == "promoted" else "rejected",
                "model_type": MODEL_TYPE,
                "params": decision.candidate.as_dict(),
                "metrics": decision.metrics.get("evaluation", {}),
                "training_summary": decision.metrics.get("data", {}),
                "activated_at": _now_iso() if decision.outcome == "promoted" else None,
                "created_by": trigger,
                "notes": decision.reason,
            }, returning=False)
            if decision.outcome == "promoted":
                active_after = decision.candidate_version
        _log_run(client, trigger=trigger, started=started, outcome=decision.outcome, reason=decision.reason,
            candidate_version=decision.candidate_version, active_after=active_after, metrics=decision.metrics)
    elif decision.outcome == "promoted":
        active_after = decision.candidate_version
    return {
        "outcome": decision.outcome, "reason": decision.reason, "candidate_version": decision.candidate_version,
        "active_version": active_after or BASELINE_VERSION, "metrics": decision.metrics, "dry_run": dry_run,
    }


def rollback(client: SupabaseRest, *, target_version: Optional[str] = None, actor: str = "admin") -> Dict[str, Any]:
    """Retire the active model and optionally reactivate an earlier version.

    With no target the baseline ranking takes over as soon as the matcher's
    model cache expires (KAREERLY_RANKER_CACHE_SECONDS, five minutes by default).
    """
    started = _now_iso()
    if target_version:
        rows = client.select("ranking_models", {"select": "version,params,status", "version": f"eq.{target_version}"})
        if not rows:
            raise ValueError(f"Ranking model {target_version} does not exist.")
        RankerParams.from_dict(rows[0].get("params"))  # refuse to activate unreadable parameters
    previous, _ = load_active(client)
    _retire_active(client)
    if target_version:
        client.update("ranking_models", {"version": f"eq.{target_version}"},
            {"status": "active", "activated_at": _now_iso(), "retired_at": None})
    active_after = target_version or BASELINE_VERSION
    _log_run(client, trigger=actor, started=started, outcome="rolled_back",
        reason=f"manual rollback from {previous or BASELINE_VERSION} to {active_after}",
        candidate_version=None, active_after=target_version, metrics={})
    return {"previous_version": previous or BASELINE_VERSION, "active_version": active_after}


def status(client: SupabaseRest, runs: int = 10) -> Dict[str, Any]:
    active = client.select("ranking_models", {
        "select": "version,metrics,training_summary,activated_at,created_by", "status": "eq.active", "limit": "1"})
    recent_runs = client.select("ranking_training_runs", {
        "select": "started_at,finished_at,trigger,outcome,reason,candidate_version,active_version_after",
        "order": "started_at.desc", "limit": str(runs)})
    versions = client.select("ranking_models", {
        "select": "version,status,created_at,activated_at,retired_at,notes", "order": "created_at.desc", "limit": "20"})
    return {
        "active_model": active[0] if active else {"version": BASELINE_VERSION},
        "recent_runs": recent_runs, "versions": versions,
    }
