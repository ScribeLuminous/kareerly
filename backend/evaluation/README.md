# Evaluation assets

This folder contains evaluation scripts, expected outputs, synthetic samples, and unique source data retained for reproducibility.

- `sample_resumes/`: synthetic/mock evaluation resumes
- `source_data/`: original raw source datasets not used by the runtime. Kept on the maintainer's machine only; it is git-ignored and not in the repository.

The active runtime code is under `backend/app/`; TF-IDF baseline artifacts are under `backend/baseline_models/`.
