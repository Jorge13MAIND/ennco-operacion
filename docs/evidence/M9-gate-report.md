# M9 Gate Report

Fecha de corte: 2026-08-12 00:52 `America/Mexico_City`.

## Veredicto

- Implementacion local M9: `EVIDENCE_READY`.
- Gate tecnico local: `PASS`.
- Gate global M9: `EXTEND`.
- Programa enterprise de doce semanas: no terminado.
- UAT ENNCO real: `0`.
- Capacitaciones ENNCO reales: `0`.
- Transferencias de acceso reales: `0`.
- Aceptaciones finales reales: `0`.
- Restore productivo probado: `0`.
- Efectos externos: `0`.

El resultado local prueba el contrato, el paquete y el harness de entrega. No prueba operacion productiva ni aceptacion del cliente.

## Paquete fuente

- Commit fuente: `757ed4d20d2c68c78be5caa8bff7d2de17c8960f`.
- Manifest SHA256: `1c8b7416cd8a8d44bbeae2a7ac1a41123201d1574f9fc7589815411549a38cd1`.
- Evidence class: `synthetic_demo`.
- Datos reales de ENNCO dentro del paquete de prueba: no.
- Source archive reproducido y comparado contra manifest: PASS.

## Verificador M9

`npm run verify:m9-readiness` obtuvo 17 de 17 checks:

- M8 global permanece `EXTEND`.
- Commit fuente existe.
- Archive fuente reproducible.
- SHA256 coincide con manifest.
- Empresas y contactos exportan y reimportan.
- Empresas sin contacto se preservan.
- Pipeline sintetico exporta y reimporta.
- Todos los rows de prueba son `synthetic_demo`.
- Cero datos reales y cero efectos externos.
- Contrato DB de handoff presente.
- Aceptacion exclusiva `ennco_admin`.
- Evidencia de aceptacion append-only.
- Rollback restaura el contrato M8.
- Gate adversarial presente.
- Indice de runbooks completo.
- Segunda restauracion local presente.

Los seis criterios locales están en PASS. Los diez criterios live permanecen en `EXTEND`.

## Gate PostgreSQL

`supabase/tests/run-handoff-acceptance-gate.sh` aplico migraciones 001 a 011 sobre PostgreSQL 16.13 desechable y verifico:

- Tenant isolation y RLS.
- Paquete sintetico sellado sólo como `EVIDENCE_READY`.
- Paquete live no sellable con P1 abierto.
- Seis artefactos locales exactos.
- Doce artefactos live exactos.
- Seis checks locales y diez live.
- Capacitacion live ligada a participante ENNCO.
- Aceptacion cruzada entre tenants rechazada.
- Paquete sintetico no aceptable.
- Service role y Teckel sin autoridad de aceptacion.
- Aprobacion exacta por manifest.
- Aceptacion idempotente.
- Deriva del statement rechazada.
- Evidencia append-only.
- Audit log sin locations de artefactos.
- Forward, rollback y reapply.

Resultados:

- `HANDOFF_ACCEPTANCE_GATE_PASS`.
- `HANDOFF_ACCEPTANCE_ROLLBACK_PASS`.
- `HANDOFF_ACCEPTANCE_REAPPLY_PASS`.

El fixture live del gate es una organizacion sintetica que ejercita la rama de seguridad. No es evidencia de UAT, capacitacion o aceptacion ENNCO.

## Segunda restauracion local

`npm run capture:m9-restore` creo un destino separado de M2 y obtuvo:

- Nueve de nueve tablas con conteos y SHA256 iguales.
- Dos de dos objetos con SHA256 iguales.
- Invariantes fuente y restore iguales.
- Audit append-only preservado.
- Idempotencia preservada.
- Lead estricto invalido rechazado.
- Archivo corrupto detectado.
- Verificacion independiente 11 de 11.

`production_pitr_proven`, `production_rpo_15m_proven` y `production_rto_4h_proven` permanecen `false`.

## Regresion acumulativa

Comando final:

```bash
npm run verify:m9
```

Resultado:

- RTM: 75 filas, 47 de 47 checklist, 0 fallas.
- Importacion: 28 de 28 checks.
- Secret scan: 343 archivos, 0 hallazgos.
- Campaign package: 29 de 29 checks.
- Canary acelerado: 14 de 14 escenarios, 13 fallas inyectadas, 0 efectos externos.
- Gates DB M0 a M9: PASS local.
- Rollback y reapply asociados: PASS.
- Restore M2 y segundo restore M9: PASS local.
- Dependency audit: 0 vulnerabilidades.
- Lint y typecheck: PASS.
- Unitarias: 27 archivos y 99 tests PASS.
- Build: PASS, 21 rutas.
- E2E: 75 de 75 en cinco viewports.
- QA visual: entrega desktop, entrega mobile y roadmap desktop PASS.

## Defectos encontrados y corregidos

1. El export de empresas nacía desde contactos y omitía cuentas sin contacto. Se cambió a account-first y se agregó reimportación.
2. `git archive` superó el buffer default. Se amplió a 128 MiB y se regeneró desde un commit exacto.
3. La aceptación idempotente aceptaba un statement distinto en un retry. Ahora rechaza `HANDOFF_ACCEPTANCE_STATEMENT_DRIFT`.
4. El primer diseño exigía un solo artefacto. Ahora exige seis locales y doce live exactos.
5. Un P1 podía quedar fuera de una lista documental. El seal consulta incidentes abiertos en la misma transacción.
6. El disclosure del módulo Entrega hablaba de renglones SIMULACION sin marcar. Ahora muestra de forma directa que no existe entrega real.
7. La captura visual usaba un origen distinto y generaba warnings dev. Se alineó a `localhost` y la recaptura quedó limpia.
8. El archive de un commit con un paquete previo podía incluir el tar dentro de sí mismo. `git archive` ahora excluye `evidence/m9-handoff` y la reproducibilidad se volvió a probar.

## Evidencia visual

- `docs/evidence/M9-delivery-desktop.png`.
- `docs/evidence/M9-delivery-mobile.png`.
- `docs/evidence/M9-roadmap-desktop.png`.

La interfaz muestra seis de seis criterios locales, cero de diez live, cero capacitaciones y cero aceptaciones.

## Bloqueos reales

- M0 y M2 a M8 no tienen PASS live completo.
- Anexo A y contrato ejecutado siguen ausentes.
- Hay 11 P0 y 7 P1 abiertos o bloqueados externamente.
- Source control y cuentas de proveedores no están bajo propiedad ENNCO verificada.
- No existe restore en infraestructura administrada.
- No existe auditoria de seguridad live.
- No existe UAT con operador ENNCO.
- No existe capacitacion con operador y suplente.
- No existe export y reimport live.
- No existe walkthrough real de runbooks.
- No existe aceptacion final.

Ningun bloqueo invalida el PASS local. Todos impiden declarar M9 global, producción o programa enterprise terminado.
