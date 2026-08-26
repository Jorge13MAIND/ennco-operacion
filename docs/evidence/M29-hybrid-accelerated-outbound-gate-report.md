# M29. Evidencia de salida híbrida acelerada

Fecha: 25 de agosto de 2026.

Veredicto local: `PASS_LOCAL`.

Veredicto productivo: `EXTEND`.

Autorización efectiva de envío: `HOLD`.

Destinatarios reales inscritos: `0`.

Mensajes reales enviados por M29: `0`.

## Resultado entregado

- Supabase productivo tiene las migraciones 001 a 029 alineadas.
- Vercel productivo sirve el deployment `dpl_CXPYEAt6jqZdmsWQ3VRnEmSZeFBq` en `https://ennco-operacion.vercel.app`.
- El panel muestra `contacto@ennco.com.mx` como carril acelerado y tres buzones aislados como carril escalable.
- El cuarto buzón queda diferido hasta 100 entregas válidas.
- El requisito histórico de cuatro buzones ya no aparece como bloqueador operativo.
- Gmail API tiene un cliente local de primer contacto, sin ruta pública ni broker OAuth productivo.
- Apollo conserva acceso de sólo lectura para investigación y reconciliación exacta. La topología esperada es de tres buzones aislados.

## Gates ejecutados

```bash
npm test
# 62 archivos y 289 pruebas PASS

npm run build
# Next.js production build PASS

npm run typecheck
# PASS

npm run lint
# PASS, cero warnings

npm run verify:secrets
# PASS, 624 archivos, cero hallazgos

npm run verify:api-surface
# PASS, 30 implementadas, 2 diferidas

npm run verify:rtm
# PASS, 99 filas y checklist 47/47

npm run verify:provider-infrastructure-db
npm run verify:provider-coverage-db
npm run verify:annex-a-db
npm run verify:hybrid-outbound-db
# PASS
```

Marcadores M29:

- `HYBRID_ACCELERATED_OUTBOUND_GATE_PASS`
- `HYBRID_ACCELERATED_OUTBOUND_CONCURRENCY_PASS`
- `HYBRID_ACCELERATED_OUTBOUND_ROLLBACK_PASS`
- `HYBRID_ACCELERATED_OUTBOUND_REAPPLY_PASS`
- `HYBRID_ACCELERATED_OUTBOUND_DIFF_PASS`
- `HYBRID_ACCELERATED_OUTBOUND_SCRIPT_PASS`

## Verificación productiva

- `/api/v1/health`: `status=ok`, `environment=production`.
- `/ingreso`: HTTP 200.
- `/operacion/infraestructura` sin sesión: HTTP 307.
- Readiness híbrido sin sesión: HTTP 401.
- Creación de release híbrido sin sesión: HTTP 403.
- Variables verificadas después del deployment:
  - `ENNCO_ALLOW_EXTERNAL_SEND=false`
  - `ENNCO_GLOBAL_KILL_SWITCH=true`
  - `ENNCO_GMAIL_WEBHOOK_RELEASED=false`
- Revisión visual autenticada:
  - carril acelerado visible;
  - tres buzones aprobados visibles;
  - requisito obsoleto de cuatro buzones ausente;
  - estados `UNKNOWN`, `WARMING` y `HOLD` visibles.
- DNS público observado el 25 de agosto de 2026:
  - MX de Google Workspace presente;
  - SPF `v=spf1 include:_spf.google.com ~all` presente;
  - DMARC `v=DMARC1; p=none` presente;
  - sin TXT visible en los selectores comunes `google._domainkey` y `default._domainkey`. Esto no demuestra ausencia universal de DKIM porque falta confirmar el selector configurado en Google Admin.

## Hashes locales

```text
11e1f5290140f44e606c5c55d2cfdef3746515053a9d80c6a687cf6795bc96c8  supabase/migrations/202608250029_hybrid_accelerated_outbound.sql
0865e3c81fc5e72f96837d42f672c1b256f0669ae0b52fad4c7db80660b3a5bc  supabase/rollbacks/202608250029_hybrid_accelerated_outbound.down.sql
e0e96b58c8db65a3eaadde49c84bf1d37d25d48dc0a6113122cc90e4854ea097  src/lib/gmail/outbound-client.ts
57323ff0cbebf0cbb7228f28a2345a5ecdbf1bf0213a45f92ef167a268ec0cf6  src/lib/infrastructure/hybrid-outbound.ts
4e2d661f743b3c5cc18c9e5bf95f975cc27adf9429b7cd5ee14eb3167d5df208  src/lib/operations/portal.ts
074314b333cb32c23aef74b292c6ad1fae3459e203dbc3d5373f89daca832ab8  data/infrastructure/hybrid-outbound-baseline-v1.json
ee2c6833bab2965e0e1436a65b57cd83e6951c0acb91aa5d3f050aedd2ff0dd6  data/campaigns/campaign-manifest-hybrid-draft-v1.json
```

## Límite de la evidencia

El deployment se generó desde un worktree coordinado que aún no está ligado a un commit limpio. Por eso esta evidencia no se clasifica como release reproducible. Antes de habilitar OAuth o cargar evidencia live debe crearse un checkpoint Git limpio y volver a capturar hashes.

Siguen sin probarse en producción: DKIM y headers de `contacto@`, seeds Gmail, Outlook y Yahoo, historial humano, blocklists, OAuth/KMS, reply sync menor a cinco minutos, compra de dominios, provisión de buzones, warmup, inventario real, manifiesto de cinco destinatarios y autorización explícita del canary.
