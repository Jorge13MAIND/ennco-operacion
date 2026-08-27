#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESEARCH_GATE_DIR="$(mktemp -d /tmp/ennco-research-workbench-gate.XXXXXX)"
RESEARCH_GATE_PORT="${ENNCO_RESEARCH_GATE_PORT:-55453}"
RESEARCH_GATE_DB="ennco_research_workbench_gate"

cleanup() {
  pg_ctl -D "$RESEARCH_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$RESEARCH_GATE_DIR" in
    /tmp/ennco-research-workbench-gate.*) find "$RESEARCH_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing unexpected temporary path: %s\n' "$RESEARCH_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$RESEARCH_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$RESEARCH_GATE_DIR/data" -o "-p $RESEARCH_GATE_PORT -k $RESEARCH_GATE_DIR" -l "$RESEARCH_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" "$RESEARCH_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" <<'SQL'
create role service_role nologin bypassrls;
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
SQL

psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" <<'SQL'
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
  202608270033_operator_auth_policy.sql
do
  psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" \
    -f "$REPO_ROOT/supabase/migrations/$migration" >/dev/null
done

psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/019_research_workbench_gate.sql"

RACE_A="$RESEARCH_GATE_DIR/race-a.log"
RACE_B="$RESEARCH_GATE_DIR/race-b.log"
run_race() {
  local output="$1"
  local idempotency_key="$2"
  psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" >"$output" 2>&1 <<SQL
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.ingest_research_batch('31900000-0000-4000-8000-000000000001','Concurrent Synthetic',
  repeat('6',64),repeat('7',64),jsonb_build_array(jsonb_build_object(
    'externalRecordId','race-1','sourceRow',1,'rawFingerprint',repeat('8',64),
    'legalName','Concurrent Synthetic','legalNameKey','concurrent-synthetic',
    'primaryDomain','concurrent.invalid','city','Synthetic City','state','GUANAJUATO',
    'industrialPark','Synthetic Park','sector','Synthetic Sector','sourceUrl','https://source.invalid/race')),
  '$idempotency_key');
SQL
}
run_race "$RACE_A" "$(printf 'a%.0s' {1..64})" & RACE_A_PID=$!
run_race "$RACE_B" "$(printf 'b%.0s' {1..64})" & RACE_B_PID=$!
RACE_A_STATUS=0
RACE_B_STATUS=0
wait "$RACE_A_PID" || RACE_A_STATUS=$?
wait "$RACE_B_PID" || RACE_B_STATUS=$?
if [[ "$RACE_A_STATUS" -ne 0 || "$RACE_B_STATUS" -ne 0 ]]; then
  printf 'Same-source race session failed: A=%s B=%s\n' "$RACE_A_STATUS" "$RACE_B_STATUS" >&2
  sed -n '1,120p' "$RACE_A" >&2
  sed -n '1,120p' "$RACE_B" >&2
  exit 1
fi
if ! rg -q 'CREATED|DUPLICATE' "$RACE_A" || ! rg -q 'CREATED|DUPLICATE' "$RACE_B"; then
  sed -n '1,120p' "$RACE_A" >&2
  sed -n '1,120p' "$RACE_B" >&2
  exit 1
fi
RACE_CREATED=0
RACE_DUPLICATE=0
if rg -q 'CREATED' "$RACE_A"; then RACE_CREATED=$((RACE_CREATED + 1)); fi
if rg -q 'CREATED' "$RACE_B"; then RACE_CREATED=$((RACE_CREATED + 1)); fi
if rg -q 'DUPLICATE' "$RACE_A"; then RACE_DUPLICATE=$((RACE_DUPLICATE + 1)); fi
if rg -q 'DUPLICATE' "$RACE_B"; then RACE_DUPLICATE=$((RACE_DUPLICATE + 1)); fi
if [[ "$RACE_CREATED" -ne 1 || "$RACE_DUPLICATE" -ne 1 ]]; then
  printf 'Same-source race did not produce exactly one CREATED and one DUPLICATE\n' >&2
  sed -n '1,120p' "$RACE_A" >&2
  sed -n '1,120p' "$RACE_B" >&2
  exit 1
fi
psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" <<'SQL'
do $$ begin
  if (select count(*) from public.import_batches where organization_id='31900000-0000-4000-8000-000000000001' and source_sha256=repeat('6',64))<>1
    or (select count(*) from public.research_import_records where external_record_id='race-1')<>1
  then raise exception 'RESEARCH_CONCURRENCY_IDEMPOTENCY_INVALID'; end if;
end $$;
\echo 'RESEARCH_WORKBENCH_CONCURRENCY_GATE_PASS'
SQL

psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" \
  -f "$REPO_ROOT/supabase/rollbacks/202608120019_research_workbench_foundation.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/019_research_workbench_rollback_gate.sql"
psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608120019_research_workbench_foundation.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$RESEARCH_GATE_DIR" -p "$RESEARCH_GATE_PORT" -d "$RESEARCH_GATE_DB" <<'SQL'
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare assessment jsonb;
begin
  assessment:=public.assess_research_inventory('31900000-0000-4000-8000-000000000001');
  if assessment->>'status'<>'ASSESSED' or assessment->>'decision'='KILL'
    or assessment->'blockers' ? 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'
    or assessment->>'outreach_state'<>'RESEARCH_ONLY_HOLD'
  then raise exception 'M019_REAPPLY_RUNTIME_INVALID'; end if;
end $$;
reset role;
do $$ begin
  if exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
    and tgname='accounts_m019_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M019_REAPPLY_GUARD_NOT_REMOVED'; end if;
end $$;
\echo 'RESEARCH_WORKBENCH_REAPPLY_GATE_PASS'
SQL
