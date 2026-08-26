#!/usr/bin/env bash
set -euo pipefail

# macOS postmaster refuses to start without a valid locale in non-interactive shells.
export LC_ALL="${LC_ALL:-C}"
export LANG="${LANG:-C}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M032_GATE_DIR="$(mktemp -d /tmp/ennco-hybrid-dispatch-gate.XXXXXX)"
M032_GATE_PORT="${ENNCO_M032_GATE_PORT:-55495}"
M032_GATE_DB="ennco_hybrid_dispatch_gate"

cleanup() {
  pg_ctl -D "$M032_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$M032_GATE_DIR" in
    /tmp/ennco-hybrid-dispatch-gate.*) find "$M032_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$M032_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$M032_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$M032_GATE_DIR/data" -o "-p $M032_GATE_PORT -k $M032_GATE_DIR" -l "$M032_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" "$M032_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" <<'SQL' >/dev/null
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

psql -X -v ON_ERROR_STOP=1 -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" <<'SQL' >/dev/null
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
  psql -X -v ON_ERROR_STOP=1 -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" -f "$migration" >/dev/null
done < <(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2)

psql -X -v ON_ERROR_STOP=1 -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/032_hybrid_dispatch_gate.sql"

pg_dump -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M032_GATE_DIR/schema-before.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" \
  -f "$REPO_ROOT/supabase/rollbacks/202608260032_hybrid_dispatch_engine.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/032_hybrid_dispatch_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608260032_hybrid_dispatch_engine.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" <<'SQL'
do $$ begin
  if to_regprocedure('public.run_dispatch_heartbeat(uuid,text,uuid,timestamptz,text)') is null
    or to_regprocedure('public.claim_hybrid_dispatch(uuid,boolean,text,uuid,timestamptz,text)') is null
    or to_regprocedure('public.settle_hybrid_dispatch(uuid,uuid,text,text,text,text,text,uuid,timestamptz,text)') is null
    or to_regprocedure('public.read_hybrid_dispatch_credential(uuid,uuid,text,uuid,timestamptz,text)') is null
    or to_regprocedure('public.read_dispatch_health(uuid,text,uuid,timestamptz,text)') is null
  then raise exception 'M032_REAPPLY_RPC_MISSING'; end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.hybrid_outbound_release_enrollments'::regclass
    and tgname='hybrid_release_enrollments_aaa_m032_envelope_contract' and not tgisinternal)
  then raise exception 'M032_REAPPLY_ENVELOPE_TRIGGER_MISSING'; end if;
  if (select count(*) from public.hybrid_dispatch_ticks where organization_id='32000000-0000-4000-8000-000000000001')<10
  then raise exception 'M032_REAPPLY_TICK_LEDGER_DRIFT'; end if;
  if position('QUARANTINED' in (
    select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname='enforce_operations_send_health'))=0
    or position('QUARANTINED' in (
    select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname='enforce_control_cadence_send_health'))=0
  then raise exception 'M032_REAPPLY_SEND_HEALTH_AMENDMENT_MISSING'; end if;
end $$;
select 'HYBRID_DISPATCH_REAPPLY_PASS' as result;
SQL

pg_dump -h "$M032_GATE_DIR" -p "$M032_GATE_PORT" -d "$M032_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M032_GATE_DIR/schema-after.sql"
if ! diff -u "$M032_GATE_DIR/schema-before.sql" "$M032_GATE_DIR/schema-after.sql" >"$M032_GATE_DIR/schema.diff"; then
  sed -n '1,260p' "$M032_GATE_DIR/schema.diff" >&2
  exit 1
fi
printf '%s\n' 'HYBRID_DISPATCH_DIFF_PASS'

git -C "$REPO_ROOT" diff --check -- \
  supabase/migrations/202608260032_hybrid_dispatch_engine.sql \
  supabase/rollbacks/202608260032_hybrid_dispatch_engine.down.sql \
  supabase/tests/032_hybrid_dispatch_gate.sql \
  supabase/tests/032_hybrid_dispatch_rollback_gate.sql \
  supabase/tests/run-hybrid-dispatch-gate.sh
bash -n "$REPO_ROOT/supabase/tests/run-hybrid-dispatch-gate.sh"
printf '%s\n' 'HYBRID_DISPATCH_SCRIPT_PASS'
