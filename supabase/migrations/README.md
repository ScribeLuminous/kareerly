# Supabase migrations

Add ordered, reviewed database migrations here. The current consolidated schema remains in `../schema.sql`.

`20260929090000_employer_structured_evaluation.sql` adds employer evaluation rubrics, reviewer scorecards and the review audit log. `tests/run_rls_tests.sh` applies it to a local PostgreSQL and runs its checks.

`20261022090000_candidate_progress_sync.sql` saves claimed skills, skill progress (`candidate_skill_progress.skill_key`) and course completions per user, owner-only. Its checks are in `tests/candidate_progress_sync_rls.sql`.

`20261004090000_security_hardening.sql` locks down SECURITY DEFINER functions, moves `pg_trgm` out of `public` and stops clients from changing their account role. See `../../docs/security.md` for the advisor findings it covers and the manual Auth setting that remains.

`20261028090000_revoke_anon_table_access.sql` revokes every `anon` privilege on public tables except SELECT on the public catalogs (jobs, learning resources, reference data), so anonymous requests for user data are refused instead of answered with an empty list. `tests/anon_table_access_tests.sql` checks it.


`20261028110000_education_levels.sql` adds `normalize_education_level()` (the SQL copy of the fixed education list) and rewrites existing account metadata to it. Checks are in `tests/education_levels_tests.sql`.

`20261028120000_assessment_due_dates.sql` adds `candidate_assessments.due_at` (default 7 days, set by the employer when sending), `extend_assessment_deadline`, a locked answer window after the deadline, and the rule that an employer can decline for no response only once the deadline has passed. Checks are in `tests/assessment_due_date_tests.sql`.

`20261028140000_assessment_link_opens.sql` adds `log_assessment_link_opened`, which records (in the review activity history) when a reviewer opens a link from a candidate's assessment answer. Checks are in `tests/assessment_link_open_tests.sql`.

`20261028150000_candidate_evidence.sql` saves a candidate's certificates and proof (badge links, PDF details) in `candidate_evidence`, owner-only, so they survive a reload. The PDF file itself is not stored. Checks are in `tests/candidate_evidence_rls.sql`.

`20261029100000_employer_job_posts_public_read.sql` limits the "Employers can manage own job posts" policy to signed-in users. Without it, anon reads of `employer_job_posts` failed with "permission denied for table employer_profiles" once anon lost access to that table, so the job list showed no employer posts. Checks are in `tests/employer_job_posts_public_read_tests.sql`.

`20261117090000_application_privacy_and_integrity.sql` stops copying the candidate's name, email and location onto `job_applications` (and clears existing copies) and removes clients' direct write access to applications. Candidates apply, withdraw and answer message requests through `submit_job_application`, `withdraw_job_application` and `respond_to_message_request`. Employers read a candidate's identity through `get_employer_applicant_identities()`, which returns it only from Interviewing on, and change stages through `set_application_stage` as before. Apply it before deploying the frontend that calls these functions. Checks are in `tests/application_privacy_tests.sql`.
