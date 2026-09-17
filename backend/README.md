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

## Vercel and Render connection checks

Set Vercel's `VITE_API_BASE_URL` to the public Render origin (for example,
`https://kareerly-yvze.onrender.com`), without `/api`, and redeploy Vercel.
Vercel builds now reject missing, localhost, and malformed backend origins.
In Render, set `FRONTEND_URLS` to a comma-separated list of the exact public
website origins allowed to call the API. A Vercel dashboard URL such as
`https://vercel.com/team/project` is not a website origin. Include any preview
origins you actually use, and redeploy Render after changing its configuration.

Check both health and the browser preflight; health alone does not verify CORS:

```bash
curl -i https://kareerly-yvze.onrender.com/api/health
curl -i -X OPTIONS https://kareerly-yvze.onrender.com/api/matches/from-resume \
  -H 'Origin: https://YOUR-PUBLIC-WEBSITE.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization'
```

The preflight must return 200 and `Access-Control-Allow-Origin` matching the
website. `400 Disallowed CORS origin` indicates Render's `FRONTEND_URLS` needs
that origin. Matching runs in a worker thread so inference does not block the
API event loop, and failures appear in backend logs.

`/api/health/config` reports the origins the running service actually accepts
and whether the checkpoint files are in place, which is the fastest way to tell
a stale `FRONTEND_URLS` apart from a bad deploy:

```bash
curl -s https://kareerly-yvze.onrender.com/api/health/config
```

It checks the checkpoint by path only and never loads it, so it stays
responsive while matching is running.

### "Cannot reach the job matching backend" on the deployed website

The website distinguishes the two causes for you. Before reporting the error it
sends an opaque `no-cors` probe to `/api/health`:

- *"running but refused a request from this website"* — the service is up and
  the origin is missing from `FRONTEND_URLS`. Add the exact website origin
  (scheme and host, no trailing slash, no path) in Render and redeploy.
- *"not responding"* — the service is down, asleep, or failing to boot. Check
  Render's logs. A boot that is killed without a Python traceback is usually the
  instance running out of memory.

`requirements.txt` carries an `--extra-index-url` for the CPU-only torch index.
The default PyPI wheel bundles the CUDA runtime, which a CPU instance cannot use
and which pulls in gigabytes of NVIDIA packages — enough to fail the build or get
the process killed at startup. Keep that line when editing the file.

`--extra-index-url` only *prefers* the CPU build (a `+cpu` version sorts above the
plain one). To make it certain, install torch from the CPU index explicitly in
Render's build command:

```bash
pip install --index-url https://download.pytorch.org/whl/cpu torch && pip install -r requirements.txt
```

The second command then sees torch as already satisfied. `backend/Dockerfile`
already builds this way. To confirm which build a deploy got, run
`pip show torch` — a `+cpu` version, or the absence of `nvidia-*` packages in
`pip list`, means the CPU wheel was used.

## Production matching algorithm

Both `/api/matches/run` and `/api/matches/from-resume` use the same fine-tuned
all-MiniLM-L6-v2 Sentence-Transformer bi-encoder. Candidate and job text are
encoded separately; raw cosine similarity determines ranking. Job embeddings
are reused until the job inputs change. There is no Cross-Encoder or TF-IDF
production fallback. Missing or corrupt model artifacts return readable 503
responses rather than a result labeled as the trained model.

The verified epoch-three checkpoint is packaged in
`backend/trained_models/kareerly-bi-encoder/`, with model configuration,
tokenizer, pooling configuration, frozen training-derived skill IDF features,
and checksum provenance. Its weights match the saved September 10 experiment.
The package contains no training resumes or job records. Include the entire
model directory when committing/deploying; the `.gitignore` exception keeps
this specific production weight file available to Git. Render can keep its
existing `pip install -r backend/requirements.txt` build and
`uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT` start command when
its root directory is the repository root. With a `backend` root directory,
use `pip install -r requirements.txt` and `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
No model download environment variable is required. Optionally configure
`KAREERLY_BI_ENCODER_MODEL_PATH` for a separately provisioned copy.

Model inputs reproduce the research representation: `[ROLE]`, up to 32
canonical semantic skill labels ordered by training-job IDF, and up to 1,400
characters of contact-redacted supporting evidence, truncated to 256 model
tokens. Survey preferences and structured job location are excluded from
semantic inputs. The twenty-skill confirmation interface remains unchanged;
its existing database IDs are used for deterministic coverage and gap reports.
Unknown confirmed IDs return 400. Related skill names and shared words do not
receive exact skill credit.

The thesis describes priorities without numerical Fit-Now cutoffs. Application
rule defaults are therefore explicit and configurable, rather than represented
as trained or evaluated thresholds: `KAREERLY_FIT_NOW_MIN_COSINE=0.45`,
`KAREERLY_FIT_NOW_MIN_COVERAGE=0.50`, and no missing explicitly designated
must-have skills. Jobs that fail these rules remain Aspiration results; none
are promoted merely to fill the Fit-Now view. Cosine ranks each view, with skill
coverage, preference alignment, and reviewed learning-resource coverage serving
as deterministic tie factors. Learning availability requires a reviewed skill-ID
mapping and a usable provider URL, with no keyword or semantic learning model.
Match percentages are nonnegative cosine similarity times 100, not hiring
probabilities. Raw signed cosine and rule thresholds remain in the response.
Guest limits (three per view), registered initial limits (five per view), and
full dashboard limits (ten per view) are unchanged. TF-IDF remains isolated in
`job_matcher.JobMatcher` for evaluation.

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
