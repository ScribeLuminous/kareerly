from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
import pandas as pd
from docx import Document
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


def _saved_analysis():
    return {
        "job": {"title": "Backend Engineer", "company_name": "Acme", "source": "external_paste"},
        "extracted_requirements": {"summary": "Build backend services", "required_skills": ["Python"]},
        "match": {
            "match_percentage": 82,
            "semantic_similarity": 0.82,
            "skill_coverage": 0.8,
            "match_type": "Fit Now",
            "explanation": "Strong backend match.",
            "matched_skills": ["Python"],
            "missing_skills": ["Kubernetes"],
            "matched_skill_ids": ["sk001"],
            "missing_skill_ids": ["sk002"],
            "preference_alignment": 0.7,
        },
        "matched_skills": ["Python"],
        "missing_skills": ["Kubernetes"],
        "preference_alignment": 0.7,
        "learning_recommendations": [],
        "warnings": [],
        "metadata": {"extraction_source": "gemma", "explanation_source": "gemma", "matching_source": "shared"},
    }


def test_saved_external_job_requires_authentication(monkeypatch):
    monkeypatch.setattr("app.main._get_authenticated_user_id", lambda _authorization: None)
    response = TestClient(app).get("/api/candidate/external-jobs/saved")
    assert response.status_code == 401


def test_saved_external_job_crud_and_result_is_compacted(monkeypatch):
    monkeypatch.setattr("app.main._get_authenticated_user_id", lambda _authorization: "candidate-1")
    stored = {
        "id": "saved-1",
        "job_title": "Backend Engineer",
        "company_name": "Acme",
        "match_percentage": 82,
        "result_json": {"job": {"title": "Backend Engineer", "company_name": "Acme"}},
        "created_at": "2026-09-22T12:00:00Z",
    }
    calls = []

    def fake_supabase(path, **kwargs):
        calls.append((path, kwargs))
        if "analysis_fingerprint" in path:
            return []
        if kwargs.get("method") == "POST":
            assert "job_description" not in kwargs["body"]["result_json"]
            assert len(kwargs["body"]["analysis_fingerprint"]) == 64
            return [stored]
        if kwargs.get("method") == "DELETE":
            return [{"id": "saved-1"}]
        if "select=id%2Cjob_title" in path:
            return [stored]
        return []

    monkeypatch.setattr("app.main._supabase_request", fake_supabase)
    client = TestClient(app)
    saved = client.post("/api/candidate/external-jobs/saved", json={"analysis": _saved_analysis()})
    assert saved.status_code == 200
    assert saved.json()["id"] == "saved-1"

    listed = client.get("/api/candidate/external-jobs/saved")
    assert listed.status_code == 200
    assert listed.json()[0]["job_title"] == "Backend Engineer"

    deleted = client.delete("/api/candidate/external-jobs/saved/saved-1")
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True, "id": "saved-1"}
    assert len(calls) == 5


def test_saved_external_job_enforces_five_result_limit(monkeypatch):
    monkeypatch.setattr("app.main._get_authenticated_user_id", lambda _authorization: "candidate-1")
    monkeypatch.setattr(
        "app.main._supabase_request",
        lambda path, **_kwargs: [] if "analysis_fingerprint" in path else [{"id": str(index)} for index in range(5)],
    )
    response = TestClient(app).post("/api/candidate/external-jobs/saved", json={"analysis": _saved_analysis()})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "EXTERNAL_JOB_MATCH_LIMIT_REACHED"


def test_saved_external_job_is_idempotent(monkeypatch):
    monkeypatch.setattr("app.main._get_authenticated_user_id", lambda _authorization: "candidate-1")
    stored = {
        "id": "saved-existing",
        "job_title": "Backend Engineer",
        "company_name": "Acme",
        "match_percentage": 82,
        "result_json": _saved_analysis(),
        "created_at": "2026-09-22T12:00:00Z",
    }
    calls = []

    def fake_supabase(path, **kwargs):
        calls.append((path, kwargs))
        assert kwargs.get("method", "GET") == "GET"
        assert "user_id=eq.candidate-1" in path
        assert "analysis_fingerprint=eq." in path
        return [stored]

    monkeypatch.setattr("app.main._supabase_request", fake_supabase)
    response = TestClient(app).post("/api/candidate/external-jobs/saved", json={"analysis": _saved_analysis()})
    assert response.status_code == 200
    assert response.json()["id"] == "saved-existing"
    assert len(calls) == 1


