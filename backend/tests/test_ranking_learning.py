"""Feedback re-ranking: cold start, gated promotion, manipulation limits, fallback, rollback."""
import os
import random
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import numpy as np
import pandas as pd

from backend.app.learning import ranking_model as rm
from backend.app.learning import ranking_training as rt
from backend.app.learning.supabase_client import SupabaseError
from backend.app.services import matching_service as matching
from backend.tests.fake_supabase import FakeSupabase

NOW = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
CONFIG = rt.TrainingConfig()


def vote_rows(n_users=30, per_user=12, signal=True, seed=1, start=None):
    """Synthetic votes: with signal, candidates prefer jobs matching their preferences."""
    rng = random.Random(seed)
    start = start or NOW - timedelta(days=30)
    rows = []
    for user in range(n_users):
        for k in range(per_user):
            alignment, score = rng.uniform(0, 1), rng.uniform(0.3, 0.9)
            p = 1 / (1 + np.exp(-(6 * (alignment - 0.5) + (score - 0.6)))) if signal else 0.5
            rows.append(dict(
                user_id=f"u{user}", job_id=f"j{user}-{k}", job_source="internal",
                vote=1 if rng.random() < p else -1, match_category=rng.choice(["Fit-Now", "Aspiration"]),
                match_score=score, semantic_similarity=rng.uniform(0.2, 0.8), required_skill_coverage=rng.uniform(0, 1),
                preferred_skill_coverage=None, preference_alignment=alignment, learning_readiness=0.2,
                critical_missing_count=0, in_preferred_career_area=None,
                updated_at=(start + timedelta(hours=user * 12 + k)).isoformat(),
            ))
    return rows


def decide(rows, current=None, config=CONFIG, candidates=None):
    return rt.decide(rt.prepare_examples(rows, candidates, NOW, config), current, NOW, config)


def match(job_id, category, score, alignment, semantic=0.5, coverage=0.8):
    return dict(job_id=job_id, match_type=category, match_category=category, match_score=score,
        match_percentage=round(score * 100, 2), semantic_score_raw=semantic, semantic_similarity=semantic,
        skill_coverage=coverage, required_skill_coverage=coverage, preferred_skill_coverage=None,
        preference_alignment=alignment, learning_readiness=0.1, critical_missing_skill_ids=[],
        in_preferred_career_area=None)


def strong_params(weight_on="preference_alignment", sign=1.0, max_adjustment=0.1):
    coef = [0.0] * len(rm.FEATURES)
    coef[rm.FEATURES.index(weight_on)] = 3.0 * sign
    return rm.RankerParams(mean=tuple([0.5] * len(rm.FEATURES)), scale=tuple([0.25] * len(rm.FEATURES)),
        coef=tuple(coef), intercept=0.0, p_mean=0.5, adjustment_scale=0.2, max_adjustment=max_adjustment)


