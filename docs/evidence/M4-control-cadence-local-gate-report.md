# Evidencia M022 de cadencia del Control Room

Fecha: 12 de agosto de 2026, America/Mexico_City.

## Veredicto

`PASS LOCAL` para el contrato de las cinco cadencias, reconciliación, watchdog y portal fail closed.

`BLOCKED_EXTERNAL` para scheduler administrado, horarios, responsables, participantes, canales y sesiones live.

No hubo red, datos reales, contacto, compras, DNS ni producción.

## Comandos

```bash
bash supabase/tests/run-control-room-cadence-gate.sh
ENNCO_M022_GATE_PORT=55467 bash supabase/tests/run-control-room-cadence-gate.sh
```

Ambas ejecuciones terminaron con exit code 0 y los marcadores:

- `CONTROL_CADENCE_FORWARD_GATE_PASS`
- `CONTROL_CADENCE_CONCURRENCY_GATE_PASS`
- `CONTROL_CADENCE_ROLLBACK_GATE_PASS`
- `CONTROL_CADENCE_REAPPLY_GATE_PASS`
- `CONTROL_CADENCE_DIFF_GATE_PASS`

## Controles probados

- Cinco códigos canónicos exactos y zona `America/Mexico_City`.
- Policy versionada, SHA256 de aprobación y un solo ACTIVE por organización.
- Configuración `UNKNOWN` cuando faltan día, hora, owner o evidencia.
- Reunión semanal exacta de 45 minutos.
- Catch-up de ventanas sin obligaciones anteriores a activación.
- Coverage exacta de occurrences, concurrencia e idempotencia.
- Evidencia automática, checklist, sesión humana, asistencia ENNCO y Teckel en la misma sesión y delivery con ACK.
- Evidencia sintética no satisface release live.
- Completion tardío conserva `BREACHED`, incidente y outbox.
- Mitigación sólo después de resolver incidente y corregir materialmente la ocurrencia.
- Evidencia posterior no degrada un cumplimiento MET ya congelado.
- Owner activo con rol operativo revalidado en activation y health.
- Input SHA256 canónico de los registros materiales.
- Watchdog independiente para heartbeat stale o política ausente.
- Política ausente crea una alerta idempotente con CLIENT EMAIL y TECKEL TELEGRAM.
- Outbound real bloqueado ante `UNKNOWN`, `DEGRADED`, synthetic, heartbeat stale o breach abierto. `DRY_RUN` permitido.
- AAL2, RLS, tenant isolation, DML revocado y negativos contra GUC.
- Rollback fail closed y reapply íntegro.

## Portal

- Parser Zod estricto.
- Cinco filas visibles incluso en `UNKNOWN`.
- Error RPC, schema inválido, truncación, heartbeat stale o policy incompleta degradan todo el módulo.
- El portal nunca inventa horario, responsable, asistencia o entrega.
- `externalSendAllowed` exige simultáneamente salud M020 y cadencia M022 `HEALTHY/ALLOWED`.
- Rutas privadas conservan `noindex, nofollow, noarchive`.

## SHA256

```text
516d3a1a661807fc6d505aed5b8715df52e41c59baf56b117a4980d5decc5273  supabase/migrations/202608120022_control_room_cadence.sql
69b5de52520782e4fa614eadb63fe89d1cb689e82e17b81ee3677f8b82b71980  supabase/rollbacks/202608120022_control_room_cadence.down.sql
d98d44ff156ddca67d45789a5094c9649c2743683551a3d60ea747c2dc44a985  supabase/tests/022_control_room_cadence_gate.sql
1b2d0848b33334d95fb9fa7bd504e61c7446914d7121ea65dfdb442bd5655c2e  supabase/tests/022_control_room_cadence_rollback_gate.sql
c12b282113e4b38603cf5fa27ef26ef5196209f21aa6db1127171dc89fd0d78e  supabase/tests/run-control-room-cadence-gate.sh
b85e6d7413f84a27d0762217f888e3da8e5ba84ac233f28e4e4d8bc3203b5eea  src/lib/operations/cadence.ts
a05f46dc13b46a45c96a13d1147f70b79392d6e976b8e6c2a70042a360580dae  src/lib/operations/cadence.test.ts
```

## Límites

- PostgreSQL local con stubs Auth, no Supabase remoto.
- Scheduler administrado no existe.
- Días y horas reales no están aprobados.
- Owners, suplentes y participantes live no están asignados.
- Email y Telegram no están conectados.
- No existe evidencia de una sesión o revisión humana real.

M022 no autoriza outbound, producción ni una cadencia live.
