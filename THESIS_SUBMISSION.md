# Thesis Submission

> Items marked **⚠ TO BE CONFIRMED** could not be verified from the repository
> or the GitHub configuration. They must be filled in from the official thesis
> title page or approved manuscript before submission.

## Thesis project information

| Item | Value |
|---|---|
| Thesis title | **AI-Powered Job Matching and Skill Gap Analysis with Personalized Upskilling Recommendations** |
| System name | Kareerly |
| Group members | ⚠ TO BE CONFIRMED: complete names as written on the official thesis title page |
| University | ⚠ TO BE CONFIRMED |
| College / department | ⚠ TO BE CONFIRMED |
| GitHub organization | ⚠ TO BE CONFIRMED: the repository is not currently owned by or shared with any GitHub organization (see below) |
| GitHub repository name | `kareerly` |
| Repository URL | <https://github.com/ScribeLuminous/kareerly> |
| Default branch | `main` |

## Repository contents

| What | Where |
|---|---|
| Frontend source code | `frontend/src/` (React + TypeScript). Candidate pages: `frontend/src/pages/candidate/`; employer pages: `frontend/src/pages/employer/`; admin: `frontend/src/pages/AdminDashboard.tsx` |
| Backend source code | `backend/app/` (FastAPI). API endpoints: `backend/app/main.py`; services: `backend/app/services/` |
| Machine learning (production) | Model checkpoint: `backend/trained_models/kareerly-bi-encoder/`; inference: `backend/app/services/bi_encoder_service.py`; scoring and classification: `backend/app/services/match_scoring.py`, `matching_service.py` |
| Machine learning (training and research) | `backend/models/` (training and evaluation; `train_retriever_today.py` trained the production bi-encoder), `backend/pipeline/` (job-corpus pipeline), `backend/annotation/` (annotation tool) |
| Resume parsing and skill extraction | `backend/app/services/resume_parser.py`, `resume_analyzer.py`, `skill_extractor.py`, `skill_resolver.py`, `ocr.py` |
| Skill gap analysis | `backend/app/services/skill_gap_aggregation.py`, `skill_gap_config.py` |
| Learning recommendations | `backend/app/services/learning_recommender.py` |
| Dataset and reference files | `backend/data/` (skill taxonomy, job and course catalogues, PSOC), `backend/evaluation/` (evaluation sets), `test-data/` (synthetic resumes, extraction ground truth) |
| Database configuration and migrations | `supabase/schema.sql`, `supabase/migrations/`, `supabase/seed_*.sql` |
| Testing files | `backend/tests/`, `frontend/tests/`, `supabase/tests/`, `test-data/resume-extraction/scripts/` |
| System documentation | `README.md`, `docs/` (index: `docs/README.md`), `backend/README.md` |
| Deployment configuration | `backend/Dockerfile`, `frontend/vercel.json`, `.github/workflows/` |

The matching method is a fine-tuned **all-MiniLM-L6-v2 Sentence-Transformer
bi-encoder** using cosine similarity, combined with rule-based skill coverage
and explanations. See `README.md` sections 6 to 10.

## Repository accessibility

Checked on 2026-11-24 using the GitHub API.

| Check | Result |
|---|---|
| Repository exists | Yes: `ScribeLuminous/kareerly` |
| Local clone's remote | `origin` → `https://github.com/ScribeLuminous/kareerly` (correct) |
| Visibility | **Private** |
| Owner | Personal user account `ScribeLuminous` (not an organization) |
| Organization ownership / sharing | **None.** The repository is not in an organization, and no organization teams have access |
| Collaborators with access | 1: `ScribeLuminous` (admin) |
| Accessible to evaluators? | **No, not yet.** Because the repository is private and has no other collaborators, the link returns "404 Not Found" for anyone else, including thesis advisers, panel members and organization members |
| README and submission documents | Present at the repository root |

### Options to make the repository available (owner decision required)

None of these have been done. Each needs the repository owner's approval.

1. **Transfer to the thesis organization** (Settings → General → Danger Zone →
   Transfer ownership). The owner must be allowed to create repositories in the
   organization. Then give the evaluators' team at least **Read** access. The old
   URL redirects to the new one, but the URL above should be updated.
2. **Keep it under the personal account and add evaluators as collaborators**
   (Settings → Collaborators → Add people, **Read** role). This does not satisfy
   an "organization" requirement.
3. **Fork or mirror into the organization**, if the organization requires its
   own copy and the original should stay personal.
4. **Change visibility to Public**, only if the university allows it. This would
   also publish the committed reference data and documentation.

After any change, verify access by opening the repository URL while signed in
as an evaluator account, or in a private browser window if it is public.

## Submission checklist

- [x] Source code for frontend, backend, ML model and database is in the repository
- [x] Production model checkpoint committed with provenance
- [x] README with overview, architecture, setup, testing and deployment
- [x] No credentials committed (`.env` files excluded; templates contain names only)
- [x] Backend, frontend and database test suites pass
- [ ] Group member names confirmed from the official title page
- [ ] University and college/department confirmed
- [ ] GitHub organization identified
- [ ] Repository shared with the organization / evaluators, and access verified
- [ ] Cleanup pull request merged into `main`
