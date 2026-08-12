#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE_DIR="$(mktemp -d /tmp/ennco-retention-live-gate.XXXXXX)"
GATE_PORT="${ENNCO_RETENTION_LIVE_GATE_PORT:-55461}"
GATE_DB="ennco_retention_live_gate"

cleanup(){
  pg_ctl -D "$GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$GATE_DIR" in /tmp/ennco-retention-live-gate.*) find "$GATE_DIR" -depth -delete;; *) exit 1;; esac
}
trap cleanup EXIT

initdb -D "$GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$GATE_DIR/data" -o "-p $GATE_PORT -k $GATE_DIR" -l "$GATE_DIR/postgres.log" start >/dev/null
createdb -h "$GATE_DIR" -p "$GATE_PORT" "$GATE_DB"
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$GATE_DIR" -p "$GATE_PORT" -d "$GATE_DB")
"${PSQL[@]}" <<'SQL'
create role service_role nologin bypassrls;
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
SQL
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
"${PSQL[@]}" <<'SQL'
create schema storage;
create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select on storage.buckets to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
SQL
for migration in $(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | sort | tail -n +2); do
  "${PSQL[@]}" -f "$migration" >/dev/null
done
"${PSQL[@]}" -f "$REPO_ROOT/supabase/tests/021_retention_live_local_control_gate.sql"

"${PSQL[@]}" <<'SQL'
select set_config('app.research_rpc_write','true',false);
insert into public.contacts(id,organization_id,account_id,full_name,role_title,normalized_email,verified,verified_at,source_confidence) values
('32130000-0000-4000-8000-000000000004','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','M021 Race Candidate','CEO','race-candidate@m021.invalid',true,now(),'VERIFIED');
set role service_role;
select set_config('app.retention_test_clock','2026-08-12T15:00:00Z',false);
select app.record_retention_subject_clock('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000004','SYNTHETIC_CONTACT','2026-06-01',repeat('b',64),repeat('c',64));
reset role;
SQL
RACE_A="$GATE_DIR/race-a.log"; RACE_B="$GATE_DIR/race-b.log"
race(){ local log="$1" key="$2"; "${PSQL[@]}" -v race_key="$key" >"$log" 2>&1 <<'SQL'
set role service_role;
select set_config('app.retention_test_clock','2026-08-12T15:00:00Z',false);
select app.run_retention_reconciler('32100000-0000-4000-8000-000000000001',repeat(:'race_key',64));
SQL
}
race "$RACE_A" f & A_PID=$!; race "$RACE_B" e & B_PID=$!
A_STATUS=0; B_STATUS=0; wait "$A_PID" || A_STATUS=$?; wait "$B_PID" || B_STATUS=$?
if [[ "$A_STATUS" -ne 0 || "$B_STATUS" -ne 0 ]] || \
  [[ "$(rg -l '"item_count": 1' "$RACE_A" "$RACE_B" | wc -l | tr -d ' ')" -ne 1 ]] || \
  [[ "$(rg -l '"item_count": 0' "$RACE_A" "$RACE_B" | wc -l | tr -d ' ')" -ne 1 ]]; then
  sed -n '1,160p' "$RACE_A" >&2; sed -n '1,160p' "$RACE_B" >&2; exit 1
fi
"${PSQL[@]}" <<'SQL'
do $$ begin
  if (select count(*) from public.retention_command_ledger where organization_id='32100000-0000-4000-8000-000000000001' and command_name='run_retention_reconciler' and idempotency_key in (repeat('e',64),repeat('f',64)))<>2
    or (select count(*) from public.deletion_items where organization_id='32100000-0000-4000-8000-000000000001' and subject_id='32130000-0000-4000-8000-000000000004' and status in ('PENDING','ELIGIBLE','INELIGIBLE_RETENTION','BLOCKED_HOLD'))<>1
    or (select count(distinct batch_id) from public.deletion_items where organization_id='32100000-0000-4000-8000-000000000001' and subject_id='32130000-0000-4000-8000-000000000004')<>1
  then raise exception 'M021_DISTINCT_KEY_CONCURRENCY_DUPLICATED_CANDIDATE'; end if;
end $$;
\echo 'RETENTION_LIVE_LOCAL_CONTROL_CONCURRENCY_PASS'
SQL

