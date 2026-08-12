#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_GATE_DIR="$(mktemp -d /tmp/ennco-db-gate.XXXXXX)"
DB_GATE_PORT="${ENNCO_DB_GATE_PORT:-55433}"
DB_GATE_NAME="ennco_core_gate"

cleanup() {
  pg_ctl -D "$DB_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$DB_GATE_DIR" in
    /tmp/ennco-db-gate.*) find "$DB_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected temp path: %s\n' "$DB_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$DB_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$DB_GATE_DIR/data" -o "-p $DB_GATE_PORT -k $DB_GATE_DIR" -l "$DB_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" "$DB_GATE_NAME"

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" <<'SQL'
create role service_role nologin bypassrls;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
SQL

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/tests/001_core_gate.sql"
psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/seed.sql" >/dev/null
printf 'SEED_APPLY_PASS\n'
