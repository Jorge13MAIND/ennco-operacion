#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M030_GATE_DIR="$(mktemp -d /tmp/ennco-gmail-oauth-kms-gate.XXXXXX)"
M030_GATE_PORT="${ENNCO_M030_GATE_PORT:-55490}"
M030_GATE_DB="ennco_gmail_oauth_kms_gate"

cleanup() {
  pg_ctl -D "$M030_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$M030_GATE_DIR" in
    /tmp/ennco-gmail-oauth-kms-gate.*) find "$M030_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$M030_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$M030_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$M030_GATE_DIR/data" -o "-p $M030_GATE_PORT -k $M030_GATE_DIR" -l "$M030_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" "$M030_GATE_DB"

psql -X -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" <<'SQL' >/dev/null
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

psql -X -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" <<'SQL' >/dev/null
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
  psql -X -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" -f "$migration" >/dev/null
done < <(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2)

psql -X -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/030_gmail_oauth_kms_broker_gate.sql"

M030_EXPIRES_AT="$(psql -X -At -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" \
  -c "select expires_at from public.gmail_oauth_authorizations where state_sha256=repeat('1',64)")"
M030_CONCURRENCY_SQL="set request.jwt.claim.sub='30100000-0000-4000-8000-000000000001'; set request.jwt.claim.aal='aal2'; set role authenticated; select public.begin_gmail_oauth_authorization('30000000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',repeat('7',64),repeat('C',43),repeat('8',64),array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],'$M030_EXPIRES_AT'::timestamptz,repeat('9',64))->>'status';"
psql -X -At -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" -c "$M030_CONCURRENCY_SQL" >"$M030_GATE_DIR/concurrency-1.txt" &
M030_PID_ONE=$!
psql -X -At -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" -c "$M030_CONCURRENCY_SQL" >"$M030_GATE_DIR/concurrency-2.txt" &
M030_PID_TWO=$!
wait "$M030_PID_ONE"
wait "$M030_PID_TWO"
M030_CONCURRENCY_RESULTS="$(cat "$M030_GATE_DIR/concurrency-1.txt" "$M030_GATE_DIR/concurrency-2.txt")"
if [[ "$(printf '%s\n' "$M030_CONCURRENCY_RESULTS" | grep -Ec '^(STARTED|DUPLICATE)$')" -ne 2 ]] \
  || [[ "$(printf '%s\n' "$M030_CONCURRENCY_RESULTS" | grep -Ec '^STARTED$')" -ne 1 ]] \
  || [[ "$(printf '%s\n' "$M030_CONCURRENCY_RESULTS" | grep -Ec '^DUPLICATE$')" -ne 1 ]]; then
  sed -n '1,20p' "$M030_GATE_DIR/concurrency-1.txt" "$M030_GATE_DIR/concurrency-2.txt" >&2
  exit 1
fi
printf '%s\n' 'GMAIL_OAUTH_KMS_BROKER_CONCURRENCY_PASS'

pg_dump -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M030_GATE_DIR/schema-before.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" \
  -f "$REPO_ROOT/supabase/rollbacks/202608250030_gmail_oauth_kms_broker.down.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" \
  -f "$REPO_ROOT/supabase/tests/030_gmail_oauth_kms_broker_rollback_gate.sql"

psql -X -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" \
  -f "$REPO_ROOT/supabase/migrations/202608250030_gmail_oauth_kms_broker.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" <<'SQL'
do $$ begin
  if to_regprocedure('public.begin_gmail_oauth_authorization(uuid,uuid,text,text,text,text[],timestamptz,text)') is null
    or to_regprocedure('public.complete_gmail_oauth_authorization(uuid,text,text,text,text,text,text,text[],timestamptz,text,text,text)') is null
    or to_regprocedure('public.evaluate_gmail_oauth_readiness(uuid,uuid)') is null
  then raise exception 'M030_REAPPLY_RPC_MISSING'; end if;
  if exists(select 1 from pg_trigger where tgrelid='public.mailboxes'::regclass
    and tgname='mailboxes_aaa_m030_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M030_REAPPLY_ROLLBACK_GUARD_SURVIVED'; end if;
  if (select count(*) from public.gmail_oauth_credentials where organization_id='30000000-0000-4000-8000-000000000001')<>1
    or (select status from public.gmail_oauth_credentials where organization_id='30000000-0000-4000-8000-000000000001')<>'ERROR'
  then raise exception 'M030_REAPPLY_CREDENTIAL_JOURNAL_DRIFT'; end if;
end $$;
select 'GMAIL_OAUTH_KMS_BROKER_REAPPLY_PASS' as result;
SQL

pg_dump -h "$M030_GATE_DIR" -p "$M030_GATE_PORT" -d "$M030_GATE_DB" --schema-only --no-owner --no-privileges \
  | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' >"$M030_GATE_DIR/schema-after.sql"
if ! diff -u "$M030_GATE_DIR/schema-before.sql" "$M030_GATE_DIR/schema-after.sql" >"$M030_GATE_DIR/schema.diff"; then
  sed -n '1,260p' "$M030_GATE_DIR/schema.diff" >&2
  exit 1
fi
printf '%s\n' 'GMAIL_OAUTH_KMS_BROKER_DIFF_PASS'

git -C "$REPO_ROOT" diff --check -- \
  supabase/migrations/202608250030_gmail_oauth_kms_broker.sql \
  supabase/rollbacks/202608250030_gmail_oauth_kms_broker.down.sql \
  supabase/tests/030_gmail_oauth_kms_broker_gate.sql \
  supabase/tests/030_gmail_oauth_kms_broker_rollback_gate.sql \
  supabase/tests/run-gmail-oauth-kms-broker-gate.sh
bash -n "$REPO_ROOT/supabase/tests/run-gmail-oauth-kms-broker-gate.sh"
printf '%s\n' 'GMAIL_OAUTH_KMS_BROKER_SCRIPT_PASS'
