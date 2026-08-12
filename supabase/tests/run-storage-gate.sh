#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_GATE_DIR="$(mktemp -d /tmp/ennco-storage-gate.XXXXXX)"
DB_GATE_PORT="${ENNCO_STORAGE_GATE_PORT:-55434}"
DB_GATE_NAME="ennco_storage_gate"

cleanup() {
  pg_ctl -D "$DB_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$DB_GATE_DIR" in
    /tmp/ennco-storage-gate.*) find "$DB_GATE_DIR" -depth -delete ;;
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
SQL

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" <<'SQL'
insert into public.audit_log (
  organization_id, action, record_type, record_id, old_data, new_data
) values (
  null,
  'UPDATE',
  'messages',
  gen_random_uuid(),
  '{"body_text":"M2_SENTINEL_EXISTING_BODY","normalized_to":"m2_sentinel_existing@invalid.test","status":"DRAFT"}',
  '{"body_text":"M2_SENTINEL_EXISTING_BODY","normalized_to":"m2_sentinel_existing@invalid.test","status":"DRY_RUN"}'
);
SQL

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" <<'SQL'
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
SQL

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/migrations/202608110002_secure_document_storage.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/tests/002_secure_storage_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/rollbacks/202608110002_secure_document_storage.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/tests/002_secure_storage_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/migrations/202608110002_secure_document_storage.sql" >/dev/null
printf 'SECURE_STORAGE_REAPPLY_PASS\n'
