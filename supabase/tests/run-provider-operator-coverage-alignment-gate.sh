#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M028_GATE_DIR="$(mktemp -d /tmp/ennco-provider-coverage-gate.XXXXXX)"
M028_GATE_PORT="${ENNCO_M028_GATE_PORT:-55468}"
M028_GATE_DB="ennco_provider_coverage_gate"

cleanup() {
  pg_ctl -D "$M028_GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$M028_GATE_DIR" in
    /tmp/ennco-provider-coverage-gate.*) find "$M028_GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$M028_GATE_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb -D "$M028_GATE_DIR/data" --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$M028_GATE_DIR/data" -o "-p $M028_GATE_PORT -k $M028_GATE_DIR" -l "$M028_GATE_DIR/postgres.log" start >/dev/null
createdb -h "$M028_GATE_DIR" -p "$M028_GATE_PORT" "$M028_GATE_DB"

PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$M028_GATE_DIR" -p "$M028_GATE_PORT" -d "$M028_GATE_DB")
"${PSQL[@]}" <<'SQL'
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

"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
"${PSQL[@]}" <<'SQL'
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
  "${PSQL[@]}" -f "$migration" >/dev/null
  if [[ "$(basename "$migration")" == "202608200028_provider_operator_coverage_alignment.sql" ]]; then break; fi
done < <(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' | sort | tail -n +2)

"${PSQL[@]}" -f "$REPO_ROOT/supabase/tests/028_provider_operator_coverage_alignment_gate.sql"
"${PSQL[@]}" -f "$REPO_ROOT/supabase/rollbacks/202608200028_provider_operator_coverage_alignment.down.sql"
"${PSQL[@]}" -f "$REPO_ROOT/supabase/tests/028_provider_operator_coverage_alignment_rollback_gate.sql"
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608200028_provider_operator_coverage_alignment.sql"
"${PSQL[@]}" <<'SQL'
do $$
declare requirements text[]:=app.provider_control_requirements(); result jsonb;
begin
  if cardinality(requirements)<>15 or not ('OPERATOR_COVERAGE'=any(requirements))
  then raise exception 'M028_REAPPLY_REQUIREMENTS_INVALID:%',requirements; end if;
  result:=app.evaluate_outbound_provider_readiness_as_system(
    '28000000-0000-4000-8000-000000000001','2026-08-20T18:00:00Z'
  );
  if (result->>'activation_gates_passed')::integer<>15 or result->>'release_state'<>'HOLD'
  then raise exception 'M028_REAPPLY_READINESS_INVALID:%',result; end if;
end $$;
select 'PROVIDER_OPERATOR_COVERAGE_ALIGNMENT_REAPPLY_PASS' as result;
SQL

git -C "$REPO_ROOT" diff --check -- \
  supabase/migrations/202608200028_provider_operator_coverage_alignment.sql \
  supabase/rollbacks/202608200028_provider_operator_coverage_alignment.down.sql \
  supabase/tests/028_provider_operator_coverage_alignment_gate.sql \
  supabase/tests/028_provider_operator_coverage_alignment_rollback_gate.sql \
  supabase/tests/run-provider-operator-coverage-alignment-gate.sh
bash -n "$REPO_ROOT/supabase/tests/run-provider-operator-coverage-alignment-gate.sh"
printf '%s\n' 'PROVIDER_OPERATOR_COVERAGE_ALIGNMENT_SCRIPT_PASS'
