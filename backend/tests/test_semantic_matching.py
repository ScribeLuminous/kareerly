from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from app.services import matching_service
from app.services import semantic_matching


class _FakeBiEncoder:
    def encode(self, texts, **_kwargs):
        rows = []
        for text in texts:
            lowered = str(text).lower()
            rows.append([1.0, 0.0] if "python" in lowered else [0.0, 1.0])
        return np.asarray(rows, dtype=float)


class _ReverseReranker:
    def predict(self, pairs, **_kwargs):
        return np.arange(len(pairs), dtype=float)


def _jobs() -> pd.DataFrame:
    return pd.DataFrame([
        {
            "job_id": "J1",
            "job_title": "Python Developer",
            "job_category": "Technology",
            "job_subcategory": "Software",
            "job_description": "Develop Python applications and APIs.",
            "mapped_required_skill_names": "Python Programming",
            "required_skill_ids": "SK001",
            "must_have_skill_ids": "SK001",
            "mapped_nice_to_have_skill_names": "SQL",
            "nice_to_have_skill_ids": "SK004",
        },
        {
            "job_id": "J2",
            "job_title": "Copywriter",
            "job_category": "Creative",
            "job_subcategory": "Writing",
            "job_description": "Write marketing and editorial copy.",
            "mapped_required_skill_names": "Content Writing",
            "required_skill_ids": "SK034",
            "must_have_skill_ids": "SK034",
            "mapped_nice_to_have_skill_names": "",
            "nice_to_have_skill_ids": "",
        },
    ])


class SemanticMatchingTests(unittest.TestCase):
    def setUp(self):
        semantic_matching._JOB_EMBEDDING_CACHE.clear()

    def test_job_representation_contains_taxonomy_fields(self):
        text = semantic_matching.build_job_semantic_text(_jobs().iloc[0].to_dict())
        self.assertIn("[ESSENTIAL SKILLS] Python Programming", text)
        self.assertIn("[ESSENTIAL SKILL IDS] SK001", text)

    @patch.object(semantic_matching, "_load_retriever", return_value=_FakeBiEncoder())
    def test_trained_bi_encoder_is_the_retrieval_stage(self, _mock_model):
        ranked, state = semantic_matching.retrieve_jobs("Python API developer", _jobs())
        self.assertEqual("J1", ranked.iloc[0]["job_id"])
        self.assertEqual(
            "trained_semantic_bi_encoder_taxonomy_enriched_inputs",
            state["retrieval_method"],
        )
        self.assertFalse(state["retrieval_fallback"])

    @patch.object(semantic_matching, "_load_reranker", return_value=_ReverseReranker())
    def test_cross_encoder_only_reorders_retrieved_top_k(self, _mock_model):
        retrieved = _jobs().copy()
        retrieved["semantic_document"] = ["first", "second"]
        retrieved["retrieval_rank"] = [1, 2]
        reranked, state = semantic_matching.rerank_jobs(
            "candidate", retrieved, enabled=True, top_k=2
        )
        self.assertEqual("J2", reranked.iloc[0]["job_id"])
        self.assertEqual("trained_kareerly_cross_encoder_top_k", state["reranking_method"])

    def test_canonical_skill_ids_drive_coverage(self):
        coverage = matching_service.compute_taxonomy_skill_coverage(
            [{"skill_id": "SK001", "skill_name": "Python Programming"}],
            {
                "required_skill_ids": "SK001;SK004",
                "must_have_skill_ids": "SK001;SK004",
                "nice_to_have_skill_ids": "SK006",
                "category_id": "K01",
            },
        )
        self.assertEqual(0.5, coverage["skill_coverage"])
        self.assertEqual(["SK001"], coverage["matched_skill_ids"])
        self.assertEqual(["SK004"], coverage["missing_skill_ids"])
        self.assertEqual("canonical_taxonomy_skill_ids", coverage["coverage_method"])

    def test_match_tiers_allow_no_result(self):
        self.assertEqual(
            "Fit-Now",
            matching_service.classify_semantic_match(0.6, 0.75, 1.0, 3),
        )
        self.assertEqual(
            "Aspiration",
            matching_service.classify_semantic_match(0.4, 0.25, 0.0, 1),
        )
        self.assertIsNone(
            matching_service.classify_semantic_match(0.2, 0.0, 0.0, 0)
        )


if __name__ == "__main__":
    unittest.main()
