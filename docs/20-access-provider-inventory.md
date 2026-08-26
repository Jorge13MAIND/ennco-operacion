# Inventario de accesos y proveedores

Fecha de corte: 2026-08-13. Este documento no autoriza compra, alta, conexion ni cambio de credenciales.

## Estado de propiedad

| Componente | Propietario requerido | Estado actual | Evidencia requerida para PASS | Gate |
|---|---|---|---|---|
| Repositorio remoto | ENNCO | UNKNOWN | Organizacion, admin ENNCO, branch protection y export de repositorio | M9 live |
| Supabase | Teckel managed | IN_PROGRESS | Proyecto aislado, region, DPA, PITR, MFA, RLS, export y restore | M2 y M9 live |
| Vercel | Teckel managed | IN_PROGRESS | Proyecto aislado, roles, MFA, variables, export y rollback | Produccion |
| Google Workspace | ENNCO | BLOCKED_EXTERNAL | Dominios, cuatro buzones, admins, MFA y offboarding | M4 y M6 |
| Google Cloud | ENNCO | BLOCKED_EXTERNAL | Proyecto, billing, Pub/Sub, KMS, IAM y audit logs | M2 y M4 |
| Resend transaccional | ENNCO | OPTIONAL | Cuenta, dominio transaccional, DPA, retencion, export y confirmacion de uso sin cold outreach | M4 |
| Sentry | ENNCO | UNKNOWN | Organizacion, region, scrub PII, retencion y export | M2 |
| Checkly | ENNCO | UNKNOWN | Cuenta, probes, retencion y export | M4 |
| Telegram | ENNCO | BLOCKED_EXTERNAL | Bot dedicado, canal, rotacion y regla sin PII | Alertas |
| 1Password | ENNCO | UNKNOWN | Vault, admins, recovery y offboarding | Seguridad |
| Apollo enriquecimiento | ENNCO | OPTIONAL_RECOMMENDED | Acceso, DPA, creditos, limites, export y aislamiento del sender | Investigacion |
| Google Postmaster | ENNCO | BLOCKED_EXTERNAL | Dominio verificado y cuenta ENNCO | M6 |

## Campos de transferencia obligatorios

Cada componente live debe registrar:

- Owner técnico Teckel.
- Responsable de facturación y recuperación Teckel.
- Cuenta y region.
- MFA.
- Roles y ultimo recertificado.
- Ubicacion del secreto, sin copiar el secreto.
- DPA, subprocesadores y retencion.
- Metodo de export y baja.
- Billing owner.
- Evidencia SHA256.
- Fecha de transferencia.
- Resultado `PASS`, `EXTEND` o `KILL`.

## Regla de salida

Vercel y Supabase permanecen administrados por Teckel. La continuidad se acepta únicamente con export de código y datos, restore probado, runbooks y recuperación documentada. La evidencia de acceso nunca incluye contrasenas, tokens, recovery codes ni capturas con secretos.
