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

## 1b. Bloqueadores abiertos del buzón primario (estado real en producción)

`public.mailboxes`, único registro: `contacto@ennco.com.mx`
(ruta `EXISTING_PRIMARY_GMAIL_RAMP`), con `health_status = HOLD` y
`kill_switch = true`, que es lo correcto mientras falte lo siguiente:

| Campo | Estado | Se destraba con |
|---|---|---|
| `credential_status` | UNKNOWN | consentimiento OAuth + KMS (sesión con Jorge) |
| `auth_dkim` | false | DKIM de `ennco.com.mx` (paso 3 del runbook) |
| `sender_identity_verified` | false | consentimiento del buzón |
| `gmail/outlook/yahoo_seed_verified` | false ×3 | corrida de seeds tras credencial |
| `reply_sync_verified` | false | sync de respuestas tras credencial |
| `list_unsubscribe_verified`, `one_click_unsubscribe_verified` | false ×2 | releases de baja |
| `blocklist_status` | UNKNOWN | verificación de listas |

`auth_spf` y `auth_dmarc` ya están en true. Los 3 buzones del carril aislado
existen en Google Workspace pero **todavía no están registrados en la
plataforma**: su alta pasa por el flujo autenticado con evidencia de proveedor,
no por inserción manual en la base (una fila puesta a mano sería un falso verde).

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

### Cómo se ejecutará (no es un curl)

`getMutationContext` corre `evaluateMutationRequest` antes que la autorización:
exige cabecera `Origin` **idéntica** al `appUrl` configurado y `sec-fetch-site`
`same-origin`, además de la cookie de sesión con AAL2. Un `curl` desde la
terminal falla en las tres condiciones, y extraer la cookie de sesión de Jorge
para inyectarla en un script sería manipular su credencial. Por lo tanto:

Los 7 POST se ejecutan **desde la página del propio sitio**, en el navegador de
Jorge ya autenticado, en el orden de
`data/imports/research/sourcing-2026-08-26/INDEX.json`, cada uno con su
`Idempotency-Key`. El payload viaja dentro del propio snippet porque la CSP
(`connect-src 'self' https://*.supabase.co`) impide que la página descargue los
archivos desde un servidor local; para los batches grandes se arma el arreglo
por partes en `window` y se envía al final. Cada respuesta se concilia:
`created` debe igualar el `source_records` del artefacto, y un reenvío debe
devolver `DUPLICATE` sin crear nada.
