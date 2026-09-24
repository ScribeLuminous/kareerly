from __future__ import annotations

import json
import logging
import base64
import copy
import hashlib
from io import BytesIO
import os
import re
import threading
import time
from datetime import datetime, timezone
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Annotated, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from docx import Document
from docx.shared import Inches, Pt
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

from .models.schemas import ExternalJobAnalysisRequest, ExternalJobSaveRequest, RunMatchesRequest
from .services.job_matcher import list_available_jobs
from .services.bi_encoder_service import MODEL_ID, get_bi_encoder
from .services.bi_encoder_service import model_path as bi_encoder_model_path
from .services.external_job_analysis import analyze_external_job
from .services.matching_service import MatchingModelUnavailable, match_resume_to_jobs, match_text_to_jobs, match_jobs, warm_matching_caches
from .services.resume_analyzer import analyze_resume_file
from .services.skill_extractor import SkillExtractor


BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
UPLOADS_DIR = BACKEND_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


app = FastAPI(title="Kareerly ML Backend")
logger = logging.getLogger(__name__)
PHILIPPINE_TIMEZONE = ZoneInfo("Asia/Manila")

frontend_urls = os.getenv(
    "FRONTEND_URLS",
    "http://localhost:5173,http://127.0.0.1:5173",
)

allowed_origins = [
    origin.strip().rstrip("/")
    for origin in frontend_urls.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

skill_extractor = SkillExtractor()
MAX_CONFIRMED_SKILLS = 20
MAX_SAVED_EXTERNAL_JOB_MATCHES = 5
MAX_SAVED_EXTERNAL_JOB_RESULT_BYTES = 120_000
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv(
    "SUPABASE_ANON_KEY",
    os.getenv("VITE_SUPABASE_ANON_KEY", ""),
)
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

class MessageCreateRequest(BaseModel):
    application_id: str
    message_text: str
    message_kind: str = "message"


class MessageModerationRequest(BaseModel):
    application_id: str
    action: str
    reason: Optional[str] = None
    details: Optional[str] = None


MESSAGE_REPORT_REASONS = {"spam", "harassment", "scam", "inappropriate", "impersonation", "other"}


class EmployerApplicationStatusRequest(BaseModel):
    application_id: str
    status: str
    rejection_reason: Optional[str] = None


class EmployerAccountSettingsRequest(BaseModel):
    company_name: Optional[str] = None
    company_size: Optional[str] = None
    industry: Optional[str] = None
    business_email: Optional[str] = None
    company_location: Optional[str] = None
    company_website: Optional[str] = None
    company_description: Optional[str] = None
    contact_person_name: Optional[str] = None
    contact_role: Optional[str] = None
    contact_number: Optional[str] = None
    account_email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class CandidateAccountSettingsRequest(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    contact_number: Optional[str] = None
    birthday: Optional[str] = None
    address: Optional[str] = None
    location: Optional[str] = None
    highest_educational_attainment: Optional[str] = None
    degree_program: Optional[str] = None
    school_university: Optional[str] = None
    year_graduated: Optional[str] = None


class AdminResetApplicationRequest(BaseModel):
    application_id: str


class AdminUserUpdateRequest(BaseModel):
    user_id: str
    email: Optional[str] = None
    password: Optional[str] = None


class AdminJobUpdateRequest(BaseModel):
    job_id: str
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    posting_status: Optional[str] = None


class AdminApplicationUpdateRequest(BaseModel):
    application_id: str
    status: str


def _message_cipher() -> AESGCM:
    secret = os.getenv("MESSAGE_ENCRYPTION_KEY") or SUPABASE_SERVICE_ROLE_KEY
    if not secret:
        raise HTTPException(status_code=503, detail="Message encryption is not configured.")
    return AESGCM(hashlib.sha256(secret.encode("utf-8")).digest())


def _get_message_participant_role(thread: dict, user_id: str) -> str | None:
    candidate_query = urllib.parse.urlencode({"id": f"eq.{thread.get('candidate_id')}", "user_id": f"eq.{user_id}", "select": "id", "limit": "1"})
    candidate_rows = _supabase_request(f"/rest/v1/candidate_profiles?{candidate_query}", service_role=True)
    if isinstance(candidate_rows, list) and candidate_rows:
        return "candidate"
    employer_query = urllib.parse.urlencode({"id": f"eq.{thread.get('employer_id')}", "user_id": f"eq.{user_id}", "select": "id", "limit": "1"})
    employer_rows = _supabase_request(f"/rest/v1/employer_profiles?{employer_query}", service_role=True)
    if isinstance(employer_rows, list) and employer_rows:
        return "employer"
    # Supports deployments where thread participant columns already contain auth user UUIDs.
    if user_id == str(thread.get("candidate_id")):
        return "candidate"
    if user_id == str(thread.get("employer_id")):
        return "employer"
    return None


def _get_authorized_message_thread(application_id: str, user_id: str) -> dict:
    query = urllib.parse.urlencode({"application_id": f"eq.{application_id}", "select": "id,application_id,employer_id,candidate_id,status", "limit": "1"})
    rows = _supabase_request(f"/rest/v1/message_threads?{query}", service_role=True)
    thread = rows[0] if isinstance(rows, list) and rows else None
    if not isinstance(thread, dict):
        raise HTTPException(status_code=404, detail="No active message thread was found for this application.")
    participant_role = _get_message_participant_role(thread, user_id)
    if not participant_role:
        raise HTTPException(status_code=403, detail="You do not have access to this message thread.")
    if thread.get("status") not in {None, "pending", "active", "accepted", "open"}:
        raise HTTPException(status_code=403, detail="This message thread is not active.")
    return {**thread, "participant_role": participant_role}


def _create_employer_message_thread(application_id: str, user_id: str) -> dict:
    app_query = urllib.parse.urlencode({"id": f"eq.{application_id}", "select": "id,user_id,job_id,status", "limit": "1"})
    app_rows = _supabase_request(f"/rest/v1/job_applications?{app_query}", service_role=True)
    application = app_rows[0] if isinstance(app_rows, list) and app_rows else None
    if not isinstance(application, dict):
        raise HTTPException(status_code=404, detail="Application was not found.")
    if str(application.get("status") or "").lower() != "interviewing":
        raise HTTPException(status_code=403, detail="Message requests are available only for interviewing applications.")

    employer_query = urllib.parse.urlencode({"user_id": f"eq.{user_id}", "select": "id", "limit": "1"})
    employer_rows = _supabase_request(f"/rest/v1/employer_profiles?{employer_query}", service_role=True)
    employer = employer_rows[0] if isinstance(employer_rows, list) and employer_rows else None
    candidate_query = urllib.parse.urlencode({"user_id": f"eq.{application.get('user_id')}", "select": "id", "limit": "1"})
    candidate_rows = _supabase_request(f"/rest/v1/candidate_profiles?{candidate_query}", service_role=True)
    candidate = candidate_rows[0] if isinstance(candidate_rows, list) and candidate_rows else None
    if not isinstance(employer, dict) or not isinstance(candidate, dict):
        raise HTTPException(status_code=409, detail="The employer or candidate profile could not be resolved.")

    ownership_query = urllib.parse.urlencode({"job_id": f"eq.{application.get('job_id')}", "employer_id": f"eq.{employer['id']}", "select": "id", "limit": "1"})
    owned_jobs = _supabase_request(f"/rest/v1/employer_job_posts?{ownership_query}", service_role=True)
    if not isinstance(owned_jobs, list) or not owned_jobs:
        raise HTTPException(status_code=403, detail="This application does not belong to your employer account.")

    existing_request_query = urllib.parse.urlencode({
        "application_id": f"eq.{application_id}",
        "employer_id": f"eq.{user_id}",
        "candidate_id": f"eq.{application['user_id']}",
        "status": "eq.pending",
        "select": "id,application_id,employer_id,candidate_id,status",
        "order": "created_at.desc",
        "limit": "1",
    })
    existing_requests = _supabase_request(f"/rest/v1/message_requests?{existing_request_query}", service_role=True)
    request_row = existing_requests[0] if isinstance(existing_requests, list) and existing_requests else None
    if not isinstance(request_row, dict):
        request_body = {
            "application_id": application_id,
            "employer_id": user_id,
            "candidate_id": application["user_id"],
            "status": "pending",
        }
        request_rows = _supabase_request("/rest/v1/message_requests", method="POST", service_role=True, body=request_body, prefer="return=representation")
        request_row = request_rows[0] if isinstance(request_rows, list) and request_rows else None
    if not isinstance(request_row, dict) or not request_row.get("id"):
        raise HTTPException(status_code=500, detail="The message request could not be created.")

    thread_body = {
        "request_id": request_row["id"],
        "application_id": application_id,
        "employer_id": user_id,
        "candidate_id": application["user_id"],
        "status": "active",
    }
    thread_rows = _supabase_request("/rest/v1/message_threads", method="POST", service_role=True, body=thread_body, prefer="return=representation")
    thread = thread_rows[0] if isinstance(thread_rows, list) and thread_rows else None
    if not isinstance(thread, dict):
        raise HTTPException(status_code=500, detail="The message thread could not be created.")
    return {**thread, "participant_role": "employer"}


def _message_block_state(application_id: str, user_id: str) -> dict:
    """Latest block/unblock per participant; a missing table degrades to unblocked."""
    query = urllib.parse.urlencode({
        "application_id": f"eq.{application_id}",
        "action": "in.(block,unblock,report)",
        "select": "actor_user_id,actor_role,action,created_at",
        "order": "created_at.desc",
        "limit": "200",
    })
    try:
        rows = _supabase_request(f"/rest/v1/message_moderation_actions?{query}", service_role=True)
    except HTTPException:
        rows = []
    latest_block_action: dict[str, dict] = {}
    reported_by_me = False
    for row in rows if isinstance(rows, list) else []:
        actor = str(row.get("actor_user_id"))
        if row.get("action") == "report":
            reported_by_me = reported_by_me or actor == user_id
            continue
        latest_block_action.setdefault(actor, row)
    blockers = [row for row in latest_block_action.values() if row.get("action") == "block"]
    return {
        "blocked": bool(blockers),
        "blocked_by_me": any(str(row.get("actor_user_id")) == user_id for row in blockers),
        "blocked_by_role": blockers[0].get("actor_role") if blockers else None,
        "reported_by_me": reported_by_me,
    }


def _get_message_thread_participant(application_id: str, user_id: str) -> dict:
    """Like _get_authorized_message_thread, but also allows closed threads so a
    participant can still report or unblock after a thread stops being active."""
    query = urllib.parse.urlencode({"application_id": f"eq.{application_id}", "select": "id,application_id,employer_id,candidate_id,status", "limit": "1"})
    rows = _supabase_request(f"/rest/v1/message_threads?{query}", service_role=True)
    thread = rows[0] if isinstance(rows, list) and rows else None
    if not isinstance(thread, dict):
        raise HTTPException(status_code=404, detail="No message thread was found for this application.")
    participant_role = _get_message_participant_role(thread, user_id)
    if not participant_role:
        raise HTTPException(status_code=403, detail="You do not have access to this message thread.")
    return {**thread, "participant_role": participant_role}


@app.get("/api/messages/{application_id}/moderation")
def get_message_moderation(application_id: str, authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    _get_message_thread_participant(application_id, user_id)
    return _message_block_state(application_id, user_id)


@app.post("/api/messages/moderation")
def create_message_moderation(payload: MessageModerationRequest, authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    action = payload.action.strip().lower()
    if action not in {"report", "block", "unblock"}:
        raise HTTPException(status_code=400, detail="Action must be report, block, or unblock.")
    reason = (payload.reason or "").strip().lower() or None
    details = (payload.details or "").strip() or None
    if action == "report" and reason not in MESSAGE_REPORT_REASONS:
        raise HTTPException(status_code=400, detail="Choose a reason for the report.")
    if details and len(details) > 2000:
        raise HTTPException(status_code=400, detail="Report details must be 2000 characters or fewer.")
    thread = _get_message_thread_participant(payload.application_id, user_id)
    body = {
        "application_id": payload.application_id,
        "actor_user_id": user_id,
        "actor_role": thread["participant_role"],
        "action": action,
        "reason": reason if action == "report" else None,
        "details": details if action == "report" else None,
    }
    _supabase_request("/rest/v1/message_moderation_actions", method="POST", service_role=True, body=body, prefer="return=minimal")
    return _message_block_state(payload.application_id, user_id)


@app.get("/api/messages/{application_id}")
def get_application_messages(application_id: str, authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    thread = _get_authorized_message_thread(application_id, user_id)
    query = urllib.parse.urlencode({"thread_id": f"eq.{thread['id']}", "select": "id,sender_user_id,sender_role,ciphertext,encryption_nonce,encryption_version,message_kind,created_at", "deleted_at": "is.null", "order": "created_at.asc"})
    rows = _supabase_request(f"/rest/v1/application_messages?{query}", service_role=True)
    cipher = _message_cipher()
    output = []
    for row in rows if isinstance(rows, list) else []:
        try:
            plaintext = cipher.decrypt(base64.b64decode(row["encryption_nonce"]), base64.b64decode(row["ciphertext"]), str(thread["id"]).encode("utf-8")).decode("utf-8")
        except Exception:
            continue
        output.append({**row, "message_text": plaintext})
    return output


@app.post("/api/messages")
def create_application_message(payload: MessageCreateRequest, authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    text = payload.message_text.strip()
    if not text or len(text) > 4000:
        raise HTTPException(status_code=400, detail="Message must contain between 1 and 4000 characters.")
    try:
        thread = _get_authorized_message_thread(payload.application_id, user_id)
    except HTTPException as exc:
        if payload.message_kind != "request" or exc.status_code != 404:
            raise
        thread = _create_employer_message_thread(payload.application_id, user_id)
    sender_role = str(thread["participant_role"])
    if _message_block_state(payload.application_id, user_id)["blocked"]:
        raise HTTPException(status_code=403, detail="Messaging is blocked for this conversation.")
    if payload.message_kind == "request" and sender_role != "employer":
        raise HTTPException(status_code=403, detail="Only the employer can initiate a message request.")
    if payload.message_kind == "message":
        state_query = urllib.parse.urlencode({"id": f"eq.{payload.application_id}", "select": "message_request_state", "limit": "1"})
        state_rows = _supabase_request(f"/rest/v1/job_applications?{state_query}", service_role=True)
        request_state = state_rows[0].get("message_request_state") if isinstance(state_rows, list) and state_rows else None
        if request_state != "accepted":
            raise HTTPException(status_code=403, detail="The candidate must accept the message request before replies can be sent.")
    cipher = _message_cipher()
    nonce = os.urandom(12)
    ciphertext = cipher.encrypt(nonce, text.encode("utf-8"), str(thread["id"]).encode("utf-8"))
    body = {
        "thread_id": thread["id"], "application_id": payload.application_id,
        "sender_user_id": user_id, "sender_role": sender_role,
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        "encryption_nonce": base64.b64encode(nonce).decode("ascii"),
        "encryption_version": 1, "message_kind": "text",
    }
    saved = _supabase_request("/rest/v1/application_messages", method="POST", service_role=True, body=body, prefer="return=representation")
    row = saved[0] if isinstance(saved, list) and saved else body
    return {**row, "message_text": text}


@app.post("/api/messages/application-status")
def update_employer_application_status(payload: EmployerApplicationStatusRequest, authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    allowed = {"shortlisted", "interviewing", "hired", "rejected"}
    status = payload.status.strip().lower()
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid application status.")
    if status == "rejected" and not (payload.rejection_reason or "").strip():
        raise HTTPException(status_code=400, detail="A rejection reason is required.")

    app_query = urllib.parse.urlencode({"id": f"eq.{payload.application_id}", "select": "id,job_id", "limit": "1"})
    app_rows = _supabase_request(f"/rest/v1/job_applications?{app_query}", service_role=True)
    application = app_rows[0] if isinstance(app_rows, list) and app_rows else None
    employer_query = urllib.parse.urlencode({"user_id": f"eq.{user_id}", "select": "id", "limit": "1"})
    employer_rows = _supabase_request(f"/rest/v1/employer_profiles?{employer_query}", service_role=True)
    employer = employer_rows[0] if isinstance(employer_rows, list) and employer_rows else None
    if not isinstance(application, dict) or not isinstance(employer, dict):
        raise HTTPException(status_code=404, detail="Application or employer profile was not found.")
    owner_query = urllib.parse.urlencode({"job_id": f"eq.{application.get('job_id')}", "employer_id": f"eq.{employer['id']}", "select": "id", "limit": "1"})
    owned = _supabase_request(f"/rest/v1/employer_job_posts?{owner_query}", service_role=True)
    if not isinstance(owned, list) or not owned:
        raise HTTPException(status_code=403, detail="This application does not belong to your employer account.")

    body = {"status": status, "updated_at": _safe_timestamp()}
    if status == "rejected":
        body["rejection_reason"] = payload.rejection_reason.strip()
    updated = _supabase_request(f"/rest/v1/job_applications?id=eq.{urllib.parse.quote(payload.application_id, safe='')}", method="PATCH", service_role=True, body=body, prefer="return=representation")
    if status == "rejected":
        _supabase_request(f"/rest/v1/message_threads?application_id=eq.{urllib.parse.quote(payload.application_id, safe='')}", method="PATCH", service_role=True, body={"status": "closed"})
    return {"application": updated[0] if isinstance(updated, list) and updated else body}


def _supabase_request(
    path: str,
    *,
    method: str = "GET",
    token: str | None = None,
    service_role: bool = False,
    body: object | None = None,
    prefer: str | None = None,
) -> object:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=503, detail="Supabase is not configured for account services.")
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


EMPLOYER_SETTINGS_COLUMNS = (
    "id,user_id,company_name,company_size,industry,business_email,company_location,"
    "company_website,company_description,contact_person_name,contact_role,contact_number,updated_at"
)


def _require_employer_profile(user_id: str) -> dict:
    query = urllib.parse.urlencode({"user_id": f"eq.{user_id}", "select": "*", "limit": "1"})
    rows = _supabase_request(f"/rest/v1/employer_profiles?{query}", service_role=True)
    profile = rows[0] if isinstance(rows, list) and rows else None
    if not isinstance(profile, dict):
        raise HTTPException(status_code=404, detail="Employer profile was not found.")
    user_query = urllib.parse.urlencode({"id": f"eq.{user_id}", "select": "first_name,last_name,email", "limit": "1"})
    users = _supabase_request(f"/rest/v1/profiles?{user_query}", service_role=True)
    user = users[0] if isinstance(users, list) and users else {}
    auth_user = _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", service_role=True)
    metadata = auth_user.get("user_metadata") if isinstance(auth_user, dict) and isinstance(auth_user.get("user_metadata"), dict) else {}
    optional_fields = ("company_location", "company_website", "company_description", "contact_person_name", "contact_role", "contact_number")
    return {
        **profile, **{field: profile.get(field) or metadata.get(field) for field in optional_fields},
        "account_email": user.get("email"), "first_name": user.get("first_name"), "last_name": user.get("last_name"),
    }


@app.get("/api/employer/account-settings")
def get_employer_account_settings(authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    return _require_employer_profile(user_id)


@app.patch("/api/employer/account-settings")
def update_employer_account_settings(payload: EmployerAccountSettingsRequest, authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    profile = _require_employer_profile(user_id)
    payload_values = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    account_fields = {key: payload_values.pop(key) for key in ("account_email", "first_name", "last_name") if key in payload_values}
    body = {key: (value.strip() if isinstance(value, str) else value) for key, value in payload_values.items()}
    if "company_name" in body and not body["company_name"]:
        raise HTTPException(status_code=400, detail="Company name is required.")
    if "business_email" in body and body["business_email"] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", body["business_email"]):
        raise HTTPException(status_code=400, detail="Enter a valid contact email address.")
    account_email = str(account_fields.get("account_email") or "").strip()
    if account_email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", account_email):
        raise HTTPException(status_code=400, detail="Enter a valid account email address.")
    profile_body = {key: str(value or "").strip() for key, value in account_fields.items() if key in {"first_name", "last_name"}}
    if account_email:
        profile_body["email"] = account_email
    metadata = {key: value for key, value in body.items() if key != "updated_at"}
    if profile_body:
        profile_body["updated_at"] = _safe_timestamp()
        _supabase_request(f"/rest/v1/profiles?id=eq.{urllib.parse.quote(user_id, safe='')}", method="PATCH", service_role=True, body=profile_body)
        metadata.update({"first_name": profile_body.get("first_name"), "last_name": profile_body.get("last_name"), "role": "employer"})
        auth_body = {"user_metadata": metadata}
        if account_email:
            auth_body["email"] = account_email
            auth_body["email_confirm"] = True
        _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", method="PUT", service_role=True, body=auth_body)
    elif metadata:
        _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", method="PUT", service_role=True, body={"user_metadata": {**metadata, "role": "employer"}})
    if not body:
        return _require_employer_profile(user_id)
    supported_body = {key: value for key, value in body.items() if key in {"company_name", "company_size", "industry", "business_email"}}
    supported_body["updated_at"] = _safe_timestamp()
    profile_id = urllib.parse.quote(str(profile["id"]), safe="")
    rows = _supabase_request(
        f"/rest/v1/employer_profiles?id=eq.{profile_id}", method="PATCH", service_role=True,
        body=supported_body, prefer="return=representation",
    )
    return _require_employer_profile(user_id)


def _require_candidate_settings(user_id: str) -> dict:
    user_query = urllib.parse.urlencode({"id": f"eq.{user_id}", "select": "first_name,last_name,email", "limit": "1"})
    users = _supabase_request(f"/rest/v1/profiles?{user_query}", service_role=True)
    user = users[0] if isinstance(users, list) and users else None
    if not isinstance(user, dict):
        raise HTTPException(status_code=404, detail="Candidate profile was not found.")
    candidate_query = urllib.parse.urlencode({"user_id": f"eq.{user_id}", "select": "public_id,location", "limit": "1"})
    candidates = _supabase_request(f"/rest/v1/candidate_profiles?{candidate_query}", service_role=True)
    candidate = candidates[0] if isinstance(candidates, list) and candidates else {}
    auth_user = _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", service_role=True)
    metadata = auth_user.get("user_metadata") if isinstance(auth_user, dict) and isinstance(auth_user.get("user_metadata"), dict) else {}
    return {
        "full_name": f"{user.get('first_name') or ''} {user.get('last_name') or ''}".strip(), "email": user.get("email"),
        "public_id": candidate.get("public_id"), "birthday": metadata.get("birthday"), "location": candidate.get("location") or metadata.get("location"),
        "contact_number": metadata.get("contact_number"), "address": metadata.get("address"),
        "highest_educational_attainment": metadata.get("highest_educational_attainment"),
        "degree_program": metadata.get("degree_program"),
        "school_university": metadata.get("school_university"),
        "year_graduated": metadata.get("year_graduated"),
    }


@app.get("/api/candidate/account-settings")
def get_candidate_account_settings(authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    return _require_candidate_settings(user_id)


@app.patch("/api/candidate/account-settings")
def update_candidate_account_settings(payload: CandidateAccountSettingsRequest, authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    current = _require_candidate_settings(user_id)
    values = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    full_name = str(values.pop("full_name", current.get("full_name") or "")).strip()
    email = str(values.pop("email", current.get("email") or "")).strip().lower()
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is required.")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    name_parts = full_name.split(None, 1)
    first_name, last_name = name_parts[0], name_parts[1] if len(name_parts) > 1 else ""
    profile_body = {"first_name": first_name, "last_name": last_name, "email": email, "updated_at": _safe_timestamp()}
    _supabase_request(f"/rest/v1/profiles?id=eq.{urllib.parse.quote(user_id, safe='')}", method="PATCH", service_role=True, body=profile_body)
    metadata = {
        "first_name": first_name, "last_name": last_name, "role": "candidate", "birthday": values.get("birthday") or None,
        "location": values.get("location") or "", "contact_number": values.get("contact_number") or "", "address": values.get("address") or "",
        "highest_educational_attainment": values.get("highest_educational_attainment") or "", "degree_program": values.get("degree_program") or "",
        "school_university": values.get("school_university") or "", "year_graduated": values.get("year_graduated") or "",
    }
    _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", method="PUT", service_role=True, body={"email": email, "email_confirm": True, "user_metadata": metadata})
    candidate_body = {"user_id": user_id, "location": values.get("location") or None, "updated_at": _safe_timestamp()}
    query = urllib.parse.urlencode({"on_conflict": "user_id"})
    _supabase_request(f"/rest/v1/candidate_profiles?{query}", method="POST", service_role=True, body=candidate_body, prefer="resolution=merge-duplicates")
    return _require_candidate_settings(user_id)


def _sync_match_results_in_background(**kwargs) -> None:
    try:
        _sync_match_results_to_supabase(**kwargs)
    except HTTPException as exc:
        logger.warning("Supabase match sync skipped: %s", exc.detail)
    except Exception:
        logger.exception("Supabase match sync failed")


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
    extracted_education = (result.get("candidate_profile") or {}).get("education") or []
    education = extracted_education[0] if isinstance(extracted_education, list) and extracted_education and isinstance(extracted_education[0], dict) else None

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

    if education:
        auth_user = _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", service_role=True)
        existing_metadata = auth_user.get("user_metadata") if isinstance(auth_user, dict) and isinstance(auth_user.get("user_metadata"), dict) else {}
        education_metadata = {
            key: str(education.get(key) or "")
            for key in ("highest_educational_attainment", "degree_program", "school_university", "year_graduated")
        }
        _supabase_request(
            f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", method="PUT", service_role=True,
            body={"user_metadata": {**existing_metadata, **education_metadata}},
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

    all_fit_now_matches = result.get("all_fit_now_matches") or result.get("fit_now_matches", [])
    all_aspiration_matches = result.get("all_aspiration_matches") or result.get("aspiration_matches", [])

    result["limited_report"] = {
        "fit_now_matches": all_fit_now_matches[:job_limit],
        "aspiration_matches": all_aspiration_matches[:job_limit],
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

    return True, "PDF file checks passed. Pending Verification: issuer authenticity, completion, and certificate validity have not been verified."


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


WARMUP_ENABLED = os.getenv("KAREERLY_WARM_ON_STARTUP", "1").strip().lower() not in {"0", "false", "no"}


def _warm_matching_caches_in_background() -> None:
    try:
        warm_matching_caches()
        logger.info("Matching model and job vectors are warm")
    except Exception:
        # Matching raises its own readable errors per request, so a failed warmup
        # costs latency, not correctness, and must not take the service down.
        logger.exception("Matching warmup failed; the first match request will load the model itself")


@app.on_event("startup")
def start_matching_warmup() -> None:
    """Warm on a daemon thread so the port opens immediately for health checks."""
    if not WARMUP_ENABLED:
        return
    threading.Thread(target=_warm_matching_caches_in_background, name="matching-warmup", daemon=True).start()


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Kareerly backend is running"}


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health/config")
def health_config() -> dict:
    """Deployment diagnostics: tells a browser CORS rejection apart from a broken service.

    Reaching this at all proves the service is up, so a failed request from the
    website is a CORS problem when the website origin is missing from
    ``allowed_origins``. Checkpoint files are probed by path only, never loaded,
    so this stays cheap enough to call while matching is running.
    """
    checkpoint = bi_encoder_model_path()
    required = ("model.safetensors", "modules.json", "input_features.json")
    missing = [name for name in required if not (checkpoint / name).is_file()]
    return {
        "status": "ok",
        "allowed_origins": allowed_origins,
        "model": {
            "id": MODEL_ID,
            "path": str(checkpoint),
            "files_present": not missing,
            "missing_files": missing,
            "loaded": get_bi_encoder.cache_info().currsize > 0,
        },
    }


@app.get("/api/admin/overview")
def admin_overview(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_user_id = _require_admin_user(authorization)
    profiles = _admin_select(
        "profiles",
        "id,role,first_name,last_name,email,created_at",
        limit=500,
        order="created_at.desc",
    )
    job_posts = _admin_select(
        "employer_job_posts",
        "id,job_id,job_title,company_name,posting_status,created_at,updated_at",
        limit=500,
        order="updated_at.desc",
    )
    applications = _admin_select(
        "job_applications",
        "id,user_id,job_id,job_title,company_name,status,message_request_state,applied_at,updated_at",
        limit=500,
        order="updated_at.desc",
    )
    messages = _admin_select(
        "application_messages",
        "id,thread_id,application_id,sender_user_id,sender_role,message_kind,encryption_version,created_at,read_at,deleted_at",
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


@app.post("/api/admin/applications/reset")
def admin_reset_application(payload: AdminResetApplicationRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    application_id = payload.application_id.strip()
    if not application_id:
        raise HTTPException(status_code=400, detail="Application ID is required.")
    encoded_id = urllib.parse.quote(application_id, safe="")
    _supabase_request(f"/rest/v1/application_messages?application_id=eq.{encoded_id}", method="DELETE", service_role=True)
    _supabase_request(f"/rest/v1/message_threads?application_id=eq.{encoded_id}", method="DELETE", service_role=True)
    _supabase_request(f"/rest/v1/message_requests?application_id=eq.{encoded_id}", method="DELETE", service_role=True)
    rows = _supabase_request(
        f"/rest/v1/job_applications?id=eq.{encoded_id}",
        method="PATCH",
        service_role=True,
        body={"status": "pending", "message_request_state": "none"},
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Application was not found.")
    return {"application": rows[0]}


@app.patch("/api/admin/users")
def admin_update_user(payload: AdminUserUpdateRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    body: dict[str, str] = {}
    if payload.email is not None:
        email = payload.email.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPException(status_code=400, detail="Enter a valid email address.")
        body["email"] = email
    if payload.password is not None:
        if len(payload.password) < 8:
            raise HTTPException(status_code=400, detail="Password must contain at least 8 characters.")
        body["password"] = payload.password
    if not body:
        raise HTTPException(status_code=400, detail="No user changes were provided.")
    updated = _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(payload.user_id, safe='')}", method="PUT", service_role=True, body=body)
    if "email" in body:
        _supabase_request(f"/rest/v1/profiles?id=eq.{urllib.parse.quote(payload.user_id, safe='')}", method="PATCH", service_role=True, body={"email": body["email"]})
    return {"user": updated}


@app.patch("/api/admin/jobs")
def admin_update_job(payload: AdminJobUpdateRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    body = {key: value.strip() for key, value in {
        "job_title": payload.job_title,
        "company_name": payload.company_name,
        "posting_status": payload.posting_status,
    }.items() if value is not None and value.strip()}
    if body.get("posting_status") and body["posting_status"] not in {"active", "draft", "closed"}:
        raise HTTPException(status_code=400, detail="Job status must be active, draft, or closed.")
    if not body:
        raise HTTPException(status_code=400, detail="No job changes were provided.")
    rows = _supabase_request(f"/rest/v1/employer_job_posts?id=eq.{urllib.parse.quote(payload.job_id, safe='')}", method="PATCH", service_role=True, body=body, prefer="return=representation")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Job post was not found.")
    return {"job": rows[0]}


@app.delete("/api/admin/jobs/{job_id}")
def admin_delete_job(job_id: str, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    rows = _supabase_request(f"/rest/v1/employer_job_posts?id=eq.{urllib.parse.quote(job_id, safe='')}", method="DELETE", service_role=True, prefer="return=representation")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Job post was not found.")
    return {"deleted": True}


@app.patch("/api/admin/applications")
def admin_update_application(payload: AdminApplicationUpdateRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    status = payload.status.strip().lower()
    if status not in {"pending", "shortlisted", "interviewing", "hired", "rejected", "withdrawn"}:
        raise HTTPException(status_code=400, detail="Invalid application status.")
    now = datetime.now(timezone.utc).isoformat()
    body: dict[str, object] = {"status": status, "updated_at": now}
    if status == "withdrawn":
        body["withdrawn_at"] = now
    rows = _supabase_request(f"/rest/v1/job_applications?id=eq.{urllib.parse.quote(payload.application_id, safe='')}", method="PATCH", service_role=True, body=body, prefer="return=representation")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Application was not found.")
    return {"application": rows[0]}


@app.get("/api/jobs/list")
def jobs_list(limit: int = 5000) -> dict:
    return {"results": list_available_jobs(limit=limit)}


def _split_detail_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not isinstance(value, str):
        return []
    return [item.strip() for item in re.split(r"\r?\n|;|,", value) if item.strip()]


def _split_job_description_sections(value: object) -> tuple[str, list[str]]:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    marker = re.search(r"(?:^|\n)\s*(?:key responsibilities|responsibilities|what you'll do)\s*:\s*", text, re.IGNORECASE)
    if not marker:
        return text, []
    description = text[: marker.start()].strip()
    responsibilities = [
        re.sub(r"^\s*[-–—•*]\s*", "", item).strip()
        for item in text[marker.end() :].splitlines()
    ]
    return description, [item for item in responsibilities if item]


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
    if source == "employer" and row.get("application_deadline") and str(row.get("application_deadline")) <= datetime.now(PHILIPPINE_TIMEZONE).date().isoformat():
        raise HTTPException(status_code=404, detail="This job posting is closed and is no longer accepting applications.")

    description, embedded_responsibilities = _split_job_description_sections(row.get("job_description"))
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
        "job_description": description,
        "responsibilities": _split_detail_list(row.get("responsibilities")) or embedded_responsibilities,
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

    analysis_started_at = time.perf_counter()
    try:
        with open(file_path, "wb") as buffer:
            buffer.write(file_bytes)

        result = await run_in_threadpool(
            analyze_resume_file,
            file_path=str(file_path),
            skill_extractor=skill_extractor,
        )

        logger.info(
            "Resume analysis completed",
            extra={
                "filename": resume.filename,
                "file_bytes": len(file_bytes),
                "raw_text_length": result.get("raw_text_length", 0),
                "skill_count": len(result.get("candidate_profile", {}).get("skills", [])),
                "elapsed_ms": round((time.perf_counter() - analysis_started_at) * 1000, 1),
            },
        )

        return result

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Resume analysis failed",
            extra={
                "filename": resume.filename,
                "file_bytes": len(file_bytes),
                "elapsed_ms": round((time.perf_counter() - analysis_started_at) * 1000, 1),
            },
        )
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

    # File screening is not issuer authentication or proof of completion.
    return {
        "status": "valid",
        "verification_status": "pending_verification",
        "authenticity_verified": False,
        "message": "File checks passed. Pending Verification: certificate authenticity and completion have not been verified.",
    }


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
    confirmed_skill_records = _normalize_confirmed_skills_payload(payload.confirmed_skills)

    try:
        # Always compute enough results for the logged-in full dashboard.
        if confirmed_skill_records:
            result = await run_in_threadpool(
                match_text_to_jobs,
                resume_text=resume_text_for_matching,
                preferences=preferences,
                confirmed_skills=confirmed_skill_records,
            )
        else:
            result = await run_in_threadpool(
                match_jobs,
                resume_text_for_matching=resume_text_for_matching,
                candidate_skill_ids=candidate_skill_ids,
                preferences=preferences,
                top_n_retrieval=150,
                top_n_output=10,
            )
    except MatchingModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Text job matching failed")
        raise HTTPException(status_code=500, detail=f"Job matching failed: {exc}") from exc

    return _apply_report_access_control(result, user_mode, view_mode)


@app.post("/api/matches/run-form")
async def run_matches_form(payload: str = Form(...)) -> dict:
    """Accept the same request without a JSON CORS preflight.

    The browser sends a multipart form with no custom headers. This matters for
    cross-origin clients when an upstream challenge rejects OPTIONS before the
    request reaches FastAPI. Keep the JSON route for existing API consumers.
    """
    try:
        values = json.loads(payload)
        if not isinstance(values, dict):
            raise ValueError("Matching payload must be an object.")
        request = (
            RunMatchesRequest.model_validate(values)
            if hasattr(RunMatchesRequest, "model_validate")
            else RunMatchesRequest.parse_obj(values)
        )
    except (json.JSONDecodeError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Invalid matching request payload.") from exc
    return await run_matches(request)


def _load_external_job_candidate(user_id: str) -> tuple[str, list[dict], dict, dict]:
    resume_query = urllib.parse.urlencode({
        "user_id": f"eq.{user_id}",
        "select": "parsed_text,extracted_profile_json,created_at",
        "order": "created_at.desc",
        "limit": "1",
    })
    resumes = _supabase_request(f"/rest/v1/resumes?{resume_query}", service_role=True)
    resume = resumes[0] if isinstance(resumes, list) and resumes and isinstance(resumes[0], dict) else None
    resume_text = str(resume.get("parsed_text") or "").strip() if resume else ""
    if not resume_text:
        raise HTTPException(status_code=409, detail={
            "code": "PROFILE_REQUIRED",
            "message": "Upload or complete your resume before analyzing an external job.",
        })

    profile_json = resume.get("extracted_profile_json") if isinstance(resume, dict) else {}
    profile_json = profile_json if isinstance(profile_json, dict) else {}
    profile = profile_json.get("candidate_profile") if isinstance(profile_json.get("candidate_profile"), dict) else {}
    skill_records = profile.get("skills") if isinstance(profile.get("skills"), list) else []
    if not skill_records:
        skill_query = urllib.parse.urlencode({"user_id": f"eq.{user_id}", "select": "skill_id,skill_name,confidence", "order": "created_at.desc"})
        skill_rows = _supabase_request(f"/rest/v1/user_skills?{skill_query}", service_role=True)
        skill_records = skill_rows if isinstance(skill_rows, list) else []

    preference_query = urllib.parse.urlencode({
        "user_id": f"eq.{user_id}",
        "select": "preferred_industry,preferred_work_setup,expected_salary,target_role,skill_to_develop",
        "limit": "1",
    })
    preference_rows = _supabase_request(f"/rest/v1/candidate_profiles?{preference_query}", service_role=True)
    profile_preferences = preference_rows[0] if isinstance(preference_rows, list) and preference_rows and isinstance(preference_rows[0], dict) else {}
    preferences = {
        "industry": str(profile_preferences.get("preferred_industry") or ""),
        "work_setup": str(profile_preferences.get("preferred_work_setup") or ""),
        "salary_expectation": str(profile_preferences.get("expected_salary") or ""),
        "target_role": str(profile_preferences.get("target_role") or ""),
        "skill_to_develop": str(profile_preferences.get("skill_to_develop") or ""),
    }
    context = {
        "education": profile.get("education") or [],
        "certifications": profile.get("certifications") or [],
        "experience": profile.get("experience_indicators") or [],
    }
    return resume_text, [item for item in skill_records if isinstance(item, dict)], preferences, context


def _compact_external_job_analysis(analysis: dict) -> dict:
    """Keep saved external results useful without retaining the pasted job text."""
    if not isinstance(analysis, dict):
        raise HTTPException(status_code=400, detail="A valid external job analysis is required.")

    job = analysis.get("job") if isinstance(analysis.get("job"), dict) else {}
    extracted = analysis.get("extracted_requirements") if isinstance(analysis.get("extracted_requirements"), dict) else {}
    match = analysis.get("match") if isinstance(analysis.get("match"), dict) else {}
    metadata = analysis.get("metadata") if isinstance(analysis.get("metadata"), dict) else {}

    def bounded_items(value: object, limit: int) -> list[str]:
        return [str(item)[:120] for item in value[:limit]] if isinstance(value, list) else []

    title = str(job.get("title") or "External job").strip()[:200]
    company_name = str(job.get("company_name") or "").strip()[:200]
    if not title:
        raise HTTPException(status_code=400, detail="The external job title is required to save this result.")

    compact_match = {
        "match_percentage": match.get("match_percentage", 0),
        "semantic_similarity": match.get("semantic_similarity", 0),
        "skill_coverage": match.get("skill_coverage", 0),
        "match_type": str(match.get("match_type") or "")[:80],
        "explanation": str(match.get("explanation") or "")[:4000],
        "matched_skills": bounded_items(match.get("matched_skills"), 20),
        "missing_skills": bounded_items(match.get("missing_skills"), 20),
        "matched_skill_ids": bounded_items(match.get("matched_skill_ids"), 20),
        "missing_skill_ids": bounded_items(match.get("missing_skill_ids"), 20),
        "preference_alignment": match.get("preference_alignment", analysis.get("preference_alignment", 0)),
    }
    compact = {
        "job": {"title": title, "company_name": company_name, "source": "external_paste"},
        "extracted_requirements": {
            key: value
            for key, value in extracted.items()
            if key in {
                "summary", "responsibilities", "required_skills", "preferred_skills",
                "normalized_required_skills", "normalized_preferred_skills", "experience_requirements",
                "education_requirements", "certifications", "job_level", "industry", "work_setup",
            }
        },
        "match": compact_match,
        "matched_skills": compact_match["matched_skills"],
        "missing_skills": compact_match["missing_skills"],
        "preference_alignment": compact_match["preference_alignment"],
        "learning_recommendations": analysis.get("learning_recommendations", [])[:5] if isinstance(analysis.get("learning_recommendations"), list) else [],
        "warnings": [str(item)[:500] for item in analysis.get("warnings", [])[:10]] if isinstance(analysis.get("warnings"), list) else [],
        "metadata": {
            key: str(metadata.get(key) or "")[:120]
            for key in ("extraction_source", "explanation_source", "matching_source")
        },
    }
    if len(json.dumps(compact, ensure_ascii=False).encode("utf-8")) > MAX_SAVED_EXTERNAL_JOB_RESULT_BYTES:
        raise HTTPException(status_code=413, detail="This external job result is too large to save.")
    return compact


def _external_job_analysis_fingerprint(analysis: dict) -> str:
    """Return a stable identity for idempotent per-candidate saves."""
    canonical = json.dumps(analysis, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _external_job_report_filename(title: object) -> str:
    safe_title = re.sub(r"[^A-Za-z0-9]+", "_", str(title or "External_Job")).strip("_")[:70]
    return f"Kareerly_External_Job_Match_Report_{safe_title or 'External_Job'}.docx"


def _build_external_job_report(analysis: dict) -> tuple[BytesIO, str]:
    """Build a genuine Office Open XML report from a validated compact analysis."""
    compact = _compact_external_job_analysis(analysis)
    job = compact["job"]
    match = compact["match"]
    document = Document()
    section = document.sections[0]
    section.top_margin = Inches(0.65)
    section.bottom_margin = Inches(0.65)
    section.left_margin = Inches(0.75)
    section.right_margin = Inches(0.75)

    styles = document.styles
    styles["Normal"].font.name = "Aptos"
    styles["Normal"].font.size = Pt(10.5)
    styles["Title"].font.name = "Aptos Display"
    styles["Title"].font.size = Pt(22)

    brand = document.add_paragraph()
    brand_run = brand.add_run("Kareerly")
    brand_run.bold = True
    brand_run.font.size = Pt(12)
    title = document.add_heading("External Job Match Report", level=0)
    title.paragraph_format.space_after = Pt(10)

    details = (
        ("Job Title", job.get("title") or "External Job"),
        ("Company", job.get("company_name") or "Not provided"),
        ("Analysis Date", datetime.now(PHILIPPINE_TIMEZONE).strftime("%B %d, %Y")),
    )
    table = document.add_table(rows=0, cols=2)
    table.style = "Light Shading Accent 1"
    for label, value in details:
        cells = table.add_row().cells
        cells[0].text = label
        cells[0].paragraphs[0].runs[0].bold = True
        cells[1].text = str(value)

    document.add_heading("Match Summary", level=1)
    try:
        percentage = max(0, min(100, round(float(match.get("match_percentage", 0)))))
    except (TypeError, ValueError):
        percentage = 0
    try:
        raw_coverage = float(match.get("skill_coverage", 0))
    except (TypeError, ValueError):
        raw_coverage = 0
    coverage = round(raw_coverage * 100 if raw_coverage <= 1 else raw_coverage)
    for label, value in (
        ("Match Percentage", f"{percentage}%"),
        ("Match Classification", match.get("match_type") or "Not classified"),
        ("Skill Coverage", f"{max(0, min(100, coverage))}%"),
    ):
        paragraph = document.add_paragraph(style="List Bullet")
        run = paragraph.add_run(f"{label}: ")
        run.bold = True
        paragraph.add_run(str(value))

    document.add_heading("Why This Matches", level=1)
    document.add_paragraph(str(match.get("explanation") or "No explanation is available."))

    def add_skill_section(heading: str, values: object, empty_message: str) -> None:
        document.add_heading(heading, level=1)
        items = values if isinstance(values, list) else []
        if not items:
            document.add_paragraph(empty_message)
            return
        for item in items:
            document.add_paragraph(str(item), style="List Bullet")

    add_skill_section("Matched Skills", compact.get("matched_skills"), "No confirmed matched skills were identified.")
    add_skill_section("Skills to Develop", compact.get("missing_skills"), "No canonical skill gaps were identified.")

    document.add_heading("What to Learn Next", level=1)
    resources = compact.get("learning_recommendations")
    if isinstance(resources, list) and resources:
        for resource in resources:
            if not isinstance(resource, dict):
                continue
            resource_title = resource.get("title") or resource.get("course_or_certification_title") or "Learning resource"
            provider = resource.get("provider") or resource.get("offered_by_provider") or "Kareerly catalog"
            url = resource.get("url") or resource.get("external_course_or_certification_link")
            paragraph = document.add_paragraph(style="List Bullet")
            paragraph.add_run(str(resource_title)).bold = True
            paragraph.add_run(f" — {provider}")
            if isinstance(url, str) and re.match(r"^https?://", url, re.IGNORECASE):
                document.add_paragraph(url)
    else:
        document.add_paragraph("No curated learning resource is available for these skills yet.")

    document.add_paragraph()
    notice = document.add_paragraph(
        "This job was analyzed from a description provided by the candidate. "
        "Applications to external jobs are not tracked by Kareerly."
    )
    notice.runs[0].italic = True

    output = BytesIO()
    document.save(output)
    output.seek(0)
    return output, _external_job_report_filename(job.get("title"))


def _saved_external_job_response(row: dict) -> dict:
    result_json = row.get("result_json") if isinstance(row.get("result_json"), dict) else {}
    saved_job = result_json.get("job") if isinstance(result_json.get("job"), dict) else {}
    return {
        "id": row.get("id"),
        "job_title": row.get("job_title") or saved_job.get("title", "External job"),
        "company_name": row.get("company_name") or saved_job.get("company_name", ""),
        "match_percentage": row.get("match_percentage", 0),
        "analysis": result_json,
        "created_at": row.get("created_at"),
    }


@app.post("/api/candidate/external-jobs/analyze")
async def analyze_candidate_external_job(
    payload: ExternalJobAnalysisRequest,
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")

    try:
        resume_text, skill_records, preferences, profile_context = _load_external_job_candidate(user_id)
        result = await run_in_threadpool(
            analyze_external_job,
            job_description=payload.job_description,
            job_title=payload.job_title or "",
            company_name=payload.company_name or "",
            resume_text=resume_text,
            confirmed_skills=skill_records,
            preferences=preferences,
            profile_context=profile_context,
        )
        logger.info("External job analysis completed", extra={"description_length": len(payload.job_description), "extraction_source": result.get("metadata", {}).get("extraction_source")})
        return result
    except HTTPException:
        raise
    except MatchingModelUnavailable as exc:
        raise HTTPException(status_code=503, detail="The matching model is temporarily unavailable. Please try again.") from exc
    except ValueError as exc:
        if str(exc) == "PROFILE_REQUIRED":
            raise HTTPException(status_code=409, detail={"code": "PROFILE_REQUIRED", "message": "Upload or complete your resume before analyzing an external job."}) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("External job analysis failed without logging candidate content")
        raise HTTPException(status_code=500, detail="External job analysis failed. Please try again.") from exc


@app.get("/api/candidate/external-jobs/saved")
def list_saved_external_jobs(authorization: Annotated[Optional[str], Header()] = None) -> list[dict]:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    query = urllib.parse.urlencode({
        "user_id": f"eq.{user_id}",
        "select": "id,job_title,company_name,match_percentage,result_json,created_at",
        "order": "created_at.desc",
        "limit": str(MAX_SAVED_EXTERNAL_JOB_MATCHES),
    })
    rows = _supabase_request(f"/rest/v1/candidate_external_job_matches?{query}", service_role=True)
    return [_saved_external_job_response(row) for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


@app.post("/api/candidate/external-jobs/saved")
def save_external_job(
    payload: ExternalJobSaveRequest,
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")

    compact = _compact_external_job_analysis(payload.analysis)
    fingerprint = _external_job_analysis_fingerprint(compact)
    job = compact["job"]
    match_percentage = compact["match"].get("match_percentage", 0)
    try:
        match_percentage = max(0, min(100, float(match_percentage)))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="The external job match percentage is invalid.") from exc

    duplicate_query = urllib.parse.urlencode({
        "user_id": f"eq.{user_id}",
        "analysis_fingerprint": f"eq.{fingerprint}",
        "select": "id,job_title,company_name,match_percentage,result_json,created_at",
        "limit": "1",
    })
    duplicate_rows = _supabase_request(f"/rest/v1/candidate_external_job_matches?{duplicate_query}", service_role=True)
    if isinstance(duplicate_rows, list) and duplicate_rows and isinstance(duplicate_rows[0], dict):
        return _saved_external_job_response(duplicate_rows[0])

    count_query = urllib.parse.urlencode({
        "user_id": f"eq.{user_id}",
        "select": "id",
        "limit": str(MAX_SAVED_EXTERNAL_JOB_MATCHES),
    })
    existing = _supabase_request(f"/rest/v1/candidate_external_job_matches?{count_query}", service_role=True)
    if isinstance(existing, list) and len(existing) >= MAX_SAVED_EXTERNAL_JOB_MATCHES:
        raise HTTPException(status_code=409, detail={
            "code": "EXTERNAL_JOB_MATCH_LIMIT_REACHED",
            "message": "You can save up to 5 external job match results. Delete one before saving another.",
            "limit": MAX_SAVED_EXTERNAL_JOB_MATCHES,
        })

    body = {
        "user_id": user_id,
        "job_title": job["title"],
        "company_name": job["company_name"] or None,
        "match_percentage": round(match_percentage, 2),
        "result_json": compact,
        "analysis_fingerprint": fingerprint,
    }
    try:
        rows = _supabase_request(
            "/rest/v1/candidate_external_job_matches",
            method="POST",
            service_role=True,
            body=body,
            prefer="return=representation",
        )
    except HTTPException as exc:
        if "MAX_EXTERNAL_JOB_MATCHES_REACHED" in str(exc.detail):
            raise HTTPException(status_code=409, detail={
                "code": "EXTERNAL_JOB_MATCH_LIMIT_REACHED",
                "message": "You can save up to 5 external job match results. Delete one before saving another.",
                "limit": MAX_SAVED_EXTERNAL_JOB_MATCHES,
            }) from exc
        raise
    row = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None
    if not row:
        raise HTTPException(status_code=502, detail="Supabase did not return the saved external job match.")
    return _saved_external_job_response(row)


@app.post("/api/candidate/external-jobs/report")
def download_external_job_report(
    payload: ExternalJobSaveRequest,
    authorization: Annotated[Optional[str], Header()] = None,
):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    report, filename = _build_external_job_report(payload.analysis)
    return StreamingResponse(
        report,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/api/candidate/external-jobs/saved/{saved_match_id}")
def delete_saved_external_job(saved_match_id: str, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    query = urllib.parse.urlencode({
        "id": f"eq.{saved_match_id}",
        "user_id": f"eq.{user_id}",
        "select": "id",
    })
    rows = _supabase_request(
        f"/rest/v1/candidate_external_job_matches?{query}",
        method="DELETE",
        service_role=True,
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Saved external job match was not found.")
    return {"deleted": True, "id": saved_match_id}


@app.get("/api/candidate/notifications")
def list_candidate_notifications(authorization: Annotated[Optional[str], Header()] = None) -> list[dict]:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    query = urllib.parse.urlencode({
        "recipient_user_id": f"eq.{user_id}",
        "select": "id,event_type,application_id,title,message,created_at,read_at",
        "order": "created_at.desc",
        "limit": "30",
    })
    rows = _supabase_request(f"/rest/v1/candidate_notifications?{query}", service_role=True)
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


@app.patch("/api/candidate/notifications/read-all")
def mark_all_candidate_notifications_read(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    query = urllib.parse.urlencode({
        "recipient_user_id": f"eq.{user_id}",
        "read_at": "is.null",
    })
    rows = _supabase_request(
        f"/rest/v1/candidate_notifications?{query}",
        method="PATCH",
        service_role=True,
        body={"read_at": _safe_timestamp()},
        prefer="return=representation",
    )
    return {"updated": len(rows) if isinstance(rows, list) else 0}


@app.patch("/api/candidate/notifications/{notification_id}/read")
def mark_candidate_notification_read(notification_id: str, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    query = urllib.parse.urlencode({
        "id": f"eq.{notification_id}",
        "recipient_user_id": f"eq.{user_id}",
        "select": "id,read_at",
    })
    rows = _supabase_request(
        f"/rest/v1/candidate_notifications?{query}",
        method="PATCH",
        service_role=True,
        body={"read_at": _safe_timestamp()},
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Notification was not found.")
    return rows[0]


@app.post("/api/matches/from-resume")
async def match_from_resume(
    file: Annotated[UploadFile, File()],
    background_tasks: BackgroundTasks,
    authorization: Annotated[Optional[str], Header()] = None,
    preferences: str = Form("{}"),
    confirmed_skills: str = Form("[]"),
    resume_text_for_matching: str = Form(""),
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
        normalized_resume_text = resume_text_for_matching.strip()
        if normalized_resume_text:
            # The UI already analyzed this file before the skills-review step.
            # Reuse that normalized text instead of parsing the same PDF/DOCX a
            # second time when the report is generated.
            result = await run_in_threadpool(
                match_text_to_jobs,
                resume_text=normalized_resume_text,
                filename=file.filename,
                preferences=preferences_payload,
                confirmed_skills=confirmed_skill_records or None,
            )
        else:
            file_bytes = await file.read()
            if not file_bytes:
                raise HTTPException(status_code=400, detail="Uploaded resume file is empty.")

            result = await run_in_threadpool(
                match_resume_to_jobs,
                file_bytes=file_bytes,
                filename=file.filename,
                preferences=preferences_payload,
                # An empty list means none were sent, not that the user has no skills.
                confirmed_skills=confirmed_skill_records or None,
            )
        if user_mode in {"registered", "logged_in"}:
            # Saving to Supabase takes several round trips; do it after the report is
            # sent. Access control trims the result in place, so sync a full copy.
            background_tasks.add_task(
                _sync_match_results_in_background,
                authorization=authorization,
                result=copy.deepcopy(result),
                filename=file.filename,
                preferences=preferences_payload,
            )
        normalized_user_mode = user_mode if user_mode in {"guest", "registered", "logged_in"} else "guest"
        normalized_view_mode = view_mode if view_mode in {"initial", "full"} else "initial"
        return _apply_report_access_control(result, normalized_user_mode, normalized_view_mode)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except MatchingModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.exception("Resume matching service failed")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Resume job matching failed")
        raise HTTPException(
            status_code=500,
            detail="We could not generate matches right now. Please try again or upload a clearer resume.",
        ) from exc
