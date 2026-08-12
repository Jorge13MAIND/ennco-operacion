#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M022_GATE_DIR="$(mktemp -d /tmp/ennco-control-cadence-gate.XXXXXX)"
M022_GATE_PORT="${ENNCO_M022_GATE_PORT:-55462}"
M022_GATE_DB="ennco_control_cadence_gate"

cleanup() {
  pg_ctl -D "$M022_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$M022_GATE_DIR" in /tmp/ennco-control-cadence-gate.*) find "$M022_GATE_DIR" -depth -delete ;; *) exit 1 ;; esac
}
trap cleanup EXIT

initdb -D "$M022_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$M022_GATE_DIR/data" -o "-p $M022_GATE_PORT -k $M022_GATE_DIR" -l "$M022_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" "$M022_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" <<'SQL'
create role service_role nologin bypassrls;
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
SQL

psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" <<'SQL'
create schema storage;
create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select on storage.buckets to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
SQL

for migration in $(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2); do
  psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" -f "$migration" >/dev/null
done

psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" -f "$REPO_ROOT/supabase/tests/022_control_room_cadence_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" <<'SQL' >/dev/null
create temporary table m022_counts as select
  (select count(*) from public.control_cadence_occurrences) occurrences,
  (select count(*) from public.control_cadence_breaches) breaches,
  (select count(*) from public.incidents where incident_key like 'cadence:%') incidents,
  (select count(*) from public.event_outbox where event_type='control_cadence.breached') outbox;
SQL

RACE_A="$M022_GATE_DIR/race-a.log"; RACE_B="$M022_GATE_DIR/race-b.log"
run_race() {
  local key="$1" output="$2"
  psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" >"$output" 2>&1 <<SQL
select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000001',clock_timestamp(),repeat('$key',64));
SQL
}
run_race d "$RACE_A" & RACE_A_PID=$!
run_race e "$RACE_B" & RACE_B_PID=$!
wait "$RACE_A_PID"; wait "$RACE_B_PID"
psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" <<'SQL'
do $$ begin
  if exists(select 1 from public.control_cadence_occurrences group by organization_id,policy_item_id,window_key having count(*)>1) then raise exception 'M022_CONCURRENT_OCCURRENCE_DUPLICATE'; end if;
  if exists(select 1 from public.control_cadence_breaches group by organization_id,occurrence_id,breach_kind having count(*)>1) then raise exception 'M022_CONCURRENT_BREACH_DUPLICATE'; end if;
  if exists(select 1 from public.event_outbox where event_type='control_cadence.breached' group by organization_id,idempotency_key having count(*)>1) then raise exception 'M022_CONCURRENT_OUTBOX_DUPLICATE'; end if;
end $$;
\echo 'CONTROL_CADENCE_CONCURRENCY_GATE_PASS'
SQL

pg_dump -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M022_GATE_DIR/schema-before.sql"
psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" -f "$REPO_ROOT/supabase/rollbacks/202608120022_control_room_cadence.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" -f "$REPO_ROOT/supabase/tests/022_control_room_cadence_rollback_gate.sql"
psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" -f "$REPO_ROOT/supabase/migrations/202608120022_control_room_cadence.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" <<'SQL'
do $$ begin
  if to_regprocedure('public.create_control_cadence_policy(uuid,integer,public.evidence_class,integer,jsonb,text)') is null then raise exception 'M022_REAPPLY_WRITE_RPC_MISSING'; end if;
  if exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass and tgname='messages_m022_rollback_fail_closed' and not tgisinternal) then raise exception 'M022_REAPPLY_OUTBOUND_ROLLBACK_GUARD_SURVIVED'; end if;
  if (select count(*) from public.control_cadence_policy_versions where organization_id='22000000-0000-4000-8000-000000000001')<>2 then raise exception 'M022_REAPPLY_LEDGER_DRIFT'; end if;
end $$;
\echo 'CONTROL_CADENCE_REAPPLY_GATE_PASS'
SQL

pg_dump -h "$M022_GATE_DIR" -p "$M022_GATE_PORT" -d "$M022_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M022_GATE_DIR/schema-after.sql"
if ! diff -u "$M022_GATE_DIR/schema-before.sql" "$M022_GATE_DIR/schema-after.sql" >"$M022_GATE_DIR/schema.diff"; then
  sed -n '1,240p' "$M022_GATE_DIR/schema.diff" >&2
  exit 1
fi
printf '%s\n' 'CONTROL_CADENCE_DIFF_GATE_PASS'
