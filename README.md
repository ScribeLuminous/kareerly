# Kareerly

Kareerly is a Vite/React frontend with a FastAPI matching backend and Supabase persistence.

## Project layout

- `backend/app/`: canonical FastAPI application and services
- `backend/data/`: curated CSV fallback and seed datasets
- `backend/baseline_models/`: TF-IDF evaluation/retrieval artifacts
- `backend/evaluation/`: thesis evaluation material and retained legacy inputs
- `frontend/`: Vite/React application
- `supabase/`: database schema and migrations

Both job matching endpoints use the shared fine-tuned all-MiniLM-L6-v2 bi-encoder and cosine similarity, with deterministic canonical skill coverage and preference explanations. The verified checkpoint is bundled in `backend/trained_models/kareerly-bi-encoder/`. Learning resources use reviewed skill-ID mappings; TF-IDF is retained only for offline evaluation. See `backend/README.md` for model provenance and deployment (website on Vercel, backend on Google Cloud Run).

Candidates choose where they want to work (anywhere in the Philippines, their current region, or a chosen region), separately from work setup. With a region chosen, on-site and hybrid jobs outside it, or whose region cannot be confirmed from the job location, are left out before the top Fit-Now and Aspiration matches are picked; remote jobs stay when the work setup allows remote work, and scores are unchanged. `backend/app/services/ph_regions.py` holds the one location-to-region mapping; the saved choice needs migration `supabase/migrations/20260927090000_candidate_region_preference.sql`.

Candidates can rate matches (Good/Bad). A scheduled job uses those ratings to adjust the order within Fit-Now and Aspiration once enough feedback exists, and proposes new skills for admin review. See `docs/feedback-learning.md` for what runs automatically, what needs review, and how to roll back.

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

`npm run dev` starts the FastAPI backend on port `8000` before starting Vite. If
FastAPI is already running separately, use `npm run dev:frontend` to start only
the frontend.
