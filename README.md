# Kareerly

Kareerly is a Vite/React frontend with a FastAPI matching backend and Supabase persistence.

## Project layout

- `backend/app/`: canonical FastAPI application and services
- `backend/data/`: curated CSV fallback and seed datasets
- `backend/baseline_models/`: TF-IDF evaluation/retrieval artifacts
- `backend/evaluation/`: thesis evaluation material and retained legacy inputs
- `frontend/`: Vite/React application
- `supabase/`: database schema and migrations

Cross-Encoder BERT is the primary semantic ranker for job matches and learning-resource relevance. TF-IDF is retained only as a baseline and large-catalog retrieval helper.

## Run locally

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

```bash
cd frontend
npm ci
npm run dev
```
