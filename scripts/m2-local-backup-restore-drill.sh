#!/usr/bin/env bash
set -Eeuo pipefail

export LC_ALL=C
export LANG=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/evidence/m2-restore"
POSTGRES_BIN="${ENNCO_POSTGRES_BIN:-}"
TASK_TMP=""
PGDATA_LOCAL=""
PGSOCKET_LOCAL=""
POSTGRES_STARTED=false
CURRENT_STEP="bootstrap"
STARTED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_EPOCH="$(date +%s)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_ROOT="$2"
      SCRIPT_DIR="$REPO_ROOT/scripts"
      EVIDENCE_DIR="$REPO_ROOT/evidence/m2-restore"
      shift 2
      ;;
    --evidence-dir)
      EVIDENCE_DIR="$2"
      shift 2
      ;;
    --postgres-bin)
      POSTGRES_BIN="$2"
      shift 2
      ;;
    *)
      echo "Argumento no reconocido: $1" >&2
      exit 2
      ;;
  esac
done

case "$EVIDENCE_DIR" in
  "$REPO_ROOT/evidence/m2-restore"|"$REPO_ROOT/evidence/m2-restore/"*|/tmp/ennco-m2-* ) ;;
  *)
    echo "Evidence dir fuera del alcance permitido: $EVIDENCE_DIR" >&2
    exit 2
    ;;
esac

mkdir -p "$EVIDENCE_DIR" "$EVIDENCE_DIR/artifacts"
COMMANDS_LOG="$EVIDENCE_DIR/commands.log"
: > "$COMMANDS_LOG"

log_command() {
  printf '%s\n' "$*" >> "$COMMANDS_LOG"
}

assert_sql_rejected() {
  local database="$1"
  local label="$2"
  local sql="$3"
  if "${PSQL[@]}" -d "$database" -c "$sql" \
    > "$TASK_TMP/$label.out" 2> "$TASK_TMP/$label.err"; then
    echo "La base aceptó una mutación que debía rechazar: $label" >&2
    return 1
  fi
}

write_extend_summary() {
  local exit_code="$1"
  local line="$2"
  local finished_at elapsed
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  elapsed="$(( $(date +%s) - START_EPOCH ))"
  cat > "$EVIDENCE_DIR/summary.json" <<EOF
{
  "schema_version": "1.0.0",
  "status": "EXTEND",
  "started_at_utc": "$STARTED_AT_UTC",
  "finished_at_utc": "$finished_at",
  "duration_seconds": $elapsed,
  "failed_step": "$CURRENT_STEP",
  "failed_line": $line,
  "exit_code": $exit_code,
  "scope": "local_disposable_postgresql_and_synthetic_objects",
  "production_pitr_proven": false,
  "production_rpo_15m_proven": false
}
EOF
}

on_error() {
  local exit_code="$1"
  local line="$2"
  set +e
  write_extend_summary "$exit_code" "$line"
  echo "EXTEND step=$CURRENT_STEP line=$line exit=$exit_code" >&2
}

cleanup() {
  set +e
  if [[ "$POSTGRES_STARTED" == true && -n "$PGDATA_LOCAL" ]]; then
    "$POSTGRES_BIN/pg_ctl" -D "$PGDATA_LOCAL" -m fast stop >/dev/null 2>&1
  fi
  if [[ -n "$TASK_TMP" ]]; then
    case "$TASK_TMP" in
      /tmp/ennco-m2-restore.*) rm -rf -- "$TASK_TMP" ;;
      *) echo "No se elimina temp fuera del prefijo validado: $TASK_TMP" >&2 ;;
    esac
  fi
}

trap 'on_error $? $LINENO' ERR
trap cleanup EXIT INT TERM

if [[ -z "$POSTGRES_BIN" ]] && command -v pg_config >/dev/null 2>&1; then
  POSTGRES_BIN="$(pg_config --bindir)"
fi
if [[ -z "$POSTGRES_BIN" ]]; then
  echo "No se pudo resolver el directorio binario de PostgreSQL" >&2
  exit 2
fi

