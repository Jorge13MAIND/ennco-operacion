# Threat Model v0.2

Snapshot: 11 de agosto de 2026, America/Mexico_City.

Estado: `EVIDENCE_READY` para sistema local sintético. Riesgo de producción: `EXTEND`.

## Estados

- `VERIFIED`: control inspeccionado en código, migración o prueba local.
- `UNKNOWN`: control o contexto sin evidencia suficiente.
- `BLOCKED_EXTERNAL`: depende de proveedor, legal, cuenta, credencial, DNS o aprobación externa.

## Activos críticos

- PII profesional de prospectos y usuarios.
- Recibos CFE y resultados de precotización.
- Anexo A, clientes actuales, bajas, rebotes y DNC.
- Tokens Gmail, service role, KMS y secretos de proveedores.
- Campaign manifests, secuencias y aprobaciones.
- Evidencia de atribución, pipeline, propuestas, pagos y comisión.
- Audit log, incidentes, outbox, dead letters y backups.
- Reputación de dominios y buzones ENNCO.

## Actores y abuso

- Visitante público legítimo o abusivo.
- Prospecto y contacto empresarial.
- Operador ENNCO o Teckel con error o intención maliciosa.
- Auditor de sólo lectura.
- Servicio externo, webhook o dependencia comprometida.
- Atacante con credencial filtrada.
- Contenido hostil en archivo, email, página investigada o prompt.

## Límites de confianza

- Navegador público a API.
- Portal autenticado a claims y RLS.
- API y worker a service role.
- PostgreSQL a Storage privado.
- Worker a Gmail, Pub/Sub, KMS, Resend y Telegram.
- Aplicación a Sentry y Checkly.
- CI/CD a infraestructura.
- Base y Storage a backups.
- Operador humano a acción comercial o exportación.

El dataflow y estado de cada zona están en `docs/12-m2-architecture.md`. Las finalidades y categorías están en `docs/10-data-processing-inventory.md`.

## Amenazas y controles

| ID | Amenaza | Impacto | Control esperado | Estado | Gate |
|---|---|---|---|---|---|
| TM-01 | SQL, XSS, CSRF o command injection | Acceso o mutación no autorizada | Zod, queries parametrizadas, CSP, same-site, ASVS y tests | VERIFIED para validación base; UNKNOWN para DAST completo | M2 |
| TM-02 | Escalamiento o fuga cross-tenant | Exposición entre organizaciones | `organization_id`, RLS, integridad de FK lógica y pruebas por rol | VERIFIED en PG16 local; BLOCKED_EXTERNAL para Auth real | P0 producción |
| TM-03 | Service role expuesto al navegador | Control total de datos | Sólo servidor, vault, rotación y secret scan | VERIFIED por diseño local; BLOCKED_EXTERNAL para vault | P0 producción |
| TM-04 | Credenciales expuestas en WhatsApp | Toma de cuenta, DNS o correo | Revocación, rotación, MFA y vault | BLOCKED_EXTERNAL | P0 producción |
| TM-05 | Omisión de Anexo A o supresión | Contacto prohibido y disputa contractual | Supresión transaccional fail closed y snapshot reciente | VERIFIED local; BLOCKED_EXTERNAL para Anexo A | P0 outreach |
| TM-06 | Retry o webhook duplicado | Doble envío o doble lead | Idempotency key, unique constraints, provider event ID y locks | VERIFIED local | M1 |
| TM-07 | Mensaje real sin autorización | Daño reputacional y legal | External send false, kill switches, manifest, approval, canary y mailbox gates | VERIFIED local; BLOCKED_EXTERNAL para release | P0 outreach |
| TM-08 | Exfiltración de recibo o PDF | Exposición de datos energéticos | Storage privado, checksum, signed URL, retención y mínimo privilegio | VERIFIED en PostgreSQL local con stubs; BLOCKED_EXTERNAL para Storage real | P0 producción |
| TM-09 | Archivo malicioso o polyglot | Malware o explotación del procesador | Allowlist real, magic bytes, antivirus, cuarentena y sandbox | VERIFIED para magic bytes y cuarentena local; UNKNOWN para antivirus real | P0 upload live |
| TM-10 | Replay o webhook falsificado | Evento o baja falsa | Firma, timestamp, audience, nonce e idempotencia | VERIFIED para ID único; BLOCKED_EXTERNAL para proveedor | P0 integración |
| TM-11 | Robo o uso excesivo de OAuth | Lectura o envío de correo | KMS, scopes mínimos, rotación y mailbox kill switch | BLOCKED_EXTERNAL | P0 Gmail |
| TM-12 | Prompt injection o fuga por asistente | Claim falso o exfiltración de KB | KB allowlist, herramientas cerradas, refusal y evals | VERIFIED como fail closed; UNKNOWN para modelo live | M4 |
| TM-13 | Abuso de formulario | Costos, spam o agotamiento | Honeypot, rate limit, tamaño, cuotas y prueba de carga | VERIFIED en contrato local; UNKNOWN en edge real | M3 |
| TM-14 | Audit log manipulado | Pérdida de trazabilidad | Append-only, trigger y permisos service-only | VERIFIED local | M1 |
| TM-15 | Audit log duplica PII y mensajes | Retención excesiva y borrado imposible | Allowlist de campos, redacción, cifrado y política por clase | VERIFIED local, `P0-PRIV-001` cerrado en migración y pruebas | M2 |
| TM-16 | PII en outbox, DLQ, alerta o observabilidad | Exposición a más proveedores | Payload por ID, scrub, destination hash y tests no-PII | VERIFIED en funciones actuales limitadas; UNKNOWN para workers futuros | P0 integración |
| TM-17 | Borrado no propagado a backup o proveedor | Dato reaparece o persiste | Tombstone, deletion batch, provider confirmation y restore drill | VERIFIED local para transacción y tombstone; BLOCKED_EXTERNAL para backup y proveedor | P0 producción |
| TM-18 | Legal hold demasiado amplio o sin control | Retención indebida o destrucción de evidencia | Registro con alcance, autoridad, expiración y revisión | VERIFIED local para contacto y cuatro ojos; BLOCKED_EXTERNAL para autoridad legal | M2 |
| TM-19 | Región, DPA o subprocesador no aprobado | Transferencia no evaluada | Gate de proveedor, DPA, región, lista de subprocesadores y export | BLOCKED_EXTERNAL | P0 proveedor |
| TM-20 | Backup ausente o irrecuperable | Pérdida de datos y operación | PITR, copia Storage, cifrado, checksum y restore separado | BLOCKED_EXTERNAL | P0 producción |
| TM-21 | Dependencia o build comprometido | Supply-chain attack | Lockfile, branch protection, SAST, SBOM y provenance | VERIFIED para lockfile y CI base; UNKNOWN para SLSA completo | M2 |
| TM-22 | Datos sintéticos confundidos con live | Métricas o decisiones falsas | `evidence_class`, banners y cero efectos externos | VERIFIED en golden path y E2E | M1 |
| TM-23 | Investigación inferida guardada como hecho | Contacto incorrecto o claim falso | Fuente, observed_at, confianza y cuarentena | VERIFIED en esquema e importación | M2 |
| TM-24 | Exportación masiva por rol legítimo | Exfiltración interna | Export gate, mínimo privilegio, watermark y audit event | UNKNOWN | P0 portal live |
| TM-25 | Canal de incidente filtra PII | Segunda exposición durante respuesta | Plantilla sin PII, incident ID y canal seguro | VERIFIED como runbook; BLOCKED_EXTERNAL para canal | P0 producción |

