from __future__ import annotations

import pandas as pd
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.services import matching_service
from app.services.external_job_analysis import analyze_external_job, normalize_external_job_text


class _UnavailableGemma:
    def extract_external_job(self, *_args, **_kwargs):
        from app.services.gemma_service import GemmaUnavailable

        raise GemmaUnavailable("test")

    def explain_match(self, *_args, **_kwargs):
        from app.services.gemma_service import GemmaUnavailable

        raise GemmaUnavailable("test")


def test_external_job_text_is_normalized_without_executing_markup():
    assert normalize_external_job_text("  <script>alert(1)</script>\n Python  ") == "<script>alert(1)</script> Python"


def test_external_job_falls_back_safely_when_gemma_is_unavailable(monkeypatch):
    monkeypatch.setattr("app.services.external_job_analysis.gemma_service", _UnavailableGemma())
    monkeypatch.setattr(
        "app.services.external_job_analysis.analyze_candidate_job_match",
        lambda *args, **kwargs: {
            "match": {
                "match_percentage": 70,
                "semantic_similarity": 0.7,
                "skill_coverage": 0.5,
                "match_type": "Aspiration",
                "preference_alignment": 0,
                "matched_skills": ["Python"],
                "missing_skills": ["SQL"],
                "matched_skill_ids": [],
                "missing_skill_ids": [],
            },
            "learning_recommendations": [],
            "metadata": {"model_version": "test"},
        },
    )
    result = analyze_external_job(
        job_description="Build Python services and work with SQL data pipelines for our product team.",
        resume_text="Professional experience with Python and backend development.",
    )
    assert result["metadata"]["extraction_source"] == "deterministic_fallback"
    assert result["metadata"]["explanation_source"] == "deterministic_fallback"
    assert result["match"]["explanation"].startswith("Your profile matches")


def test_internal_and_external_paths_share_the_same_match_calculation(monkeypatch):
    labels, _ = matching_service.canonical_skill_lookup()
    skill_id, skill_name = next(iter(labels.items()))
    job = {
        "job_id": "internal-1",
        "job_title": "Test role",
        "company_name": "Test company",
        "job_source": "internal",
        "job_description": f"Work with {skill_name} on product delivery.",
        "required_skill_ids": skill_id,
        "must_have_skill_ids": skill_id,
        "required_skills_for_eval": skill_name,
        "source_dataset": "test",
    }

    def fake_bi_encoder(_candidate_input, jobs_df):
        scored = jobs_df.copy()
        scored["semantic_score"] = 0.8
        scored["semantic_score_raw"] = 0.8
        scored["semantic_scoring_method"] = "test-cosine"
        return scored

    monkeypatch.setattr(matching_service, "bi_encoder_score_jobs", fake_bi_encoder)
    monkeypatch.setattr(matching_service, "reviewed_learning_skill_ids", lambda: set())
    monkeypatch.setattr(matching_service, "recommend_learning_resources", lambda **_kwargs: [])
    monkeypatch.setattr(matching_service, "load_reference_jobs", lambda: pd.DataFrame([job]))

    candidate = [{"skill_id": skill_id, "skill_name": skill_name}]
    internal = matching_service.match_text_to_jobs(
        f"Professional experience using {skill_name}.",
        confirmed_skills=candidate,
    )["fit_now_matches"][0]
    external = matching_service.analyze_candidate_job_match(
        f"Professional experience using {skill_name}.",
        {**job, "job_source": "external_paste"},
        confirmed_skills=candidate,
    )["match"]

    assert internal["match_percentage"] == external["match_percentage"]
    assert internal["skill_coverage"] == external["skill_coverage"]
    assert internal["matched_skills"] == external["matched_skills"]
    assert internal["missing_skills"] == external["missing_skills"]


def test_external_endpoint_requires_authentication(monkeypatch):
    monkeypatch.setattr("app.main._get_authenticated_user_id", lambda _authorization: None)
    response = TestClient(app).post(
        "/api/candidate/external-jobs/analyze",
        json={"job_description": "A sufficiently long job description that should not be processed without a session."},
    )
    assert response.status_code == 401


def test_external_endpoint_returns_profile_required(monkeypatch):
    monkeypatch.setattr("app.main._get_authenticated_user_id", lambda _authorization: "candidate-1")
    monkeypatch.setattr(
        "app.main._load_external_job_candidate",
        lambda _user_id: (_ for _ in ()).throw(HTTPException(status_code=409, detail={"code": "PROFILE_REQUIRED", "message": "Upload or complete your resume before analyzing an external job."})),
    )
    response = TestClient(app).post(
        "/api/candidate/external-jobs/analyze",
        headers={"Authorization": "Bearer test-token"},
        json={"job_description": "A sufficiently long job description that should require a saved profile."},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PROFILE_REQUIRED"
