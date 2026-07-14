from __future__ import annotations

import json
import base64
import hashlib
import os
import re
from datetime import datetime, timezone
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Annotated, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv
from pydantic import BaseModel

from .models.schemas import RunMatchesRequest
from .services.job_matcher import list_available_jobs, match_jobs
from .services.matching_service import match_resume_to_jobs
from .services.resume_analyzer import analyze_resume_file
from .services.skill_extractor import SkillExtractor


BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
UPLOADS_DIR = BACKEND_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


app = FastAPI(title="Kareerly ML Backend")
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
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv(
    "SUPABASE_ANON_KEY",
    os.getenv("VITE_SUPABASE_ANON_KEY", ""),
)
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL is not configured.")

if not SUPABASE_ANON_KEY:
    raise RuntimeError("SUPABASE_ANON_KEY is not configured.")

if not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not configured.")


class MessageCreateRequest(BaseModel):
    application_id: str
    message_text: str
    message_kind: str = "message"


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
