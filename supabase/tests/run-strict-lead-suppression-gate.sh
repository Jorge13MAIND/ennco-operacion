#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_GATE_DIR="$(mktemp -d /tmp/ennco-strict-lead-suppression-gate.XXXXXX)"
DB_GATE_PORT="${ENNCO_STRICT_LEAD_SUPPRESSION_GATE_PORT:-55450}"
DB_GATE_NAME="ennco_strict_lead_suppression_gate"

cleanup() {
  pg_ctl -D "$DB_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$DB_GATE_DIR" in
    /tmp/ennco-strict-lead-suppression-gate.*) find "$DB_GATE_DIR" -depth -delete ;;
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
  202608120017_strict_lead_suppression_gate.sql
do
  psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
    -f "$REPO_ROOT/supabase/migrations/$migration" >/dev/null
done

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/tests/017_strict_lead_suppression_gate.sql"

RACE_LOG="$DB_GATE_DIR/suppression-race.log"
psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" >"$RACE_LOG" 2>&1 <<'SQL' &
begin;
insert into public.suppression_entries (
  organization_id, kind, normalized_email, reason
) values (
  '11111111-1111-4111-8111-111111111111', 'UNSUBSCRIBE',
  'race@race.invalid', 'SYNTHETIC_CONCURRENCY_TEST'
);
\echo SUPPRESSION_RACE_LOCK_HELD
select pg_sleep(1.5);
commit;
SQL
RACE_PID=$!

RACE_READY=false
for _attempt in $(seq 1 50); do
  if rg -q 'SUPPRESSION_RACE_LOCK_HELD' "$RACE_LOG"; then
    RACE_READY=true
    break
  fi
  sleep 0.05
done
if [[ "$RACE_READY" != true ]]; then
  wait "$RACE_PID" || true
  printf 'Suppression concurrency session did not acquire its lock\n' >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" <<'SQL'
set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;
do $$
begin
  begin
    perform app.qualify_lead_strict(
      '11111111-1111-4111-8111-111111111111',
      '61111111-1111-4111-8111-111111111199',
      true, true, true, true, 0,
      array[
        '71111111-1111-4111-8111-111111111191',
        '71111111-1111-4111-8111-111111111192',
        '71111111-1111-4111-8111-111111111193',
        '71111111-1111-4111-8111-111111111194'
      ]::uuid[]
    );
    raise exception 'EXPECTED_CONCURRENT_SUPPRESSION_REJECTION';
  exception when others then
    if sqlerrm <> 'STRICT_LEAD_SUPPRESSED' then raise; end if;
  end;
  if exists (
    select 1 from public.leads
    where id = '61111111-1111-4111-8111-111111111199'
      and (status <> 'CAPTURED' or contractual_qualified)
  ) or exists (
    select 1 from public.qualification_checks
    where lead_id = '61111111-1111-4111-8111-111111111199'
  ) or exists (
    select 1 from public.event_outbox
    where aggregate_type = 'lead'
      and aggregate_id = '61111111-1111-4111-8111-111111111199'
  ) or exists (
    select 1 from public.audit_log
    where record_type = 'leads'
      and record_id = '61111111-1111-4111-8111-111111111199'
      and action = 'UPDATE'
  ) then raise exception 'CONCURRENT_SUPPRESSION_LEFT_QUALIFICATION_MUTATION'; end if;
end;
$$;
reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;
\echo 'STRICT_LEAD_SUPPRESSION_CONCURRENCY_PASS'
SQL
wait "$RACE_PID"

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/rollbacks/202608120017_strict_lead_suppression_gate.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/tests/017_strict_lead_suppression_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$DB_GATE_DIR" -p "$DB_GATE_PORT" -d "$DB_GATE_NAME" \
  -f "$REPO_ROOT/supabase/migrations/202608120017_strict_lead_suppression_gate.sql" >/dev/null
printf 'STRICT_LEAD_SUPPRESSION_REAPPLY_PASS\n'
