# Learning Paths catalog contract

Learning Paths uses deterministic explicit skill-ID mappings. Opening a resource is an external navigation only; Kareerly records no learning progress or completion and updates no profile, coverage, readiness, or job-match score. Job ranking is unchanged. No LLM or learning cross-encoder is used.

## Catalog review

Apply `supabase/migrations/20260914090000_learning_catalog_review.sql` through the normal database release process before populating the new metadata. This implementation does not apply it or promote any existing records.

An eligible row requires all of:

- `status = active`, `review_status = verified`, `skill_id_mapping_status = reviewed` (case insensitive).
- Nonempty `resource_id`, exact title, provider, `reviewer`, `catalog_version`, and `skill_id_mapping_notes` documenting reviewed learning outcomes and skill mappings.
- An HTTP(S) official evidence URL in `source_evidence` and a valid, nonfuture ISO date in `last_verified_at`.
- Explicit taxonomy IDs in `skill_ids` intersecting the requested skill gap. Names, descriptions, titles, similarity scores, and categories cannot establish eligibility.

Generated/review-needed and legacy rows without this evidence are excluded. These flags must be populated by human catalog review, not inferred from existing generated metadata. The local CSV had 243 rows and no eligible resources at implementation time. Live Supabase contents were not audited. Missing/invalid provider links are displayed as unavailable; no search URL is manufactured. HTTP(S) syntax validation does not establish current provider availability.

Reviewed `resource_type` values `exam_review` or `exam_preparation` use **View preparation course**; `certification`, `credential`, `exam`, or `industry_certification` use **View certification**. Courses use **Start learning**. Preparation does not establish that a credential is awarded.

`cost_type` describes course access; `certificate_cost` describes separate certificate/exam fees; `prerequisites` describes entry requirements. Missing values remain unknown. Credential award conditions appear only when `credential_review_status = verified`, `credential_conditions` is populated, and `credential_evidence` contains an HTTP(S) evidence URL. Never populate these from titles or recommendation scores.

Resources are stable alternatives grouped by skill, not a validated prerequisite sequence. No prerequisite order is inferred. Existing per-gap and API result limits can also limit catalog coverage. A resource mapping to multiple gaps retains all returned mappings.

Cached legacy recommendations lacking the new review/mapping metadata are hidden; rerun matching after reviewed catalog data is available.

## Checks

- `cd backend && .venv/bin/python -m unittest tests.test_learning_paths -v`
- `cd frontend && node scripts/check-learning-paths.mjs`
- `cd frontend && npm run build`

All passed on 14 September 2026. The build reports a large bundle warning. Repository-wide ESLint reports 194 errors and 11 warnings in the current working tree; unrelated lint fixes were left out. Targeted `git diff --check` passes; the existing CSV diff has CRLF whitespace reports.

The local frontend opened successfully. There was no authenticated candidate session, so real-data visual, responsive, and interactive verification of Learning Paths remains unperformed. Component rendering checks use fictional fixtures, never production data or seeded catalog entries.
