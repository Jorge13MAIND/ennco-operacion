# M3 Gate Report

Snapshot: 11 de agosto de 2026, America/Mexico_City.

## Veredicto

- Núcleo M3 local con datos sintéticos: `PASS`.
- M3 global para datos reales y publicación: `EXTEND`.
- Actividad comercial real: `0`.
- Leads contractuales reales: `0`.
- Pipeline estricto real: `0`.
- Revenue atribuido: `0 MXN`.
- Efectos externos: `0`.

El PASS local cubre landing, cálculo servidor, folio, PDF, contrato de persistencia, consentimiento versionado, analítica sin PII y QA visual. No cubre aprobación técnica, revisión legal, carga de recibos, Supabase administrado, credenciales, publicación o tráfico.

## Gates

| Gate | Local | Global | Evidencia o blocker |
|---|---|---|---|
| Landing de tres pasos | PASS | EXTEND | QA en cinco viewports; no publicada |
| Modelo versionado | PASS técnico | EXTEND | Estado `DRAFT_REVIEW_REQUIRED`; falta aprobación de Paco |
| Backtest | PASS | EXTEND | 4 de 4 casos dentro de bandas; no hay histórico de 100 kWp o más |
| PDF privado | PASS | EXTEND | Token HMAC, expiry, no-store y render visual; falta canary administrado |
| Persistencia | PASS | EXTEND | PostgreSQL 16 local; falta Supabase real |
| Idempotencia y replay | PASS | EXTEND | Nonce, lock, unique key y pruebas adversariales locales |
| Analítica | PASS | EXTEND | Allowlist sin PII local; falta Supabase real |
| Aviso de privacidad | PASS estructural | EXTEND | Versión draft, producción fail closed; falta legal |
| Carga de recibos | HOLD seguro | EXTEND | UI deshabilitada; falta antivirus y Storage real |
| Sitio corporativo actual | NOT_STARTED | EXTEND | Requiere checkpoint separado y no se tocó código ajeno |

## Comandos ejecutados

```bash
node scripts/verify-prequote-model.mjs --repo . --write-evidence \
  --source "SRC-HISTORY-001=/Users/Jorge/Downloads/clientes....xlsx" \
  --source "SRC-PROPOSAL-001=/Users/Jorge/Downloads/2.0 PROPUESTA Portales.pdf" \
  --source "SRC-PROPOSAL-002=/Users/Jorge/Downloads/2.0 PROPUESTA Vallejo.pdf" \
  --source "SRC-PROPOSAL-003=/Users/Jorge/Downloads/ENNCO - PROPUESTA TOYOTA GUANAJUATO.pdf" \
  --source "SRC-PROPOSAL-004=/Users/Jorge/Downloads/ENNCO - PROPUESTA DE PROYECTO vol.2.pptx"

supabase/tests/run-prequote-gate.sh
supabase/tests/run-analytics-gate.sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
node scripts/capture-m3-browser-evidence.mjs --repo . --base-url http://localhost:3000
pdftoppm -png -r 150 -singlefile \
  docs/evidence/M3-prequote-reference-synthetic.pdf \
  docs/evidence/M3-prequote-reference-synthetic-render
```

Resultados observados:

```text
PREQUOTE_MODEL_GATE_PASS 25/25
PUBLIC_PREQUOTE_CAPTURE_GATE_PASS
PUBLIC_PREQUOTE_CAPTURE_ROLLBACK_PASS
PUBLIC_PREQUOTE_CAPTURE_REAPPLY_PASS
CONVERSION_ANALYTICS_GATE_PASS
CONVERSION_ANALYTICS_ROLLBACK_PASS
CONVERSION_ANALYTICS_REAPPLY_PASS
LINT_PASS
TYPECHECK_PASS
UNIT_PASS files=12 tests=46
BUILD_PASS routes=12
E2E_PASS tests=55 profiles=5
M3_BROWSER_EVIDENCE_PASS diagnostic=2 privacy=1 pdf=1
```

Cada comando terminó con exit code `0`. La primera captura posterior al build agotó el timeout de `networkidle` por el cliente de analítica. El capturador se corrigió para esperar `domcontentloaded` y headings explícitos. La segunda corrida terminó con exit code `0`.

## Evidencia

- `docs/evidence/M3-prequote-model-verification.json`
- `docs/evidence/M3-diagnostic-desktop.png`
- `docs/evidence/M3-diagnostic-mobile.png`
- `docs/evidence/M3-prequote-reference-synthetic.pdf`
- `docs/evidence/M3-prequote-reference-synthetic-render.png`
- `docs/evidence/M3-privacy-draft-desktop.png`
- `supabase/tests/004_public_prequote_capture_gate.sql`
- `supabase/tests/005_conversion_analytics_gate.sql`
- `src/lib/domain/prequote.test.ts`
- `src/lib/prequote/pdf.test.ts`
- `src/lib/analytics/events.test.ts`
- `tests/e2e/surfaces.spec.ts`

## Hallazgos de QA cerrados

1. La primera versión subestimaba inversión al mezclar supuestos no auditados. Se reemplazó por bandas basadas en histórico y propuestas.
2. El histórico no tiene proyectos de 100 kWp o más. La salida industrial ahora dice extrapolación.
3. El PDF mostraba enums internos y el nombre de Paco al prospecto. Se reemplazaron por lenguaje ENNCO.
4. Una limitación del PDF se cortaba con puntos suspensivos. Se implementó wrap medido por fuente.
5. El consentimiento no registraba la versión del aviso. Ahora se almacena junto con el timestamp.
6. La analítica podía aceptar propiedades arbitrarias si se implementaba como un endpoint genérico. Se cerró a cuatro propiedades sin PII.

## Blockers

1. Aprobación técnica de Paco del modelo, bandas, vigencia y defaults.
2. Revisión legal y aprobación de la versión final del aviso.
3. Staging Supabase aislado con migraciones y canary.
4. Vault, secreto HMAC y rotación probada.
5. Antivirus y Storage real para abrir recibos.
6. Aprobación separada para modificar y publicar el sitio corporativo.
7. Compras, DNS, producción y tráfico siguen sin autorización.

Estos blockers no impiden construir M4 en local. Sí impiden aceptar M3 global o usar datos reales.
