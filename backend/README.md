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

## Resume file reading (PDF, DOCX, DOC, scanned resumes)

`POST /api/resume/analyze` (Step 1) and `POST /api/matches/from-resume` read an
upload through `app/services/resume_parser.py::extract_resume_document`, so both
see the same text:

| Format | How it is read |
| --- | --- |
| PDF with a text layer | pypdf; pages with two or three columns (found from word boxes with pdfplumber) are read column by column (`pdf_layout.py`). |
| Scanned / image-only PDF | Pages with almost no text are rendered (pypdfium2) and read with **tesseract OCR** (`ocr.py`). A failed or unavailable OCR returns a warning, never guessed skills. |
| DOCX | Body, headers, footers, tables, content controls, text boxes (the VML fallback copy is skipped), SmartArt (data part only) and, with OCR, text inside embedded images not already in the document. |
| DOC (Word 97-2003) | Converted by **LibreOffice** to DOCX when installed, otherwise read by **antiword**; both run in a private temporary folder with a timeout. |

Skill names a PDF split into pieces ("Sales force", "Quick Books", "Zen" + line
break + "desk") are rejoined only when the result is a known skill name and the
capitalisation fits (`split_words.py`); prose such as "a sales force of 12" is
left alone.

Limits: 5MB per file, 15 pages read, OCR on at most 5 pages (25s each, 60s per
resume, two OCR jobs at a time), six DOCX images, 45s per `.doc` conversion,
60,000 characters of text. Uploads are read in memory; nothing is written to
disk except the `.doc` converter's input, which is deleted straight away.

### System packages

OCR and `.doc` support need programs outside pip. `backend/Dockerfile` installs
`tesseract-ocr`, `tesseract-ocr-eng` and `antiword`; build with
`--build-arg INSTALL_LIBREOFFICE=1` to add LibreOffice Writer (about 300MB) for
better `.doc` fidelity and very short `.doc` files antiword refuses. Locally:

```bash
sudo apt-get install tesseract-ocr tesseract-ocr-eng antiword   # Debian/Ubuntu
brew install tesseract antiword                                  # macOS
```

