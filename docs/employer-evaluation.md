# Employer applicant review: profile match and reviewed evaluation

Employers see two separate measures for each applicant. They are named, stored and calculated separately and are never combined into one number.

## Audit: the old "57% match" beside "5 of 6 skills"

Before this change, the employer list showed `job_applications.match_score` as "N% match" with Top/Good/Partial bands, and "X of Y skills" beside it.

- `match_score` is written by the candidate's browser when they apply (`frontend/src/pages/Dashboard.tsx`, `applyToInternalJob`). It is the candidate-side ranking score from `backend/app/services/match_scoring.py`: `(0.45 × semantic similarity + 0.45 × required-skill coverage + 0.10 × preferred-skill coverage) / weights present − critical-skill penalty`.
- `matched_skills` / `missing_skills` are the job's **required** skills found / not found in the resume (`matching_service.py`).
- So "5 of 6 skills" (83% coverage) next to "57%" was arithmetically consistent: a text-similarity of about 0.3 pulls the composite down. But the similarity part is not stored with the application, so an employer could not see or check where the 57% came from, and the bands (90/75) were thresholds on an unexplained number. It was a **labelling and explainability problem**, not a bug in the candidate-side formula.
- Separately, Home ranked "Top applicants" by this number **across different jobs**, and job cards counted "top matches" by it.

Resolution: the employer UI no longer shows that percentage as a match. It is kept on the record (`applyTimeRankingScore` in the UI) and mentioned only as context in the review. Match bands and cross-job ranking are removed.

## Profile match

Derived only from the application.

```
required  = the job's current required skills (de-duplicated, case-insensitive)
found     = required skills that appear in the application's matched_skills
percent   = round(100 × |found| / |required|)
```

- If the application recorded no skill evidence, there is no figure ("No skill evidence recorded"), not 0%.
- If the job lists no required skills, the lists recorded at apply time are used.
- "Not found in application" means the resume did not show it, not that the candidate lacks it.
- Code: `profileMatch()` in `frontend/src/pages/employer/evaluation.ts`.

## Reviewed evaluation

From team scorecards against a job-specific rubric, calculated in the database (`public.evaluation_version_result`, migration `supabase/migrations/20260929090000_employer_structured_evaluation.sql`).

Rubric: named criteria, each with a description, four rating anchors (1 Not shown, 2 Partly shown, 3 Clearly shown, 4 Strongly shown), a weight from 1 to 5, a required flag, and linked interview questions.

For one application and one rubric version, over **submitted** scorecards only:

```
mean_c    = average rating for criterion c over reviewers who rated it
assessed  = criteria with at least one rating ("not assessed" is stored as no rating)
coverage  = 100 × Σ weight(assessed) / Σ weight(all criteria)          (rounded)
score     = 100 × Σ_assessed w_c × (mean_c − 1) / 3  /  Σ_assessed w_c  (rounded)
score is published only when every required criterion is assessed; otherwise it is null.
```

- Not-assessed optional criteria are left out of the score's denominator, never counted as zero; coverage shows how much of the rubric the score rests on.
- A criterion where reviewers differ by two or more points is flagged for discussion.
- Draft scorecards never count.
- Example (tested): weights 3 (required), 1 (required), 2 (optional, not assessed); ratings 4 and 2 → score `100 × (3×1 + 1×⅓) / 4 = 83`, coverage `4/6 = 67%`.

## Rubric versions

- Saving a rubric that no scorecard uses edits it in place.
- Saving a rubric that has scorecards creates a new version; the old one is marked superseded and keeps its criteria.
- Each result is computed with its own version's weights; nothing is recalculated with new weights.
- New scorecards can only start on the current version. The Candidates list compares applicants only on the job's current version; older results are shown in the review as "kept as scored".

## Authorization

The existing model is one employer account per `employer_profiles` row, and job ownership is `employer_profiles.user_id = auth.uid()`. The new tables use the same check:

- Rubrics, criteria, scorecards, ratings and the audit log are readable only by the owner of the job.
- Direct inserts, updates and deletes are revoked; writes go through `save_evaluation_rubric`, `save_evaluation_scorecard` and `set_application_stage`, which check ownership, that a rubric belongs to the application's job, and that rated criteria belong to that rubric version.
- Candidates cannot read evaluations.

## Audit trail

`employer_review_audit_log` records rubric saves and new versions, every scorecard save or submit (with before and after ratings), and every change of `job_applications.status` (a trigger, so candidate withdrawals are recorded too). The employer stage endpoint now calls `set_application_stage` with the employer's own token so the actor is recorded; it falls back to the previous direct update if the migration is not applied.

## What this does not claim

No score here moves an applicant: stage changes are always a person's action with a confirmation. Neither measure has been validated against job performance or shown to reduce bias in Kareerly's data. Structured, job-specific criteria and rating guidance follow the research cited in the project brief (Sackett et al., 2022; Wingate et al., 2025; Gardner et al., 2022), and the decision to avoid a single ranked list follows Malin et al. (2024) and Fabris et al. (2026). Whether they improve outcomes here needs to be measured.

## Tests

- `supabase/tests/run_rls_tests.sh`: applies the migration twice to a local PostgreSQL with pre-existing records, then checks calculations, incomplete evaluations, versioning, cross-employer access, candidate access, direct-write refusal, stage auditing and record preservation (`employer_evaluation_tests.sql`).
- `backend/tests/test_employer_stage_change.py`: the stage endpoint uses the audited function as the employer, falls back when it is missing, and refuses other employers before writing.
- `frontend/tests/dashboardData.test.mjs`: profile match, rubric validation, result parsing, next actions, per-job sorting and rendered rows and panels.
