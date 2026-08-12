# M5 Gate Report

Fecha de corte: 2026-08-11 23:15 America/Mexico_City.

## Veredicto

- Implementación local: `EVIDENCE_READY`.
- Harness local acelerado: `PASS`.
- Gate global M5: `EXTEND`.
- Release de campaña: `HOLD`.
- Efectos externos: `0`.
- Destinatarios: `0`.
- Días reales de canary: `0 de 14`.
- Leads, pipeline y revenue creados: `0`.

No se declara terminado el programa enterprise. Este corte cierra la implementación local M5 y preserva los gates externos.

## Entregables verificados

### Campaign package

- Ocho contactos.
- Cadencia `0, 3, 7, 14, 28, 42, 60, 75`.
- Tres variantes por contacto: dirección, mantenimiento y compras.
- 24 mensajes.
- Máximo observado: 55 palabras.
- Una CTA por mensaje.
- Remitente: Francisco Cuellar, CEO.
- Señal y fuente obligatorias en el primer contacto.
- Stop rules explícitas.
- Sin open pixel.
- Manifest en `HOLD`, con kill switches activos y todas las aprobaciones en false.
- Resultado: `29/29 PASS`.

Hash de secuencia:

`6d67db19633e5749a55b545e9b1a09b1ac25688234bf402b881618514c48738e`

Hash de manifest:

`e423bdfb9446b1c5988133626353b0cc5bcb53a212b25fc9cbd752d686deb0da`

### Assistant

- 22 casos.
- Dos corridas completas.
- Resultados idénticos.
- Intenciones permitidas: servicios, insumos, proceso y stakeholders.
- Handoff: comercial, fechas, legal, fiscal, técnico y unknown.
- Refusal: prompt injection y extracción de secretos.
- Endpoint cerrado por default.

### Shadow canary acelerado

- 14 días simulados.
- 14 escenarios.
- 13 fallas inyectadas.
- 14 resultados PASS del harness.
- 0 fallas.
- 0 unknowns.
- 0 efectos externos.
- Hash chain verificado.
- Decisión local: `PASS`.
- Decisión de release: `EXTEND`.

Hash final del chain:

`bb2eb28e1565a23e6ccbdbf55fb7613bb3ade7809647d0fb0f70bbf0f23c5323`

### Persistencia y seguridad del canary

- Evidencia sintética no puede recibir `PASS`.
- Sólo evidencia live en staging puede aspirar a `PASS`.
- 14 días consecutivos obligatorios.
- Unknown, falla, P1, reconciliación incompleta o hueco devuelve `EXTEND`.
- P0, efecto externo o manifest drift devuelve `KILL`.
- Operador sin DML.
- Finalización service-only.
- Audit allowlist sin texto libre, correos, cuerpos, asuntos ni destinatarios.
- Forward: `SHADOW_CANARY_GATE_PASS`.
- Rollback: `SHADOW_CANARY_ROLLBACK_PASS`.
- Reapply: `SHADOW_CANARY_REAPPLY_PASS`.

## Gate integral ejecutado

Comando:

```bash
npm run capture:m5-evidence
npm run verify:m5
```

Resultado:

- RTM: 75 filas, 47 de 47 checklist, 0 fallas.
- Importación: 28 de 28 checks.
- Secret scan: 239 archivos, 0 hallazgos.
- Campaign package: 29 de 29 checks.
- Core DB: PASS.
- Storage forward, rollback y reapply: PASS.
- Retention forward, rollback y reapply: PASS.
- Prequote forward, rollback y reapply: PASS.
- Analytics forward, rollback y reapply: PASS.
- Gmail operations forward, rollback y reapply: PASS.
- Shadow canary forward, rollback y reapply: PASS.
- Restore local: PASS.
- PITR producción: no probado.
- RPO 15 minutos: no probado.
- Dependency audit: 0 vulnerabilidades.
- Lint: PASS.
- Typecheck: PASS.
- Unitarias: 19 archivos y 64 tests PASS.
- Build: PASS, 21 rutas.
- E2E: 75 de 75 en cinco viewports.
- QA visual M5: desktop y mobile PASS.

## Defectos encontrados y corregidos

1. Una pregunta sobre paneles y datos iniciales se clasificaba como servicios. Se cambió la prioridad de intención y se repitieron ambas corridas.
2. La función SQL service-only evaluaba la identidad del propietario por `SECURITY DEFINER`. Se cambió a rol invocador de sesión y se repitió el gate.
3. El rol autenticado conservaba DML heredado sobre tablas del canary. Se revocó DML explícitamente y se comprobó el rechazo.

## Evidencia visual

- `docs/evidence/M5-roadmap-desktop.png`.
- `docs/evidence/M5-roadmap-mobile.png`.

Ambas superficies muestran M5 como `EVIDENCE_READY` y `EXTEND`, con el bloqueo real de staging y 14 días consecutivos. M6 permanece bloqueado.

## Bloqueos reales

- Anexo A no existe localmente.
- Contrato ejecutado y certificado no archivados.
- Staging administrado no provisionado.
- Proveedores y credenciales reales no conectados.
- Dominios, buzones y DNS no autorizados.
- Ventana de reputación no iniciada.
- Copy sin aprobación externa.
- UAT de Paco y operador ENNCO no ejecutado.
- Aprobación explícita de primer envío ausente.

Estos bloqueos no invalidan el PASS local. Sí impiden `PASS` global, producción y cualquier contacto.

