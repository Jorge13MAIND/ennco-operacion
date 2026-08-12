# Runbook M8 Contractual Reporting

## Registro diario

1. Reconciliar Gmail, mensajes, provider events, leads, tareas e incidentes.
2. Confirmar que supresión, reply sync y runtime no tienen estado desconocido.
3. Generar el checksum del paquete diario.
4. Registrar `campaign_operation_days` como `OPERATING`, `HOLD`, `BLOCKED` o `UNKNOWN`.
5. Nunca registrar `OPERATING` con evidencia sintética.

## Cierre de mes

1. Confirmar periodo del día uno al inicio del siguiente mes.
2. Verificar que cada día tenga evidencia live `OPERATING`.
3. Cargar el calendario MX y su fuente.
4. Reconciliar cada denominador contra registros canónicos.
5. Ejecutar `app.generate_contractual_monthly_report` como service role.
6. Exportar los items contados y verificar el hash del snapshot.
7. Revisar el reporte con QA independiente.
8. Registrar aprobación de Jorge para el ID y hash exactos.
9. Ejecutar `app.issue_contractual_monthly_report`.
10. Confirmar emisión dentro de los primeros tres días hábiles.

## Verdad del reporte

- Una apertura o clic no cuenta como respuesta.
- Una respuesta positiva no cuenta como lead sin calificación estricta.
- Una reunión agendada no cuenta como realizada.
- Una oportunidad debajo de `QUALIFIED` no cuenta como pipeline calificado.
- Una propuesta cuenta sólo con `delivered_at`.
- Un cierre cuenta sólo con transición y aprobación.
- Comisión requiere primer pago y atribución vigente.

## Recuperacion

Si el total es menor a diez:

1. Ejecutar el diagnóstico en orden.
2. Documentar el primer punto que no pasa.
3. Corregirlo y tomar nueva muestra.
4. Si todos pasan, crear un experimento de una variable.
5. Obtener aprobación exacta.
6. No ejecutar un segundo experimento mientras exista otro activo.
7. Comparar contra el baseline sin cambiar el denominador.
8. Mantener, extender o matar con evidencia.

## Verificacion local

```bash
npm run verify:m8-readiness
npm run verify:monthly-reporting-db
npm run verify:m8
```

El fixture de julio es hipotético y no representa resultados ENNCO.
