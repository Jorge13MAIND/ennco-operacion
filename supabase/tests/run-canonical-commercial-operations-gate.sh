#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_GATE_DIR="$(mktemp -d /tmp/ennco-canonical-commercial-gate.XXXXXX)"
DB_GATE_PORT="${ENNCO_CANONICAL_COMMERCIAL_GATE_PORT:-55449}"
DB_GATE_NAME="ennco_canonical_commercial_gate"

cleanup() {
  pg_ctl -D "$DB_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$DB_GATE_DIR" in
    /tmp/ennco-canonical-commercial-gate.*) find "$DB_GATE_DIR" -depth -delete ;;
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
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
SQL

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" <<'SQL'
create schema storage;
create table storage.buckets (
  id text primary key, name text not null unique, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text not null references storage.buckets(id),
  name text not null, metadata jsonb, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
SQL

for migration in \
  202608110002_secure_document_storage.sql \
  202608110003_retention_deletion.sql \
  202608110004_public_prequote_capture.sql \
  202608110005_conversion_analytics.sql \
  202608110006_gmail_operations.sql \
  202608110007_shadow_canary.sql \
  202608110008_first_send_release.sql \
  202608110009_controlled_scaling.sql \
  202608120010_contractual_monthly_reporting.sql \
  202608120011_handoff_acceptance.sql \
  202608120012_security_consistency_hardening.sql \
  202608120013_one_click_unsubscribe.sql \
  202608120014_commercial_integrity.sql \
  202608120015_suppression_privacy.sql \
  202608120016_canonical_commercial_operations.sql
do
  psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
    -f "$REPO_ROOT/supabase/migrations/$migration" >/dev/null
done

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/tests/016_canonical_commercial_operations_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/rollbacks/202608120016_canonical_commercial_operations.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/tests/016_canonical_commercial_operations_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/migrations/202608120016_canonical_commercial_operations.sql" >/dev/null
printf 'CANONICAL_COMMERCIAL_OPERATIONS_REAPPLY_PASS\n'
