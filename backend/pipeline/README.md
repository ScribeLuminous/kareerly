# Kareerly corpus pipeline

Collect -> immutable raw snapshots -> normalization and source exclusion ->
taxonomy skill proposals -> quality review. Collection is not supervised training.

## Current source strategy

Use JSearch as a bounded discovery pilot across all 13 retained categories,
with reviewed direct-employer postings and public ATS postings as supplements.
Measure actual coverage before choosing a corpus backbone. A query mentioning
Philippines or a category does not validate a posting's location or occupation.

The existing JSearch adapter uses RapidAPI credentials. OpenWeb Ninja also offers
a direct API with different authentication; its key is not interchangeable here.
The vendor advertises 200 monthly requests on its direct free tier, but verify
YOUR RapidAPI subscription allowance and billing before collection. Multi-page
requests must not be assumed to cost one unit.

From `backend`, export `JSEARCH_API_KEY` in your shell, then run:

```bash
.venv/bin/python -m pipeline.cli collect --source jsearch \
  --plan pipeline/plans/ph_jsearch_k13.json \
  --request-budget 39 --run-id ph-jsearch-k13-2026-09-09
.venv/bin/python -m pipeline.cli normalize
.venv/bin/python -m pipeline.cli label
.venv/bin/python -m pipeline.cli report
```

The plan contains 39 queries, one location and one page per query. The request
budget bounds API calls, not billable units. Missing keys stop before collection.
Existing raw run IDs cannot be overwritten. Provider errors fail the command;
partial snapshots are retained for audit and are not complete runs.

| Source | Role |
|---|---|
| JSearch | Cross-category discovery pilot; coverage and rights require review |
| Direct employers / Lever / Greenhouse / SmartRecruiters | Reviewed supplementary postings; classify by duties, not platform |
| Tabular | Import licensed CSV/JSONL datasets with recorded provenance |
| Jooble | Deprecated for research collection; Jooble-origin records excluded at normalization |
| PhilJobNet | Existing adapter remains unimplemented pending a data arrangement |

Public GET endpoints establish technical access, not blanket training or
redistribution rights. Record applicable terms and original publisher for each
source. Do not describe JSearch as guaranteeing sanctioned reuse of every board.
Do not interpret robots.txt as a research licence.

## Sampling and evaluation

Keep K01–K13 in the coverage denominator, including zero-count categories.
Report counts by category, employer, source, region and work setting. Telehealth
nursing can be K06 without representing bedside hospital nursing. Do not restrict
Lever/Greenhouse to K01–K03: saved examples include K05, K06 and K08.
Use documented category and employer sampling quotas before freezing an evaluation
set; no numerical cap or representative national coverage has yet been established.

The selected employer collection is documented in
`../data/corpus/training/curated_ph/README.md`. Its final snapshot has eight jobs,
seven match-tier and one context-tier, with zero human relevance labels. These
postings are preparation data, not a validated evaluation set. Earlier snapshots
are audit copies and must not be counted as additional jobs.

`corpus_tier=match` indicates sufficient non-snippet text, not permission,
validated skill labels or training readiness. Short descriptions remain context;
Jooble origin is excluded even when imported through another source. Excluded
records cannot suppress eligible duplicates during normalization.

Before model training: review requirements and skill evidence, deduplicate,
obtain independent candidate–job relevance labels, and split by candidate and
job-duplicate groups. Keep Djinni warm-start data distinguishable from Philippine
training and held-out evaluation. Current trainers consume pair files, not newly
collected postings automatically.

## Sources checked 2026-09-09

- https://www.openwebninja.com/api/jsearch
- https://docs.greenhouse.io/job-board.html
- https://github.com/lever/postings-api
- https://www.eucalyptus.health/ (digital healthcare; not simply a BPO)
