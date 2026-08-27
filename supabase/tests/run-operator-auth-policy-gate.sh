#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE_DIR="$(mktemp -d /tmp/ennco-operator-auth-policy-gate.XXXXXX)"
GATE_PORT="${ENNCO_OPERATOR_AUTH_POLICY_GATE_PORT:-55471}"
GATE_DB="ennco_operator_auth_policy_gate"

cleanup() {
  pg_ctl -D "$GATE_DIR/data" stop -m fast >/dev/null 2>&1 || true
  case "$GATE_DIR" in
    /tmp/ennco-operator-auth-policy-gate.*) find "$GATE_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected temp path: %s\n' "$GATE_DIR" >&2 ;;
  esac
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
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
SQL

"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608110001_core.sql" >/dev/null
"${PSQL[@]}" <<'SQL'
create schema storage;
create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(bucket_id,name));
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
  202608270033_operator_auth_policy.sql
do
  "${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/$migration" >/dev/null
done

# La migración debe sembrar el modo que DEC-106 decidió. Si alguien la edita y
# cambia esa semilla, el gate lo grita aquí y no en producción.
"${PSQL[@]}" <<'SQL'
do $$
begin
  if (select require_mfa from app.auth_policy where singleton) is distinct from false then
    raise exception 'M033_MIGRATION_SEED_DRIFT';
  end if;
end;
$$;
SQL

"${PSQL[@]}" -f "$REPO_ROOT/supabase/tests/034_operator_auth_policy_gate.sql"
