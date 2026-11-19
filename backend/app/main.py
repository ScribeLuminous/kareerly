from __future__ import annotations

import json
import logging
import base64
import copy
import hashlib
import hmac
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
from zoneinfo import ZoneInfo

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from docx import Document
from docx.shared import Inches, Pt
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

from .models.schemas import ExternalJobAnalysisRequest, ExternalJobSaveRequest, ResumeSummaryRequest, RunMatchesRequest, SkillGapsRequest
from .services.admin_stats import summarize_match_feedback
from .services.job_list import list_available_jobs
from .services.supabase_jobs import canonical_employment_type, canonical_job_level, canonical_work_setup, catalogue_counts, split_job_sections
from .services.bi_encoder_service import MODEL_ID, get_bi_encoder
from .services.bi_encoder_service import model_path as bi_encoder_model_path
from .services.external_job_analysis import analyze_external_job
from .services.skill_variants import load_skill_variants
from .services.ph_regions import region_name, region_options, resolve_single_region, regions_in_location
from .services.matching_service import MatchingModelUnavailable, analyze_candidate_job_match, career_area_skills, find_catalogue_job, current_skill_extractor, expire_stale_reference_jobs, job_level_thresholds, learning_by_skill_for, refresh_jobs_cache_for, skill_id_equivalents, prioritize_skill_gaps, run_matching, warm_matching_caches
from .services import skill_gap_config
from .services.resume_summary import build_resume_summary
from .services.education import normalize_education_level
from .services.credential_links import check_credential_link
from .services.skill_gap_aggregation import build_gap_report
from .services.resume_analyzer import analyze_resume_bytes
from .services.doc_conversion import antiword_path, soffice_path
from .services import psoc_reference
from .services.ocr import ocr_available
from .services.resume_parser import (
    MAX_RESUME_BYTES,
    RESUME_PARSER_VERSION,
    SUPPORTED_RESUME_EXTENSIONS,
    ResumeFileError,
    resume_extension,
)
from .learning import ranking_training, skill_discovery
from .learning.feedback import (
    HISTORY_ROWS_SEARCHED,
    HISTORY_SELECT,
    JOB_SOURCES,
    VOTES,
    fallback_match_context,
    find_match_context,
)
from .learning.jobs import run_all as run_learning_jobs
from .learning.ranking_model import cached_ranker_status, clear_ranker_cache
from .learning.supabase_client import SupabaseError, SupabaseRest
from .rate_limit import RateLimitMiddleware


BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


# The interactive API docs list every endpoint and schema, so they are off
# unless KAREERLY_API_DOCS=1 (backend/dev_server.sh sets it for local work).
API_DOCS_ENABLED = os.getenv("KAREERLY_API_DOCS", "0").strip().lower() in {"1", "true", "yes"}
app = FastAPI(
    title="Kareerly ML Backend",
    docs_url="/docs" if API_DOCS_ENABLED else None,
    redoc_url="/redoc" if API_DOCS_ENABLED else None,
    openapi_url="/openapi.json" if API_DOCS_ENABLED else None,
)

# Reported by /api/health/config and /api/health/jobs, so a site admin can see
# which backend code is deployed. Change it when the backend changes.
BACKEND_VERSION = "2026.11.19-p4-cleanup"
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

# Innermost, so CORS and compression apply to its 429 answers too (rate_limit.py).
app.add_middleware(RateLimitMiddleware)

# Match reports (~1.4 MB) and the job list (~2 MB) are JSON that compresses to
# under a tenth of its size; browsers send Accept-Encoding: gzip on their own.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_CONFIRMED_SKILLS = 20
MAX_SAVED_EXTERNAL_JOB_MATCHES = 5
MAX_SAVED_EXTERNAL_JOB_RESULT_BYTES = 120_000
SUPABASE_URL = os.getenv("SUPABASE_URL", os.getenv("VITE_SUPABASE_URL", "")).rstrip("/")
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

# "request" opens a conversation (employer only); "message" needs the
# candidate's acceptance. Nothing else is accepted.
MESSAGE_KINDS = {"message", "request"}

UNREADABLE_MESSAGE_TEXT = "This message could not be shown. Please contact Kareerly support if this keeps happening."

# Shown wherever a match percentage leaves the app (reports and downloads).
MATCH_SCORE_DISCLAIMER = (
    "The match percentage shows how closely the candidate's skills and experience line up with this job. "
    "It is not a probability of being hired; the employer makes the hiring decision."
)


CLOSED_APPLICATION_STATUSES = {"hired", "rejected", "withdrawn"}


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


class JobApplicationRequest(BaseModel):
    job_id: str
    job_source: str = "employer"


class MatchFeedbackRequest(BaseModel):
    job_id: str
    job_source: str = "internal"
    vote: str
    # What the candidate was shown; only used when the job is no longer in a recent saved run.
    match_category: Optional[str] = None
    match_score: Optional[float] = None


class LearningRunRequest(BaseModel):
    job: str = "all"
    dry_run: bool = False


class RankingRollbackRequest(BaseModel):
    target_version: Optional[str] = None


class SkillCandidateReviewRequest(BaseModel):
    action: str
    skill_id: Optional[str] = None
    label: Optional[str] = None
    category_id: Optional[str] = None
    note: Optional[str] = None


class AdminResetApplicationRequest(BaseModel):
    application_id: str


class AdminUserUpdateRequest(BaseModel):
    user_id: str
    email: Optional[str] = None
    password: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[str] = None


class AdminJobUpdateRequest(BaseModel):
    job_id: str
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    posting_status: Optional[str] = None
    psoc_unit_code: Optional[str] = None
    # True hides the post from the public job list and matching (migration 20261117100000).
    is_test_posting: Optional[bool] = None


class AdminApplicationUpdateRequest(BaseModel):
    application_id: str
    status: str


class AdminSuspendRequest(BaseModel):
    suspended: bool


class AdminReviewRequest(BaseModel):
    status: str
    note: Optional[str] = None


class AdminDecisionRequest(BaseModel):
    note: Optional[str] = None


class DeletionRequestCreate(BaseModel):
    reason: Optional[str] = None


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
    """Latest block/unblock per participant. Only a missing table (migration not
    applied) degrades to unblocked; any other failure is an error, so a block is
    never ignored because the check could not run."""
    query = urllib.parse.urlencode({
        "application_id": f"eq.{application_id}",
        "action": "in.(block,unblock,report)",
        "select": "actor_user_id,actor_role,action,created_at",
        "order": "created_at.desc",
        "limit": "200",
    })
    try:
        rows = _supabase_request(f"/rest/v1/message_moderation_actions?{query}", service_role=True)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise HTTPException(status_code=503, detail="Unable to check this conversation's block status. Please try again.") from exc
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


def _application_message_request_state(application_id: str) -> str | None:
    """The application's message request state ('none', 'pending', 'accepted',
    'declined' or 'ignored'); None when the application does not exist."""
    query = urllib.parse.urlencode({"id": f"eq.{application_id}", "select": "message_request_state", "limit": "1"})
    rows = _supabase_request(f"/rest/v1/job_applications?{query}", service_role=True)
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        return None
    return str(rows[0].get("message_request_state") or "none")


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
            # Keep the message in the thread so a gap is visible, not silently skipped.
            output.append({**row, "message_text": UNREADABLE_MESSAGE_TEXT, "unreadable": True})
            continue
        output.append({**row, "message_text": plaintext})
    return output


@app.post("/api/messages")
def create_application_message(payload: MessageCreateRequest, authorization: Annotated[Optional[str], Header()] = None):
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    kind = (payload.message_kind or "message").strip().lower()
    if kind not in MESSAGE_KINDS:
        raise HTTPException(status_code=400, detail="Message kind must be 'message' or 'request'.")
    text = payload.message_text.strip()
    if not text or len(text) > 4000:
        raise HTTPException(status_code=400, detail="Message must contain between 1 and 4000 characters.")
    # Consent is checked for every message: one request while none is open,
    # then nothing more until the candidate accepts it.
    request_state = _application_message_request_state(payload.application_id)
    if request_state is None:
        raise HTTPException(status_code=404, detail="Application was not found.")
    if kind == "request" and request_state != "none":
        raise HTTPException(status_code=409, detail="A message request was already sent for this application.")
    try:
        thread = _get_authorized_message_thread(payload.application_id, user_id)
    except HTTPException as exc:
        if kind != "request" or exc.status_code != 404:
            raise
        thread = _create_employer_message_thread(payload.application_id, user_id)
    sender_role = str(thread["participant_role"])
    if _message_block_state(payload.application_id, user_id)["blocked"]:
        raise HTTPException(status_code=403, detail="Messaging is blocked for this conversation.")
    if kind == "request" and sender_role != "employer":
        raise HTTPException(status_code=403, detail="Only the employer can initiate a message request.")
    if kind == "message" and request_state != "accepted":
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
    if kind == "request":
        # Recorded here, not by the employer's browser: clients cannot write
        # an application's request state (see migration 20261117090000).
        state_filter = urllib.parse.urlencode({"id": f"eq.{payload.application_id}", "message_request_state": "eq.none"})
        _supabase_request(
            f"/rest/v1/job_applications?{state_filter}", method="PATCH", service_role=True,
            body={"message_request_state": "pending", "updated_at": _safe_timestamp()},
        )
        return {**row, "message_text": text, "message_request_state": "pending"}
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

    app_query = urllib.parse.urlencode({"id": f"eq.{payload.application_id}", "select": "id,job_id,status", "limit": "1"})
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

    updated = _set_application_stage_as_employer(authorization, payload.application_id, status, payload.rejection_reason)
    if updated is None:
        # Databases without the structured-evaluation migration: update directly,
        # with the same rule as set_application_stage. A withdrawn, hired or
        # rejected application is closed; the update is also conditional on the
        # status read above, so a withdrawal made meanwhile is not overwritten.
        current_status = str(application.get("status") or "").lower()
        if current_status in CLOSED_APPLICATION_STATUSES:
            raise HTTPException(status_code=409, detail="This application is closed and cannot change stage.")
        body = {"status": status, "updated_at": _safe_timestamp()}
        if status == "rejected":
            body["rejection_reason"] = payload.rejection_reason.strip()
        update_filters = {"id": f"eq.{payload.application_id}"}
        if current_status:
            update_filters["status"] = f"eq.{current_status}"
        update_query = urllib.parse.urlencode(update_filters)
        updated = _supabase_request(f"/rest/v1/job_applications?{update_query}", method="PATCH", service_role=True, body=body, prefer="return=representation")
        if not isinstance(updated, list) or not updated:
            raise HTTPException(status_code=409, detail="This application changed while you were updating it. Reload and try again.")
    if status == "rejected":
        _supabase_request(f"/rest/v1/message_threads?application_id=eq.{urllib.parse.quote(payload.application_id, safe='')}", method="PATCH", service_role=True, body={"status": "closed"})
    return {"application": updated[0] if isinstance(updated, list) and updated else updated}


