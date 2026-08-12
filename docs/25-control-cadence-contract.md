# Contrato M022 de cadencia del Control Room

Snapshot: 12 de agosto de 2026, America/Mexico_City.

Estado actual: `EXTEND`.

Este contrato cierra la ambigüedad de PLAN-CONTROL-CADENCE-001. No prueba asistencia humana, canales externos ni operación live.

## Cinco cadencias canónicas

1. `CONTROL_ROOM_DAILY_UPDATE`
2. `INTERNAL_DAILY_REVIEW`
3. `STAGING_WEEKLY_DEMO`
4. `ENNCO_TECKEL_WEEKLY_MEETING`
5. `EXECUTIVE_MONTHLY_REVIEW`

La zona horaria es `America/Mexico_City`. La reunión semanal ENNCO y Teckel dura 45 minutos. Horas, día semanal y día mensual no definidos por la fuente permanecen `UNKNOWN`; no se inventan defaults.

## Invariantes

- Una sola política activa por organización y código.
- La política activada es inmutable y se reemplaza por una versión nueva.
- Una ocurrencia es única por política y ventana.
- Ejecución y cumplimiento son estados separados. Una terminación tardía conserva `BREACHED`.
- Snapshot automatizado, evidencia humana, asistencia y entrega externa son ledgers separados.
- Invitación o RSVP no equivale a sesión realizada.
- Sesión realizada no equivale a aprobación de release.
- Evidencia `synthetic_demo` no satisface una ocurrencia live.
- La cadencia nunca incrementa leads, pipeline, propuestas, cierres o revenue.
- Lectura parcial, política incompleta o heartbeat vencido produce `UNKNOWN`.
- `UNKNOWN` o breach P0/P1 bloquea outbound real, pero permite `DRY_RUN`.

## Persistencia mínima

- `control_cadence_policy_versions`
- `control_cadence_policy_items`
- `control_cadence_occurrences`
- `control_cadence_human_sessions`
- `control_cadence_attendance`
- `control_cadence_evidence_items`
- `control_cadence_delivery_requirements`
- `control_cadence_breaches`
- `control_cadence_reconciliation_runs`

Cada mutación usa AAL2 o `service_role` según el caso, organización derivada de sesión, actor no falsificable, idempotencia SHA256, audit allowlist y referencias tenant-safe.

## Scheduler

Cada reconciliación debe:

1. Validar exactamente cinco políticas.
2. Materializar ocurrencias faltantes de forma idempotente.
3. Abrir ventanas iniciadas.
4. Ejecutar la actualización diaria sólo con lecturas completas.
5. Evaluar checklist, asistencia y canales por separado.
6. Registrar breaches sin borrar incumplimientos históricos.
7. Crear incidente y outbox en la misma transacción.
8. Guardar heartbeat, input SHA256 y output SHA256.

## Portal

El módulo `cadencia` muestra próxima ocurrencia, responsable, vencimiento, ejecución, cumplimiento, evidencia, asistencia, entrega externa, última reconciliación, breach y siguiente acción.

Un error de cualquier query, truncación, schema inválido o heartbeat stale degrada el módulo completo a `UNKNOWN`. Nunca muestra verde parcial.

## Rollback

El rollback M022 instala primero un control fail closed, revoca DML y RPCs de escritura, bloquea outbound distinto de `DRY_RUN`, conserva M020 intacto y deja la salud de cadencia en `UNKNOWN`. Reapply debe recuperar integridad, permisos e idempotencia.

## Gate local requerido

- Forward.
- AAL2, RLS, tenant y DML.
- Cinco códigos exactos.
- Política incompleta rechazada.
- Reunión semanal distinta de 45 minutos rechazada.
- Concurrencia sin ocurrencias, breaches, incidentes u outbox duplicados.
- Evidencia de otra ventana o sintética rechazada.
- Asistencia unilateral no cumple la reunión.
- Scheduler stale y lectura parcial producen `UNKNOWN`.
- Rollback fail closed.
- `DRY_RUN` permitido y outbound real rechazado durante rollback.
- Reapply.

## Bloqueos externos conservados

- Horarios y días no definidos.
- Operador principal y suplente reales.
- Participantes y asistencia humana.
- Staging compartido, calendario, correo y Telegram.
- Scheduler administrado.
- Reuniones y revisiones realmente realizadas.

Ninguno de estos bloqueos impide construir y probar el contrato local con datos sintéticos.