class RankOrderTests(unittest.TestCase):
    def test_cold_start_order_is_the_previous_baseline_sort(self):
        rng = random.Random(3)
        items = [match(f"J{i:02d}", "Fit-Now", round(rng.uniform(0.4, 0.9), 2), round(rng.uniform(0, 1), 1),
            round(rng.uniform(0.3, 0.7), 1), round(rng.choice([0.5, 0.75, 1.0]), 2)) for i in range(40)]
        aspiration = [{**item, "match_type": "Aspiration", "match_category": "Aspiration"} for item in items]
        # The pandas sort matching_service used before feedback ranking existed.
        ranking = ["match_score", "semantic_score_raw", "skill_coverage", "preference_alignment", "learning_readiness", "job_id"]
        order = [False, False, False, False, False, True]
        old_fit = pd.DataFrame(items).sort_values(ranking, ascending=order, kind="stable")["job_id"].tolist()
        old_asp = pd.DataFrame(aspiration).sort_values(["preference_alignment", *ranking], ascending=[False, *order],
            kind="stable")["job_id"].tolist()
        self.assertEqual([m["job_id"] for m in rm.rank_category(items, "Fit-Now")], old_fit)
        self.assertEqual([m["job_id"] for m in rm.rank_category(aspiration, "Aspiration")], old_asp)
        ranked = rm.rank_category(items, "Fit-Now")
        self.assertTrue(all(m["ranking_adjustment"] == 0 and m["ranker_version"] == rm.BASELINE_VERSION for m in ranked))
        self.assertEqual([m["rank_position"] for m in ranked], list(range(1, 41)))

    def test_aspiration_lists_relevant_jobs_first_then_by_preference(self):
        # Audit AI-02: a 5% job that fits every Step 3 answer must not lead a
        # 64% job that misses one.
        items = [
            match("tiny-aligned", "Aspiration", 0.05, 1.0),
            match("low-aligned", "Aspiration", 0.16, 1.0),
            match("strong-misaligned", "Aspiration", 0.64, 0.3125),
            match("fair-aligned", "Aspiration", 0.34, 0.75),
            match("fair-misaligned", "Aspiration", 0.48, 0.5625),
        ]
        ranked = [m["job_id"] for m in rm.rank_category(items, "Aspiration")]
        self.assertEqual(ranked, ["fair-aligned", "fair-misaligned", "strong-misaligned", "low-aligned", "tiny-aligned"])
        # Scores and list membership are untouched.
        self.assertEqual({m["job_id"]: m["match_percentage"] for m in rm.rank_category(items, "Aspiration")},
                         {m["job_id"]: m["match_percentage"] for m in items})

    def test_the_relevance_floor_is_configurable_and_does_not_touch_fit_now(self):
        items = [match("low", "Aspiration", 0.16, 1.0), match("high", "Aspiration", 0.64, 0.3)]
        with patch.dict(os.environ, {"KAREERLY_ASPIRATION_RELEVANT_MIN_SCORE": "0"}):
            self.assertEqual([m["job_id"] for m in rm.rank_category(items, "Aspiration")], ["low", "high"])
        fit_now = [match("a", "Fit-Now", 0.25, 1.0), match("b", "Fit-Now", 0.20, 0.0)]
        self.assertEqual([m["job_id"] for m in rm.rank_category(fit_now, "Fit-Now")], ["a", "b"])

    def test_learned_adjustment_cannot_lift_an_aspiration_job_over_the_floor(self):
        items = [match("relevant", "Aspiration", 0.31, 0.0), match("weak", "Aspiration", 0.29, 1.0)]
        ranked = rm.rank_category(items, "Aspiration", rm.Ranker("rank-test", strong_params()))
        self.assertEqual([m["job_id"] for m in ranked], ["relevant", "weak"])

    def test_learned_adjustment_is_bounded_and_keeps_scores(self):
        items = [match("A", "Fit-Now", 0.80, 0.0), match("B", "Fit-Now", 0.78, 1.0), match("C", "Fit-Now", 0.40, 1.0)]
        ranked = rm.rank_category(items, "Fit-Now", rm.Ranker("rank-test", strong_params()))
        # B overtakes A (0.02 apart) but C, 0.40 behind, cannot jump the list.
        self.assertEqual([m["job_id"] for m in ranked], ["B", "A", "C"])
        self.assertTrue(all(abs(m["ranking_adjustment"]) <= 0.1 for m in ranked))
        self.assertEqual({m["job_id"]: m["match_percentage"] for m in ranked}, {"A": 80.0, "B": 78.0, "C": 40.0})
        self.assertTrue(all(m["ranker_version"] == "rank-test" for m in ranked))

    def test_tampered_params_are_clamped_and_invalid_params_rejected(self):
        raw = strong_params().as_dict() | {"max_adjustment": 5.0, "adjustment_scale": 9.0}
        params = rm.RankerParams.from_dict(raw)
        self.assertEqual(params.max_adjustment, rm.MAX_ADJUSTMENT_LIMIT)
        self.assertEqual(params.adjustment_scale, rm.ADJUSTMENT_SCALE_LIMIT)
        for broken in ({**raw, "features": ["x"]}, {**raw, "coef": [1.0]}, {**raw, "scale": [0.0] * len(rm.FEATURES)},
                {**raw, "intercept": float("nan")}, None):
            with self.assertRaises(ValueError):
                rm.RankerParams.from_dict(broken)

    def test_ranker_failure_falls_back_to_baseline_order(self):
        items = [match("A", "Fit-Now", 0.8, 0.0), match("B", "Fit-Now", 0.78, 1.0)]
        with patch.object(rm.RankerParams, "adjustment", side_effect=RuntimeError("boom")):
            ranked = rm.rank_category(items, "Fit-Now", rm.Ranker("rank-test", strong_params()))
        self.assertEqual([m["job_id"] for m in ranked], ["A", "B"])
        self.assertTrue(all(m["ranker_version"] == rm.BASELINE_VERSION for m in ranked))