The production backend runs on Google Cloud Run, built from
`backend/Dockerfile`, so OCR and `.doc` support are included (see
[Google Cloud Run deployment](#google-cloud-run-deployment)). A host that runs
plain Python without the Dockerfile cannot install these packages; the backend
still starts there, text-based PDF and DOCX work as before, and scanned PDFs
or `.doc` uploads get a clear message asking for a text-based PDF or DOCX. `GET /api/health/config` reports which readers are
available under `resume_readers`.

Optional settings: `KAREERLY_TESSERACT_CMD`, `KAREERLY_SOFFICE_CMD`,
`KAREERLY_ANTIWORD_CMD` (explicit program paths), `KAREERLY_OCR_LANGUAGES`
(default `eng`; install the matching `tesseract-ocr-*` package),
`KAREERLY_OCR_MAX_CONCURRENT` and `KAREERLY_DOC_MAX_CONCURRENT` (default 2).

Test fixtures for every format are in `tests/fixtures/resumes/`; rebuild them
with `python -m backend.tests.fixtures.resumes.build_fixtures`.

### Resumes analysed before this reader

Signed-in candidates' original files are kept in the private `resumes` storage
bucket. A saved analysis records `extraction.parser_version`; when it is missing
or older, the dashboard says the skills come from an earlier analysis and offers
**Re-scan saved resume** (the file is downloaded through the candidate's own
session and re-analysed; the new analysis points at the same stored file, so no
second copy is made). When no stored file is found (guest uploads, or rows from
before files were kept), it asks the candidate to upload the resume again.

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
3. Upload a PDF, DOCX or DOC resume (scanned PDFs are read with OCR).
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

- Resume parsing: PDF (text layer, multi-column, OCR for scans), DOCX and DOC
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

## Google Cloud Run deployment

The backend is a container on **Google Cloud Run**, built from
`backend/Dockerfile`; the website is on Vercel. The Dockerfile installs the CPU
build of torch, tesseract and antiword, precomputes the job vectors, and starts
uvicorn on `$PORT` (8080 by default), which is the port Cloud Run sends
traffic to.

Commands below use two placeholders. Set them once per shell:

```bash
REGION=asia-southeast1                                  # the service's region
BACKEND=https://YOUR-SERVICE-URL.run.app                # printed by the first deploy
```

### Deploy

From the repository root, build `backend/` with Cloud Build and deploy it:

```bash
gcloud run deploy kareerly-backend \
  --source backend \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 2Gi --cpu 1 \
  --timeout 300 \
  --no-cpu-throttling --cpu-boost \
  --env-vars-file backend/cloudrun.env.yaml \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,MESSAGE_ENCRYPTION_KEY=message-encryption-key:latest
```

Why these settings:

- **`--memory 2Gi`**: the service peaks at about 1 GB with the encoder and job
  vectors loaded and a report running; 2 GiB leaves room for OCR and two
  concurrent reports. An instance that runs out is restarted, and the logs
  show `Memory limit of ... exceeded`.
- **`--timeout 300`**: the website waits up to 240 s for a report (cold start
  plus matching); Cloud Run's timeout must be longer.
- **`--no-cpu-throttling`**: by default Cloud Run gives an instance CPU only
  while a request is in flight. Two things here run outside a request: the
  startup warmup of the encoder and job vectors, and saving a signed-in
  report to Supabase after the response is sent. With throttled CPU both
  stall, and the first report pays the warmup itself.
- **`--cpu-boost`**: extra CPU while the container starts, so the warmup
  (about 15 s) finishes sooner.
- Optionally **`--min-instances 1`** keeps one instance warm, so no report
  pays a cold start; it is billed while idle.

Build from the repository root so `--source backend` uploads only the backend
folder; the bundled checkpoint (`backend/trained_models/`, about 90 MB) and
`backend/data/` are part of it. `backend/.gcloudignore` keeps local virtual
environments, caches, `.env` files and `cloudrun.env.yaml` out of the upload. The image build needs outbound internet only
(PyPI, the PyTorch CPU index, and Supabase for the job-vector precompute).

### Configuration

Put non-secret settings in `backend/cloudrun.env.yaml` (not committed; one
`KEY: value` per line). A YAML file is used because `FRONTEND_URLS` contains
commas, which `--set-env-vars` would split:

```yaml
SUPABASE_URL: https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY: YOUR-ANON-KEY
FRONTEND_URLS: https://YOUR-PUBLIC-WEBSITE.vercel.app,https://www.YOUR-DOMAIN
KAREERLY_WARM_ON_STARTUP: "1"
```

Keep secrets in Secret Manager and map them with `--set-secrets`, as above
(create each once with `gcloud secrets create NAME --data-file=-`). The
service account that runs the service needs the *Secret Manager Secret
Accessor* role on them. `backend/.env.example` lists every setting.

To change one setting without rebuilding:

```bash
gcloud run services update kareerly-backend --region "$REGION" --env-vars-file backend/cloudrun.env.yaml
```

### Redeploying after a merge

A merge to `main` does not redeploy Cloud Run by itself. Run the
`gcloud run deploy` command again, or connect the repository once under
*Cloud Run → the service → Set up continuous deployment* (a Cloud Build
trigger on `main` with `backend/Dockerfile`), so every merge builds and
deploys. Vercel redeploys the website from `main` on its own.

### Logs

Logs Explorer (*Cloud Run → the service → Logs*), or:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="kareerly-backend"' \
  --limit 100 --freshness 1h
```

## Vercel and Cloud Run connection checks

Set Vercel's `VITE_API_BASE_URL` to the Cloud Run service URL (`$BACKEND`),
without `/api`, and redeploy Vercel. Vercel builds reject missing, localhost,
and malformed backend origins. In Cloud Run, set `FRONTEND_URLS` to a
comma-separated list of the exact public website origins allowed to call the
API. A Vercel dashboard URL such as `https://vercel.com/team/project` is not a
website origin. Include any preview origins you actually use; changing a
setting creates a new revision, which takes effect without a rebuild.

Check both health and the browser preflight; health alone does not verify CORS:

```bash
curl -i "$BACKEND/api/health"
curl -i -X OPTIONS "$BACKEND/api/matches/from-resume" \
  -H 'Origin: https://YOUR-PUBLIC-WEBSITE.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization'
```

The preflight must return 200 and `Access-Control-Allow-Origin` matching the
website. `400 Disallowed CORS origin` means the service's `FRONTEND_URLS`
needs that origin. Matching runs in a worker thread so inference does not block
the API event loop, and failures appear in the service logs.

`/api/health/config` reports the origins the running service actually accepts
and whether the checkpoint files are in place, which is the fastest way to tell
a stale `FRONTEND_URLS` apart from a bad deploy:

```bash
curl -s "$BACKEND/api/health/config"
```

It checks the checkpoint by path only and never loads it, so it stays
responsive while matching is running.

### "Job matching timed out" on the deployed website

The encoder and the job embeddings are built the first time a request needs them.
Paid inside a request on a small instance, that alone can outlast the client's
timeout, so the service looks broken while it is merely starting.

Startup now warms both on a daemon thread. The port opens immediately, so health
checks answer while the warmup runs, and matching requests that arrive afterwards
skip the load entirely. Watch it finish with the `model.loaded` flag:

```bash
curl -s "$BACKEND/api/health/config"
```

A warmup that fails is logged and does not stop the service: matching still
raises its own readable errors per request. Set `KAREERLY_WARM_ON_STARTUP=0` to
turn it off (useful locally, where paying the load lazily is cheaper than
warming on every reload).

With no instance running (Cloud Run scales to zero unless `--min-instances` is
set), the first request also pays a container start, so the client allows
matching requests 240s. On Cloud Run the warmup needs CPU outside requests;
deploy with `--no-cpu-throttling` (see [Deploy](#deploy)).

Job embeddings are computed at build time so that cold start does not encode the
catalogue. `backend/Dockerfile` runs this already; a build without the
Dockerfile runs it after installing the requirements:

```bash
python -m app.precompute_job_vectors            # backend root directory
python -m backend.app.precompute_job_vectors    # repository root directory
```

It encodes `data/reference_jobs.csv` and the active Supabase jobs (read with the
public anon key, like the service does; no build secrets needed) into `backend/precomputed/job_vectors.npz` (not committed; move
it with `KAREERLY_JOB_VECTORS_PATH` for both build and service). Vectors are keyed
by the exact encoder input, so jobs added or edited after the build are encoded
on demand, and a store built for other model weights is ignored. The service
logs `Loaded N precomputed job vectors` at startup when the store is in use.
The build log names the job count from each source; a `Supabase jobs unavailable`
warning means the build could not reach Supabase and those jobs will be encoded
on demand instead.

### "Cannot reach the job matching backend" on the deployed website

Before reporting the error, the website sends an opaque `no-cors` probe to
`/api/health`:

- *"answered, but the request could not complete"* — something responded at
  the backend origin, but an opaque response does not reveal what. Check the
  actual response and preflight headers (above) before changing
  `FRONTEND_URLS`.
- *"not responding"* — the service is down, starting, or failing to boot.
  Check the service logs. A revision that never becomes ready usually failed
  to start (a Python traceback) or ran out of memory (`Memory limit of ...
  exceeded`); Cloud Run keeps serving the previous revision in that case.

The browser's report request uses `/api/matches/run-form` as a simple
multipart request to avoid the JSON preflight, while the JSON endpoint remains
available for other clients. If a proxy or CDN is put in front of the service
(a custom domain through Cloudflare, for example) and it challenges requests,
its response carries none of FastAPI's CORS headers, however `FRONTEND_URLS`
is set; check that layer's logs first.

`requirements.txt` carries an `--extra-index-url` for the CPU-only torch index.
The default PyPI wheel bundles the CUDA runtime, which a CPU instance cannot use
and which pulls in gigabytes of NVIDIA packages — enough to fail the build or get
the process killed at startup. Keep that line when editing the file.

`--extra-index-url` only *prefers* the CPU build (a `+cpu` version sorts above the
plain one). `backend/Dockerfile` makes it certain by installing torch from the
CPU index first:

```bash
pip install --index-url https://download.pytorch.org/whl/cpu torch && pip install -r requirements.txt
```

The second command then sees torch as already satisfied; use the same two
commands for any build without the Dockerfile. To confirm which build a deploy got, run
`pip show torch` — a `+cpu` version, or the absence of `nvidia-*` packages in
`pip list`, means the CPU wheel was used.

## Production matching algorithm

Both `/api/matches/run` and `/api/matches/from-resume` use the same fine-tuned
all-MiniLM-L6-v2 Sentence-Transformer bi-encoder. Candidate and job text are
encoded separately; cosine similarity is one component of the composite ranking score. Job embeddings
are precomputed at build time and cached per job input, so only new or edited jobs are re-encoded. There is no Cross-Encoder or TF-IDF
production fallback. Missing or corrupt model artifacts return readable 503
responses rather than a result labeled as the trained model.

The verified epoch-three checkpoint is packaged in
`backend/trained_models/kareerly-bi-encoder/`, with model configuration,
tokenizer, pooling configuration, frozen training-derived skill IDF features,
and checksum provenance. Its weights match the saved September 10 experiment.
The package contains no training resumes or job records. Include the entire
model directory when committing/deploying; the `.gitignore` exception keeps
this specific production weight file available to Git. The Dockerfile copies
it into the image. Without the Dockerfile, run from the repository root with
`pip install -r backend/requirements.txt` and
`uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`, or from `backend/`
with `pip install -r requirements.txt` and `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
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

Scoring and classification live in `backend/app/services/match_scoring.py` and
are shared by the catalogue and pasted-job paths:

- `score = (0.45·cosine + 0.45·required coverage + 0.10·preferred coverage) /
  (weights of the components present) − 0.10 per missing critical skill (max 0.20)`
- **Fit-Now** (resume only): required skills are listed, the resume skills
  cover at least 75% of them, cosine ≥ 0.30, and no critical skill is missing.
  A critical skill is a must-have singled out from the required list.
  Preferences never affect Fit-Now.
- **Aspiration** (Step 3 preferences): not Fit-Now and in the career area the
  candidate chose; ranked by job level, work setup and salary alignment, then
  by the resume match score. Without a known career area (no preference, or an
  uncategorised job) it falls back to cosine ≥ 0.20 and at least one held skill.
- **Low Match**: everything else; scored, but never recommended.

Thresholds were calibrated on the development split of the score-distribution
diagnostic. `docs/matching-diagnosis.md` records the evidence, and
`KAREERLY_FIT_NOW_MIN_COSINE`, `KAREERLY_FIT_NOW_MIN_COVERAGE` and
`KAREERLY_ASPIRATION_MIN_COSINE` override them. None of these values are
trained parameters, and no job is promoted merely to fill the Fit-Now view.

Fit-Now is ranked by the composite score and Aspiration by preference alignment then the composite score, with cosine, coverage, preference
alignment and reviewed learning-resource coverage as deterministic tie-breakers.
Learning availability requires a reviewed skill-ID mapping and a usable provider
URL, with no keyword or semantic learning model. Match percentages are the
composite score times 100, not hiring probabilities.

Every match carries `match_score`, `match_category`, `semantic_similarity`,
`required_skill_coverage`, `preferred_skill_coverage`, `match_reason` and a
`match_breakdown` listing the components, the penalty, the failed Fit-Now rules
and the thresholds in force. To inspect one resume against the catalogue:

```bash
backend/.venv/bin/python -m backend.scripts.diagnose_match_distribution \
    --inspect-resume path/to/resume.pdf [--job-id JOB-001]
```

With an active feedback model, the order inside Fit-Now and Aspiration also includes a bounded
adjustment learned from candidates' Good/Bad ratings. It never changes a job's list or its percentage,
and it falls back to the order above whenever no valid model is available. Approved skills from skill
discovery are merged into the taxonomy at runtime. See `docs/feedback-learning.md`.

Guest limits (three per view), registered initial limits (five per view), and
full dashboard limits (ten per view) are unchanged. TF-IDF remains isolated in
`job_matcher.JobMatcher` for evaluation.

Regression checks:

```bash
backend/.venv/bin/python -m pip install -r backend/requirements-test.txt
backend/.venv/bin/python -m unittest discover -s backend/tests -v
npm --prefix frontend test
npm --prefix frontend run build
bash supabase/tests/run_rls_tests.sh   # RLS checks for the learning migration (needs PostgreSQL)
```

Evidence is currently stored in dashboard state with browser blob URLs, not durable
storage. Resume re-analysis no longer changes it; a dashboard unmount or page reload
still clears it. PDF validation only checks size and basic structure. A successful
`status: valid` response means file checks passed, never credential verification.
