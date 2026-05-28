from __future__ import annotations

from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .job_matcher import list_available_jobs, match_jobs
from .resume_analyzer import analyze_resume_file
from .schemas import RunMatchesRequest
from .skill_extractor import SkillExtractor


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
    safe_limit = max(1, min(limit, 50))
    seen_ids = set()
    results: list[dict[str, str]] = []

    for row in skill_extractor.rows:
        skill_name = row.get("skill_name", "")
        skill_id = row.get("skill_id", "")

        if not skill_id or skill_id in seen_ids:
            continue

        if not query or query in skill_name.lower() or query in skill_id.lower():
            seen_ids.add(skill_id)
            results.append(
                {
                    "skill_id": skill_id,
                    "skill_name": skill_name,
                    "skill_category": row.get("skill_category", ""),
                    "skill_subcategory": row.get("skill_subcategory", ""),
                }
            )

        if len(results) >= safe_limit:
            break

    return {"results": results}


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Kareerly backend is running"}


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/jobs/list")
def jobs_list(limit: int = 200) -> dict:
    return {"results": list_available_jobs(limit=limit)}


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

    candidate_skill_ids = [
        skill_id.strip().upper()
        for skill_id in payload.candidate_skill_ids
        if isinstance(skill_id, str) and skill_id.strip()
    ]
    candidate_skill_ids = list(dict.fromkeys(candidate_skill_ids))

    try:
        # Always compute enough results for the logged-in full dashboard.
        result = match_jobs(
            resume_text_for_matching=resume_text_for_matching,
            candidate_skill_ids=candidate_skill_ids,
            preferences=preferences,
            top_n_retrieval=50,
            top_n_output=10,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Job matching failed: {exc}") from exc

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
        "skill_gaps": result.get("skill_gaps", [])[:gap_limit],
        "learning_recommendations": result.get("learning_recommendations", [])[:learning_limit],
    }

    return result
