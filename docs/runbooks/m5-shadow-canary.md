# Runbook M5 Shadow Canary

## Objetivo

Probar durante 14 días reales el flujo E2E, las fallas esperadas, la reconciliación y la capacidad de detener el sistema. La ejecución debe ocurrir en staging aislado, con cuentas y datos sintéticos, sin prospectos ni tráfico externo.

## Preparación

1. Congelar commit, migration set y manifest hash.
2. Confirmar `ENNCO_ALLOW_EXTERNAL_SEND=false`.
3. Confirmar `ENNCO_GLOBAL_KILL_SWITCH=true`.
4. Confirmar que los destinatarios son seeds sintéticos controlados.
5. Verificar RLS, MFA y accesos.
6. Crear el run `live` con ambiente `staging`.
7. Registrar fecha de inicio y responsable QA.

## Rutina diaria

1. Ejecutar el escenario programado.
2. Verificar correlation ID y llaves de idempotencia.
3. Conciliar mensajes, eventos, leads, tareas, outbox, alertas y dead letters.
4. Confirmar cero efectos externos no autorizados.
5. Registrar conteos P0, P1, fallas y unknowns.
6. Generar checksum de evidencia.
7. Revisar que el día anterior exista y que el hash chain continúe.
8. Registrar decisión diaria sin editar días anteriores.

## Escenarios mínimos

- Golden path dry run.
- Supresión.
- Duplicado.
- Reply.
- Hard bounce.
- Unsubscribe.
- Timeout y retry.
- Dead letter.
- Falla de alerta.
- Kill switch.
- Manifest drift.
- Restore parcial.
- Unknown fail closed.
- Carga e idempotencia.

## Decisión

`PASS` requiere simultáneamente:

- Evidencia `live`.
- Ambiente `staging`.
- 14 días consecutivos.
- Manifest hash igual al de campaña.
- Cero P0 y P1.
- Cero fallas y unknowns.
- Cero efectos externos no autorizados.
- Reconciliación diaria completa.
- Una observación por escenario registrado.

`KILL` aplica ante:

- P0.
- Efecto externo no autorizado.
- Drift del manifiesto.

`EXTEND` aplica ante cualquier otro incumplimiento o evidencia incompleta. Un estado desconocido nunca cuenta como verde.

## Comandos locales

```bash
npm run verify:campaign
npm run verify:m5-canary
npm run verify:canary-db
npx vitest run src/lib/assistant/policy.test.ts src/lib/canary/shadow.test.ts
```

## Recuperación

1. Activar kill switch global.
2. Pausar mailboxes y workers.
3. Congelar manifest, logs y correlation IDs.
4. Abrir incidente con severidad correcta.
5. Preservar evidencia antes de corregir.
6. Repetir el escenario fallido con la misma versión.
7. Si cambia código, configuración o manifest, iniciar un run nuevo.

## Límite

El artefacto acelerado local sirve para validar la máquina de estados y el gate. No reduce ni sustituye el periodo real de 14 días.

