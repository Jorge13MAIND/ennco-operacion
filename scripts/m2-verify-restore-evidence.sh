#!/usr/bin/env bash
set -Eeuo pipefail

export LC_ALL=C
export LANG=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/evidence/m2-restore"
NEGATIVE_TMP=""
POSTGRES_BIN="${ENNCO_POSTGRES_BIN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_ROOT="$2"
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
  "$REPO_ROOT/evidence/m2-restore"|"$REPO_ROOT/evidence/m2-restore/"*|"$REPO_ROOT/evidence/m9-restore"|"$REPO_ROOT/evidence/m9-restore/"*|/tmp/ennco-m2-* ) ;;
  *)
    echo "Evidence dir fuera del alcance permitido: $EVIDENCE_DIR" >&2
    exit 2
    ;;
esac

cleanup() {
  set +e
  if [[ -n "$NEGATIVE_TMP" ]]; then
    case "$NEGATIVE_TMP" in
      /tmp/ennco-m2-negative.*) rm -rf -- "$NEGATIVE_TMP" ;;
      *) echo "No se elimina temp fuera del prefijo validado: $NEGATIVE_TMP" >&2 ;;
    esac
  fi
}
trap cleanup EXIT INT TERM

if [[ -z "$POSTGRES_BIN" ]] && command -v pg_config >/dev/null 2>&1; then
  POSTGRES_BIN="$(pg_config --bindir)"
fi
if [[ -z "$POSTGRES_BIN" || ! -x "$POSTGRES_BIN/pg_restore" ]]; then
  echo "No se pudo resolver pg_restore" >&2
  exit 2
fi

cd "$EVIDENCE_DIR"

shasum -a 256 -c backup-artifacts.sha256
"$POSTGRES_BIN/pg_restore" --list artifacts/ennco-m2-logical.dump > dump-contents.list
tar -tzf artifacts/ennco-m2-objects.tar.gz > object-backup-contents.list

cmp invariants-source.tsv invariants-restored.tsv
cmp object-checksums-source.sha256 object-checksums-restored.sha256
awk -F '\t' 'NR > 1 && $4 != "PASS" { exit 1 }' database-counts.tsv
awk -F '\t' 'NR > 1 && $4 != "PASS" { exit 1 }' database-checksums.tsv
awk -F '\t' '$2 != "t" { exit 1 }' invariants-source.tsv

grep -q '"status": "PASS"' summary.json
grep -q '"production_pitr_proven": false' summary.json
grep -q '"production_rpo_15m_proven": false' summary.json
grep -q '"production_rto_4h_proven": false' summary.json

DUMP_TABLE_DATA_COUNT="$(grep -c 'TABLE DATA' dump-contents.list)"
OBJECT_FILE_ENTRY_COUNT="$(grep -c -v '/$' object-backup-contents.list)"
[[ "$DUMP_TABLE_DATA_COUNT" -eq 9 ]]
[[ "$OBJECT_FILE_ENTRY_COUNT" -eq 2 ]]

NEGATIVE_TMP="$(mktemp -d /tmp/ennco-m2-negative.XXXXXX)"
cp artifacts/ennco-m2-objects.tar.gz "$NEGATIVE_TMP/object.tar.gz"
printf 'corruption' >> "$NEGATIVE_TMP/object.tar.gz"
EXPECTED_HASH="$(awk '$2 == "artifacts/ennco-m2-objects.tar.gz" { print $1 }' backup-artifacts.sha256)"
printf '%s  object.tar.gz\n' "$EXPECTED_HASH" > "$NEGATIVE_TMP/check.sha256"
if (
  cd "$NEGATIVE_TMP"
  shasum -a 256 -c check.sha256 >/dev/null 2>&1
); then
  echo "El control negativo no detectó corrupción" >&2
  exit 1
fi

{
  printf 'check\tstatus\tdetail\n'
  printf 'backup_artifact_sha256\tPASS\tdatabase_dump_and_object_tar_match_manifest\n'
  printf 'database_table_data_entries\tPASS\t%s\n' "$DUMP_TABLE_DATA_COUNT"
  printf 'object_file_entries\tPASS\t%s\n' "$OBJECT_FILE_ENTRY_COUNT"
  printf 'database_row_counts\tPASS\tall_tables_match\n'
  printf 'database_row_sha256\tPASS\tall_tables_match\n'
  printf 'invariants_source_restore\tPASS\tidentical_and_true\n'
  printf 'object_content_sha256\tPASS\tsource_and_restore_match\n'
  printf 'corruption_detection\tPASS\taltered_object_archive_rejected\n'
  printf 'production_pitr_claim\tPASS\tremains_false\n'
  printf 'production_rpo_15m_claim\tPASS\tremains_false\n'
  printf 'production_rto_4h_claim\tPASS\tremains_false\n'
} > independent-verification.tsv

echo "PASS independent_verification=11/11"
