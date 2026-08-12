# M3 Capture and Prequote Architecture

Snapshot: 11 de agosto de 2026, America/Mexico_City.

## Veredicto

- Núcleo M3 local con datos sintéticos: `PASS`.
- M3 global con datos reales: `EXTEND`.
- Publicación, tráfico, DNS y contacto externo: `HOLD`.

El núcleo ejecutable incluye landing, cálculo por rangos, folio, PDF privado, persistencia transaccional, consentimiento versionado, analítica allowlist y aviso de privacidad en borrador. La carga de recibos permanece cerrada porque no existe un scanner aprobado conectado a Storage real.

## Flujo de captura

```text
formulario
  -> validación Zod
  -> cálculo servidor
  -> gate de modelo APPROVED
  -> gate de aviso aprobado
  -> prueba HMAC con nonce, expiry, payload hash y rate key
  -> RPC security definer
  -> lock de idempotencia
  -> rate window
  -> prequote + outbox + audit safe en una transacción
  -> token PDF de 15 minutos
  -> respuesta privada no-store
```

Una precotización nunca crea automáticamente un lead contractual. El resultado conserva `DOES_NOT_COUNT_WITHOUT_HUMAN_EVIDENCE` hasta que exista evidencia humana de los cinco criterios contractuales.

## Modelo

Versión local: `ENNCO-PREQ-2026-08-DRAFT-02`.

Fuentes congeladas:

- 20 proyectos históricos, 18 solares y 2 de mantenimiento.
- Cuatro propuestas comerciales anónimas.
- Ficha oficial LONGi de un módulo de 650 W.
- Metodología oficial CFE para confirmar que la tarifa industrial tiene múltiples componentes.

Hallazgos:

- El mayor proyecto solar entregado en el histórico es 54.825 kWp.
- No existe evidencia histórica entregada que calibre directamente un proyecto de 100 kWp o más.
- Los cuatro casos comerciales quedan dentro de las bandas candidatas de capacidad e inversión.
- Las inconsistencias de fuente se preservan como flags y no se corrigen en silencio.
- La banda industrial se etiqueta como extrapolación.

El modelo no usa precio final, garantía, descuento, fecha de instalación ni beneficio fiscal definitivo. Los demás servicios se enrutan a revisión técnica sin precio automático.

## Persistencia pública

La aplicación no expone una llave service role. El servidor firma cada solicitud con un secreto HMAC. La función de base valida:

- Organización.
- Idempotency key.
- Nonce único.
- Expiración máxima de cinco minutos.
- Hash SHA-256 del payload.
- Rate key incluida en la firma.
- Modelo aprobado y vigente.
- Consentimiento y versión del aviso.
- Rango, forma y allowlists de entrada.
- Integridad tenant-safe del modelo.

El outbox sólo contiene folio, IDs opacos, veredicto, clase de evidencia y correlation ID. No contiene nombre, correo, teléfono, empresa ni cuerpo libre.

## Analítica

Eventos permitidos:

- `DIAGNOSTIC_VIEWED`
- `PREQUOTE_STARTED`
- `PREQUOTE_SUBMITTED`
- `PREQUOTE_SUCCEEDED`
- `PREQUOTE_FAILED`
- `PDF_DOWNLOADED`

Propiedades permitidas:

- `estimate_kind`
- `verdict`
- `error_code`
- `model_version`

Correos, nombres, teléfonos, empresa, UTM libre y propiedades arbitrarias son rechazados. El modo local acepta el evento como `SYNTHETIC_NOT_PERSISTED`. La ruta real permanece cerrada hasta que la superficie pública esté liberada.

## Privacidad

El aviso implementado cubre identidad y domicilio del responsable, datos, finalidades, encargados, transferencias, conservación, seguridad, ARCO, limitación y cambios. Su versión es `2026-08-11-v1`; permanece en borrador mientras no exista aprobación externa. El runtime exige versión y SHA256 exactos del snapshot canónico antes de liberarlo, y el build recalcula ese hash para impedir cambios silenciosos del texto.

La estructura se basó en el artículo 15 del texto vigente de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares. No se declara revisión legal ni cumplimiento certificado.

## Archivos

- `data/prequote/model-draft-v2.json`
- `data/prequote/source-manifest.json`
- `data/prequote/calibration-cases.json`
- `src/lib/domain/prequote.ts`
- `src/app/api/v1/prequotes/route.ts`
- `src/app/api/v1/events/route.ts`
- `src/app/privacidad/page.tsx`
- `supabase/migrations/202608110004_public_prequote_capture.sql`
- `supabase/migrations/202608110005_conversion_analytics.sql`
- `docs/evidence/M3-prequote-model-verification.json`

## Limitaciones pendientes

1. Paco debe aprobar supuestos, bandas, vigencia y versión.
2. ENNCO debe validar legalmente el aviso.
3. Supabase real debe ejecutar forward, rollback, reapply y canary aislado.
4. El secreto HMAC debe existir tanto en vault como en configuración privada de base, con procedimiento de rotación.
5. La carga de documentos requiere Storage real, magic bytes, antivirus y worker service-only.
6. El sitio corporativo actual requiere sus correcciones y medición por separado antes de publicación.
7. Ningún resultado local prueba disponibilidad, leads, pipeline o revenue.