## Riesgos prioritarios

### P0-PRIV-001: audit log con filas completas, cerrado localmente

La migración `202608110002_secure_document_storage.sql` reemplaza la serialización completa por una allowlist por tabla. También sanea snapshots anteriores sin reintroducir el serializador inseguro durante rollback.

Evidencia local:

1. Valores centinela de cuerpo, asunto, correo y razón no aparecen en `old_data` ni `new_data`.
2. Los campos operativos permitidos permanecen auditables.
3. Los snapshots inseguros previos son saneados al aplicar la migración.
4. La bitácora sigue append-only para usuarios.

La integración contra Supabase real y la política final de retención siguen pendientes, pero este riesgo concreto ya no bloquea el código local.

### P0-UPLOAD-001: archivo sin antivirus real

La aplicación valida magic bytes, tamaño y tipo; la base exige path opaco, checksum y cuarentena. Ningún objeto se libera hasta registrar `malware=false` y checksum verificado. Falta un motor antivirus real, por lo que los uploads live siguen bloqueados.

### P0-VENDOR-001: tratamiento externo desconocido

Supabase, Google, Resend, Telegram, Sentry, Checkly y el proveedor del asistente no tienen región, DPA, subprocesadores, retención, borrado o cuenta ENNCO verificados. Ninguno puede recibir datos reales.

### P0-SECRET-001: secretos expuestos

Los exports de WhatsApp contienen credenciales. No fueron reproducidas ni usadas. Deben revocarse o rotarse antes de conectar infraestructura.

## Controles por fase

### Antes de datos reales

- Revalidar la allowlist del audit log en staging real.
- Auth y RLS probados con claims reales.
- Aviso de privacidad y base legal revisados.
- DPA, región y subprocesadores aprobados.
- Upload con antivirus, cuarentena y borrado.
- Vault, MFA y rotación.
- Job de retención y legal hold.
- Backup y restore con tombstones.

### Antes de outreach

- Anexo A recibido, hasheado y conciliado.
- Manifest y sequence hash aprobados.
- Kill switches y supresión probados en ambiente real.
- SPF, DKIM, DMARC, TLS, reputación y canary PASS.
- Reply, bounce y unsubscribe reconciliados.
- Runbook y on-call activos.

### Antes de producción

- SAST, DAST, dependency y secret scan.
- SBOM por release.
- Pruebas de rol, upload, webhook, retry, backup, restore y borrado.
- Observabilidad sin PII.
- Incident drill P0.
- Cero riesgos P0 abiertos.

## Evidencia y limitaciones

- `docs/evidence/M1-gate-report.md` prueba golden path sintético, idempotencia, supresión, kill switch, RLS local y DLQ.
- `supabase/migrations/202608110001_core.sql` prueba intención implementada del esquema, no operación Supabase administrada.
- `docs/04-bill-of-materials.md` mantiene proveedores en `UNKNOWN` o `BLOCKED`.
- `docs/11-retention-policy.md` documenta defaults y la migración 003 prueba ejecución local sintética.
- `docs/runbooks/incident-response.md` documenta respuesta, no prueba on-call de producción.

## Gate

Threat model local: `PASS`.

Threat model para datos reales y producción: `EXTEND` por P0-UPLOAD-001, P0-VENDOR-001, P0-SECRET-001 y controles externos aún no verificados.
