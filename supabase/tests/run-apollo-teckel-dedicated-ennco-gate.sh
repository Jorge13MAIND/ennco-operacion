#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M031_GATE_DIR="$(mktemp -d /tmp/ennco-apollo-dedicated-gate.XXXXXX)"
M031_GATE_PORT="${ENNCO_M031_GATE_PORT:-55481}"
M031_GATE_DB="ennco_apollo_dedicated_gate"

cleanup() {
  pg_ctl -D "$M031_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$M031_GATE_DIR" in
    /tmp/ennco-apollo-dedicated-gate.*) find "$M031_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$M031_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$M031_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$M031_GATE_DIR/data" -o "-p $M031_GATE_PORT -k $M031_GATE_DIR" -l "$M031_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" "$M031_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" <<'SQL' >/dev/null
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

psql -X -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" <<'SQL' >/dev/null
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
  psql -X -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" -f "$migration" >/dev/null
done < <(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2)

psql -X -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/031_apollo_teckel_dedicated_ennco_gate.sql"

M031_CONCURRENCY_SQL="set request.jwt.claim.sub='31100000-0000-4000-8000-000000000001'; set request.jwt.claim.aal='aal2'; set role authenticated; select public.apply_apollo_dedicated_provider_snapshot('31000000-0000-4000-8000-000000000001',app.m031_snapshot(),repeat('7',64))->>'status';"
psql -X -At -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" -c "$M031_CONCURRENCY_SQL" >"$M031_GATE_DIR/concurrency-1.txt" &
M031_PID_ONE=$!
psql -X -At -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" -c "$M031_CONCURRENCY_SQL" >"$M031_GATE_DIR/concurrency-2.txt" &
M031_PID_TWO=$!
wait "$M031_PID_ONE"
wait "$M031_PID_TWO"
M031_RESULTS="$(cat "$M031_GATE_DIR/concurrency-1.txt" "$M031_GATE_DIR/concurrency-2.txt")"
if [[ "$(printf '%s\n' "$M031_RESULTS" | grep -Ec '^(UPDATED|DUPLICATE)$')" -ne 2 ]] \
  || [[ "$(printf '%s\n' "$M031_RESULTS" | grep -Ec '^UPDATED$')" -ne 1 ]] \
  || [[ "$(printf '%s\n' "$M031_RESULTS" | grep -Ec '^DUPLICATE$')" -ne 1 ]]; then
  sed -n '1,20p' "$M031_GATE_DIR/concurrency-1.txt" "$M031_GATE_DIR/concurrency-2.txt" >&2
  exit 1
fi
printf '%s\n' 'APOLLO_TECKEL_DEDICATED_CONCURRENCY_GATE_PASS'

pg_dump -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M031_GATE_DIR/schema-before.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" \
  -f "$REPO_ROOT/supabase/rollbacks/202608250031_apollo_teckel_dedicated_ennco.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/031_apollo_teckel_dedicated_ennco_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608250031_apollo_teckel_dedicated_ennco.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" <<'SQL'
do $$ begin
  if to_regprocedure('public.apply_apollo_dedicated_provider_snapshot(uuid,jsonb,text)') is null
  then raise exception 'M031_REAPPLY_RPC_MISSING'; end if;
  if exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass
    and tgname='messages_aaa_m031_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M031_REAPPLY_ROLLBACK_TRIGGER_SURVIVED'; end if;
  if (select count(*) from public.provider_accounts where organization_id='31000000-0000-4000-8000-000000000001'
      and custody_model='TECKEL_MANAGED_FOR_ENNCO' and team_ref_sha256=repeat('1',64))<>1
  then raise exception 'M031_REAPPLY_EVIDENCE_DRIFT'; end if;
end $$;
select 'APOLLO_TECKEL_DEDICATED_REAPPLY_GATE_PASS' as result;
SQL

pg_dump -h "$M031_GATE_DIR" -p "$M031_GATE_PORT" -d "$M031_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M031_GATE_DIR/schema-after.sql"
if ! diff -u "$M031_GATE_DIR/schema-before.sql" "$M031_GATE_DIR/schema-after.sql" >"$M031_GATE_DIR/schema.diff"; then
  sed -n '1,260p' "$M031_GATE_DIR/schema.diff" >&2
  exit 1
fi
printf '%s\n' 'APOLLO_TECKEL_DEDICATED_DIFF_GATE_PASS'

git -C "$REPO_ROOT" diff --check -- \
  supabase/migrations/202608250031_apollo_teckel_dedicated_ennco.sql \
  supabase/rollbacks/202608250031_apollo_teckel_dedicated_ennco.down.sql \
  supabase/tests/031_apollo_teckel_dedicated_ennco_gate.sql \
  supabase/tests/031_apollo_teckel_dedicated_ennco_rollback_gate.sql \
  supabase/tests/run-apollo-teckel-dedicated-ennco-gate.sh
bash -n "$REPO_ROOT/supabase/tests/run-apollo-teckel-dedicated-ennco-gate.sh"
printf '%s\n' 'APOLLO_TECKEL_DEDICATED_SCRIPT_GATE_PASS'
