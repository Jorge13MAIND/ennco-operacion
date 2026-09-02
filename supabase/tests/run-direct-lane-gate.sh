#!/usr/bin/env bash
set -euo pipefail

# macOS postmaster refuses to start without a valid locale in non-interactive shells.
export LC_ALL="${LC_ALL:-C}"
export LANG="${LANG:-C}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE_DIR="$(mktemp -d /tmp/ennco-direct-lane-gate.XXXXXX)"
GATE_PORT="${ENNCO_M041_GATE_PORT:-55541}"
GATE_DB="ennco_direct_lane_gate"

cleanup() {
  pg_ctl -D "$GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$GATE_DIR" in
    /tmp/ennco-direct-lane-gate.*) find "$GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$GATE_DIR/data" -o "-p $GATE_PORT -k $GATE_DIR" -l "$GATE_DIR/postgres.log" start >/dev/null
createdb -h "$GATE_DIR" -p "$GATE_PORT" "$GATE_DB"

run_sql() { psql -X -v ON_ERROR_STOP=1 -h "$GATE_DIR" -p "$GATE_PORT" -d "$GATE_DB" "$@"; }

run_sql <<'SQL' >/dev/null
create role service_role nologin bypassrls;
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
SQL

run_sql -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null

run_sql <<'SQL' >/dev/null
create schema storage;
create table storage.buckets(
  id text primary key,name text not null unique,public boolean not null default false,
  file_size_limit bigint,allowed_mime_types text[]
);
create table storage.objects(
  id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),
  name text not null,metadata jsonb,created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),unique(bucket_id,name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select on storage.buckets to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
SQL

while IFS= read -r migration; do
  run_sql -f "$migration" >/dev/null
done < <(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2)

# Los gates de M032 deshabilitan los triggers del Anexo A en la base sintética;
# aquí el gate prueba explícitamente el candado y luego lo sustituye.
run_sql -f "$REPO_ROOT/supabase/tests/041_direct_lane_gate.sql"

pg_dump -h "$GATE_DIR" -p "$GATE_PORT" -d "$GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$GATE_DIR/schema-before.sql"

run_sql -f "$REPO_ROOT/supabase/rollbacks/202609020041_direct_lane.down.sql" >/dev/null
run_sql -f "$REPO_ROOT/supabase/tests/041_direct_lane_rollback_gate.sql"
run_sql -f "$REPO_ROOT/supabase/migrations/202609020041_direct_lane.sql" >/dev/null

pg_dump -h "$GATE_DIR" -p "$GATE_PORT" -d "$GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$GATE_DIR/schema-after.sql"
if ! diff -u "$GATE_DIR/schema-before.sql" "$GATE_DIR/schema-after.sql" >"$GATE_DIR/schema.diff"; then
  sed -n '1,260p' "$GATE_DIR/schema.diff" >&2
  exit 1
fi
printf '%s\n' 'DIRECT_LANE_DIFF_PASS'

bash -n "$REPO_ROOT/supabase/tests/run-direct-lane-gate.sh"
printf '%s\n' 'DIRECT_LANE_SCRIPT_PASS'
