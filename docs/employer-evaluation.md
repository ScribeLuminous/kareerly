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

## Candidate Assessment and scorecard workflow

Employers configure one candidate question per rubric criterion using the job editor's Candidate Assessment step. The existing 1–5 relative weights, required flags, order, descriptions, and four rating anchors remain in the versioned rubric. Saving a rubric after an assessment has been sent creates a new version, even if nobody has scored it yet.

A shortlisted application can receive one assessment. `send_candidate_assessment` copies each criterion into `assessment_criterion_snapshots` and records `assessment_sent`; the candidate receives an event through the existing `candidate_notifications` recipient table. Submission creates an employer recipient event in that same table. Candidates save drafts and submit through `save_candidate_assessment`, which checks `auth.uid()`, validates required responses, and refuses edits after submission. A submitted assessment stays under the Shortlisted application stage. The employer's scorecard displays the copied question and submitted response before the rating controls. The rating remains 1–4 or SQL `NULL` for Not assessed, with reviewer notes in the existing `evaluation_ratings.evidence` column. Submitting the scorecard marks the assessment reviewed; it does not move the application.

The UI describes the weighted average on the original 1–4 scale, using assessed criteria only, and states how many criteria were assessed. The existing 0–100 evaluation result remains in the database for historical compatibility and is not mixed with Kareerly's application-time match score. The employer must explicitly choose Move to Interviewing or Decline after reviewing a shortlisted candidate's assessment. The existing confirmation and stage endpoint handle those choices, and the stage function checks the reviewed sub-status. Application history records the assessment, scorecard, and manual decision events.

`supabase/migrations/20261001090000_candidate_assessments.sql` adds the snapshot and response tables and extends the existing rubric, scorecard, and audit functions. `supabase/tests/candidate_assessment_tests.sql` checks permissions, draft and submission rules, snapshot preservation, duplicate sends, notes, and both manual decision paths.

## Assessment delivery and bulk actions

Shortlisting an applicant on a job that has an assessment now sends the Candidate Assessment straight away, from the review modal and from bulk actions on the Candidates page. `supabase/migrations/20261002090000_assessment_delivery_fix.sql` fixes two cases where nothing reached the candidate: rubrics saved before assessments existed had criteria with no question (sending refused them; the question now falls back to the first prompt, then to one built from the criterion name, and existing empty questions are filled the same way), and applicants already at Interviewing without an assessment could not be sent one (they now can). `supabase/tests/assessment_delivery_fix_tests.sql` covers both.

The Candidates list shows each applicant's profile match as a percentage and has a **Match ≥ 70%** quick filter. Applicants can be selected individually or all at once and moved together; each bulk action runs only for applicants the stage rules allow, and says how many were skipped and why. Pending applicants included in **Send Assessment** are shortlisted first.

Jobs have their own page at `/employer/jobs/<job id>`, separate from the list. The list supports selecting jobs to open, close, archive (`posting_status = 'archived'`, hidden from candidates, applicants kept) or delete. Delete is limited to jobs with no applicants; jobs past their deadline must get a later deadline before reopening.

## Assessment templates

Employers can save a Candidate Assessment as a template under **Jobs → Assessment templates** (`/employer/jobs/assessments`) and reuse it across job listings. Templates are stored per employer in `assessment_templates` (migration `supabase/migrations/20261003090000_assessment_templates.sql`, checked by `supabase/tests/assessment_template_tests.sql`). Applying a template goes through `apply_assessment_template`, which calls `save_evaluation_rubric` for each job in one transaction, so every job still gets its own versioned rubric: editing or deleting a template later never changes an assessment that was already sent or scored. `evaluation_rubrics.template_id` records which template a version came from.

Templates can be applied from the templates list (select one or several; several are combined into one assessment, in order, asking a question with the same name once), from a template's own page, or from the job postings list (select jobs, then **Set assessment**). A job's assessment editor can start from a template. Every assessment editor and each job's page show a summary: one line per question with its weight, whether it is required, and anything still missing, and the criteria below collapse so a long assessment doesn't need endless scrolling.

Every job assessment is kept in Assessment templates automatically; there is no separate "save as template" step. The editor saves through `save_job_assessment` (migration `supabase/migrations/20261027090000_auto_assessment_templates.sql`, checked by `supabase/tests/auto_assessment_template_tests.sql`), which saves the rubric as `save_evaluation_rubric` does and then links it to a template: one with exactly the same questions if it exists, otherwise the job's own template (`assessment_templates.source_job_post_id`) updated to the new questions, otherwise a new template named "<job title> assessment" (numbered if the name is taken). The migration also gives every job that already has an assessment a template. A job's page and its assessment editor name the template and link to it, and a template's page lists the jobs using it.

The scorecard shows one notes box, **Assessment Notes (optional)**. Per-question notes written on older scorecards (`evaluation_ratings.evidence`) are kept in the database but no longer shown.
