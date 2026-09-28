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
- `scripts/layouts.py`: section order, headings and wording rules for the 10 layouts
- `content/<candidate_id>.json`: each resume's individually written text (the record of the dataset)
- `scripts/render_pdfs.py`: renders `controlled/` and `stress-tests/` PDFs and writes `manifest.json` / `.csv`
- `scripts/check_similarity.py`: near-duplicate checks (writes `similarity_report.csv`)
- `scripts/validate_dataset.py`: `--matrix`, `--content` and `--pdfs` checks

Regenerate and check (the PDF steps need `scripts/requirements.txt` in a separate venv,
never the backend's production requirements):

```bash
cd test-data/synthetic-resumes-180
python3 scripts/generate_matrix.py
python3 scripts/validate_dataset.py --matrix
python3 scripts/validate_dataset.py --content
python3 scripts/check_similarity.py
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/render_pdfs.py
.venv/bin/python scripts/validate_dataset.py --pdfs
```

PDFs are byte-identical across runs given the same ReportLab version and the
DejaVu Sans font files (see generation_report.md for their checksums).

The scripts read `backend/data/category_reference.csv`, `skills_reference.csv`
and `reference_jobs.csv` and change nothing outside this folder.
