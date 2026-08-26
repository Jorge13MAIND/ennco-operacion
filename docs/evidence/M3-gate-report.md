# M3 Gate Report

Snapshot: 20 de agosto de 2026, America/Mexico_City.

## Veredicto

- Modelo de precotización `ENNCO-PREQ-2026-08-PACO-01`: `APPROVED` por Paco.
- Núcleo M3 local con datos sintéticos: `PASS`.
- M3 global para datos reales y publicación: `EXTEND`.
- Actividad comercial real: `0`.
- Leads contractuales reales: `0`.
- Pipeline estricto real: `0`.
- Revenue atribuido: `0 MXN`.
- Efectos externos: `0`.

El PASS local cubre landing, cálculo servidor, folio, PDF, modelo versionado, referencias comerciales, contrato de persistencia, consentimiento versionado, analítica sin PII y QA visual. No cubre revisión legal, carga de recibos, Supabase administrado, credenciales, publicación o tráfico real.

## Parámetros congelados

- Tarifa efectiva: 2.80 a 3.35 MXN/kWh.
- Producción mensual: 120 a 165 kWh/kWp/mes.
- Potencia de módulos: 620 a 650 Wp.
- Superficie: 5.2 a 7.3 m2/kWp.
- Inversión menor a 30 kWp: 18,000 a 29,000 MXN/kWp.
- Inversión desde 30 kWp y menor a 100 kWp: 17,000 a 24,000 MXN/kWp.
- A partir de 100 kWp: sin rango automático de inversión y con revisión técnica y comercial obligatoria.
- Precio de arranque: 11,000 MXN por módulo instalado.
- Pago de contado: 3% a 6% sujeto al contrato final.
- Garantía de referencia: 24 meses por vicios ocultos, sujeta al contrato final.
- Precio contractual y fecha de instalación: nunca automáticos.

## Gates

| Gate | Local | Global | Evidencia o blocker |
|---|---|---|---|
| Landing de tres pasos | PASS | EXTEND | QA desktop y mobile; staging sintético |
| Modelo versionado | PASS | EXTEND | Aprobación de Paco ligada a fuente y SHA256; falta canary con datos reales |
| Valores límite | PASS | EXTEND | Menor a 30, desde 30 y corte de 100 kWp probados |
| Backtest | PASS | EXTEND | 4 de 4 casos dentro de bandas; sin histórico propio suficiente para 100 kWp o más |
| PDF privado | PASS | EXTEND | Una página, sin PII de contacto, no-store y render visual; falta canary administrado |
| Persistencia | PASS | EXTEND | PostgreSQL 16 local; falta Supabase real |
| Idempotencia y replay | PASS | EXTEND | Nonce, lock, unique key y pruebas adversariales locales |
| Analítica | PASS | EXTEND | Allowlist sin PII local; falta Supabase real |
| Aviso de privacidad | PASS estructural | EXTEND | Producción fail closed; falta aprobación legal |
| Carga de recibos | HOLD seguro | EXTEND | UI deshabilitada; falta antivirus y Storage real |
| Demo Vercel | PASS | EXTEND | `https://ennco-operacion.vercel.app`; sintético, noindex, kill switch activo y sin envíos |
| Sitio corporativo actual | NOT_STARTED | EXTEND | Requiere checkpoint separado y no se tocó código ajeno |

## Resultados observados

```text
PREQUOTE_MODEL_GATE_PASS 31/31
PUBLIC_PREQUOTE_CAPTURE_GATE_PASS
PUBLIC_PREQUOTE_CAPTURE_ROLLBACK_PASS
PUBLIC_PREQUOTE_CAPTURE_REAPPLY_PASS
CONVERSION_ANALYTICS_GATE_PASS
CONVERSION_ANALYTICS_ROLLBACK_PASS
CONVERSION_ANALYTICS_REAPPLY_PASS
LINT_PASS
TYPECHECK_PASS
UNIT_PASS files=52 tests=244
BUILD_PASS routes=42
GENERAL_E2E_PASS tests=251 skipped=9
PRODUCTION_CSP_PASS tests=5
M3_BROWSER_EVIDENCE_PASS diagnostic=2 privacy=1 pdf=1
VERCEL_DEPLOY_PASS ready=true target=preview
VERCEL_LIVE_CANARY_PASS tests=2
RTM_PASS rows=99 checklist=47/47
SECRETS_PASS files=542 findings=0
```

La suite general usa `next dev`, por lo que la aserción de nonce CSP exacto se clasifica como no aplicable en esa ejecución. El mismo control se ejecutó contra `next start` y pasó en cinco perfiles.

## Evidencia

- `data/prequote/paco-approved-parameters-2026-08-20.json`
- `data/prequote/model-approved-v3.json`
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

## Hallazgos cerrados

1. El modelo anterior estaba en revisión. Se reemplazó por la versión aprobada y fechada por Paco.
2. El sistema ya no extrapola inversión para proyectos de 100 kWp o más.
3. Los rangos que cruzan el corte de 30 kWp usan el precio correcto en cada extremo.
4. Garantía, descuento, precio de arranque, precio contractual y fecha quedan visibles, pero no se convierten en compromisos automáticos.
5. El PDF y la interfaz muestran el mismo modelo, versión, disclaimer y regla industrial.
6. El PDF no contiene nombre, correo ni teléfono del solicitante.

## Blockers globales

1. Revisión legal y aprobación final del aviso de privacidad.
2. Staging Supabase aislado con migraciones y canary.
3. Vault, secreto HMAC y rotación probada.
4. Antivirus y Storage real para abrir recibos.
5. Aprobación separada para modificar y publicar el sitio corporativo.
6. Compras, DNS, datos reales, producción y tráfico siguen sujetos a sus gates.

Estos blockers no impiden desplegar la demostración sintética privada. Sí impiden aceptar M3 global o usar datos reales.