class ActiveRankerLoadingTests(unittest.TestCase):
    def setUp(self):
        rm.clear_ranker_cache()
        self.addCleanup(rm.clear_ranker_cache)
        env = patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_ANON_KEY": "anon"})
        env.start()
        self.addCleanup(env.stop)

    def load_with(self, rows=None, error=None):
        with patch.object(rm.SupabaseRest, "select", side_effect=error, return_value=rows):
            return rm.load_active_ranker_uncached()

    def test_valid_active_model_is_used(self):
        ranker = self.load_with([{"version": "rank-1", "model_type": rm.MODEL_TYPE, "params": strong_params().as_dict()}])
        self.assertEqual(ranker.version, "rank-1")
        self.assertFalse(ranker.is_baseline)

    def test_every_failure_mode_is_the_baseline(self):
        cases = {
            "no_active_model": dict(rows=[]),
            "model_fetch_failed": dict(error=SupabaseError("down")),
            "invalid_model_params": dict(rows=[{"version": "rank-x", "model_type": rm.MODEL_TYPE, "params": {"features": []}}]),
            "unsupported_model_type": dict(rows=[{"version": "rank-x", "model_type": "other", "params": {}}]),
        }
        for reason, kwargs in cases.items():
            with self.subTest(reason):
                ranker = self.load_with(**kwargs)
                self.assertTrue(ranker.is_baseline)
                self.assertEqual(ranker.fallback_reason, reason)

    def test_the_service_key_is_used_when_the_backend_has_one(self):
        # anon cannot read ranking_models (migration 20261028090000).
        seen = []
        original_init = rm.SupabaseRest.__init__

        def remember(client, url, key, timeout=15.0):
            seen.append(key)
            original_init(client, url, key, timeout)

        row = [{"version": "rank-1", "model_type": rm.MODEL_TYPE, "params": strong_params().as_dict()}]
        with patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": "service"}), \
             patch.object(rm.SupabaseRest, "__init__", remember):
            self.assertEqual(self.load_with(row).version, "rank-1")
        self.assertEqual(seen, ["service"])
        seen.clear()
        with patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": ""}), \
             patch.object(rm.SupabaseRest, "__init__", remember):
            self.load_with(row)
        self.assertEqual(seen, ["anon"])

    def test_health_status_reads_only_the_cache(self):
        self.assertEqual(rm.cached_ranker_status(), {"loaded": False, "version": None, "fallback_reason": None})
        with patch.object(rm, "load_active_ranker_uncached", return_value=rm.Ranker(rm.BASELINE_VERSION, None, "no_active_model")):
            rm.active_ranker()
        with patch.object(rm, "load_active_ranker_uncached", side_effect=AssertionError("must not load")):
            status = rm.cached_ranker_status()
        self.assertEqual(status, {"loaded": True, "version": rm.BASELINE_VERSION, "fallback_reason": "no_active_model"})

    def test_kill_switch_and_unconfigured_supabase(self):
        with patch.dict(os.environ, {"KAREERLY_RANKER": "baseline"}):
            self.assertEqual(rm.load_active_ranker_uncached().fallback_reason, "forced_baseline")
        with patch.dict(os.environ, {"SUPABASE_URL": "", "VITE_SUPABASE_URL": ""}):
            self.assertEqual(rm.load_active_ranker_uncached().fallback_reason, "supabase_not_configured")


