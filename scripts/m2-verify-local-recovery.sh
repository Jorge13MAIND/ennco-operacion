#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY_TMP="$(mktemp -d /tmp/ennco-m2-verify.XXXXXX)"

cleanup() {
  case "$VERIFY_TMP" in
    /tmp/ennco-m2-verify.*) find "$VERIFY_TMP" -depth -delete ;;
    *) printf 'Refusing to delete unexpected temp path: %s\n' "$VERIFY_TMP" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

bash "$REPO_ROOT/scripts/m2-local-backup-restore-drill.sh" \
  --repo "$REPO_ROOT" \
  --evidence-dir "$VERIFY_TMP"
bash "$REPO_ROOT/scripts/m2-verify-restore-evidence.sh" \
  --repo "$REPO_ROOT" \
  --evidence-dir "$VERIFY_TMP"

printf 'M2_EPHEMERAL_RESTORE_GATE_PASS\n'