def test_external_job_report_is_real_docx(monkeypatch):
    monkeypatch.setattr("app.main._get_authenticated_user_id", lambda _authorization: "candidate-1")
    response = TestClient(app).post(
        "/api/candidate/external-jobs/report",
        headers={"Authorization": "Bearer test-token"},
        json={"analysis": _saved_analysis()},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert response.headers["content-disposition"].endswith('.docx"')
    assert response.content.startswith(b"PK")
    document = Document(BytesIO(response.content))
    report_text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "External Job Match Report" in report_text
    assert "82%" in report_text
    assert "Strong backend match." in report_text
    assert "Python" in report_text
    assert "Kubernetes" in report_text
    assert "Applications to external jobs are not tracked by Kareerly." in report_text


def test_candidate_notifications_are_scoped_and_read_durably(monkeypatch):
    monkeypatch.setattr("app.main._get_authenticated_user_id", lambda _authorization: "candidate-a")
    calls = []

    def fake_supabase(path, **kwargs):
        calls.append((path, kwargs))
        assert "recipient_user_id=eq.candidate-a" in path
        if kwargs.get("method") == "PATCH":
            assert kwargs["body"]["read_at"]
            return [{"id": "notice-1", "read_at": kwargs["body"]["read_at"]}]
        return [{
            "id": "notice-1",
            "event_type": "application_status",
            "application_id": "application-1",
            "title": "Application shortlisted",
            "message": "Backend Engineer at Acme was shortlisted.",
            "created_at": "2026-09-23T12:00:00Z",
            "read_at": None,
        }]

    monkeypatch.setattr("app.main._supabase_request", fake_supabase)
    client = TestClient(app)
    listed = client.get("/api/candidate/notifications")
    assert listed.status_code == 200
    assert listed.json()[0]["read_at"] is None

    marked = client.patch("/api/candidate/notifications/notice-1/read")
    assert marked.status_code == 200
    assert marked.json()["read_at"]

    all_read = client.patch("/api/candidate/notifications/read-all")
    assert all_read.status_code == 200
    assert all_read.json()["updated"] == 1
    assert len(calls) == 3


def test_saved_external_jobs_are_isolated_between_candidate_accounts(monkeypatch):
    active_user = {"id": "candidate-a"}
    monkeypatch.setattr("app.main._get_authenticated_user_id", lambda _authorization: active_user["id"])

    def fake_supabase(path, **_kwargs):
        if "user_id=eq.candidate-a" in path:
            return [{
                "id": "match-a",
                "job_title": "Candidate A Role",
                "company_name": "A Company",
                "match_percentage": 70,
                "result_json": _saved_analysis(),
                "created_at": "2026-09-23T10:00:00Z",
            }]
        if "user_id=eq.candidate-b" in path:
            return [{
                "id": "match-b",
                "job_title": "Candidate B Role",
                "company_name": "B Company",
                "match_percentage": 65,
                "result_json": _saved_analysis(),
                "created_at": "2026-09-23T11:00:00Z",
            }]
        raise AssertionError(f"Unscoped saved-analysis query: {path}")

    monkeypatch.setattr("app.main._supabase_request", fake_supabase)
    client = TestClient(app)
    candidate_a = client.get("/api/candidate/external-jobs/saved").json()
    active_user["id"] = "candidate-b"
    candidate_b = client.get("/api/candidate/external-jobs/saved").json()

    assert [row["id"] for row in candidate_a] == ["match-a"]
    assert [row["id"] for row in candidate_b] == ["match-b"]
    assert candidate_a[0]["id"] != candidate_b[0]["id"]


def test_notification_migration_has_rls_and_idempotent_event_identity():
    migration = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20260923100000_external_match_dedup_and_notifications.sql"
    sql = migration.read_text(encoding="utf-8").lower()
    assert "alter table public.candidate_notifications enable row level security" in sql
    assert "auth.uid() = recipient_user_id" in sql
    assert "unique(recipient_user_id, event_type, application_id, event_version)" in sql
    assert "on conflict (recipient_user_id, event_type, application_id, event_version) do nothing" in sql


def test_rejected_token_is_unauthenticated_but_config_errors_surface(monkeypatch):
    from app.main import _get_authenticated_user_id

    def rejected(*_args, **_kwargs):
        raise HTTPException(status_code=401, detail="invalid JWT")

    monkeypatch.setattr("app.main._supabase_request", rejected)
    assert _get_authenticated_user_id("Bearer expired") is None

    def unconfigured(*_args, **_kwargs):
        raise HTTPException(status_code=503, detail="Supabase is not configured for account services.")

    monkeypatch.setattr("app.main._supabase_request", unconfigured)
    with pytest.raises(HTTPException) as exc_info:
        _get_authenticated_user_id("Bearer token")
    assert exc_info.value.status_code == 503
