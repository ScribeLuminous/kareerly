from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Annotated, Optional
from uuid import uuid4

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .models.schemas import RunMatchesRequest
from .services.job_matcher import list_available_jobs, match_jobs
from .services.matching_service import match_resume_to_jobs
from .services.resume_analyzer import analyze_resume_file
from .services.skill_extractor import SkillExtractor


BACKEND_DIR = Path(__file__).resolve().parent.parent
UPLOADS_DIR = BACKEND_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


app = FastAPI(title="Kareerly ML Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

skill_extractor = SkillExtractor()
MAX_CONFIRMED_SKILLS = 20
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://dgnxigotdpqiwohocloi.supabase.co").rstrip("/")
SUPABASE_ANON_KEY = os.getenv(
    "SUPABASE_ANON_KEY",
    os.getenv("VITE_SUPABASE_ANON_KEY", "sb_publishable_Z77o41ry4seJ7opnojlbaA_aiNUFo6B"),
)
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _supabase_request(
    path: str,
    *,
    method: str = "GET",
    token: str | None = None,
    service_role: bool = False,
    body: object | None = None,
    prefer: str | None = None,
) -> object:
    api_key = SUPABASE_SERVICE_ROLE_KEY if service_role else SUPABASE_ANON_KEY
    bearer = SUPABASE_SERVICE_ROLE_KEY if service_role else token
    if not api_key:
        raise HTTPException(status_code=503, detail="Supabase API key is not configured.")
    if service_role and not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="SUPABASE_SERVICE_ROLE_KEY is required for admin endpoints.")

    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {bearer or api_key}",
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer

    request = urllib.request.Request(
        f"{SUPABASE_URL}{path}",
        method=method,
        headers=headers,
        data=data,
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore") or exc.reason
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=503, detail=f"Unable to reach Supabase: {exc.reason}") from exc

    return json.loads(raw) if raw else None


