# Supabase migrations

Add ordered, reviewed database migrations here. The current consolidated schema remains in `../schema.sql`.

`20260929090000_employer_structured_evaluation.sql` adds employer evaluation rubrics, reviewer scorecards and the review audit log. `tests/run_rls_tests.sh` applies it to a local PostgreSQL and runs its checks.
