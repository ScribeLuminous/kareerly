# Kareerly Baseline Model: Google Colab Import Checklist

This checklist is for **documentation/preparation only**.
It does **not** change baseline formulas, model logic, or backend behavior.

## 1) Required backend Python files

Below are the backend files needed to run the current baseline pipeline in Colab.

### Core baseline modules

- `backend/app/services/resume_parser.py`
  - **Purpose:** Extracts and cleans resume text from PDF/DOCX.
  - **Key functions:** `extract_text_from_pdf`, `extract_text_from_docx`, `extract_resume_text`, `clean_resume_text`, `normalize_for_matching`.
  - **Local imports:** none.

- `backend/app/services/skill_extractor.py`
  - **Purpose:** Loads `skills_reference.csv`, builds alias index, extracts matched skills from resume sections.
  - **Key functions/classes:** `SkillExtractor` (`_load_skills_reference`, `_build_alias_index`, `extract_skills_from_sections`), `_normalize_alias`, `_split_alias_terms`.
  - **Local imports:** none.

- `backend/app/services/resume_analyzer.py`
  - **Purpose:** End-to-end resume analysis wrapper (section detection + skill extraction + normalized text output).
  - **Key functions:** `analyze_resume_file`, `detect_resume_sections`, `extract_education_indicators`, `extract_certification_indicators`, `extract_experience_indicators`.
  - **Local imports:** `backend/app/services/skill_extractor.py`, `backend/app/services/resume_parser.py`.

- `backend/app/services/job_matcher.py`
  - **Purpose:** Loads TF-IDF artifacts, computes cosine similarity, computes Fit-Now/Aspiration, builds skill gaps and recommendations.
  - **Key functions/classes:** `JobMatcher` (`_load_vectorizer`, `_load_job_matrix`, `_load_jobs`, `match_jobs`), module functions `match_jobs`, `list_available_jobs`, `role_or_industry_preference_score`, `work_setup_preference_score`.
  - **Local imports:** `backend/app/services/learning_recommender.py`.

- `backend/app/services/learning_recommender.py`
  - **Purpose:** Skill coverage, gap prioritization, and course recommendation scoring.
  - **Key functions:** `compute_skill_coverage_by_id`, `add_skill_gap_fields`, `prioritize_skill_gaps`, `recommend_learning_resources`, `compute_certification_score`.
  - **Local imports:** none.

### API entrypoints and schema helpers

- `backend/app/main.py`
  - **Purpose:** FastAPI app routes (`/api/resume/analyze`, `/api/matches/run`, etc.) using baseline modules.
  - **Key functions:** `analyze_resume`, `run_matches`, `search_skills`, `jobs_list`, `_is_valid_certificate_pdf`.
  - **Local imports:** `backend/app/services/job_matcher.py`, `backend/app/services/resume_analyzer.py`, `backend/app/models/schemas.py`, `backend/app/services/skill_extractor.py`.

- `backend/app/models/schemas.py`
  - **Purpose:** Request/response schema models for API validation (`RunMatchesRequest`, etc.).
  - **Local imports:** none.

- `backend/app/__init__.py`
  - **Purpose:** Package marker for `app` module imports.
  - **Local imports:** none.

## 2) Required data files

### Required

- `backend/data/skills_reference.csv`
  - **Purpose:** Canonical skill IDs, names, and aliases for extraction + gap metadata.
  - **Loaded by:** `backend/app/services/skill_extractor.py`, `backend/app/services/learning_recommender.py`.
  - **Required columns (used in code):**
    - `skill_id`, `skill_name`
    - `skill_category`, `skill_subcategory`
    - `related_skills`, `esco_preferred_label`, `esco_alternative_labels`
  - **Status:** Required.

- `backend/data/learning_resources.csv`
  - **Purpose:** Candidate course/certification options used in recommendation ranking.
  - **Loaded by:** `backend/app/services/learning_recommender.py`.
  - **Required columns (used in code):**
    - `resource_id`, `skill_ids`
    - `course_or_certification_title`, `course_or_certification_description`
    - `offered_by_provider`, `provider_type`, `resource_type`, `level`
    - `language`, `delivery_mode`, `cost_type`, `estimated_duration`
    - `skills_youll_gain`, `provider_trust_score_auto`
    - `external_course_or_certification_link`
  - **Status:** Required.

- `backend/baseline_models/job_index.csv`
  - **Purpose:** Job metadata rows aligned to TF-IDF matrix rows.
  - **Loaded by:** `backend/app/services/job_matcher.py`.
  - **Required columns (code defaults if missing):**
    - `job_id`, `job_title`, `job_category`, `job_subcategory`
    - `location`, `work_type`, `source_dataset`
    - `required_skill_ids`, `must_have_skill_ids`
    - `required_skills_comma_separated`, `skill_gap_reliability`
    - `job_text_for_matching`
  - **Status:** Required.

### Conditionally required / fallback source

- `backend/data/reference_jobs.csv`
  - **Purpose:** Fallback source for skill ID fields if `job_index.csv` lacks `required_skill_ids`.
  - **Loaded by:** `backend/app/services/job_matcher.py` (only if needed and file exists).
  - **Columns used for merge when present:**
    - `job_id`, `required_skill_ids`, `nice_to_have_skill_ids`
    - `mapped_required_skill_names`, `mapped_nice_to_have_skill_names`
    - `skill_gap_reliability`
  - **Status:** Optional for baseline runtime if `job_index.csv` is complete; recommended to include.

