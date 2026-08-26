# M6 First Send Architecture

## Veredicto

- Preparación local M6: `PASS`.
- Gate global M6: `EXTEND`.
- Estado de campaña: `HOLD`.
- Destinatarios reales: `0`.
- Efectos externos: `0`.
- Correos enviados: `0`.

La implementación demuestra que el sistema puede evaluar y bloquear el primer lote. No demuestra que dominios, reputación, personas, copy o proveedores estén listos. Ningún resultado externo se declara.

## Tres capas de liberación

La liberación exige simultáneamente:

1. Evidencia live completa para 30 gates.
2. Un lote inmutable de exactamente cinco cuentas y cinco contactos.
3. Controles de runtime abiertos solamente dentro de la ventana autorizada.

Un `PASS_LOCAL`, `UNKNOWN`, evidencia vencida, evidencia futura, gate faltante, supresión, deriva o bloqueo de runtime devuelve `EXTEND` o impide la escritura.

## Paquete local

- `data/release/first-send-readiness-v1.json`: estado canónico del release, en `HOLD`.
- `data/release/domain-readiness-ledger-v1.json`: candidatos sin afirmar disponibilidad, propiedad o DNS.
- `data/release/fixtures/first-send-synthetic-v1.json`: cinco destinatarios `.invalid` usados sólo en pruebas.
- `src/lib/release/first-send.ts`: evaluador determinista.
- `src/lib/release/dns.ts`: validación fail closed de evidencia DNS.
- `src/lib/release/render.ts`: render determinista de copy, sin tokens sin resolver.

El verificador compara los 30 códigos del paquete contra los 30 códigos de la migración. El fixture sintético nunca puede convertirse en aprobación de producción.

## Persistencia y cierre transaccional

La migración `202608110008_first_send_release.sql` agrega:

- `campaign_release_gates`.
- `first_send_batches`.
- `first_send_batch_enrollments`.
- Evaluación service-only.
- Lote máximo de cinco cuentas.
- Ventana de martes a jueves, 09:30 a 11:30, `America/Mexico_City`.
- Bloqueo en la tabla `messages` antes de `QUEUED`, `SENDING`, `SENT` o `DELIVERED`.
- Lock compartido con cambios de supresión.
- Audit allowlist sin correo, asunto o cuerpo.
- Rollback y reapply probados.

El lote congela IDs de cuenta, contacto, buzón y secuencia, más hash del correo y hash del contenido. Cualquier cambio posterior devuelve `EXTEND`. El conjunto de destinatarios es inmutable después de crearse.

## Aprobación explícita

La aprobación de primer envío:

- Es append-only.
- Debe pertenecer a la organización.
- Debe apuntar a la campaña.
- Debe coincidir con el hash del manifiesto.
- Debe ser registrada por el actor autenticado con rol `teckel_admin`.
- Debe enlazarse al gate `EXPLICIT_SEND_APPROVAL_JORGE`.

La presencia de una fila `APPROVED` no abre el runtime. Primero deben pasar los otros 29 gates y el lote debe finalizarse mediante la función técnica.

## Estados y transiciones

El lote sigue:

`DRAFT > READY > RELEASED`

`DRAFT`, `READY` o `RELEASED` pueden terminar en `KILLED`. Un lote `KILLED` no revive. Una fila `DRY_RUN` no se transforma en correo real y un `SENT` directo se rechaza.

## Evidencia de deliverability

Las guías oficiales de Gmail se usan como baseline:

- [Email sender guidelines](https://support.google.com/mail/answer/81126?hl=en&rd=1).
- [Email sender guidelines FAQ](https://support.google.com/mail/answer/14289100?hl=en).
- [Postmaster Tools dashboards](https://support.google.com/mail/answer/14668346?hl=en).

El sistema exige SPF, DKIM, DMARC, TLS, DNS directo e inverso, seeds y Postmaster. Postmaster no es evidencia en tiempo real y puede no mostrar datos con volumen bajo. Ausencia de datos permanece `UNKNOWN`, nunca `PASS`.

## Bloqueos externos exactos

- Anexo A vinculado, importado, conciliado y hasheado en la base operativa.
- Contrato ejecutado y certificado archivados.
- Evidencia acumulativa de inicio contractual.
- Base legal y aviso de privacidad aprobados.
- Compra y propiedad de dominios.
- DNS y cuatro buzones.
- 42 días completos de warmup Apollo por buzón.
- 14 días reales de canary live.
- Cinco cuentas elegibles y cinco contactos verificados.
- Copy aprobado por Francisco.
- Revisión técnica de Paco, actualmente `PASS_LOCAL` con fuente congelada.
- Aprobación explícita de Jorge.

Hasta entonces, el Control Room muestra M6 como `BLOCKED`, gate `EXTEND` y envío `HOLD`.
