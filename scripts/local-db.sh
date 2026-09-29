#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
task_root="$PWD/.local/postgres"
pg_bin="${PG_BIN:-}"
if [ -z "$pg_bin" ]; then
  for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -rV); do
    if [ -x "$candidate/pg_ctl" ]; then pg_bin="$candidate"; break; fi
  done
fi
if [ -z "$pg_bin" ] && command -v pg_config >/dev/null 2>&1; then pg_bin="$(pg_config --bindir)"; fi
if [ -z "$pg_bin" ] || [ ! -x "$pg_bin/pg_ctl" ]; then
  echo "pg_ctl not found (looked in: ${pg_bin:-/usr/lib/postgresql/*/bin, pg_config --bindir}). Install PostgreSQL or set PG_BIN to its bin directory." >&2
  exit 1
fi
mkdir -p "$task_root/socket"
chmod 700 "$task_root" "$task_root/socket"
if [ ! -f "$task_root/data/PG_VERSION" ]; then
  "$pg_bin/initdb" -D "$task_root/data" -A trust --no-locale --encoding=UTF8 >/dev/null
  printf 'school-saas-disposable\n' > "$task_root/disposable-marker"
fi
test "$(cat "$task_root/disposable-marker")" = 'school-saas-disposable'
if ! "$pg_bin/pg_ctl" -D "$task_root/data" status >/dev/null 2>&1; then
  "$pg_bin/pg_ctl" -D "$task_root/data" -l "$task_root/server.log" -o "-k $task_root/socket -p 55438 -h ''" start
fi
"$pg_bin/psql" -h "$task_root/socket" -p 55438 -d postgres -v ON_ERROR_STOP=1 -f scripts/bootstrap.sql
printf 'Dedicated disposable PostgreSQL ready; no TCP listener. Run npm run db:migrate.\n'
