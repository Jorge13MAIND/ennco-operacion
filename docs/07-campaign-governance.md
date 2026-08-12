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

## Voz

Francisco Cuellar, CEO. Personal, directa, breve y CEO a CEO. No incluye garantías, precio final, descuentos o fechas comprometidas.
