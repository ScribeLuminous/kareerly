#!/usr/bin/env bash
# Applies migrations to a throwaway local PostgreSQL cluster and runs the
# row-level security and calculation checks. Requires PostgreSQL server
# binaries (initdb).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bindir="${PG_BINDIR:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$bindir/initdb" ] || { echo "PostgreSQL server binaries not found; set PG_BINDIR." >&2; exit 2; }
work="$(mktemp -d)"
trap '"$bindir/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
run() { if [ "$(id -u)" = 0 ]; then chown -R postgres "$work"; su postgres -c "$*"; else sh -c "$*"; fi; }
chmod 777 "$work"
run "'$bindir/initdb' -D '$work/data' -A trust -U postgres >/dev/null"
run "'$bindir/pg_ctl' -D '$work/data' -o '-k $work -p 55432 -c listen_addresses=' -l '$work/log' -w start >/dev/null"
psql_run() { PGOPTIONS="-c client_min_messages=warning" psql -h "$work" -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_run -f "$here/supabase_stub.sql"
# Applied twice: the migration must be safe to re-run.
psql_run -f "$here/../migrations/20260925090000_match_feedback_learning.sql"
psql_run -f "$here/../migrations/20260925090000_match_feedback_learning.sql"
psql_run -f "$here/match_feedback_learning_rls.sql"

psql_run -c "create database evaluation"
psql_eval() { PGOPTIONS="-c client_min_messages=warning" psql -h "$work" -p 55432 -U postgres -d evaluation -v ON_ERROR_STOP=1 -q "$@"; }
psql_eval -f "$here/supabase_stub.sql"
psql_eval -f "$here/employer_evaluation_stub.sql"
psql_eval -f "$here/employer_evaluation_seed.sql"
psql_eval -f "$here/../migrations/20260929090000_employer_structured_evaluation.sql"
psql_eval -f "$here/../migrations/20260929090000_employer_structured_evaluation.sql"
psql_eval -f "$here/employer_evaluation_tests.sql"
psql_eval -f "$here/../migrations/20261001090000_candidate_assessments.sql"
psql_eval -f "$here/candidate_assessment_tests.sql"
psql_eval -f "$here/../migrations/20261002090000_assessment_delivery_fix.sql"
psql_eval -f "$here/../migrations/20261002090000_assessment_delivery_fix.sql"
psql_eval -f "$here/assessment_delivery_fix_tests.sql"
psql_eval -f "$here/../migrations/20261003090000_assessment_templates.sql"
psql_eval -f "$here/../migrations/20261003090000_assessment_templates.sql"
psql_eval -f "$here/assessment_template_tests.sql"
psql_run -c "create database shared_documents"
psql_docs() { PGOPTIONS="-c client_min_messages=warning" psql -h "$work" -p 55432 -U postgres -d shared_documents -v ON_ERROR_STOP=1 -q "$@"; }
psql_docs -f "$here/supabase_stub.sql"
psql_docs -f "$here/employer_evaluation_stub.sql"
psql_docs -f "$here/employer_evaluation_seed.sql"
psql_docs -c "create table public.resumes (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade)"
psql_docs -f "$here/../migrations/20260930090000_job_post_screening_and_shared_documents.sql"
psql_docs -f "$here/../migrations/20260930090000_job_post_screening_and_shared_documents.sql"
psql_docs -f "$here/shared_documents_tests.sql"
psql_run -c "create database security_hardening"
psql_sec() { PGOPTIONS="-c client_min_messages=warning" psql -h "$work" -p 55432 -U postgres -d security_hardening -v ON_ERROR_STOP=1 -q "$@"; }
psql_sec -f "$here/supabase_stub.sql"
psql_sec -f "$here/employer_evaluation_stub.sql"
psql_sec -f "$here/employer_evaluation_seed.sql"
psql_sec -f "$here/../migrations/20260929090000_employer_structured_evaluation.sql"
psql_sec -f "$here/../migrations/20261001090000_candidate_assessments.sql"
psql_sec -f "$here/../migrations/20261002090000_assessment_delivery_fix.sql"
psql_sec -f "$here/../migrations/20261003090000_assessment_templates.sql"
psql_sec -f "$here/security_hardening_setup.sql"
# Applied twice: the migration must be safe to re-run.
psql_sec -f "$here/../migrations/20261004090000_security_hardening.sql"
psql_sec -f "$here/../migrations/20261004090000_security_hardening.sql"
psql_sec -f "$here/security_hardening_tests.sql"
echo "All RLS and evaluation checks passed."
