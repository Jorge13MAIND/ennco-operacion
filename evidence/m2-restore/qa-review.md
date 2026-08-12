# QA review: M2 local backup and restore drill

## Context

- Task: prove a bounded local logical database backup plus synthetic object backup and restore.
- Scope: `scripts/**`, `docs/runbooks/**`, `evidence/m2-restore/**` only.
- Environment: disposable PostgreSQL 16.13, Unix socket only, network listener disabled.
- External providers, production credentials, real PII and external sends: none.

## Requirements verification

| Requirement | Status | Evidence |
|---|---|---|
| Use `mktemp` and disposable PostgreSQL | PASS | `summary.json`, `commands.log` |
| No provider, credential or network use | PASS | `summary.json`, script review |
| Logical database backup | PASS | `artifacts/ennco-m2-logical.dump` |
| Synthetic object backup | PASS | `artifacts/ennco-m2-objects.tar.gz` |
| Restore to separate database | PASS | `summary.json`, row comparison |
| Restore objects to separate directory | PASS | object checksum comparison |
| Verify row counts | PASS | `database-counts.tsv`, 9 of 9 tables |
| Verify row checksums | PASS | `database-checksums.tsv`, 9 of 9 tables |
| Verify invariants and constraints | PASS | source and restore invariant files, negative constraint tests |
| State production limits | PASS | PITR, RPO 15m and RTO 4h remain false |

## Accuracy and negative tests

- Backup artifact SHA256: PASS.
- Source and restored table SHA256: PASS for all nine tables.
- Source and restored object SHA256: PASS for both objects.
- Database object manifest and restored filesystem: PASS.
- Modified object archive detected as corrupt: PASS.
- Audit log mutation rejected before and after restore: PASS.
- Duplicate idempotency key rejected before and after restore: PASS.
- Invalid qualified lead rejected before and after restore: PASS.
- Temporary PostgreSQL cluster stopped and removed: PASS.

## Side effects

- No application, migration, package, Supabase, provider or root documentation files were modified.
- The preserved dump and object archive contain only deterministic synthetic fixtures.
- The drill did not contact any service or person.

## Final assessment

**Recommendation: APPROVE for the bounded local M2 drill.**

This is not approval for production recovery readiness. Production PITR, RPO 15 minutes, RTO four hours, Supabase recovery and production Storage recovery remain `UNKNOWN` until the managed staging drill in `docs/runbooks/m2-production-recovery-gaps.md` is authorized and executed.
