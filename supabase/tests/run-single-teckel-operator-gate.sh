#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M026_GATE_DIR="$(mktemp -d /tmp/ennco-single-operator-gate.XXXXXX)"
M026_GATE_PORT="${ENNCO_M026_GATE_PORT:-55467}"
M026_GATE_DB="ennco_single_operator_gate"

cleanup() {
  pg_ctl -D "$M026_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$M026_GATE_DIR" in
    /tmp/ennco-single-operator-gate.*) find "$M026_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$M026_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$M026_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$M026_GATE_DIR/data" -o "-p $M026_GATE_PORT -k $M026_GATE_DIR" -l "$M026_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" "$M026_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" <<'SQL'
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

psql -X -v ON_ERROR_STOP=1 -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" <<'SQL'
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
  psql -X -v ON_ERROR_STOP=1 -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" -f "$migration" >/dev/null
  if [[ "$(basename "$migration")" == "202608200026_single_teckel_operator.sql" ]]; then break; fi
done < <(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2)

psql -X -v ON_ERROR_STOP=1 -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/026_single_teckel_operator_gate.sql"

pg_dump -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M026_GATE_DIR/schema-before.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" \
  -f "$REPO_ROOT/supabase/rollbacks/202608200026_single_teckel_operator.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/026_single_teckel_operator_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608200026_single_teckel_operator.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" <<'SQL'
set request.jwt.claim.sub='26100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.configure_single_teckel_operator(
  '26000000-0000-4000-8000-000000000001','26100000-0000-4000-8000-000000000002',
  'M026_REAPPLY',repeat('9',64)
);
reset role;
do $$ begin
  if not app.operations_assignment_is_active('26000000-0000-4000-8000-000000000001')
    or to_regprocedure('public.configure_single_teckel_operator(uuid,uuid,text,text)') is null
  then raise exception 'M026_REAPPLY_INVALID'; end if;
end $$;
select 'SINGLE_TECKEL_OPERATOR_REAPPLY_PASS' as result;
SQL

pg_dump -h "$M026_GATE_DIR" -p "$M026_GATE_PORT" -d "$M026_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M026_GATE_DIR/schema-after.sql"
if ! diff -u "$M026_GATE_DIR/schema-before.sql" "$M026_GATE_DIR/schema-after.sql" >"$M026_GATE_DIR/schema.diff"; then
  sed -n '1,240p' "$M026_GATE_DIR/schema.diff" >&2
  exit 1
fi
printf '%s\n' 'SINGLE_TECKEL_OPERATOR_DIFF_PASS'

git -C "$REPO_ROOT" diff --check -- \
  supabase/migrations/202608200026_single_teckel_operator.sql \
  supabase/rollbacks/202608200026_single_teckel_operator.down.sql \
  supabase/tests/026_single_teckel_operator_gate.sql \
  supabase/tests/026_single_teckel_operator_rollback_gate.sql \
  supabase/tests/run-single-teckel-operator-gate.sh
bash -n "$REPO_ROOT/supabase/tests/run-single-teckel-operator-gate.sh"
printf '%s\n' 'SINGLE_TECKEL_OPERATOR_SCRIPT_PASS'