DOCUMENT_REVEAL_STATUSES = {"interviewing", "hired"}


@app.get("/api/employer/applications/{application_id}/documents")
def get_employer_application_documents(application_id: str, authorization: Annotated[Optional[str], Header()] = None):
    """The resume and portfolio a candidate chose to share with this employer.
    Available once the application reaches Interviewing, the same point the
    candidate's identity is revealed."""
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    app_query = urllib.parse.urlencode({"id": f"eq.{application_id}", "select": "id,job_id,job_source,status", "limit": "1"})
    app_rows = _supabase_request(f"/rest/v1/job_applications?{app_query}", service_role=True)
    application = app_rows[0] if isinstance(app_rows, list) and app_rows else None
    if not isinstance(application, dict) or application.get("job_source") != "employer":
        raise HTTPException(status_code=404, detail="Application was not found.")
    employer_query = urllib.parse.urlencode({"user_id": f"eq.{user_id}", "select": "id", "limit": "1"})
    employer_rows = _supabase_request(f"/rest/v1/employer_profiles?{employer_query}", service_role=True)
    employer = employer_rows[0] if isinstance(employer_rows, list) and employer_rows else None
    if not isinstance(employer, dict):
        raise HTTPException(status_code=404, detail="Employer profile was not found.")
    owner_query = urllib.parse.urlencode({"job_id": f"eq.{application.get('job_id')}", "employer_id": f"eq.{employer['id']}", "select": "id", "limit": "1"})
    owned = _supabase_request(f"/rest/v1/employer_job_posts?{owner_query}", service_role=True)
    if not isinstance(owned, list) or not owned:
        raise HTTPException(status_code=403, detail="This application does not belong to your employer account.")

    status = str(application.get("status") or "").lower()
    if status not in DOCUMENT_REVEAL_STATUSES:
        return {"available": False, "reason": "stage", "resume": None, "portfolio_url": None}

    doc_query = urllib.parse.urlencode({"application_id": f"eq.{application_id}", "select": "resume_id,share_resume,portfolio_url", "limit": "1"})
    doc_rows = _supabase_request(f"/rest/v1/application_shared_documents?{doc_query}", service_role=True)
    shared = doc_rows[0] if isinstance(doc_rows, list) and doc_rows and isinstance(doc_rows[0], dict) else {}

    resume = None
    if shared.get("share_resume") and shared.get("resume_id"):
        resume_rows = _rest_rows("resumes", {"id": f"eq.{shared['resume_id']}", "select": "id,original_filename,file_mime_type,file_size_bytes,storage_bucket,storage_path", "limit": "1"})
        row = resume_rows[0] if resume_rows else None
        if row and row.get("storage_bucket") and row.get("storage_path"):
            try:
                signed = _supabase_request(
                    f"/storage/v1/object/sign/{_quote(row['storage_bucket'])}/{urllib.parse.quote(str(row['storage_path']))}",
                    method="POST", service_role=True, body={"expiresIn": 300},
                )
            except HTTPException as exc:
                if exc.status_code not in {400, 404}:
                    raise
                signed = None
            path = (signed.get("signedURL") or signed.get("signedUrl")) if isinstance(signed, dict) else None
            if path:
                resume = {
                    "file_name": row.get("original_filename") or "Resume",
                    "mime_type": row.get("file_mime_type"),
                    "size_bytes": row.get("file_size_bytes"),
                    "download_url": path if path.startswith("http") else f"{SUPABASE_URL}/storage/v1{path}",
                }
    return {"available": True, "reason": None, "resume": resume, "portfolio_url": shared.get("portfolio_url") or None}


class CredentialLinkRequest(BaseModel):
    url: str
    candidate_name: str = ""


