#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
POSTGRES_BIN="${ENNCO_POSTGRES_BIN:-/usr/lib/postgresql/17/bin}"
export PATH="$POSTGRES_BIN:$PATH"
GATE_DIR="$(mktemp -d /tmp/ennco-projects-gate.XXXXXX)"
GATE_PORT="${ENNCO_PROJECTS_GATE_PORT:-55574}"
cleanup() {
  pg_ctl -D "$GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$GATE_DIR" in /tmp/ennco-projects-gate.*) find "$GATE_DIR" -depth -delete ;; *) return 1 ;; esac
}
trap cleanup EXIT
initdb -D "$GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$GATE_DIR/data" -o "-p $GATE_PORT -k $GATE_DIR -c listen_addresses=''" -l "$GATE_DIR/postgres.log" start >/dev/null
createdb -h "$GATE_DIR" -p "$GATE_PORT" ennco_projects_gate
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$GATE_DIR" -p "$GATE_PORT" -d ennco_projects_gate)
"${PSQL[@]}" <<'SQL' >/dev/null
create role service_role nologin bypassrls;
create role authenticated nologin;
create role anon nologin;
create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
SQL
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
"${PSQL[@]}" <<'SQL' >/dev/null
create schema storage;
create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to authenticated;
SQL
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202609100055_ennco_projects.sql" >/dev/null
"${PSQL[@]}" -f "$REPO_ROOT/supabase/tests/055_ennco_projects.sql"
# Two real sessions race on the same project/version. Exactly one may append.
CONCURRENT_PROJECT="$("${PSQL[@]}" -Atq <<'SQL'
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set role authenticated;
select public.ennco_projects_create('11111111-1111-4111-8111-111111111111','{"name":"Concurrent synthetic fixture","segment":"COMMERCIAL","customerName":"Synthetic"}','concurrent-create')->>'projectId';
SQL
)"
case "$CONCURRENT_PROJECT" in ????????-????-????-????-????????????) ;; *) printf '%s\n' 'Invalid concurrency fixture ID' >&2; exit 1 ;; esac
for worker in 1 2; do
  (
    "${PSQL[@]}" -v project_id="$CONCURRENT_PROJECT" -v command_key="concurrent-worker-$worker" <<'SQL' >"$GATE_DIR/worker-$worker.log" 2>&1
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set role authenticated;
select public.ennco_projects_append('11111111-1111-4111-8111-111111111111',:'project_id'::uuid,1,'note','{"text":"Concurrent synthetic record"}',:'command_key');
SQL
  ) &
  if [[ "$worker" = 1 ]]; then WORKER_ONE=$!; else WORKER_TWO=$!; fi
done
STATUS_ONE=0; wait "$WORKER_ONE" || STATUS_ONE=$?
STATUS_TWO=0; wait "$WORKER_TWO" || STATUS_TWO=$?
if [[ "$STATUS_ONE" = 0 && "$STATUS_TWO" = 0 ]] || [[ "$STATUS_ONE" != 0 && "$STATUS_TWO" != 0 ]]; then
  cat "$GATE_DIR/worker-1.log" "$GATE_DIR/worker-2.log"
  printf '%s\n' 'Concurrent append must have exactly one winner' >&2; exit 1
fi
rg -q 'PROJECT_VERSION_CONFLICT' "$GATE_DIR/worker-1.log" "$GATE_DIR/worker-2.log"
"${PSQL[@]}" -v project_id="$CONCURRENT_PROJECT" <<'SQL'
select test_projects.assert((select count(*) from public.ennco_project_records where project_id=:'project_id'::uuid)=1,'concurrent append has one record');
select test_projects.assert((select version from public.ennco_projects where id=:'project_id'::uuid)=2,'concurrent append increments version once');
SQL
"${PSQL[@]}" -f "$REPO_ROOT/supabase/rollbacks/202609100055_ennco_projects.down.sql" >/dev/null
"${PSQL[@]}" <<'SQL'
do $$ begin
 if to_regclass('public.ennco_projects') is not null then raise exception 'ROLLBACK_PROJECTS_REMAIN'; end if;
 if to_regclass('public.opportunities') is null then raise exception 'ROLLBACK_DAMAGED_CRM'; end if;
end $$;
SQL
printf '%s\n' 'ENNCO projects DB gate passed (isolated local PostgreSQL; no production changes).'
