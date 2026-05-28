# Kareerly Backend

Local setup:

```bash
cd /Users/dustinef/Documents/ADM-Thesis/kareerly_system
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
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

Optional Google Programmable Search API:

```bash
export GOOGLE_CSE_API_KEY="your_api_key"
export GOOGLE_CSE_ID="your_search_engine_id"
```

Place the real dataset at:

```text
backend/jobs_record.csv
```

The backend uses demo jobs when `jobs_record.csv` is not present.

## Baseline Matching Model (Thesis Baseline)

Current baseline implementation includes:

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
