# Inventario de accesos y proveedores

Fecha de corte: 2026-08-12. Este documento no autoriza compra, alta, conexion ni cambio de credenciales.

## Estado de propiedad

| Componente | Propietario requerido | Estado actual | Evidencia requerida para PASS | Gate |
|---|---|---|---|---|
| Repositorio remoto | ENNCO | UNKNOWN | Organizacion, admin ENNCO, branch protection y export de repositorio | M9 live |
| Supabase | ENNCO | BLOCKED_EXTERNAL | Proyecto, region, DPA, PITR, MFA, RLS y restore | M2 y M9 live |
| Vercel | ENNCO | BLOCKED_EXTERNAL | Proyecto, roles, MFA, variables y rollback | Produccion |
| Google Workspace | ENNCO | BLOCKED_EXTERNAL | Dominios, cuatro buzones, admins, MFA y offboarding | M4 y M6 |
| Google Cloud | ENNCO | BLOCKED_EXTERNAL | Proyecto, billing, Pub/Sub, KMS, IAM y audit logs | M2 y M4 |
| Resend | ENNCO | UNKNOWN | Cuenta, dominio transaccional, DPA, retencion y export | M4 |
| Sentry | ENNCO | UNKNOWN | Organizacion, region, scrub PII, retencion y export | M2 |
| Checkly | ENNCO | UNKNOWN | Cuenta, probes, retencion y export | M4 |
| Telegram | ENNCO | BLOCKED_EXTERNAL | Bot dedicado, canal, rotacion y regla sin PII | Alertas |
| 1Password | ENNCO | UNKNOWN | Vault, admins, recovery y offboarding | Seguridad |
| Apollo | ENNCO | UNKNOWN | Acceso, DPA, creditos, limites y export | Investigacion |
| Google Postmaster | ENNCO | BLOCKED_EXTERNAL | Dominio verificado y cuenta ENNCO | M6 |

## Campos de transferencia obligatorios

Cada componente live debe registrar:

- Owner ENNCO y suplente.
- Owner tecnico Teckel durante soporte.
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

Teckel no se retira de un acceso hasta verificar que un admin ENNCO puede entrar, operar, exportar y recuperar la cuenta. La evidencia de acceso nunca incluye contrasenas, tokens, recovery codes ni capturas con secretos.
