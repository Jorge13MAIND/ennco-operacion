# M6 Gate Report

Fecha de corte: 2026-08-11 23:41 `America/Mexico_City`.

## Veredicto

- Implementación local de readiness: `EVIDENCE_READY`.
- Gate técnico local: `PASS`.
- Gate global M6: `EXTEND`.
- Campaña: `HOLD`.
- Destinatarios reales: `0`.
- Correos enviados: `0`.
- Efectos externos: `0`.
- Leads, pipeline y revenue creados: `0`.

No se declara ejecutado el primer correo ni terminado el programa enterprise. Este corte demuestra controles locales y conserva todos los gates humanos y externos.

## Paquete de readiness

- 30 gates exactos en el JSON y 30 en el enum SQL.
- 22 de 22 checks locales.
- Cero gates marcados `PASS` con evidencia live.
- Estado actual `HOLD` y decisión `EXTEND`.
- Cero destinatarios y cero cuentas reales.
- Cuatro candidatos de dominio, todos con propiedad y DNS `UNKNOWN`.
- Cinco fixtures `.invalid`, únicos y no entregables.
- Hash de manifiesto verificado.
- Hash de secuencia verificado.

Hashes principales:

- Readiness packet: `f505d8ae74469f14db6416ea315cfb120591bda1609fbd8645b35ba401f1477d`.
- Domain ledger: `d7ac84580e573a16c7b0023491cd94906fb4e5ca56cdb2f387745540c442174a`.
- Synthetic fixture: `87cc9ccaca20025d813109bcf760179259a38f685349177b788befd53d9cfaeb`.

## Gate PostgreSQL

El runner `supabase/tests/run-first-send-release-gate.sh` ejecutó migraciones 001 a 008 sobre PostgreSQL 16.13 desechable y verificó:

- Cinco cuentas, cinco contactos y cinco enrollments exactos.
- 30 gates live hipotéticos para probar el camino positivo.
- Aprobación explícita enlazada a actor, campaña y hash.
- Finalización service-only.
- Segundo finalize idempotente.
- Evidencia sintética rechazada como `PASS`.
- Gate vencido devuelve `EXTEND`.
- `KILL` devuelve `KILL`.
- Deriva de manifiesto devuelve `KILL`.
- Supresión devuelve `EXTEND`.
- Cambio de identidad del destinatario devuelve `EXTEND`.
- Cambio de hash de secuencia devuelve `EXTEND`.
- Conjunto de destinatarios inmutable.
- Aprobación append-only.
- Actor de aprobación falsificado rechazado.
- Escritura directa de operador rechazada.
- Escritura directa de service role sobre lote o destinatarios rechazada.
- `DRY_RUN` permitido.
- `QUEUED` bloqueado por runtime cerrado.
- Insert directo de `SENT` rechazado.
- Cero estados reales de envío persistidos.
- Audit log sin correo, asunto o cuerpo centinela.
- Estado `KILLED` preserva aprobación e historial.

Resultados:

- `FIRST_SEND_RELEASE_GATE_PASS`.
- `FIRST_SEND_RELEASE_ROLLBACK_PASS`.
- `FIRST_SEND_RELEASE_REAPPLY_PASS`.

La prueba usa datos sintéticos. No convierte a producción ningún gate.

## Regresión integral ejecutada

Comandos:

```bash
npm run capture:m6-evidence
npm run capture:m6-browser
npm run verify:m6
```

Resultado:

- RTM: 75 filas, 47 de 47 checklist, 0 fallas.
- Importación: 28 de 28 checks.
- Secret scan: 266 archivos, 0 hallazgos.
- Campaign package: 29 de 29 checks.
- Canary acelerado: 14 de 14 escenarios, 13 fallas inyectadas, 0 efectos externos.
- Core DB: PASS.
- Storage forward, rollback y reapply: PASS.
- Retention forward, rollback y reapply: PASS.
- Prequote forward, rollback y reapply: PASS.
- Analytics forward, rollback y reapply: PASS.
- Gmail operations forward, rollback y reapply: PASS.
- Shadow canary forward, rollback y reapply: PASS.
- First send forward, rollback y reapply: PASS.
- Restore local: PASS.
- PITR producción: no probado.
- RPO de 15 minutos: no probado.
- Dependency audit: 0 vulnerabilidades.
- Lint: PASS.
- Typecheck: PASS.
- Unitarias: 22 archivos y 72 tests PASS.
- Build: PASS, 21 rutas.
- E2E: 75 de 75 en cinco viewports.
- QA visual M6: campañas desktop, campañas mobile y roadmap desktop PASS.

## Defectos encontrados y corregidos

1. La primera prueba temporal eliminaba una tabla al terminar la sentencia. Se corrigió el harness y se repitió desde cero.
2. Una aprobación podía registrar `PASS` sin vínculo a un registro append-only. Se agregó FK, actor autenticado, rol y coincidencia de hash.
3. Bastaba que alguna secuencia estuviera aprobada. Ahora se valida exactamente la secuencia congelada por cada enrollment.
4. El destinatario podía cambiar de correo después del lote. Ahora se congela y revalida su hash.
5. El lote y sus destinatarios permitían DML técnico directo. Se retiró UPDATE y DELETE y se exige finalización service-only.
6. Un `SENT` directo podía intentar saltar la cola. Se agregaron transiciones estrictas.
7. Un `KILLED` posterior a READY no preservaba correctamente historia. Ahora conserva aprobación, timestamp y razón de kill.
8. La supresión y la cola no compartían lock. Ahora cualquier cambio de supresión serializa contra el intento de envío.
9. CI no ejecutaba migraciones 004 a 008. Se agregaron todos los gates de base y los verificadores M5 y M6.

## Evidencia visual

- `docs/evidence/M6-campaigns-desktop.png`.
- `docs/evidence/M6-campaigns-mobile.png`.
- `docs/evidence/M6-roadmap-desktop.png`.

El Control Room muestra `0/30 gates live`, `0 destinatarios reales`, `HOLD` y M6 `EXTEND`. La interfaz no confunde preparación con campaña real.

## Bloqueos reales

- Anexo A ausente.
- Contrato ejecutado y certificado no archivados.
- Evidencia acumulativa de inicio contractual incompleta.
- Revisión legal pendiente.
- Dominios y buzones no comprados.
- DNS, seeds y Postmaster no ejecutados.
- Cero de 35 días autenticados.
- Cero de 14 días reales de canary.
- Cero cuentas elegibles y cero contactos verificados para el piloto.
- Copy sin aprobación de Francisco.
- Revisión técnica sin aprobación de Paco.
- Aprobación explícita de Jorge ausente.
- Proveedores, staging y producción no autorizados.

Ninguno invalida el PASS local. Todos impiden el primer correo.
