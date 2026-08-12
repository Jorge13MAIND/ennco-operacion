# M2 Gate Report

Snapshot: 11 de agosto de 2026, America/Mexico_City.

## Veredicto

- M2 local con datos sintéticos: `PASS`.
- M2 global para datos reales y producción: `EXTEND`.
- Actividad comercial real: `0`.
- Contactos verificados reales: `0`.
- Leads contractuales reales: `0`.
- Pipeline estricto real: `0`.
- Revenue atribuido: `0 MXN`.
- Efectos externos: `0`.

El resultado local prueba contratos, controles y recuperación en runtimes desechables. No prueba Supabase administrado, Storage real, PITR, RPO de 15 minutos, RTO de cuatro horas, antivirus, proveedores, DNS, credenciales, producción o revisión legal.

## Alcance verificado

1. Configuración fail closed. Producción rechaza demo, ausencia de MFA y configuración parcial.
2. Sesión validada con claims, membresía única por organización y MFA AAL2.
3. RLS e integridad cruzada por organización.
4. Storage privado con path opaco, checksum, tamaño, MIME y cuarentena.
5. Audit log por allowlist. Correos, asunto, cuerpo y texto libre no se serializan.
6. Supresión fail closed, idempotencia, kill switch, outbox, retry, lease y dead letter.
7. Legal holds, cuatro ojos, transiciones técnicas service-only, anonimización y tombstones.
8. Restore lógico y de objetos a destinos separados, con conteos, hashes e invariantes equivalentes.
9. CI con acciones fijadas por SHA, auditoría de dependencias y SBOM CycloneDX.
10. Portal y acceso revisados en cinco perfiles de viewport.

## Comando canónico

```bash
cd /Users/Jorge/dev/ennco-revenue-platform
npm run capture:data-verification
npm run capture:m2-restore
npm run verify:m2
```

Resultado observado:

```text
RTM_PASS rows=75 checklist=47/47
DATA_IMPORT_PASS checks=28/28
SECRET_SCAN_PASS files=137 findings=0
CORE_DATABASE_GATE_PASS
SEED_APPLY_PASS
SECURE_STORAGE_GATE_PASS
SECURE_STORAGE_ROLLBACK_PASS
SECURE_STORAGE_REAPPLY_PASS
RETENTION_DELETION_GATE_PASS
RETENTION_DELETION_ROLLBACK_PASS
RETENTION_DELETION_REAPPLY_PASS
M2_EPHEMERAL_RESTORE_GATE_PASS
DEPENDENCY_AUDIT_PASS vulnerabilities=0
LINT_PASS
TYPECHECK_PASS
UNIT_PASS files=7 tests=27
BUILD_PASS routes=10
E2E_PASS tests=40 profiles=5
```

El comando terminó con exit code `0`.

## Evidencia

- `supabase/migrations/202608110001_core.sql`
- `supabase/migrations/202608110002_secure_document_storage.sql`
- `supabase/migrations/202608110003_retention_deletion.sql`
- `supabase/tests/001_core_gate.sql`
- `supabase/tests/002_secure_storage_gate.sql`
- `supabase/tests/003_retention_deletion_gate.sql`
- `evidence/m2-restore/summary.json`
- `evidence/m2-restore/independent-verification.tsv`
- `evidence/m2-restore/qa-review.md`
- `docs/evidence/M2-signin-desktop.png`
- `docs/evidence/M2-signin-mobile.png`
- `docs/evidence/M2-control-room-desktop.png`
- `docs/10-data-processing-inventory.md`
- `docs/11-retention-policy.md`
- `docs/12-m2-architecture.md`
- `docs/runbooks/incident-response.md`

## Revisión independiente

La revisión `qa-reviewer` encontró y obligó a cerrar antes del PASS:

1. El audit log podía duplicar PII y cuerpos completos. Se reemplazó por allowlist y saneamiento histórico.
2. Un administrador podía falsificar una transición técnica de borrado. Las transiciones técnicas quedaron reservadas a service role.
3. El rollback podía reabrir la enumeración de usuarios. El control de privacidad ahora sobrevive al rollback.
4. El hash del sujeto podía derivarse de un dato identificable. Ahora deriva sólo de UUID opaco y organización.

## Blockers de producción

1. Anexo A recibido, conciliado y hasheado.
2. Contrato ejecutado y certificado BoldSign archivados.
3. Credenciales expuestas rotadas y secretos en vault.
4. Base legal, aviso de privacidad, DPA, región y subprocesadores aprobados.
5. Proyecto Supabase ENNCO aislado con Auth, RLS y Storage revalidados.
6. Antivirus real, signed URLs y ciclo de vida de objetos.
7. PITR y backup externo de Storage con restore y tombstones.
8. RPO y RTO medidos en ambiente administrado.
9. CI remoto, branch protection, SAST, DAST y provenance aún sin evidencia.

Ningún blocker impide continuar M3 en local con datos sintéticos. Todos bloquean la acción externa correspondiente.
