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
# Applied twice: the migration and its backfill must be safe to re-run.
psql_eval -f "$here/../migrations/20261027090000_auto_assessment_templates.sql"
psql_eval -f "$here/../migrations/20261027090000_auto_assessment_templates.sql"
psql_eval -f "$here/auto_assessment_template_tests.sql"
# Applied twice: the migration must be safe to re-run.
psql_eval -f "$here/../migrations/20261028120000_assessment_due_dates.sql"
psql_eval -f "$here/../migrations/20261028120000_assessment_due_dates.sql"
psql_eval -f "$here/assessment_due_date_tests.sql"
# Applied twice: the migration must be safe to re-run.
psql_eval -f "$here/../migrations/20261028140000_assessment_link_opens.sql"
psql_eval -f "$here/../migrations/20261028140000_assessment_link_opens.sql"
psql_eval -f "$here/assessment_link_open_tests.sql"
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
psql_run -c "create database resume_summary_feedback"
psql_rsf() { PGOPTIONS="-c client_min_messages=warning" psql -h "$work" -p 55432 -U postgres -d resume_summary_feedback -v ON_ERROR_STOP=1 -q "$@"; }
psql_rsf -f "$here/supabase_stub.sql"
psql_rsf -c "create table public.resumes (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade)"
# Applied twice: the migration must be safe to re-run.
psql_rsf -f "$here/../migrations/20261013090000_resume_summary_feedback.sql"
psql_rsf -f "$here/../migrations/20261013090000_resume_summary_feedback.sql"
psql_rsf -f "$here/resume_summary_feedback_rls.sql"
psql_run -c "create database candidate_progress_sync"
psql_cps() { PGOPTIONS="-c client_min_messages=warning" psql -h "$work" -p 55432 -U postgres -d candidate_progress_sync -v ON_ERROR_STOP=1 -q "$@"; }
psql_cps -f "$here/supabase_stub.sql"
psql_cps -c "create table public.profiles (id uuid primary key references auth.users(id) on delete cascade)"
# candidate_skill_progress as schema.sql creates it, with its original policy.
psql_cps -c "create table public.candidate_skill_progress (id uuid primary key default gen_random_uuid(), candidate_id uuid not null references public.profiles(id) on delete cascade, skill_id text, skill_name text not null, category_id text, category_name text, status text default 'missing' check (status in ('missing', 'started', 'in_progress', 'completed', 'evidenced', 'covered')), progress_percent integer default 0, selected_resource_id text, evidence_url text, evidence_filename text, evidence_uploaded_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now())"
psql_cps -c "alter table public.candidate_skill_progress enable row level security; create policy \"Users can manage own candidate skill progress\" on public.candidate_skill_progress for all using (auth.uid() = candidate_id) with check (auth.uid() = candidate_id)"
# Applied twice: the migration must be safe to re-run.
psql_cps -f "$here/../migrations/20261022090000_candidate_progress_sync.sql"
psql_cps -f "$here/../migrations/20261022090000_candidate_progress_sync.sql"
psql_cps -f "$here/candidate_progress_sync_rls.sql"
psql_run -c "create database anon_table_access"
psql_anon() { PGOPTIONS="-c client_min_messages=warning" psql -h "$work" -p 55432 -U postgres -d anon_table_access -v ON_ERROR_STOP=1 -q "$@"; }
psql_anon -f "$here/supabase_stub.sql"
# Stand-ins for user-data and public-catalog tables, with the broad default
# grants Supabase gives anon (including message_blocks, which exists in
# production but not in schema.sql).
psql_anon -c "create table public.profiles (id uuid primary key); create table public.user_skills (id uuid primary key); create table public.saved_jobs (id uuid primary key); create table public.job_applications (id uuid primary key); create table public.skill_candidates (id uuid primary key); create table public.employer_profiles (id uuid primary key); create table public.message_blocks (id uuid primary key); create table public.resumes (id uuid primary key); create table public.employer_job_posts (id uuid primary key); create table public.learning_resources (id uuid primary key); grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to anon, authenticated, service_role"
# Applied twice: the migration must be safe to re-run.
psql_anon -f "$here/../migrations/20261028090000_revoke_anon_table_access.sql"
psql_anon -f "$here/../migrations/20261028090000_revoke_anon_table_access.sql"
psql_anon -f "$here/anon_table_access_tests.sql"
psql_run -c "create database education_levels"
psql_edu() { PGOPTIONS="-c client_min_messages=warning" psql -h "$work" -p 55432 -U postgres -d education_levels -v ON_ERROR_STOP=1 -q "$@"; }
psql_edu -f "$here/supabase_stub.sql"
psql_edu -c "alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb"
# The test applies the migration itself (after inserting legacy rows) and the
# script applies it again: it must be safe to re-run.
psql_edu -f "$here/education_levels_tests.sql"
psql_edu -f "$here/../migrations/20261028110000_education_levels.sql"
echo "All RLS and evaluation checks passed."
