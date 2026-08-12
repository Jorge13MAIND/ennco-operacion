# Campaign Governance

## Manifiesto obligatorio

Cada release congela:

- Sender y mailbox.
- Destinatarios y snapshot de supresión.
- Hash de secuencia.
- CTA y URLs.
- Tracking.
- Volumen y horario.
- Cadencia.
- Stop rules.
- Kill switch.
- Aprobaciones.

## Reglas

- `ENNCO_ALLOW_EXTERNAL_SEND=false` por defecto.
- `ENNCO_GLOBAL_KILL_SWITCH=true` por defecto.
- Sólo un manifiesto `APPROVED` puede habilitar un lote.
- Una diferencia entre runtime y manifiesto devuelve `HOLD`.
- Reply, hard bounce, unsubscribe, DNC o intervención manual detienen la secuencia.
- Ningún contacto puede pertenecer a dos enrollments activos.
- El primer lote contiene exactamente cinco cuentas aprobadas.
- No se usa píxel de apertura durante el arranque.
- LinkedIn es manual. WhatsApp frío está prohibido.

## Gate de primer envío

El primer lote exige 30 gates live, exactamente cinco cuentas, cinco contactos y coincidencia de hashes. El paquete canónico está en `data/release/first-send-readiness-v1.json` y la aplicación transaccional en `202608110008_first_send_release.sql`.

Un `PASS_LOCAL`, `UNKNOWN`, dato vencido, evidencia futura, supresión o diferencia del manifiesto mantiene `HOLD`. La aprobación de Jorge es necesaria, append-only y no sustituye ningún otro gate.

## Voz

Francisco Cuellar, CEO. Personal, directa, breve y CEO a CEO. No incluye garantías, precio final, descuentos o fechas comprometidas.
