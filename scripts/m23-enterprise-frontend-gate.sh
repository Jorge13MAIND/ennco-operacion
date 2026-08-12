#!/usr/bin/env bash
set -euo pipefail

repo="${1:-.}"
repo="$(cd "$repo" && pwd)"
evidence_dir="$repo/evidence/m23-frontend"
base_url="http://127.0.0.1:3100"
source_backup_dir="$(mktemp -d)"
cp "$repo/next-env.d.ts" "$source_backup_dir/next-env.d.ts"
server_pid=""
cleanup() {
  cp "$source_backup_dir/next-env.d.ts" "$repo/next-env.d.ts"
  rm -rf "$source_backup_dir"
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if curl --silent --fail "$base_url/api/v1/health" >/dev/null 2>&1; then
  echo "M23_PORT_ALREADY_IN_USE" >&2
  exit 1
fi

cd "$repo"
source_commit="$(git rev-parse HEAD)"
source_snapshot="${M23_SOURCE_SNAPSHOT:-$evidence_dir/source.json}"
if [[ "$source_snapshot" != /* ]]; then
  source_snapshot="$repo/$source_snapshot"
fi

if [[ -z "${M23_SOURCE_SNAPSHOT:-}" ]]; then
  node scripts/security-evidence-gate.mjs snapshot \
    --repo "$repo" \
    --expected-commit "$source_commit" \
    --evidence "$source_snapshot" \
    --context local
elif [[ ! -f "$source_snapshot" ]]; then
  echo "M23_SOURCE_SNAPSHOT_MISSING" >&2
  exit 1
fi

node scripts/security-evidence-gate.mjs verify-snapshot \
  --repo "$repo" \
  --expected-commit "$source_commit" \
  --source-snapshot "$source_snapshot" \
  --allow-prefix "evidence/m23-frontend" \
  --context local >/dev/null

npm run typecheck 2>&1 | tee "$evidence_dir/typecheck.log"
npm run lint 2>&1 | tee "$evidence_dir/lint.log"
npm run build 2>&1 | tee "$evidence_dir/build.log"
cp "$source_backup_dir/next-env.d.ts" "$repo/next-env.d.ts"

node scripts/security-evidence-gate.mjs verify-snapshot \
  --repo "$repo" \
  --expected-commit "$source_commit" \
  --source-snapshot "$source_snapshot" \
  --allow-prefix "evidence/m23-frontend" \
  --context local >/dev/null

npm run start -- --hostname 127.0.0.1 --port 3100 >"$evidence_dir/server.log" 2>&1 &
server_pid=$!

for _ in $(seq 1 60); do
  if curl --silent --fail "$base_url/api/v1/health" >/dev/null; then
    break
  fi
  sleep 0.25
done
curl --silent --fail "$base_url/api/v1/health" >/dev/null

PLAYWRIGHT_BASE_URL="$base_url" npx playwright test \
  tests/e2e/accessibility.spec.ts \
  tests/e2e/frontend-enterprise.spec.ts \
  --config=playwright.m23.config.ts 2>&1 | tee "$evidence_dir/playwright.log"

node scripts/m23-browser-gate.mjs \
  --repo "$repo" \
  --base-url "$base_url" \
  --evidence-dir "evidence/m23-frontend" \
  --source-snapshot "${source_snapshot#"$repo/"}" \
  >"$evidence_dir/browser-report.stdout.json"

BASE_URL="$base_url" M23_LOAD_DURATION="${M23_LOAD_DURATION:-5m}" \
  k6 run --summary-export "$evidence_dir/k6-summary.json" scripts/m23-load-gate.k6.js \
  2>&1 | tee "$evidence_dir/k6.log"

node scripts/m23-frontend-evidence.mjs \
  --repo "$repo" \
  --evidence-dir "evidence/m23-frontend" \
  >"$evidence_dir/manifest.stdout.json"

cp "$source_backup_dir/next-env.d.ts" "$repo/next-env.d.ts"
node scripts/security-evidence-gate.mjs verify-snapshot \
  --repo "$repo" \
  --expected-commit "$source_commit" \
  --source-snapshot "$source_snapshot" \
  --allow-prefix "evidence/m23-frontend" \
  --context local >/dev/null

git diff --check
echo "M23_FRONTEND_QA_GATE_PASS"
