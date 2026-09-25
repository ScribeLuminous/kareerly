#!/usr/bin/env bash
# Applies the learning migration to a throwaway local PostgreSQL cluster and runs
# the row-level security checks. Requires PostgreSQL server binaries (initdb).
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
