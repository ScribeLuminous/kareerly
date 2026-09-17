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

### Start frontend and backend together

After installing the dependencies above, run `npm run dev:full` from `frontend/`. This starts FastAPI, waits for `/api/health`, then starts Vite. It reuses a healthy backend that is already running. Ctrl+C stops only processes started by this command. `npm run dev` still starts the frontend alone.

A connection error means the browser could not reach the API; it is separate from having no reviewed learning resources. For a hosted frontend, configure `VITE_API_BASE_URL` to the deployed HTTPS backend before building, and allow the frontend origin in the backend's `FRONTEND_URLS`. A hosted site must not use `127.0.0.1` as its backend address.
