# ADR 0003: acciones externas fail closed

## Decisión

La falta de configuración, evidencia, supresión, aprobación, manifest o salud produce `HOLD`, nunca envío best effort.

## Controles

- Kill switch global y por mailbox.
- `allowExternalSend` falso por defecto.
- Manifest hash verificado.
- Idempotencia persistente.
- Auditoría previa y posterior.