pg_dump -h "$GATE_DIR" -p "$GATE_PORT" -d "$GATE_DB" --schema-only --no-owner --no-privileges | sed '/^\\restrict /d;/^\\unrestrict /d' >"$GATE_DIR/schema-before.sql"
"${PSQL[@]}" <<'SQL'
create table public.m021_gate_preservation_snapshot as
select
  count(*)::integer as tombstone_count,
  encode(digest(coalesce(string_agg(id::text||':'||subject_hash||':'||deletion_evidence_sha256||':'||deleted_at::text,E'\n' order by id),''),'sha256'),'hex') as tombstone_checksum,
  (select max(heartbeat_at) from public.retention_reconciliation_runs where organization_id='32100000-0000-4000-8000-000000000001') as reconciliation_watermark
from public.deletion_tombstones
where organization_id='32100000-0000-4000-8000-000000000001';
SQL
"${PSQL[@]}" -f "$REPO_ROOT/supabase/rollbacks/202608120021_retention_live_local_control.down.sql" >/dev/null
"${PSQL[@]}" -f "$REPO_ROOT/supabase/tests/021_retention_live_local_control_rollback_gate.sql"
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608120021_retention_live_local_control.sql" >/dev/null
"${PSQL[@]}" <<'SQL'
do $$ begin
  if exists(select 1 from pg_trigger where tgrelid='public.deletion_tombstones'::regclass and tgname='deletion_tombstones_m021_rollback_fail_closed' and not tgisinternal)
    or not exists(select 1 from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001'
      and subject_hash=encode(digest('32100000-0000-4000-8000-000000000001:CONTACT:32130000-0000-4000-8000-000000000001','sha256'),'hex'))
    or not exists(
      select 1 from public.m021_gate_preservation_snapshot s
      where s.tombstone_count=(select count(*) from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001')
        and s.tombstone_checksum=(select encode(digest(coalesce(string_agg(id::text||':'||subject_hash||':'||deletion_evidence_sha256||':'||deleted_at::text,E'\n' order by id),''),'sha256'),'hex') from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001')
        and s.reconciliation_watermark=(select max(heartbeat_at) from public.retention_reconciliation_runs where organization_id='32100000-0000-4000-8000-000000000001')
    )
  then raise exception 'M021_REAPPLY_INVALID'; end if;
end $$;
\echo 'RETENTION_LIVE_LOCAL_CONTROL_REAPPLY_PASS'
SQL

"${PSQL[@]}" -f "$REPO_ROOT/supabase/rollbacks/202608110003_retention_deletion.down.sql" >/dev/null
"${PSQL[@]}" <<'SQL'
do $$ begin
  if to_regclass('public.deletion_tombstones') is null or not exists(select 1 from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001')
    or not exists(select 1 from pg_trigger where tgrelid='public.deletion_tombstones'::regclass and tgname='deletion_tombstones_m003_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M003_LOGICAL_ROLLBACK_DESTROYED_M021_EVIDENCE'; end if;
end $$;
\echo 'RETENTION_M003_JOURNAL_PRESERVATION_PASS'
SQL
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608110003_retention_deletion.sql" >/dev/null
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608120012_security_consistency_hardening.sql" >/dev/null
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608120021_retention_live_local_control.sql" >/dev/null
"${PSQL[@]}" <<'SQL'
do $$ begin
  if exists(select 1 from pg_trigger where tgrelid='public.deletion_tombstones'::regclass and tgname in ('deletion_tombstones_m003_rollback_fail_closed','deletion_tombstones_m021_rollback_fail_closed') and not tgisinternal)
    or not exists(select 1 from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001'
      and subject_hash=encode(digest('32100000-0000-4000-8000-000000000001:CONTACT:32130000-0000-4000-8000-000000000001','sha256'),'hex'))
    or not exists(
      select 1 from public.m021_gate_preservation_snapshot s
      where s.tombstone_count=(select count(*) from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001')
        and s.tombstone_checksum=(select encode(digest(coalesce(string_agg(id::text||':'||subject_hash||':'||deletion_evidence_sha256||':'||deleted_at::text,E'\n' order by id),''),'sha256'),'hex') from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001')
        and s.reconciliation_watermark=(select max(heartbeat_at) from public.retention_reconciliation_runs where organization_id='32100000-0000-4000-8000-000000000001')
    )
  then raise exception 'M003_M021_REAPPLY_JOURNAL_INVALID'; end if;
end $$;
drop table public.m021_gate_preservation_snapshot;
\echo 'RETENTION_M003_M021_REAPPLY_PASS'
SQL
pg_dump -h "$GATE_DIR" -p "$GATE_PORT" -d "$GATE_DB" --schema-only --no-owner --no-privileges | sed '/^\\restrict /d;/^\\unrestrict /d' >"$GATE_DIR/schema-after.sql"
diff -u "$GATE_DIR/schema-before.sql" "$GATE_DIR/schema-after.sql"
printf 'RETENTION_LIVE_LOCAL_CONTROL_DIFF_CHECK_PASS\n'
