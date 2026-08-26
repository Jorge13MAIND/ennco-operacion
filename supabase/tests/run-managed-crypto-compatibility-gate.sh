#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${ENNCO_PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
WORK_DIR="$(mktemp -d /tmp/ennco-managed-crypto-gate.XXXXXX)"
DATA_DIR="$WORK_DIR/data"
SOCKET_DIR="$WORK_DIR/socket"
PORT="${ENNCO_M027_GATE_PORT:-55467}"

cleanup() {
  if [[ -f "$DATA_DIR/postmaster.pid" ]]; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  fi
  case "$WORK_DIR" in
    /tmp/ennco-managed-crypto-gate.*) find "$WORK_DIR" -depth -delete ;;
    *) printf 'Refusing to delete unexpected path: %s\n' "$WORK_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$SOCKET_DIR"
"$PG_BIN/initdb" -D "$DATA_DIR" -A trust -U postgres --no-locale --encoding=UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA_DIR" -o "-F -k $SOCKET_DIR -p $PORT -c listen_addresses=''" -w start >/dev/null

PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" <<'SQL'
create schema app;
create schema extensions;
create extension pgcrypto with schema extensions;
SQL
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608200027_managed_crypto_compatibility.sql"
"${PSQL[@]}" -f "$REPO_ROOT/supabase/tests/027_managed_crypto_compatibility_gate.sql"
"${PSQL[@]}" -f "$REPO_ROOT/supabase/rollbacks/202608200027_managed_crypto_compatibility.down.sql"
"${PSQL[@]}" <<'SQL'
do $$
begin
  if to_regprocedure('app.hmac(bytea,bytea,text)') is not null then
    raise exception 'MANAGED_CRYPTO_ROLLBACK_FAILED';
  end if;
end;
$$;
select 'MANAGED_CRYPTO_ROLLBACK_PASS' as gate;
SQL
"${PSQL[@]}" -f "$REPO_ROOT/supabase/migrations/202608200027_managed_crypto_compatibility.sql"
"${PSQL[@]}" -f "$REPO_ROOT/supabase/tests/027_managed_crypto_compatibility_gate.sql"
printf 'MANAGED_CRYPTO_REAPPLY_PASS\n'