@app.post("/api/candidate/credential-links/check")
def check_candidate_credential_link(payload: CredentialLinkRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    """Cleans up a certificate link and, for Credly, checks that it is a real badge (services/credential_links.py)."""
    if not _get_authenticated_user_id(authorization):
        raise HTTPException(status_code=401, detail="Authentication is required.")
    return check_credential_link(payload.url, candidate_name=payload.candidate_name)


def _set_application_stage_as_employer(authorization: str | None, application_id: str, status: str, reason: Optional[str]) -> object | None:
    """Change the stage through ``set_application_stage`` with the employer's own
    token, so the audit trail records who decided. Returns None when the
    function is not deployed yet."""
    token = (authorization or "").split(" ", 1)[1].strip() if authorization and " " in authorization else ""
    try:
        return _supabase_request(
            "/rest/v1/rpc/set_application_stage", method="POST", token=token,
            body={"target_application_id": application_id, "next_status": status, "reason": (reason or "").strip() or None},
        )
    except HTTPException as exc:
        if exc.status_code == 404 or "PGRST202" in str(exc.detail):
            return None
        raise


# PostgreSQL constraint errors quote the offending row values, for example
# 'Key (email)=(someone@example.com) already exists.'. Those values can be
# another user's email, so they never reach API responses or logs.
_CONSTRAINT_VALUE_PATTERN = re.compile(r"(Key \([^)]*\)=\().*?(\)\s+(?:already exists|is not present|is still referenced))")


def _redact_constraint_values(detail: str) -> str:
    return _CONSTRAINT_VALUE_PATTERN.sub(r"\1[redacted]\2", detail)


class SupabaseRequestError(HTTPException):
    """A Supabase error response. ``detail`` keeps Supabase's (redacted) body
    for the code that inspects it (for example PGRST202 or a named limit);
    when one reaches the client, only supabase_error_message() is sent."""


# SQLSTATEs Kareerly's own database functions raise with a message written for
# the user ("This application is closed and cannot change stage.").
_USER_FACING_SQLSTATES = {"22023", "P0001", "P0002", "28000", "42501"}
_GENERIC_SUPABASE_MESSAGES = {
    400: "The request could not be completed. Check the details and try again.",
    401: "Your session has expired. Please log in again.",
    403: "You do not have access to this.",
    404: "This was not found. It may have been removed.",
    409: "This conflicts with a change made meanwhile. Reload and try again.",
    429: "Too many requests. Please wait a moment and try again.",
}


def supabase_error_message(status_code: int, detail: object) -> str:
    """What a client sees for a Supabase error: the message of an error one of
    Kareerly's functions raised on purpose, otherwise a plain message for the
    status. Table, column, constraint and policy names never leave the API."""
    try:
        body = json.loads(detail) if isinstance(detail, str) else detail
    except ValueError:
        body = None
    if isinstance(body, dict):
        code = str(body.get("code") or "")
        message = str(body.get("message") or "").strip()
        internal = message.lower().startswith(("permission denied for", "new row violates", "duplicate key", "relation "))
        if code in _USER_FACING_SQLSTATES and message and not internal and len(message) <= 300:
            return message
    if status_code >= 500:
        return "The service is temporarily unavailable. Please try again."
    return _GENERIC_SUPABASE_MESSAGES.get(status_code, _GENERIC_SUPABASE_MESSAGES[400])


@app.exception_handler(SupabaseRequestError)
async def _supabase_error_response(request, exc: SupabaseRequestError):
    logger.warning("Supabase request failed (%s) for %s: %s", exc.status_code, request.url.path, str(exc.detail)[:500])
    return JSONResponse(status_code=exc.status_code, content={"detail": supabase_error_message(exc.status_code, exc.detail)})


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
        detail = _redact_constraint_values(exc.read().decode("utf-8", errors="ignore")) or exc.reason
        raise SupabaseRequestError(status_code=exc.code, detail=detail) from exc
    except urllib.error.URLError as exc:
        logger.warning("Unable to reach Supabase: %s", exc.reason)
        raise HTTPException(status_code=503, detail="Account services are temporarily unavailable. Please try again shortly.") from exc

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
    except HTTPException as exc:
        # Only a rejected token means "not signed in". Missing Supabase config or an
        # unreachable Supabase must surface as-is instead of posing as a logged-out user.
        if exc.status_code in {400, 401, 403}:
            return None
        raise

    if not isinstance(auth_user, dict) or not auth_user.get("id"):
        return None

    return str(auth_user["id"])


def _safe_timestamp() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
# The sign-up rule (frontend/src/lib/passwordRules.ts), for passwords an admin sets.
STRONG_PASSWORD = re.compile(r"(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{14,}")
STRONG_PASSWORD_MESSAGE = "Use at least 14 characters, with an uppercase letter, a number and a symbol."


def _confirmed_auth_email(user_id: str, profile_email: object, auth_user: object) -> str:
    """The account's confirmed login email. profiles.email follows Supabase
    Auth: after the user confirms an email change, the next settings read
    copies the new address into their profile."""
    current = str(profile_email or "")
    auth_email = str(auth_user.get("email") or "") if isinstance(auth_user, dict) else ""
    if auth_email and auth_email.lower() != current.lower():
        _supabase_request(
            f"/rest/v1/profiles?id=eq.{urllib.parse.quote(user_id, safe='')}", method="PATCH", service_role=True,
            body={"email": auth_email, "updated_at": _safe_timestamp()},
        )
        return auth_email
    return current


def _pending_email(auth_user: object) -> str | None:
    """A requested login email still waiting for confirmation, if any."""
    value = auth_user.get("new_email") if isinstance(auth_user, dict) else None
    return str(value) if value else None


def _request_email_change(authorization: str | None, new_email: str) -> None:
    """Ask Supabase Auth to change the signed-in user's login email.

    Sent with the user's own session, so Supabase emails a confirmation link
    and the address changes only once it is confirmed. The service role is
    never used here: an admin update would switch the login email at once,
    without proving the user owns the new address.
    """
    token = (authorization or "").split(" ", 1)[1].strip() if authorization and " " in authorization else ""
    try:
        _supabase_request("/auth/v1/user", method="PUT", token=token, body={"email": new_email})
    except HTTPException as exc:
        if exc.status_code == 429:
            raise HTTPException(status_code=429, detail="Too many email change requests. Please wait a few minutes and try again.") from exc
        if exc.status_code in {400, 422}:
            raise HTTPException(status_code=400, detail="That email address can't be used. Check it, or use a different address.") from exc
        raise


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
        "account_email": _confirmed_auth_email(user_id, user.get("email"), auth_user),
        "pending_email": _pending_email(auth_user),
        "first_name": user.get("first_name"), "last_name": user.get("last_name"),
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
    if "business_email" in body and body["business_email"] and not EMAIL_PATTERN.fullmatch(body["business_email"]):
        raise HTTPException(status_code=400, detail="Enter a valid contact email address.")
    account_email = str(account_fields.get("account_email") or "").strip().lower()
    if account_email and not EMAIL_PATTERN.fullmatch(account_email):
        raise HTTPException(status_code=400, detail="Enter a valid account email address.")
    email_change = bool(account_email) and account_email != str(profile.get("account_email") or "").lower()
    profile_body = {key: str(value or "").strip() for key, value in account_fields.items() if key in {"first_name", "last_name"}}
    metadata = {key: value for key, value in body.items() if key != "updated_at"}
    if profile_body:
        profile_body["updated_at"] = _safe_timestamp()
        _supabase_request(f"/rest/v1/profiles?id=eq.{urllib.parse.quote(user_id, safe='')}", method="PATCH", service_role=True, body=profile_body)
        metadata.update({"first_name": profile_body.get("first_name"), "last_name": profile_body.get("last_name"), "role": "employer"})
        _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", method="PUT", service_role=True, body={"user_metadata": metadata})
    elif metadata:
        _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", method="PUT", service_role=True, body={"user_metadata": {**metadata, "role": "employer"}})
    if email_change:
        # The login email changes only after the confirmation link is opened.
        _request_email_change(authorization, account_email)
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
    user_query = urllib.parse.urlencode({"id": f"eq.{user_id}", "select": "first_name,last_name,email,role", "limit": "1"})
    users = _supabase_request(f"/rest/v1/profiles?{user_query}", service_role=True)
    user = users[0] if isinstance(users, list) and users else None
    if not isinstance(user, dict):
        raise HTTPException(status_code=404, detail="Candidate profile was not found.")
    # Saving these settings writes candidate account data, so only candidate
    # accounts may use them (an employer's role and profile stay untouched).
    if str(user.get("role") or "") != "candidate":
        raise HTTPException(status_code=403, detail="These settings are for job seeker accounts.")
    candidate_query = urllib.parse.urlencode({"user_id": f"eq.{user_id}", "select": "public_id,location", "limit": "1"})
    candidates = _supabase_request(f"/rest/v1/candidate_profiles?{candidate_query}", service_role=True)
    candidate = candidates[0] if isinstance(candidates, list) and candidates else {}
    auth_user = _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", service_role=True)
    metadata = auth_user.get("user_metadata") if isinstance(auth_user, dict) and isinstance(auth_user.get("user_metadata"), dict) else {}
    return {
        "full_name": f"{user.get('first_name') or ''} {user.get('last_name') or ''}".strip(),
        "email": _confirmed_auth_email(user_id, user.get("email"), auth_user),
        "pending_email": _pending_email(auth_user),
        "public_id": candidate.get("public_id"), "birthday": metadata.get("birthday"), "location": candidate.get("location") or metadata.get("location"),
        "contact_number": metadata.get("contact_number"), "address": metadata.get("address"),
        # Older accounts may hold free text; it reads back as the matching list entry.
        "highest_educational_attainment": normalize_education_level(metadata.get("highest_educational_attainment")),
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
    if not EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    email_change = email != str(current.get("email") or "").lower()
    attainment_input = str(values.get("highest_educational_attainment") or "").strip()
    attainment = normalize_education_level(attainment_input)
    if attainment_input and not attainment:
        raise HTTPException(status_code=400, detail="Choose your highest educational attainment from the list.")
    values["highest_educational_attainment"] = attainment
    name_parts = full_name.split(None, 1)
    first_name, last_name = name_parts[0], name_parts[1] if len(name_parts) > 1 else ""
    profile_body = {"first_name": first_name, "last_name": last_name, "updated_at": _safe_timestamp()}
    _supabase_request(f"/rest/v1/profiles?id=eq.{urllib.parse.quote(user_id, safe='')}", method="PATCH", service_role=True, body=profile_body)
    metadata = {
        "first_name": first_name, "last_name": last_name, "role": "candidate", "birthday": values.get("birthday") or None,
        "location": values.get("location") or "", "contact_number": values.get("contact_number") or "", "address": values.get("address") or "",
        "highest_educational_attainment": values.get("highest_educational_attainment") or "", "degree_program": values.get("degree_program") or "",
        "school_university": values.get("school_university") or "", "year_graduated": values.get("year_graduated") or "",
    }
    _supabase_request(f"/auth/v1/admin/users/{urllib.parse.quote(user_id, safe='')}", method="PUT", service_role=True, body={"user_metadata": metadata})
    candidate_body = {"user_id": user_id, "location": values.get("location") or None, "updated_at": _safe_timestamp()}
    query = urllib.parse.urlencode({"on_conflict": "user_id"})
    _supabase_request(f"/rest/v1/candidate_profiles?{query}", method="POST", service_role=True, body=candidate_body, prefer="resolution=merge-duplicates")
    if email_change:
        # The login email changes only after the confirmation link is opened.
        _request_email_change(authorization, email)
    return _require_candidate_settings(user_id)


# The values candidate_profiles.preferred_employment_type accepts.
EMPLOYMENT_TYPE_PREFERENCES = {"full-time", "part-time", "contract", "temporary", "internship", "any"}


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
    # Sent only by clients that ask the region question, so older clients keep
    # syncing while the region columns' migration has not run.
    if preferences.get("location_scope"):
        candidate_profile_payload["preferred_location_scope"] = str(preferences.get("location_scope")) or None
        candidate_profile_payload["preferred_region"] = str(preferences.get("region") or "") or None
    employment_type = str(preferences.get("employment_type") or "").strip().lower()
    if employment_type in EMPLOYMENT_TYPE_PREFERENCES:
        candidate_profile_payload["preferred_employment_type"] = employment_type
    try:
        _supabase_request(
            "/rest/v1/candidate_profiles?on_conflict=user_id",
            method="POST",
            token=access_token,
            body=candidate_profile_payload,
            prefer="resolution=merge-duplicates",
        )
    except HTTPException as exc:
        # The employment type column comes from a migration; until it has run,
        # keep saving the other answers.
        if "preferred_employment_type" not in candidate_profile_payload or "preferred_employment_type" not in str(exc.detail):
            raise
        candidate_profile_payload.pop("preferred_employment_type")
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
            key: (normalize_education_level(education.get(key)) if key == "highest_educational_attainment" else str(education.get(key) or ""))
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
                # A new upload refreshes the skill's details only; the candidate's
                # own progress (status, percent, chosen course) is never reset.
                _supabase_request(
                    f"/rest/v1/candidate_skill_progress?{progress_query}",
                    method="PATCH",
                    token=access_token,
                    body={key: value for key, value in payload.items()
                          if key not in {"status", "progress_percent", "selected_resource_id"}},
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


# PostgREST returns at most this many rows per request (the project's max-rows
# setting), whatever limit is asked for. Reading more means paging.
POSTGREST_PAGE_ROWS = 1000


def _rest_rows_all(table: str, params: dict, max_rows: int = 100_000) -> list[dict]:
    """Every matching row, read a page at a time, so totals are not cut at the
    page size (audit DATA-02). Pages are ordered so none overlap or are skipped."""
    rows: list[dict] = []
    query = {**params, "order": params.get("order") or "id.asc"}
    while len(rows) < max_rows:
        page = _rest_rows(table, {**query, "limit": str(POSTGREST_PAGE_ROWS), "offset": str(len(rows))})
        rows.extend(page)
        if len(page) < POSTGREST_PAGE_ROWS:
            break
    return rows[:max_rows]


def _admin_count(table: str) -> int:
    return len(_rest_rows_all(table, {"select": "id"}))


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


def _normalize_removed_skill_ids(raw_skill_ids: object) -> list[str] | None:
    """Skill IDs the candidate removed in Step 2; None when the client sent none."""
    if raw_skill_ids is None:
        return None
    if not isinstance(raw_skill_ids, list):
        raise HTTPException(status_code=400, detail="Removed skill IDs must be a list.")
    return list(dict.fromkeys(
        str(skill_id).strip().upper() for skill_id in raw_skill_ids
        if isinstance(skill_id, str) and str(skill_id).strip()
    ))[:200]


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
    all_closest_matches = result.get("all_closest_matches") or result.get("closest_matches", [])
    limited_fit_now = all_fit_now_matches[:job_limit]
    limited_aspiration = all_aspiration_matches[:job_limit]
    # Gaps of the jobs this report shows, never of jobs cut by the limit.
    limited_gaps = prioritize_skill_gaps(limited_fit_now + limited_aspiration, limit=gap_limit) \
        if limited_fit_now or limited_aspiration else []

    shown_job_ids = {str(item.get("job_id", "")) for item in limited_fit_now + limited_aspiration}
    result["limited_report"] = {
        "fit_now_matches": limited_fit_now,
        "aspiration_matches": limited_aspiration,
        "closest_matches": all_closest_matches[:job_limit],
        "skill_gaps": limited_gaps,
        # Resources for the gaps of the jobs this report shows, in gap order.
        "learning_recommendations": [
            item for item in result.get("learning_recommendations", [])
            if "gap_matches" not in item or any(
                job_id in shown_job_ids for gap in item["gap_matches"] for job_id in gap.get("job_ids", []))
        ][:learning_limit],
        "development_progress": result.get("development_progress", []),
    }

    return result


MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024


def _is_valid_certificate_pdf(filename: str, file_bytes: bytes) -> tuple[bool, str]:
    lower_name = filename.lower().strip()
    if not lower_name.endswith(".pdf"):
        return False, "Only PDF certificate files are accepted."

    if len(file_bytes) > MAX_CERTIFICATE_BYTES:
        return False, "Certificate file must be 5MB or smaller."

    if not file_bytes.startswith(b"%PDF"):
        return False, "Invalid PDF signature detected."

    decoded = file_bytes.decode("latin1", errors="ignore")
    if "/Type /Page" not in decoded:
        return False, "The uploaded file does not appear to be a valid PDF document."

    return True, "PDF file checks passed. Pending Verification: issuer authenticity, completion, and certificate validity have not been verified."


def _search_form(value: str) -> str:
    """Lower case with hyphens and slashes as spaces and "e-mail" as "email"."""
    value = re.sub(r"[\-_/]+", " ", str(value or "").lower())
    value = re.sub(r"\be mail", "email", value)
    return re.sub(r"\s+", " ", value).strip()


@app.get("/api/career-areas")
def get_career_areas() -> dict:
    """Each Step 3 career area's skills and the job-level thresholds, as the job-level lock uses them."""
    return {"areas": career_area_skills(), "level_thresholds": job_level_thresholds()}


@app.get("/api/skills/search")
def search_skills(q: str = "", limit: int = 20) -> dict:
    query = _search_form(q)
    # "MSExcel", "Hub Spot" and "HubSpot" are compared without their spaces too.
    query_compact = re.sub(r"[^a-z0-9+#]", "", query)
    safe_limit = max(1, min(limit, 10))
    seen_ids = set()
    scored_results: list[tuple[int, dict[str, str]]] = []

    def match_alias(alias: str) -> int:
        alias_lower = _search_form(alias)
        if not query:
            return 1
        if alias_lower == query:
            return 100
        if len(query_compact) >= 3 and re.sub(r"[^a-z0-9+#]", "", alias_lower) == query_compact:
            return 95
        if alias_lower.startswith(query):
            return 80
        if re.search(r"(?<![a-z0-9])" + re.escape(query) + r"(?![a-z0-9])", alias_lower):
            return 60
        return 0

    # Upper-case abbreviations ("CS", "VA", "JS") are not row aliases, since
    # resume text matches them only as written; a search for one still finds it.
    duplicate_ids = set(skill_id_equivalents())
    abbreviations: dict[str, list[str]] = {}
    for variant in load_skill_variants():
        abbreviations.setdefault(variant.skill_id, []).append(variant.variant)

    # Includes approved taxonomy additions, so employers and candidates can pick
    # a newly approved skill without a code change. A skill is found by the
    # verified names that identify it everywhere else (skill_resolver.py), not
    # by unreviewed ESCO labels; unreviewed auto-expansion skills are not offered.
    extractor = current_skill_extractor()
    vocabulary = extractor.vocabulary
    for row in extractor.rows:
        skill_name = row.get("skill_name", "").strip()
        skill_id = row.get("skill_id", "")

        if not skill_id or skill_id in seen_ids or not vocabulary.is_active(skill_id.upper()):
            continue
        # Auto-generated copies of a reviewed skill (SK134 of SK001 Python) are
        # one skill in matching, so search lists the reviewed one only.
        if skill_id.upper() in duplicate_ids:
            continue
        preferred_label = skill_name

        aliases = [
            *vocabulary.evidence_names.get(skill_id.upper(), [skill_name]),
            *abbreviations.get(skill_id.upper(), []),
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


    # Every row is scored before ranking: stopping at the first few hits in file
    # order could drop the exact match ("CS" found JavaScript's "CSJS" first).
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
        "backend_version": BACKEND_VERSION,
        "allowed_origins": allowed_origins,
        "model": {
            "id": MODEL_ID,
            "files_present": not missing,
            "missing_files": missing,
            "loaded": get_bi_encoder.cache_info().currsize > 0,
        },
        # Scanned PDFs need OCR and .doc files a converter; without them those
        # uploads get a warning or a request for a text-based PDF or DOCX.
        "resume_readers": {
            "parser_version": RESUME_PARSER_VERSION,
            "ocr": ocr_available(),
            "doc_libreoffice": soffice_path() is not None,
            "doc_antiword": antiword_path() is not None,
        },
        # Local file only; the PSA API is never called while serving requests.
        "psoc_reference": psoc_reference.reference_status(),
        # The feedback ranker the last match run used; fallback_reason says why
        # matching ran on the baseline order (for example model_fetch_failed).
        "ranker": cached_ranker_status(),
    }


@app.get("/api/health/jobs")
def health_jobs() -> dict:
    """Which Supabase project the job list reads, and how many open jobs each
    table shows it. Compare with the counts in the Supabase SQL editor."""
    listed = list_available_jobs()
    list_status = {"total": len(listed), "by_source": {
        "kareerly": sum(1 for job in listed if not job.get("external_job_link_optional")),
        "external_site": sum(1 for job in listed if job.get("external_job_link_optional")),
    }}
    return {"backend_version": BACKEND_VERSION, **catalogue_counts(), "job_list": list_status}


@app.get("/api/admin/overview")
def admin_overview(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_user_id = _require_admin_user(authorization)
    profiles = _admin_select(
        "profiles",
        "id,role,first_name,last_name,email,created_at",
        limit=500,
        order="created_at.desc",
    )
    job_select = "id,job_id,job_title,company_name,psoc_unit_code,posting_status,created_at,updated_at"
    try:
        job_posts = _admin_select("employer_job_posts", job_select, limit=500, order="updated_at.desc")
    except HTTPException as error:
        if error.status_code != 400 or "psoc_unit_code" not in str(error.detail):
            raise
        job_posts = _admin_select("employer_job_posts", job_select.replace("psoc_unit_code,", ""),
                                  limit=500, order="updated_at.desc")
    for job_post in job_posts:
        code = job_post.get("psoc_unit_code")
        occupation = psoc_reference.validate_occupation_code(code) if code else {}
        job_post["psoc_title"] = occupation.get("title", "") if occupation.get("valid") and occupation.get("level") == "unit" else ""
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
    for row in _rest_rows_all("profiles", {"select": "id,role"}):
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
    admin_id = _require_admin_user(authorization)
    user_id = payload.user_id
    quoted = urllib.parse.quote(user_id, safe="")
    body: dict = {}
    profile_body: dict[str, str] = {}
    metadata_changes: dict[str, str] = {}
    if payload.email is not None:
        email = payload.email.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPException(status_code=400, detail="Enter a valid email address.")
        body["email"] = email
        profile_body["email"] = email
    if payload.password is not None:
        if not STRONG_PASSWORD.fullmatch(payload.password):
            raise HTTPException(status_code=400, detail=STRONG_PASSWORD_MESSAGE)
        body["password"] = payload.password
    for field in ("first_name", "last_name"):
        value = getattr(payload, field)
        if value is not None:
            value = value.strip()
            if field == "first_name" and not value:
                raise HTTPException(status_code=400, detail="First name is required.")
            profile_body[field] = value
            metadata_changes[field] = value
    if payload.role is not None:
        if payload.role not in {"candidate", "employer", "admin"}:
            raise HTTPException(status_code=400, detail="Role must be candidate, employer or admin.")
        if user_id == admin_id:
            raise HTTPException(status_code=400, detail="You cannot change your own role.")
        profile_body["role"] = payload.role
        metadata_changes["role"] = payload.role
    if not body and not profile_body:
        raise HTTPException(status_code=400, detail="No user changes were provided.")
    targets = _rest_rows("profiles", {"id": f"eq.{user_id}", "select": "id,role,email", "limit": "1"})
    if not targets:
        raise HTTPException(status_code=404, detail="User was not found.")
    current_role = str(targets[0].get("role") or "")
    role_change = payload.role is not None and payload.role != current_role
    if role_change and current_role == "employer":
        # Access to job posts and their applicants follows the employer profile,
        # not the role, so an employer who still owns posts keeps that access.
        owner_ids = [row["id"] for row in _rest_rows("employer_profiles", {"user_id": f"eq.{user_id}", "select": "id"}) if row.get("id")]
        if owner_ids and _rest_rows("employer_job_posts", {"employer_id": _in_filter(owner_ids), "select": "id", "limit": "1"}):
            raise HTTPException(status_code=409, detail="This employer still owns job posts. Delete or reassign them before changing the role.")
    if metadata_changes:
        auth_user = _supabase_request(f"/auth/v1/admin/users/{quoted}", service_role=True)
        existing = auth_user.get("user_metadata") if isinstance(auth_user, dict) else None
        body["user_metadata"] = {**(existing if isinstance(existing, dict) else {}), **metadata_changes}
    updated = _supabase_request(f"/auth/v1/admin/users/{quoted}", method="PUT", service_role=True, body=body) if body else None
    if profile_body:
        _supabase_request(f"/rest/v1/profiles?id=eq.{quoted}", method="PATCH", service_role=True, body={**profile_body, "updated_at": _safe_timestamp()})
    if role_change:
        # The workspace for the new role needs its profile row, as sign-up creates it.
        if payload.role == "employer":
            _supabase_request("/rest/v1/employer_profiles?on_conflict=user_id", method="POST", service_role=True,
                body={"user_id": user_id, "company_name": "Employer Workspace", "business_email": targets[0].get("email")},
                prefer="resolution=ignore-duplicates")
        elif payload.role == "candidate":
            _supabase_request("/rest/v1/candidate_profiles?on_conflict=user_id", method="POST", service_role=True,
                body={"user_id": user_id}, prefer="resolution=ignore-duplicates")
    return {"user": updated}


@app.patch("/api/admin/jobs")
def admin_update_job(payload: AdminJobUpdateRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    body: dict[str, str | bool | None] = {key: value.strip() for key, value in {
        "job_title": payload.job_title,
        "company_name": payload.company_name,
        "posting_status": payload.posting_status,
    }.items() if value is not None and value.strip()}
    if body.get("posting_status") and body["posting_status"] not in {"active", "draft", "closed"}:
        raise HTTPException(status_code=400, detail="Job status must be active, draft, or closed.")
    if payload.psoc_unit_code is not None:
        code = payload.psoc_unit_code.strip()
        if code:
            occupation = psoc_reference.validate_occupation_code(code)
            if not occupation["valid"] or occupation["level"] != "unit":
                raise HTTPException(status_code=400, detail="Enter a valid four-digit PSOC 2012 unit code.")
        body["psoc_unit_code"] = code or None
    if payload.is_test_posting is not None:
        body["is_test_posting"] = payload.is_test_posting
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


# ---------------------------------------------------------------------------
# Admin: users, resumes, message reports, match quality and account deletion
# ---------------------------------------------------------------------------

ADMIN_PAGE_LIMIT = 100
SUSPEND_DURATION = "876000h"  # Supabase Auth ban length; about 100 years.
REPORT_REVIEW_STATUSES = {"open", "resolved", "dismissed"}
DELETION_REQUEST_STATUSES = {"pending", "approved", "rejected", "cancelled"}
RESUME_TEXT_PREVIEW_CHARS = 20_000


def _quote(value: str) -> str:
    return urllib.parse.quote(str(value), safe="")


def _in_filter(values) -> str:
    return "in.(" + ",".join(sorted({str(value) for value in values if value})) + ")"


def _rest_rows(table: str, params: dict) -> list[dict]:
    rows = _supabase_request(f"/rest/v1/{table}?{urllib.parse.urlencode(params)}", service_role=True)
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _profiles_by_id(user_ids) -> dict[str, dict]:
    ids = [value for value in set(user_ids) if value]
    if not ids:
        return {}
    rows = _rest_rows("profiles", {"id": _in_filter(ids), "select": "id,role,first_name,last_name,email"})
    return {str(row["id"]): row for row in rows}


def _person(profile: dict | None) -> dict | None:
    if not profile:
        return None
    name = f"{profile.get('first_name') or ''} {profile.get('last_name') or ''}".strip()
    return {"id": profile.get("id"), "email": profile.get("email"), "name": name or profile.get("email"), "role": profile.get("role")}


def _search_term(q: str | None) -> str:
    # PostgREST `or` filters use commas, parentheses and * as syntax.
    return re.sub(r"[,()*\\:]", " ", (q or "")).strip()[:100]


def _admin_page(limit: int, offset: int) -> tuple[int, int]:
    return max(1, min(limit, ADMIN_PAGE_LIMIT)), max(0, offset)


def _banned_until_by_user() -> dict[str, str | None]:
    try:
        data = _supabase_request("/auth/v1/admin/users?page=1&per_page=1000", service_role=True)
    except HTTPException as exc:
        logger.warning("Unable to read suspension state from Supabase Auth: %s", exc.detail)
        return {}
    users = data.get("users") if isinstance(data, dict) else data
    return {str(user.get("id")): user.get("banned_until") for user in users or [] if isinstance(user, dict)}


def _is_suspended(banned_until: str | None) -> bool:
    if not banned_until:
        return False
    try:
        until = datetime.fromisoformat(str(banned_until).replace("Z", "+00:00"))
    except ValueError:
        return True
    return until > datetime.now(timezone.utc)


def _require_manageable_user(user_id: str, admin_id: str) -> dict:
    if user_id == admin_id:
        raise HTTPException(status_code=400, detail="You cannot change your own admin account here.")
    rows = _rest_rows("profiles", {"id": f"eq.{user_id}", "select": "id,role,email,first_name,last_name", "limit": "1"})
    if not rows:
        raise HTTPException(status_code=404, detail="User was not found.")
    if rows[0].get("role") == "admin":
        raise HTTPException(status_code=403, detail="Administrator accounts cannot be suspended or deleted from the dashboard.")
    return rows[0]


def _remove_storage_objects(rows: list[dict]) -> None:
    by_bucket: dict[str, list[str]] = {}
    for row in rows:
        if row.get("storage_bucket") and row.get("storage_path"):
            by_bucket.setdefault(str(row["storage_bucket"]), []).append(str(row["storage_path"]))
    for bucket, paths in by_bucket.items():
        try:
            _supabase_request(f"/storage/v1/object/{_quote(bucket)}", method="DELETE", service_role=True, body={"prefixes": paths})
        except HTTPException as exc:
            if exc.status_code != 404:
                raise


def _delete_user_account(user_id: str) -> None:
    """Remove stored resume files, then the auth user; table rows cascade from it."""
    _remove_storage_objects(_rest_rows("resumes", {"user_id": f"eq.{user_id}", "select": "storage_bucket,storage_path"}))
    try:
        _supabase_request(f"/auth/v1/admin/users/{_quote(user_id)}", method="DELETE", service_role=True)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise


@app.get("/api/admin/users")
def admin_list_users(
    role: str = "candidate",
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict:
    _require_admin_user(authorization)
    if role not in {"candidate", "employer", "admin"}:
        raise HTTPException(status_code=400, detail="Role must be candidate, employer or admin.")
    limit, offset = _admin_page(limit, offset)
    params = {
        "role": f"eq.{role}", "select": "id,role,first_name,last_name,email,created_at",
        "order": "created_at.desc", "limit": str(limit + 1), "offset": str(offset),
    }
    term = _search_term(q)
    if term:
        params["or"] = f"(email.ilike.*{term}*,first_name.ilike.*{term}*,last_name.ilike.*{term}*)"
    rows = _rest_rows("profiles", params)
    has_more = len(rows) > limit
    rows = rows[:limit]
    banned = _banned_until_by_user()
    extra: dict[str, dict] = {}
    ids = [row["id"] for row in rows]
    if ids and role == "employer":
        for row in _rest_rows("employer_profiles", {"user_id": _in_filter(ids), "select": "user_id,company_name"}):
            extra[str(row["user_id"])] = {"company_name": row.get("company_name")}
    if ids and role == "candidate":
        counts: dict[str, int] = {}
        for row in _rest_rows_all("resumes", {"user_id": _in_filter(ids), "select": "id,user_id"}):
            counts[str(row["user_id"])] = counts.get(str(row["user_id"]), 0) + 1
        extra = {user_id: {"resume_count": count} for user_id, count in counts.items()}
    pending: set[str] = set()
    if ids:
        try:
            pending = {str(row["user_id"]) for row in _rest_rows(
                "account_deletion_requests", {"user_id": _in_filter(ids), "status": "eq.pending", "select": "user_id"})}
        except HTTPException:
            pass  # The deletion-requests migration has not been applied yet.
    users = [{
        **row,
        **extra.get(str(row["id"]), {}),
        "banned_until": banned.get(str(row["id"])),
        "suspended": _is_suspended(banned.get(str(row["id"]))),
        "deletion_requested": str(row["id"]) in pending,
    } for row in rows]
    return {"users": users, "has_more": has_more, "offset": offset, "limit": limit}


@app.post("/api/admin/users/{user_id}/suspend")
def admin_suspend_user(user_id: str, payload: AdminSuspendRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_id = _require_admin_user(authorization)
    _require_manageable_user(user_id, admin_id)
    body = {"ban_duration": SUSPEND_DURATION if payload.suspended else "none"}
    updated = _supabase_request(f"/auth/v1/admin/users/{_quote(user_id)}", method="PUT", service_role=True, body=body)
    banned_until = updated.get("banned_until") if isinstance(updated, dict) else None
    return {"user_id": user_id, "suspended": payload.suspended, "banned_until": banned_until}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: str, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_id = _require_admin_user(authorization)
    _require_manageable_user(user_id, admin_id)
    try:
        _supabase_request(
            f"/rest/v1/account_deletion_requests?user_id=eq.{_quote(user_id)}&status=eq.pending",
            method="PATCH", service_role=True,
            body={"status": "approved", "reviewed_at": _safe_timestamp(), "reviewed_by": admin_id, "admin_note": "Deleted directly by an administrator."},
        )
    except HTTPException:
        pass  # The deletion-requests migration has not been applied yet.
    _delete_user_account(user_id)
    return {"deleted": True, "user_id": user_id}


RESUME_LIST_SELECT = "id,user_id,original_filename,storage_bucket,storage_path,file_mime_type,file_size_bytes,created_at"


@app.get("/api/admin/resumes")
def admin_list_resumes(
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict:
    _require_admin_user(authorization)
    limit, offset = _admin_page(limit, offset)
    params = {"select": RESUME_LIST_SELECT, "order": "created_at.desc", "limit": str(limit + 1), "offset": str(offset)}
    term = _search_term(q)
    if term:
        owners = _rest_rows("profiles", {
            "select": "id", "limit": "500",
            "or": f"(email.ilike.*{term}*,first_name.ilike.*{term}*,last_name.ilike.*{term}*)",
        })
        if not owners:
            return {"resumes": [], "has_more": False, "offset": offset, "limit": limit}
        params["user_id"] = _in_filter(row["id"] for row in owners)
    rows = _rest_rows("resumes", params)
    has_more = len(rows) > limit
    rows = rows[:limit]
    owners_by_id = _profiles_by_id(row.get("user_id") for row in rows)
    resumes = [{**row, "has_file": bool(row.get("storage_bucket") and row.get("storage_path")),
        "owner": _person(owners_by_id.get(str(row.get("user_id"))))} for row in rows]
    return {"resumes": resumes, "has_more": has_more, "offset": offset, "limit": limit}


def _get_resume(resume_id: str, select: str) -> dict:
    rows = _rest_rows("resumes", {"id": f"eq.{resume_id}", "select": select, "limit": "1"})
    if not rows:
        raise HTTPException(status_code=404, detail="Resume was not found.")
    return rows[0]


@app.get("/api/admin/resumes/{resume_id}")
def admin_view_resume(resume_id: str, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    row = _get_resume(resume_id, f"{RESUME_LIST_SELECT},parsed_text")
    download_url = None
    if row.get("storage_bucket") and row.get("storage_path"):
        try:
            signed = _supabase_request(
                f"/storage/v1/object/sign/{_quote(row['storage_bucket'])}/{urllib.parse.quote(str(row['storage_path']))}",
                method="POST", service_role=True, body={"expiresIn": 300},
            )
        except HTTPException as exc:
            if exc.status_code not in {400, 404}:
                raise
            signed = None
        path = signed.get("signedURL") or signed.get("signedUrl") if isinstance(signed, dict) else None
        if path:
            download_url = path if path.startswith("http") else f"{SUPABASE_URL}/storage/v1{path}"
    text = str(row.pop("parsed_text", None) or "")
    owner = _person(_profiles_by_id([row.get("user_id")]).get(str(row.get("user_id"))))
    return {
        "resume": {**row, "owner": owner, "download_url": download_url,
            "parsed_text": text[:RESUME_TEXT_PREVIEW_CHARS], "parsed_text_truncated": len(text) > RESUME_TEXT_PREVIEW_CHARS},
    }


@app.delete("/api/admin/resumes/{resume_id}")
def admin_delete_resume(resume_id: str, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    row = _get_resume(resume_id, "id,storage_bucket,storage_path")
    _remove_storage_objects([row])
    _supabase_request(f"/rest/v1/resumes?id=eq.{_quote(resume_id)}", method="DELETE", service_role=True)
    return {"deleted": True, "resume_id": resume_id}


def _thread_participants(application_ids) -> dict[str, dict]:
    """Candidate and employer user IDs for each application's message thread."""
    ids = [value for value in set(application_ids) if value]
    if not ids:
        return {}
    threads = _rest_rows("message_threads", {"application_id": _in_filter(ids), "select": "application_id,candidate_id,employer_id"})
    candidate_ids = {str(row.get("candidate_id")) for row in threads if row.get("candidate_id")}
    employer_ids = {str(row.get("employer_id")) for row in threads if row.get("employer_id")}
    candidate_users = {str(row["id"]): str(row["user_id"]) for row in _rest_rows(
        "candidate_profiles", {"id": _in_filter(candidate_ids), "select": "id,user_id"})} if candidate_ids else {}
    employers = {str(row["id"]): row for row in _rest_rows(
        "employer_profiles", {"id": _in_filter(employer_ids), "select": "id,user_id,company_name"})} if employer_ids else {}
    participants: dict[str, dict] = {}
    for row in threads:
        candidate_id, employer_id = str(row.get("candidate_id") or ""), str(row.get("employer_id") or "")
        employer = employers.get(employer_id, {})
        participants[str(row["application_id"])] = {
            # Some deployments store auth user IDs directly in the thread columns.
            "candidate": candidate_users.get(candidate_id, candidate_id or None),
            "employer": str(employer.get("user_id") or employer_id) or None,
            "company_name": employer.get("company_name"),
        }
    return participants


@app.get("/api/admin/reports")
def admin_list_reports(status: str = "open", authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    if status != "all" and status not in REPORT_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be open, resolved, dismissed or all.")
    params = {
        "action": "eq.report", "order": "created_at.desc", "limit": "200",
        "select": "id,application_id,actor_user_id,actor_role,reason,details,created_at,review_status,reviewed_at,reviewed_by,admin_note",
    }
    if status != "all":
        params["review_status"] = f"eq.{status}"
    rows = _rest_rows("message_moderation_actions", params)
    application_ids = [row.get("application_id") for row in rows]
    applications = {str(row["id"]): row for row in _rest_rows(
        "job_applications", {"id": _in_filter(application_ids), "select": "id,job_title,company_name,status"})} if rows else {}
    participants = _thread_participants(application_ids)
    reported_ids: dict[str, str | None] = {}
    for row in rows:
        other_role = "employer" if row.get("actor_role") == "candidate" else "candidate"
        reported_ids[str(row["id"])] = participants.get(str(row.get("application_id")), {}).get(other_role)
    people = _profiles_by_id([row.get("actor_user_id") for row in rows] + list(reported_ids.values()))
    reports = []
    for row in rows:
        application = applications.get(str(row.get("application_id")), {})
        reported = _person(people.get(str(reported_ids.get(str(row["id"])))))
        if reported and reported.get("role") == "employer":
            reported["company_name"] = participants.get(str(row.get("application_id")), {}).get("company_name")
        reports.append({
            **row,
            "reporter": _person(people.get(str(row.get("actor_user_id")))),
            "reported": reported,
            "application": {"job_title": application.get("job_title"), "company_name": application.get("company_name"),
                "status": application.get("status")},
        })
    counts = {name: 0 for name in REPORT_REVIEW_STATUSES}
    for row in _rest_rows_all("message_moderation_actions", {"action": "eq.report", "select": "id,review_status"}):
        if row.get("review_status") in counts:
            counts[row["review_status"]] += 1
    return {"reports": reports, "counts": counts}


@app.patch("/api/admin/reports/{report_id}")
def admin_review_report(report_id: str, payload: AdminReviewRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_id = _require_admin_user(authorization)
    status = payload.status.strip().lower()
    if status not in REPORT_REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be open, resolved or dismissed.")
    note = (payload.note or "").strip() or None
    if note and len(note) > 2000:
        raise HTTPException(status_code=400, detail="Admin notes must be 2000 characters or fewer.")
    reopened = status == "open"
    body = {"review_status": status, "admin_note": note,
        "reviewed_at": None if reopened else _safe_timestamp(), "reviewed_by": None if reopened else admin_id}
    rows = _supabase_request(
        f"/rest/v1/message_moderation_actions?id=eq.{_quote(report_id)}&action=eq.report",
        method="PATCH", service_role=True, body=body, prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Report was not found.")
    return {"report": rows[0]}


@app.get("/api/admin/match-feedback/stats")
def admin_match_feedback_stats(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    rows = _rest_rows_all("match_feedback", {
        "select": "user_id,job_id,job_source,vote,match_category,match_score,ranker_version,created_at,updated_at",
        "order": "updated_at.desc,id.asc",
    }, max_rows=20_000)
    summary = summarize_match_feedback(rows)
    flagged = summary["most_downvoted_jobs"]
    titles: dict[tuple[str, str], dict] = {}
    for source, table in (("internal", "internal_jobs"), ("employer", "employer_job_posts")):
        job_ids = [item["job_id"] for item in flagged if item["job_source"] == source]
        if job_ids:
            for row in _rest_rows(table, {"job_id": _in_filter(job_ids), "select": "job_id,job_title,company_name"}):
                titles[(source, str(row["job_id"]))] = row
    for item in flagged:
        job = titles.get((item["job_source"], item["job_id"]), {})
        item["job_title"] = job.get("job_title")
        item["company_name"] = job.get("company_name")
    return summary


def _profile_for_session(authorization: str | None) -> dict:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to manage your account.")
    rows = _rest_rows("profiles", {"id": f"eq.{user_id}", "select": "id,role,email", "limit": "1"})
    if not rows:
        raise HTTPException(status_code=404, detail="Your profile was not found.")
    return rows[0]


def _latest_deletion_request(user_id: str) -> dict | None:
    rows = _rest_rows("account_deletion_requests", {
        "user_id": f"eq.{user_id}", "select": "id,status,reason,requested_at,reviewed_at,admin_note",
        "order": "requested_at.desc", "limit": "1",
    })
    return rows[0] if rows else None


@app.get("/api/account/deletion-request")
def get_account_deletion_request(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    profile = _profile_for_session(authorization)
    return {"request": _latest_deletion_request(str(profile["id"]))}


@app.post("/api/account/deletion-request")
def create_account_deletion_request(payload: DeletionRequestCreate, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    profile = _profile_for_session(authorization)
    if profile.get("role") not in {"candidate", "employer"}:
        raise HTTPException(status_code=400, detail="Administrator accounts cannot request deletion here.")
    reason = (payload.reason or "").strip() or None
    if reason and len(reason) > 2000:
        raise HTTPException(status_code=400, detail="Please keep the reason to 2000 characters or fewer.")
    latest = _latest_deletion_request(str(profile["id"]))
    if latest and latest.get("status") == "pending":
        return {"request": latest}
    rows = _supabase_request("/rest/v1/account_deletion_requests", method="POST", service_role=True, body={
        "user_id": profile["id"], "user_email": profile.get("email") or "", "user_role": profile["role"], "reason": reason,
    }, prefer="return=representation")
    return {"request": rows[0] if isinstance(rows, list) and rows else None}


@app.delete("/api/account/deletion-request")
def cancel_account_deletion_request(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    profile = _profile_for_session(authorization)
    _supabase_request(
        f"/rest/v1/account_deletion_requests?user_id=eq.{_quote(profile['id'])}&status=eq.pending",
        method="PATCH", service_role=True, body={"status": "cancelled"},
    )
    return {"request": _latest_deletion_request(str(profile["id"]))}


@app.get("/api/admin/deletion-requests")
def admin_list_deletion_requests(status: str = "pending", authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    if status != "all" and status not in DELETION_REQUEST_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown deletion request status.")
    params = {"select": "*", "order": "requested_at.desc", "limit": "200"}
    if status != "all":
        params["status"] = f"eq.{status}"
    rows = _rest_rows("account_deletion_requests", params)
    people = _profiles_by_id(row.get("user_id") for row in rows)
    counts = {name: 0 for name in DELETION_REQUEST_STATUSES}
    for row in _rest_rows_all("account_deletion_requests", {"select": "id,status"}):
        if row.get("status") in counts:
            counts[row["status"]] += 1
    return {"requests": [{**row, "user": _person(people.get(str(row.get("user_id"))))} for row in rows], "counts": counts}


def _pending_deletion_request(request_id: str) -> dict:
    rows = _rest_rows("account_deletion_requests", {"id": f"eq.{request_id}", "select": "*", "limit": "1"})
    if not rows:
        raise HTTPException(status_code=404, detail="Deletion request was not found.")
    if rows[0].get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"This request was already {rows[0].get('status')}.")
    return rows[0]


def _close_deletion_request(request_id: str, status: str, admin_id: str, note: str | None) -> dict:
    rows = _supabase_request(
        f"/rest/v1/account_deletion_requests?id=eq.{_quote(request_id)}", method="PATCH", service_role=True,
        body={"status": status, "reviewed_at": _safe_timestamp(), "reviewed_by": admin_id, "admin_note": (note or "").strip() or None},
        prefer="return=representation",
    )
    return rows[0] if isinstance(rows, list) and rows else {"id": request_id, "status": status}


@app.post("/api/admin/deletion-requests/{request_id}/approve")
def admin_approve_deletion_request(request_id: str, payload: AdminDecisionRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_id = _require_admin_user(authorization)
    request = _pending_deletion_request(request_id)
    user_id = request.get("user_id")
    if user_id:
        _require_manageable_user(str(user_id), admin_id)
        _delete_user_account(str(user_id))
    return {"request": _close_deletion_request(request_id, "approved", admin_id, payload.note)}


@app.post("/api/admin/deletion-requests/{request_id}/reject")
def admin_reject_deletion_request(request_id: str, payload: AdminDecisionRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_id = _require_admin_user(authorization)
    _pending_deletion_request(request_id)
    return {"request": _close_deletion_request(request_id, "rejected", admin_id, payload.note)}


@app.get("/api/jobs/list")
def jobs_list(limit: int = 5000) -> dict:
    results = list_available_jobs(limit=limit)
    # A job listed here but not yet in the matching cache (a new employer post)
    # is scored by the next match run instead of after the cache expires.
    refresh_jobs_cache_for([item.get("job_id") for item in results])
    return {"results": results}


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


def _clean_screening_questions(value: object, *, include_expected: bool) -> list[dict]:
    """Screening questions as stored on a job post. Candidates never see the
    employer's expected answer."""
    items = value if isinstance(value, list) else []
    cleaned = []
    for item in items:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or "").strip()
        if not question:
            continue
        entry = {"question": question}
        if include_expected:
            entry["expected_answer"] = str(item.get("expected_answer") or "").strip() or None
        cleaned.append(entry)
    return cleaned


def _clean_hiring_stages(value: object) -> list[dict]:
    items = value if isinstance(value, list) else []
    return [
        {"stage": str(item.get("stage") or "").strip(), "description": str(item.get("description") or "").strip() or None}
        for item in items
        if isinstance(item, dict) and str(item.get("stage") or "").strip()
    ]


def _job_applicant_count(job_id: str) -> int | None:
    """Applicants on an open employer post, withdrawn excluded. None when the
    count function is not deployed yet."""
    if not job_id:
        return None
    try:
        rows = _supabase_request(
            "/rest/v1/rpc/get_job_applicant_counts", method="POST", service_role=True, body={"target_job_ids": [job_id]}
        )
    except HTTPException as exc:
        if exc.status_code == 404 or "PGRST202" in str(exc.detail):
            return None
        raise
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        return int(rows[0].get("applicant_count") or 0)
    return 0


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

    description, embedded_responsibilities, embedded_qualifications = split_job_sections(row.get("job_description"))
    occupation = psoc_reference.validate_occupation_code(row.get("psoc_unit_code")) if row.get("psoc_unit_code") else {}
    psoc_code = str(occupation.get("code", "")) if occupation.get("valid") and occupation.get("level") == "unit" else ""
    job = {
        "job_id": str(row.get("job_id") or ""),
        "job_source": source,
        "job_title": str(row.get("job_title") or ""),
        "psoc_unit_code": psoc_code,
        "psoc_title": str(occupation.get("title", "")) if psoc_code else "",
        "company_name": str(row.get("company_name") or ""),
        "job_category": str(row.get("category_name") or ""),
        "job_subcategory": str(row.get("job_subcategory") or ""),
        "job_level": canonical_job_level(row.get("job_level")),
        "work_type": canonical_work_setup(row.get("work_setup")),
        "employment_type": canonical_employment_type(row.get("employment_type")),
        "location": str(row.get("location") or ""),
        "salary_range_monthly_php": _format_detail_salary(row),
        "job_description": description,
        "responsibilities": _split_detail_list(row.get("responsibilities")) or embedded_responsibilities,
        # One per line; qualifications often contain commas ("Hospitality, Tourism or related field").
        "qualifications": [line.strip() for line in str(row.get("qualifications") or "").splitlines() if line.strip()] or embedded_qualifications,
        "required_skills": _split_detail_list(row.get("required_skills")),
        "preferred_skills": _split_detail_list(row.get("preferred_skills")),
        "external_job_link_optional": str(row.get("source_url") or ""),
        "posted_at": str(row.get("created_at") or ""),
        "applicant_count": _job_applicant_count(str(row.get("job_id") or "")) if source == "employer" else None,
        "screening_questions": _clean_screening_questions(row.get("screening_questions"), include_expected=False) if source == "employer" else [],
        "hiring_stages": _clean_hiring_stages(row.get("hiring_stages")) if source == "employer" else [],
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


async def _read_resume_upload(upload: UploadFile) -> bytes:
    """The upload's bytes, refusing files over the resume size limit without reading them whole."""
    file_bytes = await upload.read(MAX_RESUME_BYTES + 1)
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded resume file is empty.")
    if len(file_bytes) > MAX_RESUME_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Resume file must be {MAX_RESUME_BYTES // (1024 * 1024)}MB or smaller.",
        )
    return file_bytes


@app.post("/api/resume/analyze")
async def analyze_resume(
    resume: Annotated[UploadFile, File()],
) -> dict:
    if not resume.filename:
        raise HTTPException(status_code=400, detail="Resume filename is missing.")

    if resume_extension(resume.filename) not in SUPPORTED_RESUME_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF, DOCX or DOC resume.",
        )

    file_bytes = await _read_resume_upload(resume)

    analysis_started_at = time.perf_counter()
    try:
        # The resume is read from memory: no copy of it is written to disk
        # (a .doc conversion uses a private temporary folder that is deleted).
        # Includes approved taxonomy additions; may refresh them from Supabase.
        extractor = await run_in_threadpool(current_skill_extractor)
        result = await run_in_threadpool(
            analyze_resume_bytes,
            file_bytes=file_bytes,
            filename=resume.filename,
            skill_extractor=extractor,
        )

        logger.info(
            "Resume analysis completed",
            extra={
                "file_bytes": len(file_bytes),
                "raw_text_length": result.get("raw_text_length", 0),
                "skill_count": len(result.get("candidate_profile", {}).get("skills", [])),
                "extraction": result.get("extraction", {}),
                "elapsed_ms": round((time.perf_counter() - analysis_started_at) * 1000, 1),
            },
        )

        return result

    except HTTPException:
        raise
    except ResumeFileError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Resume analysis failed",
            extra={
                "file_bytes": len(file_bytes),
                "elapsed_ms": round((time.perf_counter() - analysis_started_at) * 1000, 1),
            },
        )
        raise HTTPException(status_code=500, detail="We could not analyze this resume right now. Please try again, or upload a text-based PDF or DOCX.") from exc


@app.post("/api/certificates/validate")
async def validate_certificate_file(
    certificate: Annotated[UploadFile, File()],
) -> dict:
    if not certificate.filename:
        raise HTTPException(status_code=400, detail="Certificate filename is missing.")

    # Read at most one byte past the limit, so an oversized upload is refused
    # without holding all of it in memory.
    file_bytes = await certificate.read(MAX_CERTIFICATE_BYTES + 1)
    if len(file_bytes) > MAX_CERTIFICATE_BYTES:
        raise HTTPException(status_code=400, detail="Certificate file must be 5MB or smaller.")
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


@app.get("/api/locations/regions")
def list_regions(location: str = "") -> dict:
    """The Philippine regions, and the region a location resolves to.

    The frontend shows the candidate's current region from this answer so the
    region used for filtering is always the one the backend would compute.
    ``current_region`` is empty when the location names no region, or more
    than one ("Philippines", "Laguna / Metro Manila"): the candidate chooses.
    """
    current = resolve_single_region(location) if location.strip() else None
    return {
        "regions": region_options(),
        "location": location,
        "current_region": current or "",
        "current_region_name": region_name(current) if current else "",
        "location_regions": sorted(regions_in_location(location)) if location.strip() else [],
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
    removed_skill_ids = _normalize_removed_skill_ids(payload.removed_skill_ids)
    if payload.refresh_jobs:
        expire_stale_reference_jobs()

    try:
        # Onboarding and the dashboard both land here; the upload route uses
        # the same run_matching, so every report follows one set of rules.
        result = await run_in_threadpool(
            run_matching,
            resume_text=resume_text_for_matching,
            preferences=preferences,
            confirmed_skills=confirmed_skill_records or None,
            candidate_skill_ids=candidate_skill_ids,
            removed_skill_ids=removed_skill_ids,
        )
    except MatchingModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Text job matching failed")
        raise HTTPException(status_code=500, detail="We could not generate matches right now. Please try again.") from exc

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


def _form_model(model: type[BaseModel], payload: str, label: str):
    """Parse a JSON form field (a CORS simple request, as run-form explains) into ``model``."""
    try:
        values = json.loads(payload)
        if not isinstance(values, dict):
            raise ValueError(f"{label} must be an object.")
        return model.model_validate(values) if hasattr(model, "model_validate") else model.parse_obj(values)
    except (json.JSONDecodeError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid {label}.") from exc


def _dump(model: BaseModel) -> dict:
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


@app.post("/api/skills/gaps")
async def skill_gaps(
    payload: str = Form(...),
    group_by: str = skill_gap_config.GROUP_BY_SKILL,
    scope: str = skill_gap_config.SCOPE_DEFAULT,
    include_courses: bool = False,
) -> dict:
    """The Skills page's gaps, regrouped by skill or by job, for one scope.

    The browser sends its matches' missing skills as matching returned them;
    nothing is re-scored. ``scope``: default (Fit-Now plus saved and applied
    jobs), fit_now, saved (saved and applied jobs) or all. Saved or applied
    jobs that are not among the matches are left out and counted. Tiers,
    order and display limits are in services/skill_gap_config.py.
    """
    if group_by not in skill_gap_config.GROUP_BY_IDS:
        raise HTTPException(status_code=422, detail=f"group_by must be one of {', '.join(skill_gap_config.GROUP_BY_IDS)}.")
    if scope not in skill_gap_config.SCOPE_IDS:
        raise HTTPException(status_code=422, detail=f"scope must be one of {', '.join(skill_gap_config.SCOPE_IDS)}.")
    request = _form_model(SkillGapsRequest, payload, "skill gaps request")

    def build() -> dict:
        report = build_gap_report(
            [_dump(job) for job in request.matches], scope=scope, group_by=group_by,
            saved=[(job.job_source, job.job_id) for job in request.saved_jobs],
            applied=[(job.job_source, job.job_id) for job in request.applied_jobs],
        )
        if include_courses and group_by == skill_gap_config.GROUP_BY_SKILL:
            report["courses_by_skill"] = learning_by_skill_for(report["skills"])
        return report

    try:
        return await run_in_threadpool(build)
    except Exception as exc:
        logger.exception("Skill gap grouping failed")
        raise HTTPException(status_code=500, detail="Skill gaps could not be grouped right now.") from exc


@app.post("/api/resume/summary")
async def resume_summary(payload: str = Form(...)) -> dict:
    """'Your resume at a glance', filled in from fixed templates (services/resume_summary.py)."""
    request = _form_model(ResumeSummaryRequest, payload, "resume summary request")
    return build_resume_summary(
        resume_text=request.resume_text, skills=request.skills, role_level=request.role_level,
        fit_now_titles=request.fit_now_titles, aspiration_titles=request.aspiration_titles,
    )


def _parse_timestamp(value: object) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _confirmed_skills_since(user_id: str, resume_created_at: object) -> list[dict]:
    """Skills confirmed on the Skills review step, if saved after the given resume."""
    query = urllib.parse.urlencode({
        "user_id": f"eq.{user_id}",
        "source": "eq.confirmed_skill",
        "select": "skill_id,skill_name,confidence,created_at",
        "order": "created_at.desc",
    })
    rows = _supabase_request(f"/rest/v1/user_skills?{query}", service_role=True)
    rows = [row for row in rows if isinstance(row, dict) and str(row.get("skill_name") or "").strip()] if isinstance(rows, list) else []
    if not rows:
        return []
    resume_time = _parse_timestamp(resume_created_at)
    saved_times = [time for time in (_parse_timestamp(row.get("created_at")) for row in rows) if time]
    if resume_time and (not saved_times or max(saved_times) < resume_time):
        return []
    return [{"skill_id": row.get("skill_id"), "skill_name": row.get("skill_name"), "confidence": row.get("confidence")} for row in rows]


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
    # The skills the candidate reviewed and confirmed (saved with each match run)
    # are the same ones Fit-Now and Aspiration matching used, so this analysis
    # agrees with the dashboard. They count only when saved after this resume.
    skill_records = _confirmed_skills_since(user_id, resume.get("created_at") if isinstance(resume, dict) else None)
    if not skill_records:
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
    score_note = document.add_paragraph(MATCH_SCORE_DISCLAIMER)
    score_note.runs[0].italic = True

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


APPLICATION_JOB_SOURCES = {"employer", "internal"}
JOB_CLOSED_MESSAGE = "This job is closed or no longer accepting applications."


@app.post("/api/candidate/applications")
async def submit_candidate_application(payload: JobApplicationRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    """Apply for an open job. The match score and the skills found and missing
    that the employer sees are calculated here with the production matcher,
    from the candidate's saved resume and confirmed skills; the browser sends
    only which job (audit APP-01)."""
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication is required.")
    job_id = (payload.job_id or "").strip()
    job_source = (payload.job_source or "").strip().lower()
    if not job_id or len(job_id) > 200 or job_source not in APPLICATION_JOB_SOURCES:
        raise HTTPException(status_code=422, detail="Choose a job to apply for.")

    resume_text, skill_records, preferences, _context = await run_in_threadpool(_load_external_job_candidate, user_id)
    job = await run_in_threadpool(find_catalogue_job, job_id, job_source)
    if job is None:
        raise HTTPException(status_code=404, detail=JOB_CLOSED_MESSAGE)
    try:
        scored = await run_in_threadpool(
            analyze_candidate_job_match, resume_text, job, preferences=preferences, confirmed_skills=skill_records)
    except MatchingModelUnavailable as exc:
        raise HTTPException(status_code=503, detail="The matching model is temporarily unavailable. Please try again.") from exc
    except Exception as exc:
        logger.exception("Scoring an application failed")
        raise HTTPException(status_code=500, detail="We could not submit your application right now. Please try again.") from exc
    match = scored["match"]
    body = {
        "applicant_id": user_id,
        "target_job_source": job_source,
        "target_job_id": job_id,
        "applicant_match_score": round(float(match.get("match_percentage") or 0.0)),
        "applicant_matched_skills": [str(skill) for skill in match.get("matched_skills") or []],
        "applicant_missing_skills": [str(skill) for skill in match.get("missing_skills") or []],
    }
    try:
        saved = _supabase_request("/rest/v1/rpc/submit_job_application_for", method="POST", service_role=True, body=body)
    except SupabaseRequestError as exc:
        if '"23505"' in str(exc.detail):
            raise HTTPException(status_code=409, detail="You have already applied for this job.") from exc
        raise HTTPException(status_code=exc.status_code, detail=supabase_error_message(exc.status_code, exc.detail)) from exc
    application = saved[0] if isinstance(saved, list) and saved else saved
    return {"application": application}


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


# ---------------------------------------------------------------------------
# Match feedback and learning (docs/feedback-learning.md)
# ---------------------------------------------------------------------------

def _require_user_session(authorization: str | None) -> tuple[str, str]:
    user_id = _get_authenticated_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to rate job matches.")
    return user_id, authorization.split(" ", 1)[1].strip()


def _validated_feedback_target(job_id: str, job_source: str) -> tuple[str, str]:
    job_id = (job_id or "").strip()
    job_source = (job_source or "internal").strip().lower()
    if not job_id or len(job_id) > 200:
        raise HTTPException(status_code=422, detail="A job ID is required.")
    if job_source not in JOB_SOURCES:
        raise HTTPException(status_code=422, detail="Unknown job source.")
    return job_id, job_source


def _public_feedback(row: dict) -> dict:
    return {
        "job_id": row.get("job_id"),
        "job_source": row.get("job_source") or "internal",
        "vote": "good" if row.get("vote") == 1 else "bad",
        "updated_at": row.get("updated_at"),
    }


@app.get("/api/candidate/match-feedback")
def list_match_feedback(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    user_id, token = _require_user_session(authorization)
    query = urllib.parse.urlencode({
        "user_id": f"eq.{user_id}", "select": "job_id,job_source,vote,updated_at",
        "order": "updated_at.desc", "limit": "1000",
    })
    rows = _supabase_request(f"/rest/v1/match_feedback?{query}", token=token)
    return {"feedback": [_public_feedback(row) for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []}


@app.put("/api/candidate/match-feedback")
def save_match_feedback(payload: MatchFeedbackRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    """Record or change the caller's vote for one recommended job.

    Written with the caller's own token, so row-level security enforces that
    the row belongs to them. The context comes from their saved match history,
    which also limits voting to jobs that were actually recommended to them.
    """
    job_id, job_source = _validated_feedback_target(payload.job_id, payload.job_source)
    vote = VOTES.get((payload.vote or "").strip().lower())
    if vote is None:
        raise HTTPException(status_code=422, detail="Vote must be 'good' or 'bad'.")
    user_id, token = _require_user_session(authorization)
    history_query = urllib.parse.urlencode({
        "user_id": f"eq.{user_id}", "select": HISTORY_SELECT,
        "order": "created_at.desc", "limit": str(HISTORY_ROWS_SEARCHED),
    })
    history = _supabase_request(f"/rest/v1/match_history?{history_query}", token=token)
    context = find_match_context(history if isinstance(history, list) else [], job_id, job_source)
    if context is None:
        # The job may come from an older run, a saved job or an application. Rate it with what the
        # candidate saw, so long as it is a real job and the category is one we recognise.
        context = fallback_match_context(payload.match_category, payload.match_score)
    if context is None:
        raise HTTPException(
            status_code=409,
            detail="Only jobs from your saved recommendations can be rated. Refresh your matches and try again.",
        )
    body = {"user_id": user_id, "job_id": job_id, "job_source": job_source, "vote": vote, **context}
    try:
        rows = _supabase_request(
            "/rest/v1/match_feedback?on_conflict=user_id,job_id,job_source",
            method="POST", token=token, body=body,
            prefer="resolution=merge-duplicates,return=representation",
        )
    except HTTPException as exc:
        if "MATCH_FEEDBACK_RATE_LIMIT" in str(exc.detail):
            raise HTTPException(status_code=429, detail="Too many ratings in a short time. Please try again later.") from exc
        raise
    saved = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else body
    return {"feedback": _public_feedback(saved)}


@app.delete("/api/candidate/match-feedback")
def delete_match_feedback(
    job_id: str,
    job_source: str = "internal",
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict:
    job_id, job_source = _validated_feedback_target(job_id, job_source)
    user_id, token = _require_user_session(authorization)
    query = urllib.parse.urlencode({"user_id": f"eq.{user_id}", "job_id": f"eq.{job_id}", "job_source": f"eq.{job_source}"})
    _supabase_request(f"/rest/v1/match_feedback?{query}", method="DELETE", token=token)
    return {"deleted": True, "job_id": job_id, "job_source": job_source}


def _learning_client() -> SupabaseRest:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="SUPABASE_SERVICE_ROLE_KEY is required for learning jobs.")
    return SupabaseRest(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _learning_error(exc: Exception) -> HTTPException:
    if isinstance(exc, skill_discovery.ReviewError):
        return HTTPException(status_code=exc.status, detail=str(exc))
    if isinstance(exc, SupabaseError):
        if exc.status == 409 or "duplicate key" in str(exc):
            return HTTPException(status_code=409, detail="That skill name was already approved.")
        logger.warning("Learning data store error: %s", exc)
        return HTTPException(status_code=502, detail="The learning data store could not complete this request. Please try again.")
    return HTTPException(status_code=400, detail=str(exc))


def _run_learning(job: str, dry_run: bool, trigger: str) -> dict:
    client = _learning_client()
    if job == "ranking":
        report = {"ranking": ranking_training.run_training(client, trigger=trigger, dry_run=dry_run)}
    elif job == "skills":
        report = {"skills": skill_discovery.run_discovery(client, dry_run=dry_run)}
    elif job == "all":
        report = run_learning_jobs(client, trigger=trigger, dry_run=dry_run)
    else:
        raise HTTPException(status_code=422, detail="job must be 'all', 'ranking' or 'skills'.")
    clear_ranker_cache()
    return report


@app.get("/api/admin/learning/status")
def admin_learning_status(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    client = _learning_client()
    try:
        ranking = ranking_training.status(client)
        pending = client.select("skill_candidates", {"select": "id", "status": "eq.pending", "limit": "1000"})
    except SupabaseError as exc:
        raise _learning_error(exc) from exc
    return {
        "ranking": ranking,
        "feedback_votes": _admin_count("match_feedback"),
        "pending_skill_proposals": len(pending),
        "ranker_override": os.getenv("KAREERLY_RANKER", "auto"),
    }


@app.post("/api/admin/learning/run")
async def admin_run_learning(payload: LearningRunRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_id = _require_admin_user(authorization)
    try:
        return await run_in_threadpool(_run_learning, payload.job, payload.dry_run, f"admin:{admin_id}")
    except (SupabaseError, ValueError) as exc:
        raise _learning_error(exc) from exc


@app.post("/api/admin/learning/rollback")
def admin_rollback_ranking(payload: RankingRollbackRequest, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    admin_id = _require_admin_user(authorization)
    try:
        result = ranking_training.rollback(_learning_client(), target_version=(payload.target_version or "").strip() or None,
            actor=f"admin:{admin_id}")
    except (SupabaseError, ValueError) as exc:
        raise _learning_error(exc) from exc
    clear_ranker_cache()
    return result


@app.get("/api/admin/skill-candidates")
def admin_list_skill_candidates(status: str = "pending", limit: int = 100, authorization: Annotated[Optional[str], Header()] = None) -> dict:
    _require_admin_user(authorization)
    try:
        return {"candidates": skill_discovery.list_candidates(_learning_client(), status=status, limit=limit)}
    except (SupabaseError, ValueError) as exc:
        raise _learning_error(exc) from exc


@app.post("/api/admin/skill-candidates/{candidate_id}/review")
def admin_review_skill_candidate(
    candidate_id: str,
    payload: SkillCandidateReviewRequest,
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict:
    admin_id = _require_admin_user(authorization)
    try:
        return skill_discovery.review_candidate(
            _learning_client(), candidate_id, payload.action, admin_id,
            skill_id=payload.skill_id, label=payload.label, category_id=payload.category_id, note=payload.note,
        )
    except (SupabaseError, ValueError) as exc:
        raise _learning_error(exc) from exc


@app.post("/api/internal/learning/run")
async def scheduled_learning_run(
    payload: LearningRunRequest,
    x_learning_job_token: Annotated[Optional[str], Header()] = None,
) -> dict:
    """Entry point for an external scheduler, such as Cloud Scheduler."""
    expected = os.getenv("KAREERLY_LEARNING_JOB_TOKEN", "")
    if len(expected) < 24:
        raise HTTPException(status_code=404, detail="Not Found")
    if not x_learning_job_token or not hmac.compare_digest(x_learning_job_token, expected):
        raise HTTPException(status_code=401, detail="Invalid learning job token.")
    try:
        return await run_in_threadpool(_run_learning, payload.job, payload.dry_run, "webhook")
    except (SupabaseError, ValueError) as exc:
        raise _learning_error(exc) from exc


@app.post("/api/matches/from-resume")
async def match_from_resume(
    file: Annotated[UploadFile, File()],
    background_tasks: BackgroundTasks,
    authorization: Annotated[Optional[str], Header()] = None,
    preferences: str = Form("{}"),
    confirmed_skills: str = Form("[]"),
    resume_text_for_matching: str = Form(""),
    removed_skill_ids: str = Form(""),
    user_mode: str = Form("guest"),
    view_mode: str = Form("initial"),
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Resume filename is missing.")

    if resume_extension(file.filename) not in SUPPORTED_RESUME_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Please upload a PDF, DOCX or DOC resume.")

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
        removed_skill_ids_payload = json.loads(removed_skill_ids or "null")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Removed skill IDs must be valid JSON.") from exc
    removed = _normalize_removed_skill_ids(removed_skill_ids_payload)

    try:
        normalized_resume_text = resume_text_for_matching.strip()
        # The UI already analyzed this file before the skills-review step and
        # sends that text; otherwise the file is read exactly as Step 1 reads it.
        file_bytes = None if normalized_resume_text else await _read_resume_upload(file)
        result = await run_in_threadpool(
            run_matching,
            resume_text=normalized_resume_text,
            file_bytes=file_bytes,
            filename=file.filename,
            preferences=preferences_payload,
            # An empty list means none were sent, not that the user has no skills.
            confirmed_skills=confirmed_skill_records or None,
            removed_skill_ids=removed,
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
    except Exception as exc:
        logger.exception("Resume job matching failed")
        raise HTTPException(
            status_code=500,
            detail="We could not generate matches right now. Please try again or upload a clearer resume.",
        ) from exc
