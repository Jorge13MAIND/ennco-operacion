#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_GATE_DIR="$(mktemp -d /tmp/ennco-monthly-capacity-gate.XXXXXX)"
DB_GATE_PORT="${ENNCO_MONTHLY_CAPACITY_GATE_PORT:-55451}"
DB_GATE_NAME="ennco_monthly_capacity_gate"

cleanup() {
  pg_ctl -D "$DB_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$DB_GATE_DIR" in
    /tmp/ennco-monthly-capacity-gate.*) find "$DB_GATE_DIR" -depth -delete ;;
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
  202608120016_canonical_commercial_operations.sql \
  202608120017_strict_lead_suppression_gate.sql \
  202608120018_monthly_operational_capacity.sql
do
  psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
    -f "$REPO_ROOT/supabase/migrations/$migration" >/dev/null
done

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/tests/018_monthly_operational_capacity_gate.sql"

RACE_A_LOG="$DB_GATE_DIR/capacity-race-a.log"
RACE_B_LOG="$DB_GATE_DIR/capacity-race-b.log"

run_capacity_race() {
  local opportunity_id="$1"
  local execution_date="$2"
  local reason="$3"
  local key="$4"
  local log_file="$5"
  psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
    >"$log_file" 2>&1 <<SQL
set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111112';
set request.jwt.claim.aal = 'aal2';
set role authenticated;
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '$opportunity_id', '$execution_date', '$reason', '$key'
);
SQL
}

run_capacity_race \
  '41111111-1111-4111-8111-111111111114' '2027-03-10' \
  'Synthetic concurrent project four' 'capacity-race-march-four' "$RACE_A_LOG" &
RACE_A_PID=$!
run_capacity_race \
  '41111111-1111-4111-8111-111111111115' '2027-03-11' \
  'Synthetic concurrent project five' 'capacity-race-march-five' "$RACE_B_LOG" &
RACE_B_PID=$!
wait "$RACE_A_PID"
wait "$RACE_B_PID"

if ! rg -q 'SCHEDULED' "$RACE_A_LOG" || ! rg -q 'SCHEDULED' "$RACE_B_LOG"; then
  printf 'Capacity concurrency sessions did not both succeed\n' >&2
  sed -n '1,160p' "$RACE_A_LOG" >&2
  sed -n '1,160p' "$RACE_B_LOG" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" <<'SQL'
set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;
do $$
declare evaluation jsonb;
begin
  evaluation := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-03-01'
  );
  if evaluation->>'state' <> 'FULL'
    or (evaluation->>'committed_projects')::integer <> 2
    or (evaluation->>'available_projects')::integer <> 0
    or (evaluation->>'over_capacity_projects')::integer <> 0
  then raise exception 'CONCURRENT_CAPACITY_COUNT_INVALID'; end if;
  if (select count(*) from public.opportunity_capacity_schedules
      where organization_id = '11111111-1111-4111-8111-111111111111'
        and capacity_month = '2027-03-01') <> 2
  then raise exception 'CONCURRENT_CAPACITY_RESERVATION_LOST_OR_DUPLICATED'; end if;
  if (select count(*) from public.event_outbox
      where event_type = 'operational_capacity.warning'
        and payload_json->>'capacity_month' = '2027-03-01') <> 1
    or (select count(*) from public.event_outbox
      where event_type = 'operational_capacity.full'
        and payload_json->>'capacity_month' = '2027-03-01') <> 1
  then raise exception 'CONCURRENT_CAPACITY_ALERT_SEQUENCE_INVALID'; end if;
  if (select count(*) from public.tasks
      where normalized_objective = 'CAPACITY_MONTH:2027-03-01' and status = 'OPEN') <> 1
    or not exists (
      select 1 from public.tasks
      where normalized_objective = 'CAPACITY_MONTH:2027-03-01'
        and task_type = 'CAPACITY_FULL' and status = 'OPEN'
    )
  then raise exception 'CONCURRENT_CAPACITY_TASK_RECONCILIATION_INVALID'; end if;
end;
$$;

select app.create_operational_capacity_config(
  '11111111-1111-4111-8111-111111111111', 1, 1, '2027-03-01',
  'SYNTHETIC_CAPACITY_CHANGE_RECONCILIATION', 'capacity-config-v3-march'
);
do $$
declare evaluation jsonb;
begin
  evaluation := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-03-01'
  );
  if evaluation->>'state' <> 'FULL'
    or (evaluation->>'config_version')::integer <> 3
    or (evaluation->>'committed_projects')::integer <> 2
    or (evaluation->>'over_capacity_projects')::integer <> 1
  then raise exception 'CONFIG_CHANGE_DID_NOT_REEVALUATE_CAPACITY'; end if;
  if not exists (
    select 1 from public.event_outbox
    where event_type = 'operational_capacity.exceeded'
      and payload_json->>'capacity_month' = '2027-03-01'
      and payload_json->>'config_version' = '3'
      and payload_json->>'over_capacity_projects' = '1'
  ) then raise exception 'CONFIG_CHANGE_DID_NOT_EMIT_CAPACITY_ALERT'; end if;
end;
$$;
reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;
\echo 'MONTHLY_OPERATIONAL_CAPACITY_CONCURRENCY_PASS'
SQL

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/rollbacks/202608120018_monthly_operational_capacity.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/tests/018_monthly_operational_capacity_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/migrations/202608120018_monthly_operational_capacity.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" <<'SQL'
do $$
begin
  if to_regclass('public.operational_capacity_configs') is null
    or to_regclass('public.opportunity_capacity_schedules') is null
    or to_regclass('public.operational_capacity_commands') is null
    or exists (
      select 1 from pg_trigger
      where tgrelid = 'public.opportunities'::regclass
        and tgname = 'opportunities_m018_rollback_fail_closed' and not tgisinternal
    )
  then raise exception 'M018_REAPPLY_SCHEMA_INVALID'; end if;
end;
$$;
set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;
select app.create_operational_capacity_config(
  '11111111-1111-4111-8111-111111111111', 2, 1, '2027-04-01',
  'SYNTHETIC_REAPPLY_CAPACITY_TWO', 'capacity-reapply-config-v1'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111', '2027-04-10',
  'Synthetic reapply execution', 'capacity-reapply-schedule-one'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111112', '2027-05-11',
  'Synthetic reapply execution two', 'capacity-reapply-schedule-two'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111113', '2027-05-12',
  'Synthetic reapply execution three', 'capacity-reapply-schedule-three'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111114', '2027-05-13',
  'Synthetic reapply execution four', 'capacity-reapply-schedule-four'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111115', '2027-05-14',
  'Synthetic reapply execution five', 'capacity-reapply-schedule-five'
);
do $$
declare evaluation jsonb;
begin
  evaluation := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-04-01'
  );
  if evaluation->>'state' <> 'WARNING'
    or (evaluation->>'config_version')::integer <> 1
    or (evaluation->>'committed_projects')::integer <> 1
  then raise exception 'M018_REAPPLY_FUNCTIONAL_GATE_FAILED'; end if;
end;
$$;
reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;
\echo 'MONTHLY_OPERATIONAL_CAPACITY_REAPPLY_PASS'
SQL
