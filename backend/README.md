# Kareerly Backend

Local setup:

```bash
# From the repository root
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

Run backend in background (single command):

```bash
bash backend/dev_server.sh start
```

Useful controls:

```bash
bash backend/dev_server.sh status
bash backend/dev_server.sh logs
bash backend/dev_server.sh stop
```

## Resume Matching Endpoint

The only active FastAPI entry point is `backend/app/main.py`.

After the backend starts, open Swagger at:

```text
http://127.0.0.1:8000/docs
```

Manual check for the resume-based matching flow:

1. Start the backend:
   ```bash
   bash backend/dev_server.sh start
   ```
2. Open `/docs` and find `POST /api/matches/from-resume`.
3. Upload a readable PDF or DOCX resume.
4. Provide `preferences` as JSON, for example:
   ```json
   {
     "industry": "Technology, Data, Business & Finance",
     "target_role": "Data Analyst",
     "role_level": "Entry level",
     "work_setup": "Hybrid",
     "salary_expectation": "PHP 30,000 - PHP 50,000/month",
     "skill_to_develop": "Data Visualization"
   }
   ```
5. Confirm the response includes:
   - `extracted_skills`
   - `fit_now_matches`
   - `aspiration_matches`
   - `prioritized_skill_gaps`
   - `resume_text_preview`
   - `model_used`

Quick import check:

```bash
backend/.venv/bin/python -c "from backend.app.main import app; print(app.title)"
```

Optional Google Programmable Search API:

```bash
export GOOGLE_CSE_API_KEY="your_api_key"
export GOOGLE_CSE_ID="your_search_engine_id"
```

The legacy raw source dataset is retained locally at:

```text
backend/evaluation/source_data/jobs_record_source.csv
```

Active matching uses Supabase when configured and `backend/data/reference_jobs.csv` as its curated fallback.

## TF-IDF Evaluation Baseline

Artifacts live in `backend/baseline_models/`. This implementation is retained for evaluation and optional retrieval; it is not the primary semantic ranker.

The baseline includes:

- Resume parsing: PDF and DOCX
- Skill extraction using alias matching from `backend/data/skills_reference.csv`
- TF-IDF vectorization + cosine similarity for resume-job text matching
- Exact skill-ID coverage for candidate vs required skills

Scoring formulas:

- `Fit-Now Score = 0.60 * Text Similarity + 0.40 * Skill Coverage`
- `Aspiration Score = 0.45 * Text Similarity + 0.25 * Skill Coverage + 0.20 * Role/Industry Preference + 0.10 * Work Setup Preference`
- `Employer Alignment Score = 0.50 * Text Similarity + 0.35 * Skill Coverage + 0.15 * Must-Have Skill Coverage or Evidence`
- `Course Recommendation Score = 0.65 * Gap Coverage + 0.15 * Provider Trust + 0.10 * Affordability + 0.10 * User Fit`

Skill gaps:

- `Skill Gap = Required Job Skills - Candidate Skills`
- Severity by frequency across top matches:
  - Critical: appears in 3 or more matches
  - High: appears in 2 matches
  - Moderate: appears in 1 match

Not yet included in this baseline:

- related-competency partial scoring
- evidence strength as a Fit-Now component
- semantic embeddings
- Resume2Vec

## Start the complete local app

After installing backend requirements and running `npm ci` in `frontend`, run:

```bash
cd frontend
npm run dev
```

This starts FastAPI on `127.0.0.1:8000`, waits up to 60 attempts for
`GET /api/health` to return `{"status":"ok"}`, then starts Vite on port 5173.
A process or occupied port alone does not count as ready. Startup errors appear
in `backend/.uvicorn.log`; Vite does not launch when health fails.
To use an existing Python environment, set `BACKEND_PYTHON=/absolute/path/to/python`.
The backend remains running after Vite exits; stop it with `bash backend/dev_server.sh stop`.

The frontend defaults to `http://127.0.0.1:8000`; override with
`VITE_API_BASE_URL` in `frontend/.env` and restart Vite. Default CORS allows both
`http://localhost:5173` and `http://127.0.0.1:5173`. If overriding `FRONTEND_URLS`,
include the origins used by your browser. Supabase credentials are required for
account services, but missing credentials do not prevent health/public routes
from starting. Matching still requires its datasets and model dependencies.

Regression checks:

```bash
backend/.venv/bin/python -m pip install -r backend/requirements-test.txt
backend/.venv/bin/python -m unittest discover -s backend/tests -v
npm --prefix frontend test
npm --prefix frontend run build
```

Evidence is currently stored in dashboard state with browser blob URLs, not durable
storage. Resume re-analysis no longer changes it; a dashboard unmount or page reload
still clears it. PDF validation only checks size and basic structure. A successful
`status: valid` response means file checks passed, never credential verification.
