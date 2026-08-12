# Runbook M6 First Send Release

## Propósito

Preparar, aprobar y observar el primer lote de cinco correos sin permitir un bypass del gate.

## Autoridad

- Revenue Operations prepara cuentas, contactos y evidencia.
- Francisco aprueba copy y voz.
- Paco aprueba contenido técnico.
- Jorge registra la aprobación explícita del release.
- El servicio técnico finaliza el lote.
- Ningún operador abre kill switches por su cuenta.

## Preparación

1. Verifica que el manifiesto no cambió.
2. Importa y reconcilia Anexo A, clientes actuales, bajas y rebotes.
3. Confirma exactamente cinco cuentas distintas y cinco contactos distintos.
4. Confirma fuente, fecha, rol y correo verificado para cada contacto.
5. Renderiza el touch 1 y ejecuta dry run idéntico.
6. Confirma reply sync, alertas, baja y kill switch.
7. Registra evidencia live y hash para cada uno de los 30 gates.
8. Programa martes, miércoles o jueves a las 09:30 `America/Mexico_City`.
9. Finaliza el lote. Debe responder `PASS` y quedar `READY`.

## Comandos locales de validación

```bash
npm run verify:m6-readiness
npm run verify:first-send-db
npm run verify:m6
```

Estos comandos no envían correo.

## Ejecución autorizada

1. Revalida supresión dentro de las 24 horas previas.
2. Revalida todos los gates inmediatamente antes de la cola.
3. Confirma que runtime y mailbox siguen cerrados.
4. Jorge confirma el hash del manifiesto y registra aprobación.
5. Abre runtime sólo para el lote y la ventana aprobados.
6. Encola un mensaje. Verifica que el lote cambió de `READY` a `RELEASED` en la misma transacción.
7. Completa los otros cuatro sin cambiar destinatario, copy o buzón.
8. Cierra runtime al terminar.

## Monitoreo de 24 horas

- Entregas, rebotes, bajas y respuestas.
- Queue lag y dead letters.
- Salud de buzón y dominio.
- Cero duplicados.
- Cero contactos fuera del lote.
- Tiempo de respuesta de ENNCO.

No se escala volumen automáticamente.

## Pausa inmediata

Activa kill switch ante:

- Supresión ignorada.
- Destinatario o copy distinto al lote.
- Doble envío.
- Credencial comprometida.
- Rebote anormal.
- Reply sync detenido.
- Gate vencido o cambiado.
- Evidencia desconocida.

Registra correlation ID, timestamps, alcance, evidencia, mitigación y decisión `PASS`, `EXTEND` o `KILL`.

## Recuperación

- `EXTEND`: corrige evidencia, crea una nueva versión y repite dry run.
- `KILL`: mata el lote. No lo revivas. Crea otro lote con nuevo ID y nueva aprobación.
- Deriva de manifiesto: invalida la autorización y reinicia el gate.
- Fallo después de cola: usa idempotency key. No reenvíes manualmente sin reconciliar proveedor y base.
