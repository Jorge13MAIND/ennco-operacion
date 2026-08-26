#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M029_GATE_DIR="$(mktemp -d /tmp/ennco-hybrid-accelerated-gate.XXXXXX)"
M029_GATE_PORT="${ENNCO_M029_GATE_PORT:-55479}"
M029_GATE_DB="ennco_hybrid_accelerated_gate"

cleanup() {
  pg_ctl -D "$M029_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$M029_GATE_DIR" in
    /tmp/ennco-hybrid-accelerated-gate.*) find "$M029_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$M029_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$M029_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$M029_GATE_DIR/data" -o "-p $M029_GATE_PORT -k $M029_GATE_DIR" -l "$M029_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" "$M029_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" <<'SQL' >/dev/null
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

psql -X -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" <<'SQL' >/dev/null
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
  psql -X -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" -f "$migration" >/dev/null
done < <(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2)

psql -X -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/029_hybrid_accelerated_outbound_gate.sql"

M029_OBSERVED_AT="$(psql -X -At -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" -c "select (max(observed_at)+interval '1 second')::text from public.hybrid_mailbox_observations where organization_id='29000000-0000-4000-8000-000000000001' and mailbox_id=(select id from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx')")"
M029_MAILBOX_ID="$(psql -X -At -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" -c "select id from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'")"
M029_CONCURRENCY_SQL="set request.jwt.claim.sub='29100000-0000-4000-8000-000000000001'; set request.jwt.claim.aal='aal2'; set role authenticated; select public.record_hybrid_mailbox_observation('29000000-0000-4000-8000-000000000001','$M029_MAILBOX_ID',jsonb_build_object('valid_deliveries',100,'attempted_deliveries',102,'hard_bounces',0,'spam_complaints',1,'delivery_rate',round(100::numeric/102::numeric,6),'reply_sync_p95_seconds',60,'positive_reply_sla_breaches',0,'provider_reconciled',true,'suppression_reconciled',true,'identity_unambiguous',true,'evidence_sha256',repeat('c',64),'evidence_class','live','observed_at','$M029_OBSERVED_AT'::timestamptz),repeat('e',64))->>'status';"

psql -X -At -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" -c "$M029_CONCURRENCY_SQL" >"$M029_GATE_DIR/concurrency-1.txt" &
M029_PID_ONE=$!
psql -X -At -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" -c "$M029_CONCURRENCY_SQL" >"$M029_GATE_DIR/concurrency-2.txt" &
M029_PID_TWO=$!
wait "$M029_PID_ONE"
wait "$M029_PID_TWO"
M029_CONCURRENCY_RESULTS="$(cat "$M029_GATE_DIR/concurrency-1.txt" "$M029_GATE_DIR/concurrency-2.txt")"
if [[ "$(printf '%s\n' "$M029_CONCURRENCY_RESULTS" | grep -Ec '^(RECORDED|DUPLICATE)$')" -ne 2 ]] \
  || [[ "$(printf '%s\n' "$M029_CONCURRENCY_RESULTS" | grep -Ec '^RECORDED$')" -ne 1 ]] \
  || [[ "$(printf '%s\n' "$M029_CONCURRENCY_RESULTS" | grep -Ec '^DUPLICATE$')" -ne 1 ]]; then
  sed -n '1,20p' "$M029_GATE_DIR/concurrency-1.txt" "$M029_GATE_DIR/concurrency-2.txt" >&2
  exit 1
fi
printf '%s\n' 'HYBRID_ACCELERATED_OUTBOUND_CONCURRENCY_PASS'

pg_dump -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M029_GATE_DIR/schema-before.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" \
  -f "$REPO_ROOT/supabase/rollbacks/202608250029_hybrid_accelerated_outbound.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/029_hybrid_accelerated_outbound_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608250029_hybrid_accelerated_outbound.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" <<'SQL'
do $$ begin
  if to_regprocedure('public.evaluate_hybrid_outbound_readiness(uuid,timestamptz)') is null
    or to_regprocedure('public.apply_hybrid_mailbox_snapshot(uuid,jsonb,text)') is null
    or to_regprocedure('public.create_hybrid_outbound_release(uuid,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,uuid[],text)') is null
  then raise exception 'M029_REAPPLY_RPC_MISSING'; end if;
  if exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass
    and tgname='messages_aaa_m029_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M029_REAPPLY_ROLLBACK_GUARD_SURVIVED'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass
    and tgname='messages_aaa_m029_hybrid_outbound' and not tgisinternal)
  then raise exception 'M029_REAPPLY_HYBRID_TRIGGER_MISSING'; end if;
  if (select count(*) from public.hybrid_outbound_releases where organization_id='29000000-0000-4000-8000-000000000001')<>1
  then raise exception 'M029_REAPPLY_LEDGER_DRIFT'; end if;
end $$;
select 'HYBRID_ACCELERATED_OUTBOUND_REAPPLY_PASS' as result;
SQL

pg_dump -h "$M029_GATE_DIR" -p "$M029_GATE_PORT" -d "$M029_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M029_GATE_DIR/schema-after.sql"
if ! diff -u "$M029_GATE_DIR/schema-before.sql" "$M029_GATE_DIR/schema-after.sql" >"$M029_GATE_DIR/schema.diff"; then
  sed -n '1,260p' "$M029_GATE_DIR/schema.diff" >&2
  exit 1
fi
printf '%s\n' 'HYBRID_ACCELERATED_OUTBOUND_DIFF_PASS'

git -C "$REPO_ROOT" diff --check -- \
  supabase/migrations/202608250029_hybrid_accelerated_outbound.sql \
  supabase/rollbacks/202608250029_hybrid_accelerated_outbound.down.sql \
  supabase/tests/029_hybrid_accelerated_outbound_gate.sql \
  supabase/tests/029_hybrid_accelerated_outbound_rollback_gate.sql \
  supabase/tests/run-hybrid-accelerated-outbound-gate.sh
bash -n "$REPO_ROOT/supabase/tests/run-hybrid-accelerated-outbound-gate.sh"
printf '%s\n' 'HYBRID_ACCELERATED_OUTBOUND_SCRIPT_PASS'