def _require_admin_user(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Admin session token is required.")

    access_token = authorization.split(" ", 1)[1].strip()
    auth_user = _supabase_request("/auth/v1/user", token=access_token)
    if not isinstance(auth_user, dict) or not auth_user.get("id"):
        raise HTTPException(status_code=401, detail="Invalid admin session token.")

    user_id = str(auth_user["id"])
    query = urllib.parse.urlencode({"id": f"eq.{user_id}", "select": "id,role,email"})
    profiles = _supabase_request(f"/rest/v1/profiles?{query}", service_role=True)
    profile = profiles[0] if isinstance(profiles, list) and profiles else None
    if not isinstance(profile, dict) or profile.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role is required.")

    return user_id


def _get_authenticated_user_id(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None

    access_token = authorization.split(" ", 1)[1].strip()
    if not access_token:
        return None

    try:
        auth_user = _supabase_request("/auth/v1/user", token=access_token)
    except HTTPException:
        return None

    if not isinstance(auth_user, dict) or not auth_user.get("id"):
        return None

    return str(auth_user["id"])


def _safe_timestamp() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _sync_match_results_to_supabase(
    *,
    authorization: str | None,
    result: dict,
    filename: str,
    preferences: dict,
) -> None:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        return

    access_token = authorization.split(" ", 1)[1].strip()
    now = _safe_timestamp()
    parsed_text = str(result.get("resume_text_for_matching") or result.get("resume_text_preview") or "")
    confirmed_skill_records = result.get("confirmed_skill_records") or result.get("extracted_skills") or []
    skill_gaps = result.get("skill_gaps") or result.get("prioritized_skill_gaps") or []

    candidate_profile_payload = {
        "user_id": user_id,
        "preferred_industry": str(preferences.get("industry") or "") or None,
        "preferred_work_setup": str(preferences.get("work_setup") or "") or None,
        "expected_salary": str(preferences.get("salary_expectation") or preferences.get("salary") or "") or None,
        "target_role": str(preferences.get("target_role") or preferences.get("role") or preferences.get("role_level") or "") or None,
        "skill_to_develop": str(preferences.get("skill_to_develop") or "") or None,
        "updated_at": now,
    }
    _supabase_request(
        "/rest/v1/candidate_profiles?on_conflict=user_id",
        method="POST",
        token=access_token,
        body=candidate_profile_payload,
        prefer="resolution=merge-duplicates",
    )

    resume_rows = _supabase_request(
        "/rest/v1/resumes?select=id",
        method="POST",
        token=access_token,
        body={
            "user_id": user_id,
            "original_filename": filename,
            "parsed_text": parsed_text,
            "extracted_profile_json": result,
        },
        prefer="return=representation",
    )
    resume_id = ""
    if isinstance(resume_rows, list) and resume_rows and isinstance(resume_rows[0], dict):
        resume_id = str(resume_rows[0].get("id") or "")

    _supabase_request(
        f"/rest/v1/user_skills?{urllib.parse.urlencode({'user_id': f'eq.{user_id}', 'source': 'eq.resume_match_upload'})}",
        method="DELETE",
        token=access_token,
    )
    skill_rows: list[dict] = []
    for item in confirmed_skill_records if isinstance(confirmed_skill_records, list) else []:
        if not isinstance(item, dict):
            continue
        skill_name = str(item.get("skill_name") or "").strip()
        if not skill_name:
            continue
        skill_rows.append(
            {
                "user_id": user_id,
                "skill_id": str(item.get("skill_id") or "").strip().upper() or None,
                "skill_name": skill_name,
                "confidence": item.get("confidence") or 0,
                "source": "resume_match_upload",
            }
        )
    if skill_rows:
        _supabase_request(
            "/rest/v1/user_skills",
            method="POST",
            token=access_token,
            body=skill_rows,
        )

    if isinstance(skill_gaps, list):
        for gap in skill_gaps[:10]:
            if not isinstance(gap, dict):
                continue
            skill_name = str(gap.get("skill") or gap.get("skill_name") or "").strip()
            if not skill_name:
                continue
            query = urllib.parse.urlencode(
                {
                    "candidate_id": f"eq.{user_id}",
                    "skill_name": f"eq.{skill_name}",
                    "select": "id",
                    "limit": "1",
                }
            )
            existing = _supabase_request(f"/rest/v1/candidate_skill_progress?{query}", token=access_token)
            payload = {
                "candidate_id": user_id,
                "skill_id": str(gap.get("skill_id") or "").strip() or None,
                "skill_name": skill_name,
                "category_id": str(gap.get("category_id") or "").strip() or None,
                "category_name": str(gap.get("category_name") or "").strip() or None,
                "status": "missing",
                "progress_percent": int(float(gap.get("progress_percent") or 0)),
                "selected_resource_id": (
                    str((gap.get("recommended_learning_resources") or [{}])[0].get("resource_id") or "").strip()
                    if isinstance(gap.get("recommended_learning_resources"), list) and gap.get("recommended_learning_resources")
                    else None
                ),
                "updated_at": now,
            }
            if isinstance(existing, list) and existing and isinstance(existing[0], dict) and existing[0].get("id"):
                progress_id = str(existing[0]["id"])
                progress_query = urllib.parse.urlencode({"id": f"eq.{progress_id}"})
                _supabase_request(
                    f"/rest/v1/candidate_skill_progress?{progress_query}",
                    method="PATCH",
                    token=access_token,
                    body=payload,
                )
            else:
                _supabase_request(
                    "/rest/v1/candidate_skill_progress",
                    method="POST",
                    token=access_token,
                    body=payload,
                )

    _supabase_request(
        "/rest/v1/match_history",
        method="POST",
        token=access_token,
        body={
            "user_id": user_id,
            "resume_id": resume_id or None,
            "preferences_json": preferences,
            "results_json": result,
        },
    )


def _admin_select(table: str, select: str = "*", limit: int = 25, order: str | None = "created_at.desc") -> list[dict]:
    params = {"select": select, "limit": str(max(1, min(limit, 100)))}
    if order:
        params["order"] = order
    query = urllib.parse.urlencode(params)
    data = _supabase_request(f"/rest/v1/{table}?{query}", service_role=True)
    return data if isinstance(data, list) else []


def _admin_count(table: str) -> int:
    params = urllib.parse.urlencode({"select": "id", "limit": "10000"})
    data = _supabase_request(f"/rest/v1/{table}?{params}", service_role=True)
    return len(data) if isinstance(data, list) else 0


def _normalize_candidate_skill_ids(raw_skill_ids: list) -> list[str]:
    skill_ids = [
        str(skill_id).strip().upper()
        for skill_id in raw_skill_ids
        if isinstance(skill_id, str) and str(skill_id).strip()
    ]
    skill_ids = list(dict.fromkeys(skill_ids))
    if len(skill_ids) > MAX_CONFIRMED_SKILLS:
        raise HTTPException(
            status_code=400,
            detail=f"Candidate skill list is limited to {MAX_CONFIRMED_SKILLS} skills.",
        )
    return skill_ids


def _normalize_confirmed_skills_payload(payload: list) -> list[dict]:
    normalized: list[dict] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()

    for item in payload:
        if isinstance(item, str):
            skill_name = item.strip()
            if not skill_name:
                continue
            name_key = skill_name.lower()
            if name_key in seen_names:
                continue
            seen_names.add(name_key)
            normalized.append(
                {
                    "skill_id": "",
                    "skill_name": skill_name,
                    "custom_skill_name": "",
                    "source": "confirmed_legacy_name",
                    "is_standardized": False,
                    "source_metadata": {},
                }
            )
            continue

        if not isinstance(item, dict):
            continue

        skill_id = str(item.get("skill_id", "") or "").strip().upper()
        skill_name = str(item.get("skill_name", "") or "").strip()
        custom_skill_name = str(item.get("custom_skill_name", "") or "").strip()
        source = str(item.get("source", "") or "confirmed_skill").strip()
        is_standardized = item.get("is_standardized")
        is_standardized = bool(skill_id) if is_standardized is None else bool(is_standardized)
        if source == "custom" or not is_standardized:
            skill_id = ""
            skill_name = custom_skill_name or skill_name
            custom_skill_name = skill_name
        if not skill_name:
            continue

        if skill_id:
            if skill_id in seen_ids:
                continue
            seen_ids.add(skill_id)
        else:
            name_key = skill_name.lower()
            if name_key in seen_names:
                continue
            seen_names.add(name_key)

        source_metadata = item.get("source_metadata", {})
        normalized.append(
            {
                "skill_id": skill_id,
                "skill_name": skill_name,
                "custom_skill_name": custom_skill_name,
                "source": source,
                "is_standardized": is_standardized,
                "source_metadata": source_metadata if isinstance(source_metadata, dict) else {},
            }
        )

    if len(normalized) > MAX_CONFIRMED_SKILLS:
        raise HTTPException(
            status_code=400,
            detail=f"Confirmed skills are limited to {MAX_CONFIRMED_SKILLS} skills.",
        )

    return normalized


def _apply_report_access_control(
    result: dict,
    user_mode: str,
    view_mode: str,
) -> dict:
    if user_mode == "guest":
        job_limit = 3
        gap_limit = 3
        learning_limit = 3
        access_label = "guest_limited_report"
    elif user_mode in {"registered", "logged_in"} and view_mode == "full":
        job_limit = 10
        gap_limit = 10
        learning_limit = 10
        access_label = "registered_full_dashboard"
    else:
        job_limit = 5
        gap_limit = 5
        learning_limit = 5
        access_label = "registered_initial_report"

    result["access_control"] = {
        "user_mode": user_mode,
        "view_mode": view_mode,
        "access_label": access_label,
        "job_limit_per_match_type": job_limit,
        "skill_gap_limit": gap_limit,
        "learning_recommendation_limit": learning_limit,
        "guest_note": (
            "Guest users receive a limited Top 3 report."
            if user_mode == "guest"
            else ""
        ),
    }

    result["limited_report"] = {
        "fit_now_matches": result.get("fit_now_matches", [])[:job_limit],
        "aspiration_matches": result.get("aspiration_matches", [])[:job_limit],
        "skill_gaps": result.get("skill_gaps", result.get("prioritized_skill_gaps", []))[:gap_limit],
        "learning_recommendations": result.get("learning_recommendations", [])[:learning_limit],
        "development_progress": result.get("development_progress", []),
    }

    return result


def _is_valid_certificate_pdf(filename: str, file_bytes: bytes) -> tuple[bool, str]:
    lower_name = filename.lower().strip()
    if not lower_name.endswith(".pdf"):
        return False, "Only PDF certificate files are accepted."

    if len(file_bytes) > 5 * 1024 * 1024:
        return False, "Certificate file must be 5MB or smaller."

    if not file_bytes.startswith(b"%PDF"):
        return False, "Invalid PDF signature detected."

    decoded = file_bytes.decode("latin1", errors="ignore")
    if "/Type /Page" not in decoded:
        return False, "The uploaded file does not appear to be a valid PDF document."

    has_certificate_keyword = any(
        keyword in lower_name
        for keyword in [
            "certificate",
            "cert",
            "tesda",
            "diploma",
            "credential",
            "license",
            "licence",
            "training",
        ]
    )
    has_document_keyword = any(
        keyword in decoded.lower()
        for keyword in [
            "certificate",
            "certification",
            "tesda",
            "diploma",
            "awarded",
            "issued",
            "completion",
            "credential",
            "license",
            "licence",
        ]
    )
    if not has_certificate_keyword and not has_document_keyword:
        return False, "No certificate markers were detected in filename or document content."

    return True, "Certificate file passed baseline validation checks."


@app.get("/api/skills/search")
def search_skills(q: str = "", limit: int = 20) -> dict:
    query = q.strip().lower()
    safe_limit = max(1, min(limit, 10))
    seen_ids = set()
    scored_results: list[tuple[int, dict[str, str]]] = []

    def match_alias(alias: str) -> int:
        alias_lower = alias.lower().strip()
        if not query:
            return 1
        if alias_lower == query:
            return 100
        if alias_lower.startswith(query):
            return 80
        if re.search(r"(?<![a-z0-9])" + re.escape(query) + r"(?![a-z0-9])", alias_lower):
            return 60
        return 0

    for row in skill_extractor.rows:
        skill_name = row.get("skill_name", "").strip()
        preferred_label = (row.get("esco_preferred_label", "") or skill_name).strip()
        alt_labels = row.get("esco_alternative_labels", "")
        related_skills = row.get("related_skills", "")
        skill_id = row.get("skill_id", "")

        if not skill_id or skill_id in seen_ids:
            continue

        aliases = [
            skill_name,
            preferred_label,
            *[part.strip() for part in str(alt_labels).replace("|", ";").replace(",", ";").split(";") if part.strip()],
            *[part.strip() for part in str(related_skills).replace("|", ";").replace(",", ";").split(";") if part.strip()],
        ]
        matched_alias = ""
        match_score = 0
        if query:
            for alias in aliases:
                score = match_alias(alias)
                if score > match_score:
                    match_score = score
                    matched_alias = alias

        id_match_score = 90 if query and query in skill_id.lower() else 0
        match_score = max(match_score, id_match_score)

        if not query or match_score > 0:
            seen_ids.add(skill_id)
            scored_results.append(
                (
                    match_score,
                    {
                        "skill_id": skill_id,
                        "preferred_label": preferred_label or skill_name,
                        "skill_name": preferred_label or skill_name,
                        "category": row.get("skill_category", ""),
                        "skill_category": row.get("skill_category", ""),
                        "skill_subcategory": row.get("skill_subcategory", ""),
                        "matched_alias": matched_alias if matched_alias and matched_alias != preferred_label else "",
                    },
                )
            )

        if len(scored_results) >= safe_limit * 3:
            break

    results = [item for _, item in sorted(scored_results, key=lambda result: result[0], reverse=True)[:safe_limit]]
    return {"results": results}


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Kareerly backend is running"}


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/admin/overview")
def admin_overview(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_user_id = _require_admin_user(authorization)
    profiles = _admin_select(
        "profiles",
        "id,role,first_name,last_name,email,created_at",
        limit=12,
        order="created_at.desc",
    )
    job_posts = _admin_select(
        "employer_job_posts",
        "id,job_id,job_title,company_name,posting_status,created_at,updated_at",
        limit=12,
        order="updated_at.desc",
    )
    applications = _admin_select(
        "job_applications",
        "id,user_id,job_id,job_title,company_name,status,message_request_state,applied_at,updated_at",
        limit=12,
        order="updated_at.desc",
    )
    messages = _admin_select(
        "application_messages",
        "id,application_id,sender_user_id,sender_role,message_kind,message_text,created_at",
        limit=12,
        order="created_at.desc",
    )
    evidence = _admin_select(
        "candidate_skill_progress",
        "id,candidate_id,skill_name,status,progress_percent,evidence_filename,evidence_uploaded_at,updated_at",
        limit=12,
        order="updated_at.desc",
    )

    role_counts = {"candidate": 0, "employer": 0, "admin": 0}
    for row in _admin_select("profiles", "id,role", limit=100, order=None):
        role = str(row.get("role", ""))
        if role in role_counts:
            role_counts[role] += 1

    return {
        "admin_user_id": admin_user_id,
        "counts": {
            "users": _admin_count("profiles"),
            "candidate_profiles": _admin_count("candidate_profiles"),
            "employer_profiles": _admin_count("employer_profiles"),
            "job_posts": _admin_count("employer_job_posts"),
            "applications": _admin_count("job_applications"),
            "messages": _admin_count("application_messages"),
            "evidence_records": _admin_count("candidate_skill_progress"),
            "roles": role_counts,
        },
        "recent": {
            "profiles": profiles,
            "job_posts": job_posts,
            "applications": applications,
            "messages": messages,
            "evidence": evidence,
        },
    }


@app.get("/api/jobs/list")
def jobs_list(limit: int = 200) -> dict:
    return {"results": list_available_jobs(limit=limit)}


def _split_detail_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not isinstance(value, str):
        return []
    return [item.strip() for item in re.split(r"\r?\n|;|,", value) if item.strip()]


def _format_detail_salary(record: dict) -> str:
    def amount(value: object) -> int:
        raw = str(value or "").replace(",", "").strip()
        if not raw:
            return 0
        try:
            return int(float(raw))
        except ValueError:
            return 0

    min_salary = amount(record.get("salary_min_php"))
    max_salary = amount(record.get("salary_max_php"))
    if min_salary and max_salary:
        return f"₱{min_salary:,} - ₱{max_salary:,}"
    if min_salary:
        return f"₱{min_salary:,}+"
    if max_salary:
        return f"Up to ₱{max_salary:,}"
    return ""


@app.get("/api/jobs/detail")
def job_detail(job_id: str, job_source: str = "internal") -> dict:
    source = "employer" if job_source == "employer" else "internal"
    table = "employer_job_posts" if source == "employer" else "internal_jobs"
    query = urllib.parse.urlencode(
        {
            "job_id": f"eq.{job_id}",
            "posting_status": "in.(active,open)",
            "select": "*",
            "limit": "1",
        }
    )
    rows = _supabase_request(f"/rest/v1/{table}?{query}")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Job details were not found or the listing is no longer active.")

    row = rows[0]
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="Job details were not found.")

    job = {
        "job_id": str(row.get("job_id") or ""),
        "job_source": source,
        "job_title": str(row.get("job_title") or ""),
        "company_name": str(row.get("company_name") or ""),
        "job_category": str(row.get("category_name") or ""),
        "job_subcategory": str(row.get("job_subcategory") or ""),
        "job_level": str(row.get("job_level") or ""),
        "work_type": str(row.get("work_setup") or ""),
        "employment_type": str(row.get("employment_type") or ""),
        "location": str(row.get("location") or ""),
        "salary_range_monthly_php": _format_detail_salary(row),
        "job_description": str(row.get("job_description") or ""),
        "responsibilities": _split_detail_list(row.get("responsibilities")),
        "required_skills": _split_detail_list(row.get("required_skills")),
        "preferred_skills": _split_detail_list(row.get("preferred_skills")),
        "external_job_link_optional": str(row.get("source_url") or ""),
    }

    return {
        "job": job,
        "match_analysis": {
            "match_label": "",
            "confidence": "",
            "why_this_matches": "",
            "matched_skills": [],
            "missing_skills": [],
            "recommended_learning": [],
            "career_guidance": "",
        },
    }


@app.post("/api/resume/analyze")
async def analyze_resume(
    resume: Annotated[UploadFile, File()],
) -> dict:
    if not resume.filename:
        raise HTTPException(status_code=400, detail="Resume filename is missing.")

    suffix = resume.filename.lower().rsplit(".", 1)[-1]

    if suffix not in {"pdf", "docx"}:
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF or DOCX resume.",
        )

    file_bytes = await resume.read()

    if not file_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded resume file is empty.",
        )

    if len(file_bytes) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="Resume file must be 5MB or smaller.",
        )

    suffix_with_dot = f".{suffix}"
    file_path = UPLOADS_DIR / f"{uuid4().hex}{suffix_with_dot}"

    try:
        with open(file_path, "wb") as buffer:
            buffer.write(file_bytes)

        result = analyze_resume_file(
            file_path=str(file_path),
            skill_extractor=skill_extractor,
        )

        return result

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Resume analysis failed: {exc}") from exc

    finally:
        if file_path.exists():
            try:
                file_path.unlink()
            except Exception:
                pass


