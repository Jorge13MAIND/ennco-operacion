#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M024_GATE_DIR="$(mktemp -d /tmp/ennco-provider-infrastructure-gate.XXXXXX)"
M024_GATE_PORT="${ENNCO_M024_GATE_PORT:-55465}"
M024_GATE_DB="ennco_provider_infrastructure_gate"

cleanup() {
  pg_ctl -D "$M024_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$M024_GATE_DIR" in
    /tmp/ennco-provider-infrastructure-gate.*) find "$M024_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$M024_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$M024_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$M024_GATE_DIR/data" -o "-p $M024_GATE_PORT -k $M024_GATE_DIR" -l "$M024_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" "$M024_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" <<'SQL'
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

psql -X -v ON_ERROR_STOP=1 -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" <<'SQL'
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
  psql -X -v ON_ERROR_STOP=1 -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" \
    -f "$migration" >/dev/null
  if [[ "$(basename "$migration")" == "202608200024_provider_infrastructure_control.sql" ]]; then break; fi
done < <(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2)

psql -X -v ON_ERROR_STOP=1 -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/024_provider_infrastructure_control_gate.sql"

pg_dump -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M024_GATE_DIR/schema-before.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" \
  -f "$REPO_ROOT/supabase/rollbacks/202608200024_provider_infrastructure_control.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/024_provider_infrastructure_control_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608200024_provider_infrastructure_control.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" <<'SQL'
do $$ begin
  if to_regprocedure('public.evaluate_outbound_provider_readiness(uuid,timestamptz)') is null then
    raise exception 'M024_REAPPLY_READ_RPC_MISSING';
  end if;
  if to_regprocedure('public.apply_outbound_provider_snapshot(uuid,jsonb,text)') is null then
    raise exception 'M024_REAPPLY_WRITE_RPC_MISSING';
  end if;
  if exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass
    and tgname='messages_aaa_m024_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M024_REAPPLY_ROLLBACK_GUARD_SURVIVED'; end if;
  if (select count(*) from public.provider_activation_gates
      where organization_id='24000000-0000-4000-8000-000000000001')<>15
  then raise exception 'M024_REAPPLY_LEDGER_DRIFT'; end if;
end $$;
select 'PROVIDER_INFRASTRUCTURE_CONTROL_REAPPLY_PASS' as result;
SQL

pg_dump -h "$M024_GATE_DIR" -p "$M024_GATE_PORT" -d "$M024_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M024_GATE_DIR/schema-after.sql"
if ! diff -u "$M024_GATE_DIR/schema-before.sql" "$M024_GATE_DIR/schema-after.sql" >"$M024_GATE_DIR/schema.diff"; then
  sed -n '1,240p' "$M024_GATE_DIR/schema.diff" >&2
  exit 1
fi
printf '%s\n' 'PROVIDER_INFRASTRUCTURE_CONTROL_DIFF_PASS'

git -C "$REPO_ROOT" diff --check -- \
  supabase/migrations/202608200024_provider_infrastructure_control.sql \
  supabase/rollbacks/202608200024_provider_infrastructure_control.down.sql \
  supabase/tests/024_provider_infrastructure_control_gate.sql \
  supabase/tests/024_provider_infrastructure_control_rollback_gate.sql \
  supabase/tests/run-provider-infrastructure-control-gate.sh
bash -n "$REPO_ROOT/supabase/tests/run-provider-infrastructure-control-gate.sh"
printf '%s\n' 'PROVIDER_INFRASTRUCTURE_CONTROL_SCRIPT_PASS'
