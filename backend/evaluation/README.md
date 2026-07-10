# Evaluation assets

This folder contains thesis evaluation scripts, expected outputs, synthetic samples, and retained legacy implementations.

- `sample_resumes/`: synthetic/mock evaluation resumes
- `private_resume_review/`: ignored local material requiring privacy review
- `legacy/`: obsolete or source-only implementations retained for comparison
- `legacy/source_data/`: partial or raw source datasets not used by the runtime
- `legacy/source_models/`: older TF-IDF generations retained for reproducibility

The active runtime code is under `backend/app/`; TF-IDF baseline artifacts are under `backend/baseline_models/`.