class MatchingIntegrationTests(unittest.TestCase):
    """The ranker changes order inside lists only; categories and percentages stay."""

    def setUp(self):
        matching.clear_reference_jobs_cache()
        self.addCleanup(matching.clear_reference_jobs_cache)
        jobs = []
        for i in range(8):
            jobs.append(dict(job_id=f"J{i}", category_id="K01", job_category="Technology", job_title=f"Developer {i}",
                job_description="Build Python backend applications and SQL database queries for reports.",
                required_skills_comma_separated="Python Programming; SQL", mapped_required_skill_names="Python Programming; SQL",
                required_skill_ids="SK001;SK004" if i % 2 == 0 else "SK001;SK004;SK006", must_have_skill_ids="",
                experience_level_required="Entry level" if i % 3 else "Senior", location="Philippines",
                work_type="Remote" if i % 2 else "Onsite", salary_range_monthly_php="", job_text_for_matching=""))
        self.jobs = pd.DataFrame(jobs)

    def run_match(self, ranker):
        with patch.object(matching, "load_internal_jobs_dataframe", return_value=self.jobs), \
             patch.object(matching, "score_jobs", return_value=np.linspace(0.75, 0.35, len(self.jobs))), \
             patch.object(matching, "reviewed_learning_skill_ids", return_value=set()), \
             patch.object(matching, "recommend_learning_resources_for_matches", return_value=[]), \
             patch.object(matching, "active_ranker", return_value=ranker):
            return matching.match_text_to_jobs("Python developer who writes SQL queries.",
                confirmed_skills=[{"skill_id": "SK001"}, {"skill_id": "SK004"}],
                preferences={"work_setup": "Remote", "role_level": "Entry level"})

    def test_categories_and_percentages_unchanged_with_active_model(self):
        baseline = self.run_match(rm.BASELINE)
        learned = self.run_match(rm.Ranker("rank-test", strong_params(max_adjustment=0.15)))
        for key in ("all_fit_now_matches", "all_aspiration_matches"):
            before = {m["job_id"]: m["match_percentage"] for m in baseline[key]}
            after = {m["job_id"]: m["match_percentage"] for m in learned[key]}
            self.assertEqual(before, after)
        self.assertNotEqual([m["job_id"] for m in baseline["all_fit_now_matches"]],
            [m["job_id"] for m in learned["all_fit_now_matches"]])
        self.assertEqual(baseline["metadata"]["ranker_version"], rm.BASELINE_VERSION)
        self.assertEqual(baseline["metadata"]["ranking_signal"], "composite_match_score")
        self.assertEqual(learned["metadata"]["ranker_version"], "rank-test")
        self.assertIn("not hiring probability", learned["metadata"]["score_interpretation"])
        self.assertTrue(all("rank_position" in m for m in learned["all_fit_now_matches"]))


class TrainingDecisionTests(unittest.TestCase):
    def test_insufficient_data_changes_nothing(self):
        decision = decide(vote_rows(n_users=5))
        self.assertEqual(decision.outcome, "insufficient_data")
        self.assertIsNone(decision.candidate)
        self.assertIn("accounts", decision.reason)

    def test_consistent_feedback_is_promoted_after_beating_baseline(self):
        for seed in (1, 2, 3):
            decision = decide(vote_rows(seed=seed))
            self.assertEqual(decision.outcome, "promoted", decision.metrics.get("evaluation"))
            evaluation = decision.metrics["evaluation"]
            self.assertGreater(evaluation["candidate_auc"], evaluation["baseline_auc"])
            self.assertGreater(evaluation["candidate_vs_baseline"]["p10"], 0)

    def test_random_feedback_is_not_promoted(self):
        for seed in (1, 2, 3):
            self.assertEqual(decide(vote_rows(signal=False, seed=seed)).outcome, "kept_current")

    def test_one_more_vote_does_not_cross_into_a_model(self):
        rows = vote_rows(n_users=9)
        extra = dict(rows[0], user_id="u-new", job_id="j-new")
        self.assertEqual(decide(rows).outcome, "insufficient_data")
        self.assertEqual(decide(rows + [extra]).outcome, "insufficient_data")

    def test_single_account_cannot_steer_the_model(self):
        # Honest votes carry no signal; one account casts 600 votes that reward low
        # preference alignment, alternating votes to dodge the uniform-voter rule.
        honest = vote_rows(n_users=15, per_user=10, signal=False, seed=4)
        rng = random.Random(9)
        attack = []
        for k in range(600):
            alignment = rng.uniform(0, 1)
            attack.append(dict(honest[0], user_id="attacker", job_id=f"a{k}", preference_alignment=alignment,
                vote=1 if alignment < 0.5 else -1, updated_at=(NOW - timedelta(days=2, minutes=k)).isoformat()))
        data = rt.prepare_examples(honest + attack, None, NOW, CONFIG)
        attacker_weight = sum(e.weight for e in data.examples if e.user_id == "attacker")
        self.assertLessEqual(attacker_weight, CONFIG.user_vote_cap + 1e-9)
        self.assertNotEqual(rt.decide(data, None, NOW, CONFIG).outcome, "promoted")

    def test_filters_unsettled_uniform_and_non_candidate_votes(self):
        rows = vote_rows(n_users=3, per_user=20)
        rows[0]["updated_at"] = (NOW - timedelta(minutes=5)).isoformat()
        for row in rows:
            if row["user_id"] == "u1":
                row["vote"] = 1
        data = rt.prepare_examples(rows + [dict(rows[1], vote=7)], {"u0", "u1"}, NOW, CONFIG)
        dropped = data.summary["dropped"]
        self.assertEqual(dropped["not_settled"], 1)
        self.assertEqual(dropped["uniform_voter"], 20)
        self.assertEqual(dropped["not_candidate_account"], 20)
        self.assertEqual(dropped["invalid"], 1)
        self.assertEqual({e.user_id for e in data.examples}, {"u0"})

    def test_current_model_worse_than_baseline_is_retired(self):
        inverted = strong_params(sign=-1.0)
        promoted = decide(vote_rows(seed=2), current=inverted)
        self.assertEqual(promoted.outcome, "promoted")
        self.assertTrue(promoted.demote_current)
        strict = rt.TrainingConfig(min_auc_gain=0.5)
        demoted = decide(vote_rows(seed=2), current=inverted, config=strict)
        self.assertEqual(demoted.outcome, "rolled_back")
        self.assertTrue(demoted.demote_current)


