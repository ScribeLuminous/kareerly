# Kareerly

**AI-Powered Job Matching and Skill Gap Analysis with Personalized Upskilling Recommendations**

by: Antoque, Dustine Faith | Macatuno, John Marco

BSCS 4IS2 |   LSPU SAN PABLO

==

Kareerly is a web-based career platform for Philippine job seekers and employers.
A candidate uploads a resume. Kareerly reads it, finds the candidate's skills,
matches them to job postings with a fine-tuned Sentence-Transformer model, explains
each match in terms of matched and missing skills, and recommends learning resources
for the skills still to build. Employers post jobs and review applicants
skills-first, with identity details withheld until the interview stage.

---

## Contents

1. [Project overview](#1-project-overview)
2. [Research objectives](#2-research-objectives)
3. [Main system features](#3-main-system-features)
4. [System architecture](#4-system-architecture)
5. [Technologies and frameworks](#5-technologies-and-frameworks)
6. [Machine learning methodology](#6-machine-learning-methodology)
7. [Resume processing workflow](#7-resume-processing-workflow)
8. [Job matching workflow](#8-job-matching-workflow)
9. [Skill gap analysis](#9-skill-gap-analysis)
10. [Personalized learning recommendations](#10-personalized-learning-recommendations)
11. [Database and external integrations](#11-database-and-external-integrations)
12. [Repository structure](#12-repository-structure)
13. [Installation](#13-installation)
14. [Environment configuration](#14-environment-configuration)
15. [Running the backend](#15-running-the-backend)
16. [Running the frontend](#16-running-the-frontend)
17. [Testing](#17-testing)
18. [Datasets and reference sources](#18-datasets-and-reference-sources)
19. [Deployment](#19-deployment)
20. [Limitations and technical notes](#20-limitations-and-technical-notes)

---

## 1. Project overview

Job seekers often cannot tell which openings they already qualify for, which
ones are within reach, and what to learn to close the difference. Kareerly
addresses this in three steps:

1. **Understand the candidate.** Read the resume (PDF, DOCX, DOC, JPG or PNG,
   including scanned documents) and map the text to canonical skills in an
   ESCO-aligned skill taxonomy. The candidate confirms or edits the skills.
2. **Match and explain.** Rank jobs with a fine-tuned all-MiniLM-L6-v2
   bi-encoder (cosine similarity) combined with transparent skill-coverage rules.
   Jobs are split into **Fit-Now** (ready to apply) and **Aspiration**
   (in the candidate's chosen career direction, with gaps). Every match shows
   why it was placed there.
3. **Close the gaps.** Group the missing skills across the recommended jobs and
   recommend reviewed learning resources for each one.

The platform has three roles: **candidates**, **employers** and
**administrators**.

## 2. Research objectives

The system was built to address the objectives below, as implemented in this
repository.

1. Extract skills from resumes of varied formats and layouts and normalize them
   to a canonical skill taxonomy.
2. Match candidates to jobs with a fine-tuned semantic model combined with
   explainable, rule-based skill coverage.
3. Identify and prioritize each candidate's skill gaps relative to the jobs
   recommended to them.
4. Recommend learning resources that address the identified gaps.
5. Present matches and gaps with explanations that candidates can interpret,
   and support privacy-conscious, skills-first applicant review for employers.

## 3. Main system features

Every feature below is implemented in this repository (file references given).

**Candidates** (`frontend/src/pages/candidate/`, `frontend/src/pages/Onboarding.tsx`)

- Guided onboarding: resume upload (Step 1), skill confirmation of up to 20
  skills, and career preferences (career area, job level, work setup, salary,
  preferred region).
- Fit-Now, Aspiration and Closest-Fit job lists with match percentage, matched
  and missing skills, and a plain-language reason.
- **Skill Gaps** page: missing skills grouped by skill across all in-scope jobs,
  in three priority tiers.
- **Learning** page: courses and certifications per missing skill; progress and
  completions are saved per account.
- "Your resume at a glance" summary, certificate/evidence uploads, Good/Bad
  match ratings, job applications, consent-based messaging and assessments.
- External job analysis: paste any job posting and see how the resume matches it
  (`backend/app/services/external_job_analysis.py`).

**Employers** (`frontend/src/pages/employer/`)

- Job posting (single or bulk upload) with required and nice-to-have skills.
- Applicant review one job at a time: a server-calculated **Profile match** and,
  once a rubric exists, a **Reviewed evaluation** from team scorecards.
- Identity masking: candidate name, email and location are returned only from the
  Interviewing stage on
  (`supabase/migrations/20261117090000_application_privacy_and_integrity.sql`).
- Assessments with deadlines, messaging after candidate consent, applicant
  reports.

**Administrators** (`frontend/src/pages/AdminDashboard.tsx`, `frontend/src/components/admin/`)

- User, job, application and resume management; message moderation; account
  deletion requests; feedback-learning status, rollback and review of proposed
  new skills.

## 4. System architecture

```
 ┌───────────────────────────┐     HTTPS (JSON / multipart)    ┌───────────────────────────────┐
 │  Frontend (Vercel)        │ ──────────────────────────────▶ │  Backend API (Cloud Run)      │
 │  React + TypeScript + Vite│                                 │  FastAPI  backend/app/main.py │
 │  frontend/src/            │ ◀────────────────────────────── │                               │
 └────────────┬──────────────┘                                 │  Resume parsing + OCR         │
              │ Supabase JS (auth, RLS-protected tables)       │  Skill extraction (taxonomy)  │
              ▼                                                │  Bi-encoder matching          │
 ┌───────────────────────────┐   service-role REST             │  Skill gaps + learning recs   │
 │  Supabase                 │ ◀────────────────────────────── │  Feedback re-ranking          │
 │  PostgreSQL, Auth, RLS    │                                 └──────────────┬────────────────┘
 │  supabase/migrations/     │                                                │ loads
 └───────────────────────────┘                                 ┌──────────────▼────────────────┐
                                                               │ backend/trained_models/       │
  GitHub Actions (.github/workflows/):                         │   kareerly-bi-encoder/        │
   • learning-jobs.yml  – daily feedback retrain + skill scan   │ backend/data/ (taxonomy, CSV  │
   • jooble-import.yml  – manual job import                    │   fallback catalogue)         │
                                                               └───────────────────────────────┘
```

- The **frontend** talks to Supabase directly for authentication and
  row-level-security-protected data, and to the backend for anything that needs
  the model or server-side scoring.
- The **backend** is a single FastAPI application (`backend/app/main.py`) with
  its logic in `backend/app/services/` and the feedback-learning jobs in
  `backend/app/learning/`.
- **Supabase** holds accounts, profiles, jobs, applications, messages and the
  learning catalogue. When Supabase is not configured, matching uses the curated
  CSV catalogue in `backend/data/`.

## 5. Technologies and frameworks

| Layer | Technologies |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, React Router, Supabase JS, jsPDF, Mammoth, DOMPurify |
| Backend | Python 3.11 (Docker image), FastAPI, Uvicorn, Pydantic |
| Machine learning | Sentence-Transformers, PyTorch (CPU), NumPy, pandas, scikit-learn (TF-IDF baseline only) |
| Document reading | pypdf, pdfplumber, pypdfium2, Pillow, python-docx, lxml, Tesseract OCR, LibreOffice / antiword (`.doc`) |
| Database | Supabase (PostgreSQL, Auth, Row-Level Security) |
| Optional LLM | Gemma via an OpenAI-compatible endpoint, for pasted-job extraction and explanation only; a deterministic fallback is used when not configured |
| Hosting | Vercel (frontend), Google Cloud Run (backend), GitHub Actions (scheduled jobs) |

## 6. Machine learning methodology

**Production model.** Both matching endpoints use one fine-tuned
**all-MiniLM-L6-v2 Sentence-Transformer bi-encoder**
(`backend/trained_models/kareerly-bi-encoder/`, model ID
`kareerly-skills-first-minilm-2026-09-10`). Candidate text and job text are
encoded separately into normalized embeddings, and their **cosine similarity** is
one component of the match score. Skill explanations are produced by
deterministic rules, not by the model.

- **Base model:** `sentence-transformers/all-MiniLM-L6-v2`.
- **Training:** `backend/models/train_retriever_today.py`, using
  `MultipleNegativesRankingLoss` on resume–job pairs, 3 epochs, learning rate
  1e-5, max sequence length 256, fixed seed. The checkpoint was selected on
  validation NDCG@10 (epoch 3).
- **Model input:** a `[ROLE]` line, up to 32 canonical skill labels ordered by
  training-job IDF, and up to 1,400 characters of contact-redacted supporting
  evidence. Preferences and job location are not part of the model input.
- **Provenance:** `provenance.json` records the base model, weight SHA-256,
  selection rule and evaluation scope. The package contains no training resumes
  or job records.
- **Inference:** job embeddings are precomputed at build time
  (`python -m app.precompute_job_vectors`) and cached; a missing or corrupt
  checkpoint returns a readable HTTP 503 instead of a mislabelled result. There
  is no Cross-Encoder and no TF-IDF fallback in production.

**Baseline.** A TF-IDF + cosine matcher (`backend/app/services/job_matcher.py`,
artifacts in `backend/baseline_models/`) is kept for offline comparison only.

**Feedback re-ranking.** Candidates' Good/Bad ratings train a small, bounded
re-ranking adjustment daily (`backend/app/learning/`). It can change the order
inside Fit-Now and Aspiration but never a job's list or percentage, and it is
disabled until enough feedback exists. See
[`docs/feedback-learning.md`](docs/feedback-learning.md).

**Research code.** `backend/models/` (training and evaluation experiments,
including an experimental Cross-Encoder reranker that is **not** used in
production), `backend/pipeline/` (job-corpus collection and normalization),
`backend/annotation/` (relevance annotation tool) and `backend/evaluation/`
(evaluation sets and a Colab notebook).

Full details: [`backend/README.md` → Production matching algorithm](backend/README.md#production-matching-algorithm).

## 7. Resume processing workflow

Implemented in `backend/app/services/resume_parser.py`, `resume_analyzer.py`,
`skill_extractor.py` and `skill_resolver.py`.

1. **Upload** (`POST /api/resume/analyze`): PDF, DOCX, DOC, JPG or PNG, up to 5 MB.
2. **Text extraction:**
   - PDF with a text layer: pypdf, with multi-column pages read column by column
     (`pdf_layout.py`).
   - Scanned PDFs and images: Tesseract OCR (`ocr.py`).
   - DOCX: body, headers, footers, tables, text boxes and embedded images (OCR).
   - DOC: converted with LibreOffice, or read with antiword.
3. **Cleanup:** Unicode (NFKC) normalization, rejoining skill names split by PDF
   layout (`split_words.py`), and section and field detection
   (`resume_fields.py`). Contact details are redacted from the text the model
   sees (`bi_encoder_service.py`).
4. **Skill extraction:** alias matching against the canonical, ESCO-aligned
   taxonomy (`backend/data/skills_reference.csv`, `skill_aliases.csv`), with
   excluded look-alikes (`skill_alias_exclusions.csv`).
5. **Confirmation:** the candidate reviews up to 20 skills; confirmed skill IDs
   drive coverage and gap calculations.

Extraction quality is measured in `test-data/resume-extraction/` (reports in
`reports/`).

## 8. Job matching workflow

Implemented in `backend/app/services/matching_service.py`, `match_scoring.py`
and `bi_encoder_service.py`. Endpoints: `POST /api/matches/run`,
`POST /api/matches/from-resume`.

1. Build the candidate's model input from the confirmed skills and resume evidence.
2. Encode it and compute cosine similarity against every job embedding.
3. Compute **required** and **preferred** skill coverage from canonical skill IDs.
4. Score each job:

   `score = (0.45·cosine + 0.45·required coverage + 0.10·preferred coverage) / (weights present) − 0.10 per missing critical skill (max 0.20)`

5. Classify:
   - **Fit-Now:** ≥ 70% required-skill coverage, cosine ≥ 0.30, no missing
     critical skill. Preferences do not affect Fit-Now. If no job qualifies, the
     closest job is shown as **Closest Fit**.
   - **Aspiration:** not Fit-Now, in the candidate's chosen career area, ranked
     by job level, work setup and salary alignment, then by score.
   - **Low Match:** scored but not recommended.
6. Apply the region preference, then the optional feedback re-ranking.
7. Return each match with `match_score`, `match_category`,
   `semantic_similarity`, skill coverages, a rule-based `match_reason`, and a
   `match_breakdown` of every component and threshold.

Thresholds were calibrated on a development split
([`docs/matching-diagnosis.md`](docs/matching-diagnosis.md)). Match percentages
are scores × 100, **not** hiring probabilities.

## 9. Skill gap analysis

Implemented in `backend/app/services/skill_gap_aggregation.py` and
`skill_gap_config.py`; endpoint `POST /api/skills/gaps`.

- A gap is a required or nice-to-have job skill (by canonical ID) the candidate
  does not have.
- Gaps are grouped **by skill**: one row lists every in-scope job that needs it.
- Three tiers: required by 2+ jobs; required by 1 or nice-to-have for 2+;
  nice-to-have for 1. Display limits are fixed.
- Related skills and shared words do not count as having the skill.

See [`docs/skill-gaps-by-skill.md`](docs/skill-gaps-by-skill.md).

## 10. Personalized learning recommendations

Implemented in `backend/app/services/learning_recommender.py`,
`resource_links.py` and `credential_links.py`.

- Courses and certifications come from the learning catalogue (Supabase table,
  with `backend/data/learning_resources.csv` as fallback).
- A resource is recommended for a gap only through a **reviewed skill-ID
  mapping** and only if it has a usable provider URL. No keyword or semantic
  model selects courses.
- Resources are ordered per skill, limited per skill, and tracked per account
  (claimed skills, progress, completions).

See [`docs/learning-recommendations.md`](docs/learning-recommendations.md) and
[`docs/learning-paths.md`](docs/learning-paths.md).

## 11. Database and external integrations

**Supabase** (`supabase/`)

- `schema.sql`: consolidated base schema.
- `migrations/`: 38 ordered migrations (row-level security, application privacy,
  server-scored applications, employer evaluation, assessments, feedback
  learning, and more), each described in `migrations/README.md`.
- `seed_*.sql`: learning-catalogue and credential seed data.
- `tests/`: SQL checks for row-level security and database functions.

**External services**

| Service | Use | Where |
|---|---|---|
| Supabase | Auth, database, RLS | frontend and backend |
| Jooble API | Optional manual import of Philippine job listings | `backend/scripts/import_jooble_jobs.py`, `.github/workflows/jooble-import.yml` |
| PSA PSOC 2012 | Occupation reference, published copy committed; no runtime API calls | `backend/data/psoc/`, [`docs/psoc-api-integration.md`](docs/psoc-api-integration.md) |
| ESCO v1.2.1 | Skill taxonomy source | `backend/data/`, [`docs/esco-skill-implementation.md`](docs/esco-skill-implementation.md) |
| Gemma (optional) | Pasted-job extraction and explanation | `backend/app/services/gemma_service.py` |

## 12. Repository structure

```
kareerly/
├── frontend/                  React + TypeScript web app (Vercel)
│   ├── src/pages/             candidate/, employer/, admin and auth pages
│   ├── src/components/        shared UI
│   ├── src/lib/               API client, Supabase client, data helpers
│   ├── tests/                 Node test runner tests (*.test.mjs)
│   └── package.json
├── backend/                   FastAPI service (Cloud Run)
│   ├── app/                   ★ production application
│   │   ├── main.py            API endpoints
│   │   ├── services/          resume parsing, skills, matching, gaps, learning
│   │   ├── learning/          feedback re-ranking and skill discovery
│   │   └── models/schemas.py  request/response models
│   ├── trained_models/kareerly-bi-encoder/   ★ production model checkpoint
│   ├── data/                  taxonomy, aliases, CSV job and course catalogues, PSOC
│   ├── baseline_models/       TF-IDF baseline artifacts (evaluation)
│   ├── models/                ML training and evaluation experiments (research)
│   ├── pipeline/              job-corpus collection and normalization (research)
│   ├── annotation/            relevance annotation tool (research)
│   ├── evaluation/            evaluation sets, sample resumes, Colab notebook
│   ├── scripts/               maintenance and data scripts
│   ├── tests/                 backend tests (pytest / unittest)
│   ├── requirements*.txt, Dockerfile, dev_server.sh, README.md
├── supabase/                  schema, migrations, seeds, SQL tests
├── test-data/
│   ├── synthetic-resumes-180/ 180 fictional Philippine resumes for system tests
│   └── resume-extraction/     extraction QA: manifest, ground truth, reports
├── docs/                      technical documentation (index: docs/README.md)
├── .github/workflows/         scheduled learning jobs and job import
└── README.md
```

The layout follows the deployed architecture (frontend on Vercel, backend on
Cloud Run). Folders should stay where they are, because the Dockerfile, CI
workflows and Python imports depend on these paths.

## 13. Installation

Prerequisites: **Python 3.11+**, **Node.js 20.19+** (22 LTS recommended) and npm, and optionally
**Tesseract OCR** and **LibreOffice** or **antiword** for scanned and `.doc`
resumes.

```bash
git clone https://github.com/ScribeLuminous/kareerly.git
cd kareerly

# Backend
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt

# Frontend
cd frontend
npm ci
cd ..
```

`backend/requirements.txt` installs CPU-only PyTorch from
`download.pytorch.org`. If that host is unreachable, install the remaining
packages from PyPI; the default PyPI PyTorch build also works.

On Debian or Ubuntu, the optional system packages are:

```bash
sudo apt-get install tesseract-ocr antiword libreoffice-writer
```

## 14. Environment configuration

Copy the templates and fill in your own values. **Never commit `.env` files**:
they are already excluded by `.gitignore`.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

| Variable | File | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | backend | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | Server-side writes (secret; backend only) |
| `MESSAGE_ENCRYPTION_KEY` | backend | Encrypts stored messages |
| `FRONTEND_URLS` | backend | Allowed CORS origins |
| `KAREERLY_BI_ENCODER_MODEL_PATH` | backend | Optional; defaults to the bundled checkpoint |
| `GEMMA_*` | backend | Optional LLM for pasted-job analysis |
| `JOOBLE_API_KEY`, `PSA_API_TOKEN` | backend | Maintainer scripts only |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | frontend | Supabase project (public anon key) |
| `VITE_API_BASE_URL` | frontend | Backend URL, e.g. `http://127.0.0.1:8000` |

Every variable is commented in the two `.env.example` files.

## 15. Running the backend

From the repository root:

```bash
source backend/.venv/bin/activate
uvicorn backend.app.main:app --reload --port 8000
```

Or run it in the background with `bash backend/dev_server.sh start`
(`status`, `logs`, `stop`), which also turns on the interactive API docs at
<http://127.0.0.1:8000/docs>.

Quick checks:

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/health/config
```

`/api/health/config` reports whether the model files, OCR tools and PSOC
reference are present.

## 16. Running the frontend

```bash
cd frontend
npm run dev            # starts the backend (port 8000) and then Vite (port 5173)
npm run dev:frontend   # Vite only, when the backend is already running
npm run build          # production build into frontend/dist
```

Open <http://127.0.0.1:5173>. `npm run build` requires `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` to be set.

## 17. Testing

```bash
# Backend (53 test modules)
pip install -r backend/requirements-test.txt
python -m pytest backend/tests -q

# Frontend (42 test files), lint and type-checked build
cd frontend
npm test
npm run lint
npm run build

# Database row-level security and function checks (needs PostgreSQL server binaries)
bash supabase/tests/run_rls_tests.sh

# Resume extraction ground truth
python test-data/resume-extraction/scripts/validate_ground_truth.py
```

OCR and `.doc` tests are skipped automatically when Tesseract or LibreOffice
is not installed.

## 18. Datasets and reference sources

| Data | Location | Source / notes |
|---|---|---|
| Skill taxonomy and aliases | `backend/data/skills_reference.csv`, `skill_aliases.csv`, `*_meta.json` | ESCO v1.2.1 (European Commission), curated and reviewed; checksums in `skill_aliases_meta.json` |
| Reference job catalogue | `backend/data/reference_jobs.csv` | Curated job postings with reviewed skill IDs; reviewed in [`docs/job-data-anomalies.md`](docs/job-data-anomalies.md) |
| Learning catalogue | `backend/data/learning_resources.csv`, `supabase/seed_*.sql` | Public course and certification pages, mapped to skill IDs |
| Occupation reference | `backend/data/psoc/` | PSA PSOC 2012, retrieved 2026-09-27 (`psoc_reference_meta.json`) |
| Synthetic test resumes | `test-data/synthetic-resumes-180/` | 180 fictional resumes for system tests; **not** research data |
| Extraction QA samples | `test-data/resume-extraction/` | Manifest and ground truth only; the third-party sample files are not redistributed |
| Evaluation sets | `backend/evaluation/` | Expected skills, matches, gaps and courses; mock resumes |
| Training corpus | not committed (`backend/data/corpus/`) | Kept on the maintainer's machine because of redistribution terms |

The training corpus, raw source datasets and third-party resume samples are
deliberately **not** in the repository. Their redistribution rights were not
verified. Their provenance is recorded in the files above.

## 19. Deployment

- **Frontend:** Vercel, built from `frontend/` (`frontend/vercel.json` sets SPA
  routing and security headers). Vercel redeploys from `main`.
- **Backend:** Google Cloud Run from `backend/Dockerfile` (Python 3.11 slim,
  CPU PyTorch, Tesseract, antiword, with the model baked into the image).
  Configuration is passed through a git-ignored `backend/cloudrun.env.yaml`.
- **Scheduled jobs:** GitHub Actions (`.github/workflows/learning-jobs.yml`
  daily; `jooble-import.yml` manual). Both need repository secrets and do
  nothing without them.

Step-by-step deployment and troubleshooting:
[`backend/README.md` → Google Cloud Run deployment](backend/README.md#google-cloud-run-deployment).

## 20. Limitations and technical notes

- **Evaluation labels.** The bi-encoder was selected on algorithmic weak
  relevance labels, not human relevance judgements. Offline metrics are not
  hiring accuracy (`provenance.json`, `evaluation_scope`).
- **Match percentages** are composite scores, not probabilities of being hired.
- **Thresholds** (Fit-Now, Aspiration) are calibrated constants, not trained
  parameters, and can be overridden by environment variables.
- **Identity masking** limits early exposure of direct identifiers. It does not
  prove that hiring bias is reduced, because resumes may contain indirect proxies.
- **Language:** the base model (all-MiniLM-L6-v2) and the ESCO skill labels used
  are English.
- **OCR** quality depends on scan quality. A failed OCR returns a warning, not
  guessed skills.
- **Synthetic data:** the 180 test resumes are fictional and must not be
  reported as real job-seeker results.
- **Bundle size:** the production frontend bundle has one chunk over 500 kB
  (a build warning, not an error).

More technical documentation is indexed in [`docs/README.md`](docs/README.md).
