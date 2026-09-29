#!/usr/bin/env bash
# Runs a command against a fresh database cloned from a migrated template, then drops it.
# Usage: bash scripts/with-test-db.sh <command> [args...]
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/local-db.sh >/dev/null
socket="$PWD/.local/postgres/socket"
pg_bin="${PG_BIN:-}"
if [ -z "$pg_bin" ]; then
  for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -rV); do
    if [ -x "$candidate/pg_ctl" ]; then pg_bin="$candidate"; break; fi
  done
fi
[ -n "$pg_bin" ] || pg_bin="$(pg_config --bindir)"
psql_admin() { "$pg_bin/psql" -h "$socket" -p 55438 -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

template=school_saas_template
run_db="school_saas_run_$$"

# Drop leftovers from interrupted runs (only databases nobody is connected to).
for stale in $(psql_admin -c "SELECT datname FROM pg_database WHERE datname LIKE 'school_saas_run_%'"); do
  psql_admin -c "DROP DATABASE IF EXISTS \"$stale\"" 2>/dev/null || true
done

if [ -z "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname='$template'")" ]; then psql_admin -c "CREATE DATABASE $template"; fi
LOCAL_DB_NAME=$template npm run db:migrate >/dev/null
LOCAL_DB_NAME=$template npm run seed -w backend >/dev/null

psql_admin -c "CREATE DATABASE \"$run_db\" TEMPLATE $template"
trap 'psql_admin -c "DROP DATABASE IF EXISTS \"$run_db\" WITH (FORCE)" >/dev/null 2>&1 || true' EXIT
LOCAL_DB_NAME=$run_db "$@"