for executable in initdb pg_ctl createdb psql pg_dump pg_restore postgres; do
  if [[ ! -x "$POSTGRES_BIN/$executable" ]]; then
    echo "Falta ejecutable PostgreSQL: $POSTGRES_BIN/$executable" >&2
    exit 2
  fi
done

unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE

TASK_TMP="$(mktemp -d /tmp/ennco-m2-restore.XXXXXX)"
PGDATA_LOCAL="$TASK_TMP/pgdata"
PGSOCKET_LOCAL="$TASK_TMP/socket"
SOURCE_OBJECTS="$TASK_TMP/object-source"
RESTORED_OBJECTS="$TASK_TMP/object-restored"
BACKUP_WORK="$TASK_TMP/backup"
SOURCE_DB="ennco_m2_source"
RESTORE_DB="ennco_m2_restore"
PGPORT_LOCAL="$(( 55432 + ($$ % 1000) ))"
mkdir -p "$PGSOCKET_LOCAL" "$SOURCE_OBJECTS/prequotes" "$SOURCE_OBJECTS/receipts" "$RESTORED_OBJECTS" "$BACKUP_WORK"

CURRENT_STEP="create_synthetic_objects"
printf '%s\n' '{"folio":"PQ-M2-001","synthetic":true,"capacity_kwp":150,"external_delivery":false}' \
  > "$SOURCE_OBJECTS/prequotes/PQ-M2-001.json"
printf '%s\n' 'SYNTHETIC RECEIPT FIXTURE. NO PII. NO CUSTOMER DATA.' \
  > "$SOURCE_OBJECTS/receipts/REC-M2-001.txt"
PREQUOTE_SHA="$(shasum -a 256 "$SOURCE_OBJECTS/prequotes/PQ-M2-001.json" | awk '{print $1}')"
RECEIPT_SHA="$(shasum -a 256 "$SOURCE_OBJECTS/receipts/REC-M2-001.txt" | awk '{print $1}')"
PREQUOTE_SIZE="$(stat -f '%z' "$SOURCE_OBJECTS/prequotes/PQ-M2-001.json" 2>/dev/null || stat -c '%s' "$SOURCE_OBJECTS/prequotes/PQ-M2-001.json")"
RECEIPT_SIZE="$(stat -f '%z' "$SOURCE_OBJECTS/receipts/REC-M2-001.txt" 2>/dev/null || stat -c '%s' "$SOURCE_OBJECTS/receipts/REC-M2-001.txt")"

CURRENT_STEP="initialize_disposable_postgres"
log_command "initdb --no-locale --encoding=UTF8 --auth=trust -D <mktemp>/pgdata"
"$POSTGRES_BIN/initdb" --no-locale --encoding=UTF8 --auth=trust -D "$PGDATA_LOCAL" > "$TASK_TMP/initdb.log"
log_command "pg_ctl -D <mktemp>/pgdata -o listen_addresses='' unix_socket_directories=<mktemp>/socket start"
"$POSTGRES_BIN/pg_ctl" \
  -D "$PGDATA_LOCAL" \
  -l "$TASK_TMP/postgres.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$PGSOCKET_LOCAL' -p $PGPORT_LOCAL -F" \
  start >/dev/null
POSTGRES_STARTED=true

PSQL=("$POSTGRES_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PGSOCKET_LOCAL" -p "$PGPORT_LOCAL")
CREATEDB=("$POSTGRES_BIN/createdb" -h "$PGSOCKET_LOCAL" -p "$PGPORT_LOCAL")

CURRENT_STEP="seed_source_database"
log_command "createdb --host=<unix-socket> $SOURCE_DB"
"${CREATEDB[@]}" "$SOURCE_DB"
log_command "psql $SOURCE_DB -f scripts/m2/schema.sql"
"${PSQL[@]}" -d "$SOURCE_DB" -f "$SCRIPT_DIR/m2/schema.sql" > "$TASK_TMP/schema.log"
log_command "psql $SOURCE_DB -f scripts/m2/seed.sql with synthetic object checksums"
"${PSQL[@]}" \
  -d "$SOURCE_DB" \
  -v object_prequote_sha="$PREQUOTE_SHA" \
  -v object_prequote_size="$PREQUOTE_SIZE" \
  -v object_receipt_sha="$RECEIPT_SHA" \
  -v object_receipt_size="$RECEIPT_SIZE" \
  -f "$SCRIPT_DIR/m2/seed.sql" > "$TASK_TMP/seed.log"