@app.post("/api/certificates/validate")
async def validate_certificate_file(
    certificate: Annotated[UploadFile, File()],
) -> dict:
    if not certificate.filename:
        raise HTTPException(status_code=400, detail="Certificate filename is missing.")

    file_bytes = await certificate.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded certificate file is empty.")

    is_valid, message = _is_valid_certificate_pdf(certificate.filename, file_bytes)
    if not is_valid:
        raise HTTPException(status_code=400, detail=message)

    return {"status": "valid", "message": message}


@app.post("/api/matches/run")
async def run_matches(payload: RunMatchesRequest) -> dict:
    resume_text_for_matching = payload.resume_text_for_matching.strip()
    preferences = (
        payload.preferences.model_dump()
        if hasattr(payload.preferences, "model_dump")
        else payload.preferences.dict()
    )
    user_mode = payload.user_mode
    view_mode = payload.view_mode

    if not resume_text_for_matching:
        raise HTTPException(status_code=400, detail="resume_text_for_matching is required.")

    candidate_skill_ids = _normalize_candidate_skill_ids(payload.candidate_skill_ids)

    try:
        # Always compute enough results for the logged-in full dashboard.
        result = match_jobs(
            resume_text_for_matching=resume_text_for_matching,
            candidate_skill_ids=candidate_skill_ids,
            preferences=preferences,
            top_n_retrieval=150,
            top_n_output=10,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Job matching failed: {exc}") from exc

    return _apply_report_access_control(result, user_mode, view_mode)


@app.post("/api/matches/from-resume")
async def match_from_resume(
    file: Annotated[UploadFile, File()],
    authorization: Annotated[Optional[str], Header()] = None,
    preferences: str = Form("{}"),
    confirmed_skills: str = Form("[]"),
    user_mode: str = Form("guest"),
    view_mode: str = Form("initial"),
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Resume filename is missing.")

    suffix = file.filename.lower().rsplit(".", 1)[-1]
    if suffix not in {"pdf", "docx"}:
        raise HTTPException(status_code=400, detail="Please upload a PDF or DOCX resume.")

    try:
        preferences_payload = json.loads(preferences or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Preferences must be valid JSON.") from exc

    if preferences_payload is None:
        preferences_payload = {}
    if not isinstance(preferences_payload, dict):
        raise HTTPException(status_code=400, detail="Preferences must be a JSON object.")

    try:
        confirmed_skills_payload = json.loads(confirmed_skills or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Confirmed skills must be valid JSON.") from exc

    if confirmed_skills_payload is None:
        confirmed_skills_payload = []
    if not isinstance(confirmed_skills_payload, list):
        raise HTTPException(status_code=400, detail="Confirmed skills must be a JSON list.")

    confirmed_skill_records = _normalize_confirmed_skills_payload(confirmed_skills_payload)

    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded resume file is empty.")

        result = match_resume_to_jobs(
            file_bytes=file_bytes,
            filename=file.filename,
            preferences=preferences_payload,
            confirmed_skills=confirmed_skill_records,
        )
        if user_mode in {"registered", "logged_in"}:
            try:
                _sync_match_results_to_supabase(
                    authorization=authorization,
                    result=result,
                    filename=file.filename,
                    preferences=preferences_payload,
                )
            except HTTPException as exc:
                print(f"Supabase match sync skipped: {exc.detail}")
        normalized_user_mode = user_mode if user_mode in {"guest", "registered", "logged_in"} else "guest"
        normalized_view_mode = view_mode if view_mode in {"initial", "full"} else "initial"
        return _apply_report_access_control(result, normalized_user_mode, normalized_view_mode)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="We could not generate matches right now. Please try again or upload a clearer resume.",
        ) from exc
