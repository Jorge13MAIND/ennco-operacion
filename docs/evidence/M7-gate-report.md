# M7 Gate Report

Fecha de corte: 2026-08-12 00:03 `America/Mexico_City`.

## Veredicto

- Implementacion local de escalamiento: `EVIDENCE_READY`.
- Gate tecnico local: `PASS`.
- Gate global M7: `EXTEND`.
- M6: `EXTEND`.
- Olas reales liberadas: `0`.
- Primeras entregas validas: `0 de 100`.
- T0: `NOT_AVAILABLE`.
- Efectos externos: `0`.
- Leads, pipeline y revenue creados: `0`.

No se declara escalamiento, baseline comercial ni resultado externo. El corte demuestra que el sistema puede impedir una ola insegura y medir T0 cuando exista el denominador real.

## Verificador determinista

`npm run capture:m7-evidence` obtuvo 13 de 13 checks:

- M6 sigue en HOLD.
- Cero destinatarios reales.
- Runtime cerrado.
- Salud live limpia devuelve `PASS`.
- Evidencia sintetica devuelve `EXTEND`.
- Violacion de supresion devuelve `KILL`.
- Ola limitada a 25.
- Observacion minima de 24 horas.
- Reply sync p95 maximo de 300 segundos.
- Fuente de release unica.
- T0 exige 100 entregas.
- Forecast derivado de la tasa observada.
- Tasa cero devuelve `null`, no una cifra inventada.

El escenario matematico de prueba usa 100 entregas, 10 respuestas sustantivas, 6 positivas, 4 leads estrictos, 3 reuniones realizadas y 2 oportunidades calificadas. Es un fixture, no un resultado ENNCO.

## Gate PostgreSQL

`supabase/tests/run-controlled-scaling-gate.sh` aplico migraciones 001 a 009 sobre PostgreSQL 16.13 desechable y verifico:

- `PASS`, `EXTEND` y `KILL` de salud.
- Evidencia sintetica incapaz de pasar.
- Observacion de 24 horas.
- Limite progresivo de volumen.
- Aprobacion exacta y append-only.
- Ola finalizada solamente por service role.
- Recipient set inmutable.
- Una sola fuente de release por enrollment.
- 30 gates live vigentes en el camino positivo sintetico.
- Supresion, mailbox, secuencia, hashes y ventana fail closed.
- `SENT` directo rechazado.
- T0 rechazado con menos de 100 entregas.
- Baseline congelado con 100 entregas exactas.
- Funnel con invariantes.
- Oportunidades debajo de `QUALIFIED` excluidas.
- DML de operador y service role limitado.
- Audit log sin correo, asunto ni cuerpo centinela.
- Forward, rollback y reapply.

Resultados:

- `CONTROLLED_SCALING_GATE_PASS`.
- `CONTROLLED_SCALING_ROLLBACK_PASS`.
- `CONTROLLED_SCALING_REAPPLY_PASS`.

## Regresion acumulativa

Comandos:

```bash
npm run capture:m7-evidence
npm run capture:m7-browser
npm run verify:m7
```

Resultado:

- RTM: 75 filas, 47 de 47 checklist, 0 fallas.
- Importacion: 28 de 28 checks.
- Secret scan: 280 archivos, 0 hallazgos.
- Campaign package: 29 de 29 checks.
- Canary acelerado: 14 de 14 escenarios, 13 fallas inyectadas, 0 efectos externos.
- Core, Storage, Retention, Prequote, Analytics, Gmail, Canary, First Send y Scaling DB: PASS.
- Todos los rollbacks y reapply asociados: PASS.
- Restore local: PASS.
- PITR produccion y RPO 15 minutos: no probados.
- Dependency audit: 0 vulnerabilidades.
- Lint y typecheck: PASS.
- Unitarias: 23 archivos y 79 tests PASS.
- Build: PASS, 21 rutas.
- E2E: 75 de 75 en cinco viewports.
- QA visual: campañas desktop, reportes desktop y mobile, roadmap desktop PASS.

## Defectos encontrados y corregidos

1. La prueba esperaba llegar al kill switch fuera de la ventana. Se corrigio para validar el orden fail closed exacto.
2. Un enrollment podia aparecer en primer lote y ola, o repetirse en dos fuentes. Se agregaron indices y rechazo transaccional.
3. El baseline podia contar una oportunidad completa debajo de `QUALIFIED`. Se agrego el minimo de etapa y una prueba de transiciones.
4. Un segundo mensaje del mismo touch podia entrar por otro retry. Se agrego indice parcial por enrollment y touch externo.
5. El portal no mostraba ola ni T0. Se agregaron consultas live y estados sinteticos explicitos.

## Evidencia visual

- `docs/evidence/M7-campaigns-desktop.png`.
- `docs/evidence/M7-reports-desktop.png`.
- `docs/evidence/M7-reports-mobile.png`.
- `docs/evidence/M7-roadmap-desktop.png`.

La interfaz muestra `M7 bloqueado`, `0/100 entregas validas`, `T0 no existe` y `HOLD`.

## Bloqueos reales

- M6 no ha pasado.
- Anexo A ausente.
- Contrato ejecutado y certificado no archivados.
- Proveedores, dominios, DNS, buzones y staging no autorizados.
- Cero cuentas elegibles y contactos verificados.
- Cero entregas reales.
- Cero observaciones live de 24 horas.
- Reconciliacion real Gmail y Supabase no probada.
- Aprobaciones de campaña y ola ausentes.

Ningun bloqueo invalida el PASS local. Todos impiden liberar una ola o calcular T0.