CURRENT_STEP="prove_audit_append_only_source"
assert_sql_rejected "$SOURCE_DB" "audit-source" \
  "UPDATE audit_log SET event_type = 'tampered' WHERE id = '80000000-0000-4000-8000-000000000001';"
assert_sql_rejected "$SOURCE_DB" "idempotency-source" \
  "INSERT INTO messages (id, organization_id, company_id, idempotency_key, recipient_email, subject, body_text, dry_run, created_at) SELECT '30000000-0000-4000-8000-000000000099', organization_id, company_id, idempotency_key, recipient_email, subject, body_text, dry_run, created_at FROM messages WHERE id = '30000000-0000-4000-8000-000000000001';"
assert_sql_rejected "$SOURCE_DB" "strict-lead-source" \
  "INSERT INTO leads (id, organization_id, company_id, reply_id, qualification_status, project_capacity_kwp, annex_a_match, contact_role_verified, explicit_interest, monthly_spend_mxn, evidence_reference, next_action, next_action_due_at, created_at) SELECT '50000000-0000-4000-8000-000000000099', organization_id, company_id, reply_id, 'QUALIFIED', 50, false, true, true, 250000, evidence_reference, next_action, next_action_due_at, created_at FROM leads WHERE id = '50000000-0000-4000-8000-000000000001';"

CURRENT_STEP="create_logical_and_object_backups"
DB_DUMP="$EVIDENCE_DIR/artifacts/ennco-m2-logical.dump"
OBJECT_TAR="$EVIDENCE_DIR/artifacts/ennco-m2-objects.tar.gz"
log_command "pg_dump --format=custom --no-owner --no-privileges $SOURCE_DB"
"$POSTGRES_BIN/pg_dump" \
  -h "$PGSOCKET_LOCAL" \
  -p "$PGPORT_LOCAL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$DB_DUMP" \
  "$SOURCE_DB"
log_command "tar -czf evidence/m2-restore/artifacts/ennco-m2-objects.tar.gz -C <synthetic-object-source> ."
tar -czf "$OBJECT_TAR" -C "$SOURCE_OBJECTS" .
DB_DUMP_SHA="$(shasum -a 256 "$DB_DUMP" | awk '{print $1}')"
OBJECT_TAR_SHA="$(shasum -a 256 "$OBJECT_TAR" | awk '{print $1}')"
printf '%s  %s\n%s  %s\n' \
  "$DB_DUMP_SHA" "artifacts/ennco-m2-logical.dump" \
  "$OBJECT_TAR_SHA" "artifacts/ennco-m2-objects.tar.gz" \
  > "$EVIDENCE_DIR/backup-artifacts.sha256"

CURRENT_STEP="restore_to_separate_destinations"
log_command "createdb --host=<unix-socket> $RESTORE_DB"
"${CREATEDB[@]}" "$RESTORE_DB"
log_command "pg_restore --no-owner --no-privileges --exit-on-error --dbname=$RESTORE_DB <logical-dump>"
"$POSTGRES_BIN/pg_restore" \
  -h "$PGSOCKET_LOCAL" \
  -p "$PGPORT_LOCAL" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --dbname="$RESTORE_DB" \
  "$DB_DUMP" > "$TASK_TMP/pg-restore.log"
log_command "tar -xzf <object-backup> -C <separate-object-restore>"
tar -xzf "$OBJECT_TAR" -C "$RESTORED_OBJECTS"

CURRENT_STEP="verify_database_counts_and_checksums"
TABLES=(
  organizations
  companies
  suppression_entries
  messages
  replies
  leads
  outbox_events
  object_records
  audit_log
)
printf 'table\tsource_count\trestored_count\tstatus\n' > "$EVIDENCE_DIR/database-counts.tsv"
printf 'table\tsource_sha256\trestored_sha256\tstatus\n' > "$EVIDENCE_DIR/database-checksums.tsv"