## 3) Required model artifacts

- `backend/baseline_models/tfidf_vectorizer.joblib`
  - **Purpose:** Saved TF-IDF vectorizer used to transform resume text.
  - **Loaded by:** `backend/app/services/job_matcher.py` (`_load_vectorizer`).
  - **If missing:** `FileNotFoundError`, matcher initialization fails.

- `backend/baseline_models/job_tfidf_matrix.npz`
  - **Purpose:** Sparse TF-IDF matrix for all indexed jobs.
  - **Loaded by:** `backend/app/services/job_matcher.py` (`_load_job_matrix`).
  - **If missing:** `FileNotFoundError`, matcher initialization fails.

- `backend/baseline_models/job_index.csv`
  - **Purpose:** Row-aligned job metadata referenced by similarity index.
  - **Loaded by:** `backend/app/services/job_matcher.py` (`_load_jobs`).
  - **If missing:** `FileNotFoundError`, matcher initialization fails.

- `backend/baseline_models/model_metadata.json`
  - **Purpose:** Metadata/documentation of training/model settings.
  - **Loaded by runtime:** not required by current app modules.
  - **If missing:** runtime unaffected; metadata/reporting loses provenance.

## 4) Evaluation files/folders to prepare in Drive

Recommended evaluation structure:

- `backend/evaluation/`
- `backend/evaluation/sample_resumes/`
- `backend/evaluation/expected_skills.csv`
- `backend/evaluation/expected_job_matches.csv`
- `backend/evaluation/expected_skill_gaps.csv`
- `backend/evaluation/expected_course_recommendations.csv`
- `backend/evaluation/file_validation_cases.csv`
- `backend/evaluation/outputs/`

Current repository state:
- `backend/evaluation/` exists after preparation.
- `backend/evaluation/sample_resumes/` exists (folder placeholder).
- `backend/evaluation/outputs/` exists (folder placeholder).
- `expected_*.csv` files are **not yet present** and should be added before full benchmark runs.

## 5) Python packages for Colab

### Required for Colab evaluation (baseline logic only)

- `pandas`
- `numpy`
- `scikit-learn`
- `scipy`
- `joblib`
- `pypdf`
- `python-docx`

### Required only when running FastAPI server/endpoints

- `fastapi`
- `uvicorn`
- `python-multipart`
- `pydantic`

### Optional / convenience

- `ipykernel` (if you want notebook kernel management outside default Colab)
- `matplotlib`/`seaborn` (only if adding visualization cells; not required by baseline backend code)

## 6) Colab import path setup cell

Use this exact setup cell in Colab:

```python
# --- Mount Google Drive ---
from google.colab import drive
drive.mount("/content/drive")

# --- Paths ---
import sys
from pathlib import Path

PROJECT_DIR = Path("/content/drive/MyDrive/kareerly_system")
BACKEND_DIR = PROJECT_DIR / "backend"
APP_DIR = BACKEND_DIR / "app"
DATA_DIR = BACKEND_DIR / "data"
MODELS_DIR = BACKEND_DIR / "baseline_models"
EVAL_DIR = BACKEND_DIR / "evaluation"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

print("PROJECT_DIR:", PROJECT_DIR)
print("BACKEND_DIR:", BACKEND_DIR)
print("APP_DIR:", APP_DIR)
print("DATA_DIR:", DATA_DIR)
print("MODELS_DIR:", MODELS_DIR)
print("EVAL_DIR:", EVAL_DIR)

# --- Import smoke test ---
from app.services.resume_parser import extract_resume_text, normalize_for_matching
from app.services.skill_extractor import SkillExtractor
from app.services.resume_analyzer import analyze_resume_file
from app.services.learning_recommender import recommend_learning_resources
from app.services.job_matcher import JobMatcher, match_jobs

print("✅ Baseline backend imports succeeded.")
```

## 7) Import test script usage

File provided: `backend/evaluation/colab_import_test.py`

### Run in Colab (after mounting Drive)

```python
!python /content/drive/MyDrive/kareerly_system/backend/evaluation/colab_import_test.py \
  --project-dir /content/drive/MyDrive/kareerly_system
```

What it checks:
- required backend Python files exist
- required CSV/data/model files exist
- backend modules import correctly
- `backend/evaluation/sample_resumes/` exists
- `backend/evaluation/outputs/` exists (created automatically if missing)
- missing Python packages are reported by category

## 8) What to upload to Google Drive before notebook run

Minimum required:

- `backend/app/` (entire folder)
- `backend/data/skills_reference.csv`
- `backend/data/learning_resources.csv`
- `backend/baseline_models/tfidf_vectorizer.joblib`
- `backend/baseline_models/job_tfidf_matrix.npz`
- `backend/baseline_models/job_index.csv`
- `backend/evaluation/colab_import_test.py`

Strongly recommended:

- `backend/data/reference_jobs.csv`
- `backend/baseline_models/model_metadata.json`
- `backend/evaluation/sample_resumes/`
- `backend/evaluation/expected_skills.csv`
- `backend/evaluation/expected_job_matches.csv`
- `backend/evaluation/expected_skill_gaps.csv`
- `backend/evaluation/expected_course_recommendations.csv`
- `backend/evaluation/file_validation_cases.csv`
- `backend/evaluation/outputs/`
