# Supabase migrations

Add ordered, reviewed database migrations here. The current consolidated schema remains in `../schema.sql`.

`20260929090000_employer_structured_evaluation.sql` adds employer evaluation rubrics, reviewer scorecards and the review audit log. `tests/run_rls_tests.sh` applies it to a local PostgreSQL and runs its checks.

`20261022090000_candidate_progress_sync.sql` saves claimed skills, skill progress (`candidate_skill_progress.skill_key`) and course completions per user, owner-only. Its checks are in `tests/candidate_progress_sync_rls.sql`.

`20261004090000_security_hardening.sql` locks down SECURITY DEFINER functions, moves `pg_trgm` out of `public` and stops clients from changing their account role. See `../../docs/security.md` for the advisor findings it covers and the manual Auth setting that remains.

`20261028090000_revoke_anon_table_access.sql` revokes every `anon` privilege on public tables except SELECT on the public catalogs (jobs, learning resources, reference data), so anonymous requests for user data are refused instead of answered with an empty list. `tests/anon_table_access_tests.sql` checks it.
