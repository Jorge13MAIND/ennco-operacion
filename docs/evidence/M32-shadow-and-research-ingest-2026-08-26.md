# Evidencia — motor M32 en sombra + preparación del ingest de research (26-ago-2026)

## 1. El motor en sombra se maneja solo (verificado en producción)

Deployment vigente `a5jzllhnx` (creado 19:56 UTC), proyecto `ennco-operacion`,
plan Vercel **pro** (los 5 crons quedan registrados con granularidad de minutos).

Ledger `public.hybrid_dispatch_ticks`, últimas marcas:

| Tick | Resultado | UTC | Origen |
|---|---|---|---|
| HEARTBEAT | DEGRADED (bucket `dispatch-hb:2026-08-26-12-55`) | 18:59:45 | verificación manual |
| CLAIM | NOOP (`NO_ACTIVE_RELEASE`) | 18:59:45 | verificación manual |
| HEALTH | READ | 19:00:05 | **cron watchdog** |
| HEARTBEAT / CLAIM / HEALTH | DEGRADED / NOOP / READ | 19:57:17-18 | verificación manual del fix `21426a7` |
| HEALTH | READ | 20:01:13 | **cron watchdog** |
| HEALTH | READ | 20:30:15 | **cron watchdog** |

**Lo que prueba**: las marcas de 20:01 y 20:30 se escribieron sin intervención
humana ni curl de verificación, con ~29 minutos entre ellas, que es exactamente
el `*/30` del watchdog. Los 5 crons están registrados contra el mismo host, así
que la programación de Vercel está operando sobre este deployment.

**Lo que NO prueba**: la cadencia real del cron de despacho (`*/5 15-19 UTC` =
09:00-13:59 CDMX). El fix del ledger se desplegó a las 19:56 UTC, tres minutos
antes de que esa ventana cerrara, así que su primera corrida natural completa
ocurre el 27-ago por la mañana. No se debe afirmar antes de verla.

`CLAIM → NOOP (NO_ACTIVE_RELEASE)` y `HEARTBEAT → DEGRADED` son el estado
correcto hoy: no hay release activo porque el copy no está aprobado y no hay
buzones conectados. El motor tiene que quedarse quieto.

## 2. Batches de ingest listos (bloqueados por una llave humana)

`scripts/build-sourcing-batches-2026-08-26.mts` convierte las fuentes congeladas
del sourcing en artefactos POST-ables, deterministas y verificados:

| Batch | Filas |
|---|---:|
| `batch-tier1-top50.json` | 50 |
| `batch-profepa-gto-qro.json` | 65 |
| `batch-parques-industriales.json` | 422 |
| `batch-denue-manufactura-parte-{1,2,3}.json` | 1,294 |
| **Total nuevo** | **1,831** |
| (previo) `company-directory-seed-batch.json` | 27 |

Garantías, cada una con prueba automatizada en
`src/lib/research/sourcing-batches.test.ts` (20 casos) y en el gate
`npm run verify:data`:

- Cada artefacto valida contra `ingestResearchBatchRpcSchema`, el mismo contrato
  zod que corre la ruta. La normalización se importa del módulo real del app, no
  se reimplementa: no puede haber drift.
- `sourceSha256` único por batch (`import_batches` lo tiene como llave única) y
  `externalRecordId` sin colisiones entre batches.
- `Idempotency-Key` derivada del request canónico: reenviar es idempotente.
- Todo queda `RESEARCH_ONLY_HOLD` con 0 registros elegibles para outreach.
- Exclusiones conciliadas con marcador, nunca en silencio (DEC-105): 19 CFE,
  1 DENUE sin razón social, 2 del Anexo A.

**El bloqueo**: `app.ingest_research_batch` llama a `research_assert_operator`,
que exige rol de operador **con sesión AAL2**. Ningún usuario de producción ha
completado su primer acceso (`auth.mfa_factors` vacío para los dos usuarios).
Sin ese primer ingreso con TOTP, ningún dato entra al Workbench.

Procedimiento cuando exista la sesión (paso 2b del runbook de Jorge): con su
sesión viva en el navegador, se ejecutan los 7 POST a `/api/v1/research/imports`
en el orden de `data/imports/research/sourcing-2026-08-26/INDEX.json`, cada uno
con su `Idempotency-Key`, y se concilia la respuesta (`created`) contra el
`source_records` del artefacto.