for table in "${TABLES[@]}"; do
  source_count="$("${PSQL[@]}" -qAt -d "$SOURCE_DB" -c "SELECT count(*) FROM public.$table;")"
  restored_count="$("${PSQL[@]}" -qAt -d "$RESTORE_DB" -c "SELECT count(*) FROM public.$table;")"
  count_status="FAIL"
  [[ "$source_count" == "$restored_count" ]] && count_status="PASS"
  printf '%s\t%s\t%s\t%s\n' "$table" "$source_count" "$restored_count" "$count_status" \
    >> "$EVIDENCE_DIR/database-counts.tsv"
  [[ "$count_status" == "PASS" ]]

  "${PSQL[@]}" -qAt -d "$SOURCE_DB" \
    -c "COPY (SELECT to_jsonb(t)::text FROM public.$table t ORDER BY id::text) TO STDOUT;" \
    > "$TASK_TMP/source-$table.jsonl"
  "${PSQL[@]}" -qAt -d "$RESTORE_DB" \
    -c "COPY (SELECT to_jsonb(t)::text FROM public.$table t ORDER BY id::text) TO STDOUT;" \
    > "$TASK_TMP/restored-$table.jsonl"
  source_sha="$(shasum -a 256 "$TASK_TMP/source-$table.jsonl" | awk '{print $1}')"
  restored_sha="$(shasum -a 256 "$TASK_TMP/restored-$table.jsonl" | awk '{print $1}')"
  checksum_status="FAIL"
  [[ "$source_sha" == "$restored_sha" ]] && checksum_status="PASS"
  printf '%s\t%s\t%s\t%s\n' "$table" "$source_sha" "$restored_sha" "$checksum_status" \
    >> "$EVIDENCE_DIR/database-checksums.tsv"
  [[ "$checksum_status" == "PASS" ]]
done

CURRENT_STEP="verify_invariants_source_and_restore"
"${PSQL[@]}" -qAt -F $'\t' -d "$SOURCE_DB" -f "$SCRIPT_DIR/m2/invariants.sql" \
  > "$EVIDENCE_DIR/invariants-source.tsv"
"${PSQL[@]}" -qAt -F $'\t' -d "$RESTORE_DB" -f "$SCRIPT_DIR/m2/invariants.sql" \
  > "$EVIDENCE_DIR/invariants-restored.tsv"
cmp "$EVIDENCE_DIR/invariants-source.tsv" "$EVIDENCE_DIR/invariants-restored.tsv"
if awk -F '\t' '$2 != "t" { failed=1 } END { exit failed ? 1 : 0 }' \
  "$EVIDENCE_DIR/invariants-source.tsv"; then
  INVARIANTS_STATUS="PASS"
else
  INVARIANTS_STATUS="FAIL"
  exit 1
fi

CURRENT_STEP="prove_audit_append_only_restore"
assert_sql_rejected "$RESTORE_DB" "audit-restore" \
  "DELETE FROM audit_log WHERE id = '80000000-0000-4000-8000-000000000001';"
assert_sql_rejected "$RESTORE_DB" "idempotency-restore" \
  "INSERT INTO messages (id, organization_id, company_id, idempotency_key, recipient_email, subject, body_text, dry_run, created_at) SELECT '30000000-0000-4000-8000-000000000098', organization_id, company_id, idempotency_key, recipient_email, subject, body_text, dry_run, created_at FROM messages WHERE id = '30000000-0000-4000-8000-000000000001';"
assert_sql_rejected "$RESTORE_DB" "strict-lead-restore" \
  "INSERT INTO leads (id, organization_id, company_id, reply_id, qualification_status, project_capacity_kwp, annex_a_match, contact_role_verified, explicit_interest, monthly_spend_mxn, evidence_reference, next_action, next_action_due_at, created_at) SELECT '50000000-0000-4000-8000-000000000098', organization_id, company_id, reply_id, 'QUALIFIED', 50, false, true, true, 250000, evidence_reference, next_action, next_action_due_at, created_at FROM leads WHERE id = '50000000-0000-4000-8000-000000000001';"

