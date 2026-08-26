#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M025_GATE_DIR="$(mktemp -d /tmp/ennco-annex-a-gate.XXXXXX)"
M025_GATE_PORT="${ENNCO_M025_GATE_PORT:-55466}"
M025_GATE_DB="ennco_annex_a_gate"

cleanup() {
  pg_ctl -D "$M025_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$M025_GATE_DIR" in
    /tmp/ennco-annex-a-gate.*) find "$M025_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$M025_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$M025_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$M025_GATE_DIR/data" -o "-p $M025_GATE_PORT -k $M025_GATE_DIR" -l "$M025_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" "$M025_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" <<'SQL'
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

psql -X -v ON_ERROR_STOP=1 -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" <<'SQL'
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
  psql -X -v ON_ERROR_STOP=1 -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" \
    -f "$migration" >/dev/null
  if [[ "$(basename "$migration")" == "202608200025_annex_a_transactional_suppression.sql" ]]; then break; fi
done < <(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2)

psql -X -v ON_ERROR_STOP=1 -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/025_annex_a_transactional_suppression_gate.sql"

pg_dump -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M025_GATE_DIR/schema-before.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" \
  -f "$REPO_ROOT/supabase/rollbacks/202608200025_annex_a_transactional_suppression.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/025_annex_a_transactional_suppression_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608200025_annex_a_transactional_suppression.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" <<'SQL'
do $$ begin
  if to_regprocedure('public.apply_annex_a_suppression_snapshot(uuid,jsonb,text)') is null
    or exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass
      and tgname='messages_aaa_m025_rollback_fail_closed' and not tgisinternal)
    or not app.annex_a_manifest_is_ready('25000000-0000-4000-8000-000000000001')
    or (select count(*) from public.suppression_manifest_identities
        where organization_id='25000000-0000-4000-8000-000000000001')<>18
  then raise exception 'M025_REAPPLY_INVALID'; end if;
end $$;
select 'ANNEX_A_TRANSACTIONAL_SUPPRESSION_REAPPLY_PASS' as result;
SQL

pg_dump -h "$M025_GATE_DIR" -p "$M025_GATE_PORT" -d "$M025_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M025_GATE_DIR/schema-after.sql"
if ! diff -u "$M025_GATE_DIR/schema-before.sql" "$M025_GATE_DIR/schema-after.sql" >"$M025_GATE_DIR/schema.diff"; then
  sed -n '1,240p' "$M025_GATE_DIR/schema.diff" >&2
  exit 1
fi
printf '%s\n' 'ANNEX_A_TRANSACTIONAL_SUPPRESSION_DIFF_PASS'

git -C "$REPO_ROOT" diff --check -- \
  supabase/migrations/202608200025_annex_a_transactional_suppression.sql \
  supabase/rollbacks/202608200025_annex_a_transactional_suppression.down.sql \
  supabase/tests/025_annex_a_transactional_suppression_gate.sql \
  supabase/tests/025_annex_a_transactional_suppression_rollback_gate.sql \
  supabase/tests/run-annex-a-transactional-suppression-gate.sh
bash -n "$REPO_ROOT/supabase/tests/run-annex-a-transactional-suppression-gate.sh"
printf '%s\n' 'ANNEX_A_TRANSACTIONAL_SUPPRESSION_SCRIPT_PASS'
