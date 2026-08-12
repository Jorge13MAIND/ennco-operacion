# M4 Gate Report

Snapshot: 11 de agosto de 2026, America/Mexico_City.

## Veredicto

- Nucleo M4 local con datos sinteticos: `PASS`.
- M4 global con proveedores y datos reales: `EXTEND`.
- Actividad comercial real: `0`.
- Leads contractuales reales: `0`.
- Pipeline estricto real: `0`.
- Revenue atribuido: `0 MXN`.
- Efectos externos: `0`.

El PASS local cubre portal, respuestas, revision humana, calificacion, reuniones, pipeline, exportaciones, Gmail push, history sync por contrato, idempotencia, rollback y QA visual. No cubre cuentas administradas, OAuth, KMS, Gmail real, Pub/Sub real, Supabase real, UAT ENNCO, produccion o envio.

## Gates

| Gate | Local | Global | Evidencia o blocker |
|---|---|---|---|
| Portal Hoy y diez modulos | PASS | EXTEND | Responsive en cinco viewports; falta UAT humano |
| Verdad comercial separada | PASS | EXTEND | Ocho indicadores reales en cero y fixtures con SIMULACION |
| Webhook Gmail | PASS | EXTEND | OIDC, audience, service account, subscription, HMAC y replay; falta Pub/Sub real |
| History sync | PASS por contrato | EXTEND | Paginacion, dedup y 404 fail closed; falta OAuth y watch real |
| Respuesta humana | PASS | EXTEND | Detiene secuencia, crea tarea y espera revision; falta Gmail real |
| Revision positiva | PASS | EXTEND | Crea CAPTURED, nunca contractual; falta UAT operador |
| Hard bounce y baja | PASS DB | EXTEND | Supresion exacta y stop rule; falta DSN y unsubscribe live |
| Lead contractual | PASS | EXTEND | Cinco criterios y evidencia UUID; falta UAT ENNCO |
| Reunion realizada | PASS | EXTEND | Hora, asistencia y notas obligatorias; falta calendario live |
| Pipeline estricto | PASS | EXTEND | No permite saltos ni QUALIFIED incompleto; falta operacion live |
| CSV export | PASS | EXTEND | Empty synthetic, formula neutralization, SHA256 y audit run; falta datos live |
| RLS y escritura tecnica | PASS | EXTEND | Operador no escribe messages, provider events o mailboxes; falta Auth real |
| Visual desktop y mobile | PASS | EXTEND | Cuatro capturas auditadas; falta Safari real |

## Comandos ejecutados

```bash
npm run verify:m4
node scripts/capture-m4-browser-evidence.mjs --repo . --base-url http://localhost:3000
```

Resultados observados:

```text
RTM_PASS rows=75 checklist=47/47
DATA_IMPORT_PASS checks=28/28
SECRET_SCAN_PASS files=217 findings=0
PREQUOTE_MODEL_GATE_PASS 20/20
CORE_DATABASE_GATE_PASS
SECURE_STORAGE_GATE_PASS
RETENTION_DELETION_GATE_PASS
PUBLIC_PREQUOTE_CAPTURE_GATE_PASS
CONVERSION_ANALYTICS_GATE_PASS
GMAIL_OPERATIONS_GATE_PASS
GMAIL_OPERATIONS_ROLLBACK_PASS
GMAIL_OPERATIONS_REAPPLY_PASS
M2_EPHEMERAL_RESTORE_GATE_PASS
NPM_AUDIT_PASS vulnerabilities=0
LINT_PASS
TYPECHECK_PASS
UNIT_PASS files=17 tests=58
BUILD_PASS routes=21
E2E_PASS tests=75 profiles=5
M4_BROWSER_EVIDENCE_PASS captures=4
```

Cada comando termino con exit code `0`.

## Evidencia

- `docs/evidence/M4-control-room-desktop.png`
- `docs/evidence/M4-control-room-mobile.png`
- `docs/evidence/M4-replies-desktop.png`
- `docs/evidence/M4-roadmap-desktop.png`
- `docs/evidence/M4-checksums.sha256`
- `supabase/migrations/202608110006_gmail_operations.sql`
- `supabase/tests/006_gmail_operations_gate.sql`
- `src/lib/gmail/history.test.ts`
- `src/lib/gmail/webhook.test.ts`
- `src/lib/operations/mutations.test.ts`
- `src/lib/exports/csv.test.ts`
- `tests/e2e/surfaces.spec.ts`

## Hallazgos de QA cerrados

1. El primer esquema permitia a un operador escribir mensajes y provider events por la politica generica. Se revoco DML y se exigieron RPC auditadas.
2. La primera ingesta podia aceptar una clasificacion positiva desde el worker. Ahora toda respuesta inicia `UNREVIEWED` y exige decision humana.
3. Un hard bounce podia suprimir cuenta y dominio completos. Ahora la supresion automatica se limita al correo exacto.
4. Metadata de mailer daemon podia confundirse con hard bounce permanente. Ahora queda `UNKNOWN` hasta resolver el DSN.
5. Un lead y una oportunidad podian nacer en un estado avanzado por INSERT directo. Los triggers ahora validan INSERT y UPDATE.
6. Una oportunidad podia saltar etapas. La base rechaza el salto y exige evidencia al entrar a pipeline calificado.
7. Una reunion podia marcarse realizada sin asistencia. Ahora exige hora, asistencia y notas.
8. Un CSV podia ejecutar formulas al abrirse. Los valores con prefijos peligrosos reciben neutralizacion antes de exportar.
9. Una falla live podia tentar a cargar fixtures. El portal ahora falla cerrado y muestra una pantalla de error.
10. El conteo de riesgos del demo no coincidia con el Risk Register. Se reconcilio a diez P0 y cuatro P1 abiertos.

## Blockers

1. Proyecto Supabase ENNCO aislado y aprobado.
2. Google Workspace, buzones y OAuth aprobados.
3. Google Cloud, Pub/Sub, service account, KMS y secretos rotados.
4. Watch real y cursor inicial por mailbox.
5. Staging aislado con MFA, RLS y pruebas de integracion.
6. Operador ENNCO y suplente designados.
7. UAT humano de 15 escenarios.
8. Anexo A y contrato ejecutado siguen bloqueando readiness global.

Estos blockers no impiden construir M5 en local. Si impiden aceptar M4 global o usar datos reales.
