# M8 Gate Report

Fecha de corte: 2026-08-12 00:26 `America/Mexico_City`.

## Veredicto

- Implementacion local de reporte contractual: `EVIDENCE_READY`.
- Gate tecnico local: `PASS`.
- Gate global M8: `EXTEND`.
- Mes contractual: `NOT_STARTED`.
- Reportes contractuales reales: `0`.
- Experimentos reales: `0`.
- Leads contractuales reales: `0`.
- Efectos externos: `0`.

No se declara cumplida la meta de diez leads ni iniciado el primer mes completo. El fixture hipotetico valida el contrato de calculo, no representa resultados ENNCO.

## Verificador determinista

`npm run capture:m8-evidence` obtuvo 15 de 15 checks:

- M7 global permanece `EXTEND`.
- Cero olas y entregas reales.
- Reporte contractual no disponible.
- Mes calendario completo validado.
- Denominadores por canal separados.
- Meta de diez sin conversión a hecho.
- Recuperación inicia por denominadores.
- Experimento sólo después del diagnóstico.
- Verdad diaria persistida.
- Calendario laboral con evidencia.
- Items contados persistidos.
- Emisión con aprobación.
- Un solo experimento activo.
- Evidencia append-only.

El fixture usa 200 entregas, 24 respuestas sustantivas, 12 positivas, 6 leads de email, 2 de precotización, 5 reuniones, 3 oportunidades, 2 propuestas, 1 cierre y 100,000 MXN de primer pago. Todo está etiquetado `hypothetical_live_fixture` dentro de evidencia sintética.

## Gate PostgreSQL

El runner `supabase/tests/run-contractual-monthly-reporting-gate.sh` aplico migraciones 001 a 010 sobre PostgreSQL 16.13 desechable y verifico:

- 31 días operativos live exactos.
- Calendario MX con tercer día hábil.
- Mes incompleto rechazado.
- Cinco entregas con provider ID.
- Dos respuestas positivas.
- Dos leads estrictos de email.
- Funnel con una reunión, una oportunidad y una propuesta.
- Un primer pago y una brecha de SLA.
- 16 items de evidencia enlazados.
- Reporte append-only e idempotente.
- Deriva de evidencia rechazada.
- Emisión sin aprobación rechazada.
- Aprobación ligada a actor, ID y hash.
- Emisión idempotente.
- Diagnóstico incompleto rechazado.
- Experimento sin aprobación rechazado.
- Segundo experimento activo rechazado.
- DML directo de operador y service role rechazado.
- Audit log sin el rationale centinela.
- Forward, rollback y reapply.

Resultados:

- `CONTRACTUAL_MONTHLY_REPORTING_GATE_PASS`.
- `CONTRACTUAL_MONTHLY_REPORTING_ROLLBACK_PASS`.
- `CONTRACTUAL_MONTHLY_REPORTING_REAPPLY_PASS`.

## Regresion acumulativa

Comandos:

```bash
npm run capture:m8-evidence
npm run capture:m8-browser
npm run verify:m8
```

Resultado:

- RTM: 75 filas, 47 de 47 checklist, 0 fallas.
- Importacion: 28 de 28 checks.
- Secret scan: 298 archivos, 0 hallazgos.
- Campaign package: 29 de 29 checks.
- Canary acelerado: 14 de 14 escenarios, 13 fallas inyectadas, 0 efectos externos.
- Todos los gates DB M0 a M8: PASS.
- Todos los rollbacks y reapply asociados: PASS.
- Restore local: PASS.
- PITR produccion y RPO 15 minutos: no probados.
- Dependency audit: 0 vulnerabilidades.
- Lint y typecheck: PASS.
- Unitarias: 24 archivos y 85 tests PASS.
- Build: PASS, 21 rutas.
- E2E: 75 de 75 en cinco viewports.
- QA visual: reportes desktop y mobile, roadmap desktop PASS.

## Defectos encontrados y corregidos

1. Las politicas M8 llamaban un helper RLS inexistente. Se corrigieron para usar `app.is_member`.
2. El audit intentaba escribir una columna que no existe y no preservaba old/new por separado. Se corrigio al esquema real.
3. El trigger de calendario no podía leer usuarios bajo service role. Se convirtió en security definer acotado.
4. Los tipos enum de items se resolvían como texto en un `UNION ALL`. Se agregaron casts explícitos.
5. El harness intentaba expandir variables psql dentro de bloques dollar quoted. Se sustituyeron por consultas canónicas.
6. El primer diseño no modelaba feriados ni los tres días hábiles. Se agregó calendario MX versionado con evidencia.
7. La emisión idempotente intentaba un UPDATE sobre evidencia append-only. Ahora devuelve la emisión existente.
8. El portal seguía diciendo M0 a M7. Se corrigio a M0 a M8 antes de recapturar evidencia.

## Evidencia visual

- `docs/evidence/M8-reports-desktop.png`.
- `docs/evidence/M8-reports-mobile.png`.
- `docs/evidence/M8-roadmap-desktop.png`.

La interfaz muestra `Primer mes completo: No iniciado`, `Experimento activo: Ninguno`, cero leads y M8 `EXTEND`.

## Bloqueos reales

- M6 y M7 en `EXTEND`.
- Anexo A y contrato ejecutado ausentes.
- Cero días operativos live.
- Calendario MX real no cargado.
- Cero entregas y T0 inexistente.
- Mes contractual no iniciado.
- Reconciliación real de proveedores no probada.
- Aprobación de emisión no aplicable todavía.

Ningun bloqueo invalida el PASS local. Todos impiden emitir un reporte contractual real.
