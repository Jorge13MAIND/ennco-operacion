# Evidencia local M24 y M25

Fecha de verificación: 2026-08-20, America/Mexico_City.

## Dictamen

`PASS_LOCAL` para los controles M24 y M25. El programa comercial conserva estado global `EXTEND` y la autorización efectiva conserva `HOLD`.

No se compraron dominios, buzones, licencias o infraestructura. No se modificó DNS. No se crearon cuentas de proveedores. No se importaron datos a producción. No se inscribieron contactos ni se enviaron mensajes.

El commit base observado fue `f35c77a8140e954712432d0921ad76dabb1d8f06`. El árbol contiene la implementación autorizada sin commit, por lo que esta evidencia no es todavía un artefacto de release ligado a un commit final.

## Gate integral

Comando:

```bash
npm run verify:m24
```

Resultado, exit code 0:

- Baseline de proveedor: `PASS`, Apollo Professional mensual, propietario ENNCO, dos dominios objetivo, cuatro buzones objetivo, 42 días y cap de 500 créditos.
- Anexo A: `PASS`, 3 empresas, 12 alias, 6 dominios y hash de snapshot `8e986eff74dee10d3f619f7562ee6b7d18207c3c5e080cd82656cc0e88d46af1`.
- Aviso de privacidad: paquete válido, aprobación `AWAITING_ENNCO_AND_LEGAL_REVIEW`, publicación y envío en falso.
- M23 warmup: forward, rollback, reapply y diff `PASS`.
- M24 infraestructura de proveedor: forward, rollback, reapply, diff y script `PASS`.
- M25 supresión transaccional: forward, rollback, reapply, diff y script `PASS`.
- RTM: 99 filas, checklist 47 de 47, 7 requisitos enterprise todavía abiertos.
- TypeScript: `PASS`.
- ESLint: `PASS`, cero warnings.
- Vitest: 56 archivos y 262 pruebas `PASS`.
- Build Next.js de producción: `PASS`.

## Controles implementados

M24 registra y valida propiedad, plan, MFA, términos, presupuesto, renovación, administradores, dos dominios independientes, cuatro buzones, identidad Francisco Cuellar, warmup de 42 días, cap de créditos, quince gates y autorización efectiva separada de la configuración técnica.

M25 importa únicamente el snapshot congelado del Anexo A. Verifica las tres empresas, alias y dominios, persiste identidades con HMAC por tenant, bloquea cuentas y dominios, detiene enrollments existentes y bloquea cualquier salida si el manifiesto no existe o no coincide.

La reconciliación Apollo exige lectura individual por email exacto, exactamente un contacto, exactamente un enrollment, estado `PAUSED`, binding de secuencia y buzón y evidencia fresca. Los contadores agregados no autorizan nada.

## Preview Vercel

Proyecto observado: `jorge13mainds-projects/ennco-operacion`.

Deployment:

- ID: `dpl_7PUV5bHPUysHLjUhTt22GmtXN6VD`.
- Target: `preview`.
- Estado: `Ready`.
- URL: `https://ennco-operacion-uli8ov8n2-jorge13mainds-projects.vercel.app`.
- Configuración: `staging`, `synthetic_demo`, sin Supabase y sin efectos externos.

La primera compilación remota sin modo demo falló con `DEDICATED_SUPABASE_REQUIRED_OUTSIDE_DEMO`. Esto prueba que el despliegue no cae silenciosamente a una base compartida. El segundo intento usó configuración efímera de preview y quedó `Ready`.

Verificación HTTP:

- `/`: 200.
- `/operacion`: 200.
- `/operacion/infraestructura`: 200.
- `/api/v1/operations/infrastructure/readiness`: 200.
- API: `UNKNOWN`, `HOLD`, 0 de 2 dominios, 0 de 4 buzones, 0 de 42 días y 0 de 15 gates.
- Headers: CSP con nonce, HSTS, `frame-ancestors 'none'` y `X-Robots-Tag: noindex, nofollow, noarchive`.

Captura: `docs/evidence/M24-provider-infrastructure-preview.png`.

SHA256 de captura: `d36dcff21a0155a19322edcf68109fa6033698a3db37edc9483193f8ffb3e494`.

## Checksums principales

- M24 migration: `ed0a210c2a1f42acb0d51e62b12102bf573e8b40a555a2e188c1ec0f5aca9b40`.
- M25 migration: `5c47152b8996d1bd59786fa7347dddfa7dd536f6f08eae6a2f0bb8afa048924d`.
- Baseline M24: `ebc99975a0799ca1d421769f3e51d2bd2135d1656fa4f25ed36081f5f0dc8229`.
- Fuente JSON Anexo A: `9392e243a3e5884e4d2e3dacff1a93257e3c289d5283c3d5bf63ba8b8a6e0e9e`.

## Bloqueos externos

- Cuenta Apollo Professional mensual propiedad de ENNCO.
- Dos dominios y cuatro usuarios de Google Workspace.
- Cuentas ENNCO de Vercel, Supabase, Google Cloud, Resend, Sentry y Checkly.
- Contrato ejecutado y certificado archivados localmente.
- Aprobación legal del aviso de privacidad.
- Operador suplente.
- DNS, OAuth, MFA, warmup, seed tests y reply sync reales.
- Inventario real de 75 empresas y 150 contactos verificados.
- Aprobación de copy y aprobación explícita del piloto.

La URL de preview actual pertenece a la cuenta personal observada. No satisface la propiedad ENNCO ni sustituye staging o producción administrados.
