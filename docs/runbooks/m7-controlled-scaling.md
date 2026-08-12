# Runbook M7 Controlled Scaling

## Proposito

Liberar una ola progresiva sin confundir preparación local con envio real y sin deteriorar supresion, reputacion o capacidad de respuesta.

## Precondiciones

- M6 en `PASS` y primer lote revisado durante 24 horas.
- Campaign manifest vigente.
- 30 gates live vigentes.
- Runtime cerrado mientras se prepara la ola.
- Observacion previa finalizada en `PASS`.
- Cero P0 y P1 abiertos.
- Recipient set congelado y aprobado.

Si falta una precondicion, registrar `EXTEND` y no abrir runtime.

## Preparar la ola

1. Reconciliar Anexo A, clientes, bajas y rebotes.
2. Seleccionar una cuenta por enrollment y excluir cualquier fuente previa.
3. Congelar email y hash de secuencia.
4. Calcular el volumen maximo permitido.
5. Registrar la ola `DRAFT`.
6. Registrar la aprobacion append-only de Jorge para el ID y hash exactos.
7. Ejecutar `app.assess_rollout_wave`.
8. Finalizar con service role. `PASS` deja la ola `READY`.
9. Mantener runtime cerrado hasta la ventana aprobada.

## Monitorear

Durante al menos 24 horas registrar:

- Entregas validas.
- Rebotes duros.
- Quejas.
- Bajas.
- Respuestas sustantivas y positivas.
- Duplicados.
- Violaciones de supresion.
- Señales desconocidas.
- P0 y P1.
- Reply sync p95.

Finalizar con `app.finalize_scaling_health`.

- `PASS`: puede prepararse la siguiente ola.
- `EXTEND`: corregir, repetir observacion y no aumentar volumen.
- `KILL`: kill switch, incidente y revision independiente.

## Congelar T0

1. Confirmar 100 primeras entregas validas.
2. Reconciliar eventos de proveedor con mensajes canonicos.
3. Confirmar revision humana de respuestas positivas.
4. Confirmar evidencia estricta de cada lead.
5. Confirmar asistencia de reuniones y etapa de oportunidades.
6. Generar checksum del paquete de evidencia.
7. Ejecutar `app.freeze_t0_baseline` como service role.
8. Comparar el resultado con el reporte del portal.

T0 es append-only. Una correccion posterior crea un registro de revision, no edita el baseline.

## Kill switch

Ante P0:

1. Activar kill switch global y del mailbox.
2. Marcar la ola `KILLED` mediante el flujo tecnico.
3. Abrir incidente con correlation IDs.
4. Preservar mensajes, provider events, observacion y auditoria.
5. No reanudar hasta nueva evidencia y gate independiente.

## Verificacion local

```bash
npm run verify:m7-readiness
npm run verify:scaling-db
npm run verify:m7
```

Estas pruebas no abren runtime ni contactan destinatarios.