class TrainingPersistenceTests(unittest.TestCase):
    def client(self, rows):
        profiles = [{"id": f"u{i}", "role": "candidate"} for i in range(40)]
        return FakeSupabase({"match_feedback": rows, "profiles": profiles, "ranking_models": [], "ranking_training_runs": []})

    def test_promotion_is_versioned_logged_and_reversible(self):
        client = self.client(vote_rows(seed=1))
        report = rt.run_training(client, now=NOW, trigger="test")
        self.assertEqual(report["outcome"], "promoted")
        active = [row for row in client.rows("ranking_models") if row["status"] == "active"]
        self.assertEqual([row["version"] for row in active], [report["candidate_version"]])
        self.assertIn("baseline_auc", active[0]["metrics"])
        self.assertEqual(client.rows("ranking_training_runs")[-1]["outcome"], "promoted")
        version = report["candidate_version"]

        self.assertEqual(rt.rollback(client, actor="test")["active_version"], rm.BASELINE_VERSION)
        self.assertFalse([row for row in client.rows("ranking_models") if row["status"] == "active"])
        self.assertEqual(rt.rollback(client, target_version=version)["active_version"], version)
        self.assertEqual([row["version"] for row in client.rows("ranking_models") if row["status"] == "active"], [version])
        with self.assertRaises(ValueError):
            rt.rollback(client, target_version="rank-missing")

    def test_dry_run_and_insufficient_data_write_no_model(self):
        client = self.client(vote_rows(seed=1))
        self.assertEqual(rt.run_training(client, now=NOW, dry_run=True)["outcome"], "promoted")
        self.assertEqual(client.rows("ranking_models"), [])
        self.assertEqual(client.rows("ranking_training_runs"), [])
        small = self.client(vote_rows(n_users=4))
        self.assertEqual(rt.run_training(small, now=NOW)["outcome"], "insufficient_data")
        self.assertEqual(small.rows("ranking_models"), [])
        self.assertEqual(small.rows("ranking_training_runs")[-1]["outcome"], "insufficient_data")

    def test_failed_run_keeps_the_active_model(self):
        client = self.client([])
        client.rows("ranking_models").append({"version": "rank-live", "status": "active", "params": strong_params().as_dict()})
        with patch.object(rt, "load_feedback", side_effect=SupabaseError("timeout")):
            report = rt.run_training(client, now=NOW)
        self.assertEqual(report["outcome"], "failed")
        self.assertEqual([r["status"] for r in client.rows("ranking_models")], ["active"])
        self.assertEqual(client.rows("ranking_training_runs")[-1]["outcome"], "failed")


if __name__ == "__main__":
    unittest.main()
