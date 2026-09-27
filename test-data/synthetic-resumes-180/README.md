# Synthetic Philippine test resumes (180)

System-test fixtures for Kareerly: parsing, skill normalization, matching,
region filtering and category-boundary checks. Every person, employer, email
address and phone number in this folder is fictional.

**Not research data.** Do not add these resumes to model training, validation
or held-out thesis test sets, use them for checkpoint selection, or report
metrics on them as if they were real job seekers. Never use the contact
details to send email or SMS or to place calls.

## Layout

- `scripts/specs.py`: hand-curated candidate specifications (canonical skill IDs)
- `scripts/reference.py`: regions, approved locations, name pools, layouts
- `scripts/generate_matrix.py`: builds `generation_matrix.json` / `.csv` (seed 20260928)
- `scripts/validate_dataset.py --matrix`: allocation, location, naming, layout and skill checks

Regenerate and check:

```bash
python3 test-data/synthetic-resumes-180/scripts/generate_matrix.py
python3 test-data/synthetic-resumes-180/scripts/validate_dataset.py --matrix
```

The scripts read `backend/data/category_reference.csv`, `skills_reference.csv`
and `reference_jobs.csv` and change nothing outside this folder.
