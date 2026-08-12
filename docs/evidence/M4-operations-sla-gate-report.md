# M4 Operations SLA gate report

Fecha de corte: 2026-08-12, America/Mexico_City.

Source commit: `3adb60a0ef2e16a4c6d665aa329f36f792ebde55`.

## Dictamen

- M020 local: `PASS`.
- Programa enterprise completo: `EXTEND`.
- Producción, staging compartido y contacto externo: `HOLD`.
- Envíos reales, leads, pipeline y revenue generados por este gate: `0`.

El PASS demuestra el control local sintético de SLA, incidentes, aprobaciones, tareas, reuniones, watchdog, alertas y bloqueo de envío. No demuestra scheduler administrado, canales reales, credenciales, proveedores, cronómetros live ni operación humana.

## Controles cerrados

- DML autenticado revocado sobre ledgers operativos críticos.
- AAL2, RLS y referencias tenant-safe en las mutaciones canónicas.
- Incidentes recurrentes con ocurrencia, reloj SLA y outbox independientes.
- P0 activa kill switch en la misma transacción.
- Watchdog `UNKNOWN` o vencido bloquea cualquier envío externo.
- Asignación válida exige operador y suplente activos con rol operativo.
- Matriz de alerta exige CLIENT EMAIL y TECKEL TELEGRAM con destino configurado y coincidente.
- Una entrega aislada o falsificada no completa una alerta.
- Aprobación `CLOSED_WON` usa digest canónico del servidor y falla por expiración o drift.
- Respuesta positiva usa la fecha observada para medir el SLA y conserva incumplimientos históricos.
- Tareas y reuniones conservan evidencia de finalización aun después de un breach.
- Reuniones `HELD` y `NO_SHOW` rechazan fecha nula, futura o anterior a la reunión.
- Portal y campañas muestran autorización efectiva, no sólo la bandera de runtime.
- Rollback queda fail closed y reapply conserva estados intermedios.

## Comandos y resultados

### Gate M020

Comando:

```bash
supabase/tests/run-operations-sla-gate.sh
```

Resultado, exit 0:

```text
OPERATIONS_SLA_FORWARD_GATE_PASS
OPERATIONS_SLA_CONCURRENCY_GATE_PASS
OPERATIONS_SLA_ROLLBACK_GATE_PASS
OPERATIONS_SLA_REAPPLY_GATE_PASS
```

### Verificación integral M4

Comando:

```bash
npm run verify:m4
```

Resultado, exit 0:

- RTM: 98 filas, checklist 47/47, 0 fallas estructurales.
- Importación: 45/45 checks PASS.
- Semillas: 27/27, `HOLD`, 0 elegibles.
- Secretos: 467 archivos, 0 hallazgos.
- API: 23 contratos locales implementados, 2 diferidos.
- Build Next.js: PASS.
- Playwright: 125/125 PASS en cinco viewports.
- Todos los gates PostgreSQL locales incluidos en `verify:m4`: PASS.

### Pruebas unitarias finales

Comando:

```bash
npm test -- --run --reporter=dot
```

Resultado, exit 0:

```text
Test Files 48 passed (48)
Tests 218 passed (218)
```

### Calidad del cambio

Comandos:

```bash
git diff --check
bash -n supabase/tests/run-operations-sla-gate.sh
```

Resultado: ambos exit 0 y sin hallazgos.

## Auditoría independiente

La revisión separada del autor emitió primero `EXTEND` y reprodujo fallas de recurrencia, salud desconocida, hash de aprobación, tiempos SLA, asignación, reuniones y falsificación de entregas. Cada escenario se corrigió y se agregó a los gates adversariales. La reauditoría final fue `PASS local`, sin P0 o P1 reproducible dentro de M020.

## Evidencia primaria

- `supabase/migrations/202608120020_operations_sla_control.sql`
- `supabase/rollbacks/202608120020_operations_sla_control.down.sql`
- `supabase/tests/020_operations_sla_gate.sql`
- `supabase/tests/020_operations_sla_rollback_gate.sql`
- `supabase/tests/run-operations-sla-gate.sh`
- `src/lib/operations/sla.ts`
- `src/lib/operations/http.ts`
- `src/lib/operations/portal.ts`
- `src/components/OperationsActions.tsx`
- `src/components/PortalTable.tsx`
- `docs/14-m4-operations-architecture.md`
- `docs/evidence/M4-operations-sla-checksums.sha256`

## Bloqueos externos conservados

- Anexo A vigente.
- Contrato ejecutado y certificado BoldSign.
- Compras, DNS, dominios y buzones.
- Credenciales y ambientes administrados.
- Scheduler y watchdog live.
- Configuración real de operador y suplente.
- Destinos y canales reales de alertas.
- Gmail, Pub/Sub, correo transaccional y Telegram.
- Staging real, pruebas con proveedores y aprobación de release.

Ninguno de estos bloqueos se maquilló como trabajo terminado y ninguno impidió cerrar evidencia local útil.
