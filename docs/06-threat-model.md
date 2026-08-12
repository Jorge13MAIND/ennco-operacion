# Threat Model v0.1

## Activos críticos

- PII de prospectos.
- Recibos CFE.
- Anexo A y supresiones.
- Tokens Gmail.
- Campaign manifests.
- Evidencia de atribución.
- Datos de pipeline y pagos.

## Límites de confianza

- Navegador público a API.
- Portal autenticado a Supabase.
- Worker a Gmail, Resend y Telegram.
- Pub/Sub a webhook.
- CI/CD a producción.
- Operador humano a acciones comerciales.

## Amenazas y controles

| Amenaza | Control |
|---|---|
| Inyección | Zod, queries parametrizadas, CSP y ASVS |
| Escalamiento de privilegio | RLS, roles y pruebas cruzadas |
| Exfiltración de recibos | Storage privado, signed URL y retención |
| Replay de webhook | Firma, timestamp e idempotency key |
| Doble envío | Lock, unique constraint y outbox |
| Omisión de supresión | Función transaccional fail closed |
| Robo de token Gmail | KMS, rotación y menor privilegio |
| Prompt injection | KB allowlist, herramientas cerradas y evals |
| Abuso de formulario | Honeypot, rate limit y límites de archivo |
| Manipulación de audit log | Append-only y permisos service-only |
| Supply chain | Lockfile, SBOM, dependency y secret scan |

## Pendiente de M2

- Diagrama de flujo con infraestructura real.
- Data processing inventory.
- Riesgo por proveedor y región.
- Revisión legal de retención y base de tratamiento.
