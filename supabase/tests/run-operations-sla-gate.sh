#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OPS_GATE_DIR="$(mktemp -d /tmp/ennco-operations-sla-gate.XXXXXX)"
OPS_GATE_PORT="${ENNCO_OPERATIONS_GATE_PORT:-55459}"
OPS_GATE_DB="ennco_operations_sla_gate"

cleanup() {
  pg_ctl -D "$OPS_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$OPS_GATE_DIR" in
    /tmp/ennco-operations-sla-gate.*) find "$OPS_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing unexpected temporary path: %s\n' "$OPS_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$OPS_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$OPS_GATE_DIR/data" -o "-p $OPS_GATE_PORT -k $OPS_GATE_DIR" -l "$OPS_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" "$OPS_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" <<'SQL'
create role service_role nologin bypassrls;
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
SQL

psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" <<'SQL'
create schema storage;
create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select on storage.buckets to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
SQL

for migration in \
  202608110002_secure_document_storage.sql 202608110003_retention_deletion.sql \
  202608110004_public_prequote_capture.sql 202608110005_conversion_analytics.sql \
  202608110006_gmail_operations.sql 202608110007_shadow_canary.sql \
  202608110008_first_send_release.sql 202608110009_controlled_scaling.sql \
  202608120010_contractual_monthly_reporting.sql 202608120011_handoff_acceptance.sql \
  202608120012_security_consistency_hardening.sql 202608120013_one_click_unsubscribe.sql \
  202608120014_commercial_integrity.sql 202608120015_suppression_privacy.sql \
  202608120016_canonical_commercial_operations.sql 202608120017_strict_lead_suppression_gate.sql \
  202608120018_monthly_operational_capacity.sql 202608120019_research_workbench_foundation.sql \
  202608120020_operations_sla_control.sql
do
  psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" \
    -f "$REPO_ROOT/supabase/migrations/$migration" >/dev/null
done

psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/020_operations_sla_gate.sql"

RACE_A="$OPS_GATE_DIR/race-a.log"
RACE_B="$OPS_GATE_DIR/race-b.log"
run_idempotency_race() {
  local output="$1"
  psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" >"$output" 2>&1 <<'SQL'
set request.jwt.claim.sub='32010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.request_operational_approval(
  '32000000-0000-4000-8000-000000000001',
  'synthetic_concurrency',
  '32060000-0000-4000-8000-000000000001',
  repeat('7',64),
  'synthetic concurrency request',
  repeat('8',64)
);
SQL
}
run_idempotency_race "$RACE_A" & RACE_A_PID=$!
run_idempotency_race "$RACE_B" & RACE_B_PID=$!
RACE_A_STATUS=0
RACE_B_STATUS=0
wait "$RACE_A_PID" || RACE_A_STATUS=$?
wait "$RACE_B_PID" || RACE_B_STATUS=$?
if [[ "$RACE_A_STATUS" -ne 0 || "$RACE_B_STATUS" -ne 0 ]]; then
  printf 'Operations idempotency race failed: A=%s B=%s\n' "$RACE_A_STATUS" "$RACE_B_STATUS" >&2
  sed -n '1,120p' "$RACE_A" >&2
  sed -n '1,120p' "$RACE_B" >&2
  exit 1
fi
if [[ "$(rg -l '"replayed": false' "$RACE_A" "$RACE_B" | wc -l | tr -d ' ')" -ne 1 ]] \
  || [[ "$(rg -l '"replayed": true' "$RACE_A" "$RACE_B" | wc -l | tr -d ' ')" -ne 1 ]]; then
  printf 'Operations idempotency race did not produce one commit and one replay\n' >&2
  sed -n '1,120p' "$RACE_A" >&2
  sed -n '1,120p' "$RACE_B" >&2
  exit 1
fi
psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" <<'SQL'
do $$ begin
  if (select count(*) from public.approval_requests where organization_id='32000000-0000-4000-8000-000000000001' and subject_type='synthetic_concurrency')<>1
    or (select count(*) from public.operational_command_ledger where organization_id='32000000-0000-4000-8000-000000000001' and command_name='request_operational_approval' and idempotency_key=repeat('8',64))<>1
  then raise exception 'OPERATIONS_CONCURRENCY_IDEMPOTENCY_INVALID'; end if;
end $$;
\echo 'OPERATIONS_SLA_CONCURRENCY_GATE_PASS'
SQL

psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" \
  -f "$REPO_ROOT/supabase/rollbacks/202608120020_operations_sla_control.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/020_operations_sla_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608120020_operations_sla_control.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$OPS_GATE_DIR" -p "$OPS_GATE_PORT" -d "$OPS_GATE_DB" <<'SQL'
do $$ begin
  if to_regprocedure('public.evaluate_operations_health(uuid,timestamptz)') is null then raise exception 'M020_REAPPLY_RPC_MISSING'; end if;
  if exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_m020_rollback_fail_closed' and not tgisinternal) then raise exception 'M020_REAPPLY_GUARD_SURVIVED'; end if;
  if not exists(select 1 from public.incidents where title='Synthetic intermediate lifecycle' and status='CONTAINED') then raise exception 'M020_INTERMEDIATE_INCIDENT_REAPPLY_INVALID'; end if;
end $$;
\echo 'OPERATIONS_SLA_REAPPLY_GATE_PASS'
SQL
