# Evidencia M021 de retención local

Fecha: 12 de agosto de 2026, America/Mexico_City.

## Veredicto

`PASS LOCAL` para controles sintéticos de retención, eliminación, propagación fail closed y replay parcial de datos de aplicación.

`BLOCKED_EXTERNAL` para retención productiva, PITR real, scheduler administrado y confirmaciones de proveedores.

No hubo llamadas de red, datos reales, compras, DNS, credenciales ni cambios de producción. `live_provider_calls=0`.

## Comando de aceptación

```bash
cd /Users/Jorge/dev/ennco-revenue-platform
bash supabase/tests/run-retention-live-local-control-gate.sh
```

Resultado: exit code 0.

Marcadores:

- `RETENTION_LIVE_LOCAL_CONTROL_FORWARD_PASS`
- `RETENTION_LIVE_LOCAL_CONTROL_CONCURRENCY_PASS`
- `RETENTION_LIVE_LOCAL_CONTROL_ROLLBACK_PASS`
- `RETENTION_LIVE_LOCAL_CONTROL_REAPPLY_PASS`
- `RETENTION_M003_JOURNAL_PRESERVATION_PASS`
- `RETENTION_M003_M021_REAPPLY_PASS`
- `RETENTION_LIVE_LOCAL_CONTROL_DIFF_CHECK_PASS`

## Controles probados

- Política versionada y aprobación four eyes vinculada por SHA256.
- Relojes monotónicos, mutex por organización e idempotencia entre llaves distintas.
- Legal hold activo, revisión máxima de 90 días y health fail closed.
- Borrado integral del contacto y del grafo directo e indirecto.
- M019: candidates, evidence, reviews, dedupe y qualification links.
- Mensajes, outbox, dead letters, notificaciones y hashes de batches de envío.
- Reuniones realizadas, approvals, oportunidad cerrada y razones de capacidad.
- Evidencia de primer pago conservada como snapshot canónico no personal.
- Ambigüedad de precotización compartida bloqueada antes de mutar.
- Seis destinos requeridos con ACK individual y `NOT_APPLICABLE` rechazado.
- Manifiesto completo reconstruido por servidor, origen tenant-safe y rechazo de subsets.
- Restore parcial del grafo, replay idempotente, cero residuos y alerta para todo `UNKNOWN`.
- DML directo revocado a `authenticated` y `service_role` en journals.
- Rollback de M021 y M003 conserva holds, items, tombstones y watermarks.

## Auditoría independiente

La revisión adversarial independiente reprodujo y obligó a corregir bypass de DML, clocks regresivos, candidatos duplicados, manifiestos fabricados o parciales, legal holds ignorados, restores parciales, residuos M019, evidencia indirecta, ledgers append-only, reuniones realizadas, pagos, batches de envío y capacidad. Después de los fixes, el mismo runner recibió `PASS LOCAL` sin P0 o P1 reproducible restante en el alcance revisado.

## Artefactos y SHA256

```text
1d675e17f3084ef044dd2ba1eb9bfcf3c0d86b6ce28f87ccae5a47e54797af99  supabase/migrations/202608120021_retention_live_local_control.sql
a27d138ceb523d52a55b28ab45766767c06c7359197e6547ddfc2b59009a1c98  supabase/rollbacks/202608120021_retention_live_local_control.down.sql
ac0affd2160e89a915d492f9d031a013130c88c1971c2c0230e9bd9fb354ffc9  supabase/tests/021_retention_live_local_control_gate.sql
a2c27bdecc244b252ce79467033caea4b8b475b9165043176d05e956b51864f0  supabase/tests/021_retention_live_local_control_rollback_gate.sql
217d12d17b8aef6a8ef72c23d9647cf1bd506020228499fb1d4e6ebd45092d94  supabase/tests/run-retention-live-local-control-gate.sh
471290cc1c1db1c1782320c08d4048bed034b2b7f56ccf7dc1a91a3dff31964b  supabase/migrations/202608110003_retention_deletion.sql
7fd0815ec90d45fa5be2fe93510b835d53db9ff87d8ba04a95851b4ea31bbd7f  supabase/rollbacks/202608110003_retention_deletion.down.sql
b171d8111292cad63b2de4c7392287312dbc2531a8c70c46db5571f33f2e7d2c  supabase/tests/003_retention_deletion_rollback_gate.sql
```

## Límites

- PostgreSQL local desechable, no Supabase remoto.
- Datos sintéticos, no información de ENNCO o prospectos.
- Restore parcial de datos de aplicación, no PITR anterior al borrado.
- Journal externo autenticado no conectado.
- Scheduler de producción no creado.
- Gmail, Resend, Sentry, Checkly, Supabase Backup y Storage Backup sin ACK real.
- RPO de 15 minutos y RTO de cuatro horas no demostrados.

M021 no autoriza datos reales ni producción.