CURRENT_STEP="verify_object_restore"
(
  cd "$SOURCE_OBJECTS"
  find . -type f -print | sort | xargs shasum -a 256
) > "$EVIDENCE_DIR/object-checksums-source.sha256"
(
  cd "$RESTORED_OBJECTS"
  find . -type f -print | sort | xargs shasum -a 256
) > "$EVIDENCE_DIR/object-checksums-restored.sha256"
cmp "$EVIDENCE_DIR/object-checksums-source.sha256" "$EVIDENCE_DIR/object-checksums-restored.sha256"

printf 'prequotes/PQ-M2-001.json\t%s\nreceipts/REC-M2-001.txt\t%s\n' "$PREQUOTE_SHA" "$RECEIPT_SHA" \
  | sort > "$TASK_TMP/object-filesystem-manifest.tsv"
"${PSQL[@]}" -qAt -F $'\t' -d "$RESTORE_DB" \
  -c "SELECT object_key, sha256 FROM object_records ORDER BY object_key;" \
  > "$TASK_TMP/object-database-manifest.tsv"
cmp "$TASK_TMP/object-filesystem-manifest.tsv" "$TASK_TMP/object-database-manifest.tsv"
cp "$TASK_TMP/object-database-manifest.tsv" "$EVIDENCE_DIR/object-database-manifest.tsv"

CURRENT_STEP="write_pass_evidence"
FINISHED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DURATION_SECONDS="$(( $(date +%s) - START_EPOCH ))"
POSTGRES_VERSION="$($POSTGRES_BIN/postgres --version | sed 's/"/\\"/g')"
ALL_COUNTS_PASS="$(awk -F '\t' 'NR > 1 && $4 != "PASS" { failed=1 } END { print failed ? "false" : "true" }' "$EVIDENCE_DIR/database-counts.tsv")"
ALL_CHECKSUMS_PASS="$(awk -F '\t' 'NR > 1 && $4 != "PASS" { failed=1 } END { print failed ? "false" : "true" }' "$EVIDENCE_DIR/database-checksums.tsv")"

cat > "$EVIDENCE_DIR/summary.json" <<EOF
{
  "schema_version": "1.0.0",
  "status": "PASS",
  "started_at_utc": "$STARTED_AT_UTC",
  "finished_at_utc": "$FINISHED_AT_UTC",
  "duration_seconds": $DURATION_SECONDS,
  "scope": "local_disposable_postgresql_and_synthetic_objects",
  "postgres_version": "$POSTGRES_VERSION",
  "database_backup": {
    "format": "pg_dump_custom",
    "sha256": "$DB_DUMP_SHA",
    "restored_to_separate_database": true,
    "row_counts_match": $ALL_COUNTS_PASS,
    "row_checksums_match": $ALL_CHECKSUMS_PASS
  },
  "object_backup": {
    "format": "tar_gzip",
    "sha256": "$OBJECT_TAR_SHA",
    "restored_to_separate_directory": true,
    "content_checksums_match": true,
    "database_manifest_matches_filesystem": true
  },
  "controls": {
    "mktemp_used": true,
    "unix_socket_only": true,
    "network_listener_disabled": true,
    "real_provider_used": false,
    "real_credentials_used": false,
    "real_pii_used": false,
    "external_sends": 0,
    "audit_log_append_only_source": true,
    "audit_log_append_only_restore": true,
    "duplicate_idempotency_rejected_source": true,
    "duplicate_idempotency_rejected_restore": true,
    "invalid_qualified_lead_rejected_source": true,
    "invalid_qualified_lead_rejected_restore": true,
    "invariants_match": true
  },
  "limits": {
    "production_pitr_proven": false,
    "production_rpo_15m_proven": false,
    "production_rto_4h_proven": false,
    "supabase_restore_proven": false,
    "production_storage_restore_proven": false,
    "statement": "PASS proves only a local logical backup and synthetic object restore drill. It does not prove production PITR, RPO 15m, RTO 4h, Supabase recovery, or production Storage recovery."
  }
}
EOF

printf '%s\n' \
  "PASS" \
  "database_rows_and_sha256_match=true" \
  "object_sha256_match=true" \
  "invariants_match=true" \
  "production_pitr_proven=false" \
  "production_rpo_15m_proven=false"
