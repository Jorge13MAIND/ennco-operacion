#!/usr/bin/env bash
set -euo pipefail

# macOS postmaster refuses to start without a valid locale in non-interactive shells.
export LC_ALL="${LC_ALL:-C}"
export LANG="${LANG:-C}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE_DIR="$(mktemp -d /tmp/ennco-ambiguous-send-gate.XXXXXX)"
GATE_PORT="${ENNCO_AMBIGUOUS_GATE_PORT:-55569}"
GATE_DB="ennco_direct_lane_gate"

cleanup() {
  pg_ctl -D "$GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$GATE_DIR" in
    /tmp/ennco-ambiguous-send-gate.*) find "$GATE_DIR" -depth -delete ;;
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
create table auth.users(id uuid primary key,email text);
insert into auth.users(id,email) values ('b16cdecb-098b-4cc4-a059-5d3c0ca96295','synthetic@example.test');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
SQL

run_sql -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
run_sql -c "insert into public.organizations(id,slug,legal_name) values ('e0000000-0000-4000-8000-000000000001','synthetic-email-test','Synthetic test only')" >/dev/null

run_sql <<'SQL' >/dev/null
create schema extensions;
create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select public.digest($1,$2)';
create function extensions.digest(text,text) returns bytea language sql immutable as 'select public.digest($1,$2)';
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

run_sql -f "$REPO_ROOT/supabase/tests/075_ambiguous_send_hotfix.sql"
printf "%s\n" "AMBIGUOUS_SEND_SQL_PASS"
