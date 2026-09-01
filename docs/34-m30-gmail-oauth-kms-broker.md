# M30. Broker Gmail OAuth y KMS

## Estado

`DEPLOYED_HOLD`. El broker, la bóveda y los gates adversariales están implementados. La migración M30 está aplicada y registrada en el Supabase productivo; las rutas están desplegadas en Vercel con `ENNCO_GMAIL_OAUTH_RELEASED=false`. La conexión live permanece `HOLD` porque no existen todavía un cliente OAuth liberado, una clave KMS accesible desde el runtime ni una sesión de Google Admin ENNCO para DKIM.

M30 no envía correos, no crea credenciales de Google Cloud y no cambia el kill switch.

La evidencia de despliegue y verificación está en `docs/evidence/M30-gmail-oauth-kms-gate-report.md`.

## Contrato

El carril acelerado sólo admite `contacto@ennco.com.mx` y exige:

- sesión ENNCO live con MFA;
- PKCE S256;
- estado aleatorio con vigencia máxima de diez minutos;
- cookie cifrada, `HttpOnly`, `Secure` y `SameSite=Lax`;
- scopes exactos `openid`, `email`, `gmail.readonly` y `gmail.send`;
- identidad Google verificada e igualdad exacta con el buzón;
- refresh token presente para acceso offline;
- cifrado en Google Cloud KMS antes de persistir;
- ciphertext, versión KMS, identidad hasheada y checksum ligados;
- idempotencia de inicio y finalización;
- auditoría y outbox sin token, email, subject de Google ni ciphertext.

## Persistencia

La migración `supabase/migrations/202608250030_gmail_oauth_kms_broker.sql` crea:

- `gmail_oauth_authorizations`, sólo conserva hash de state y challenge PKCE;
- `gmail_oauth_credentials`, bóveda RLS sin acceso directo para `authenticated` ni `service_role`;
- `gmail_oauth_commands`, ledger idempotente sin secretos;
- RPCs AAL2 para iniciar, finalizar y leer readiness;
- bloqueo permanente de `mailboxes.encrypted_refresh_token`.

El refresh token crudo sólo vive en memoria durante el callback. El callback cifra primero en KMS y después llama a Supabase con ciphertext.

## Release fail closed

`ENNCO_GMAIL_OAUTH_RELEASED=false` es el valor predeterminado. Para habilitar el flujo deben existir todos:

- `GOOGLE_OAUTH_CLIENT_ID`;
- `GOOGLE_OAUTH_CLIENT_SECRET`;
- `GOOGLE_OAUTH_REDIRECT_URI`, exactamente en el mismo origen del portal y path canónico;
- `GOOGLE_KMS_KEY_NAME`;
- `ENNCO_GMAIL_OAUTH_STATE_SECRET`;
- `ENNCO_GMAIL_OAUTH_COMPLETION_SECRET`, compartido sólo entre el runtime y `app.private_runtime_config` para atestación HMAC;
- Application Default Credentials con permiso de cifrado KMS;
- Supabase dedicado y modo no demo.

La ruta de inicio responde `503 GMAIL_OAUTH_NOT_RELEASED` mientras falte cualquiera. Eso no degrada el portal ni habilita envíos.

## Verificación

```bash
npm run verify:gmail-oauth-kms-db
npm test -- --run src/lib/gmail/oauth.test.ts src/lib/runtime/config.test.ts src/app/api/v1/operations/infrastructure/gmail/oauth/oauth-routes.test.ts
npm run typecheck
npm run lint
```

El gate DB prueba AAL1, tenant cruzado, DML directo, service role, legacy token, actor distinto, hash falso, idempotencia, concurrencia, rollback fail closed, reapply y ausencia de ciphertext en audit/outbox.

## Pendientes externos exactos

> **CORRECCIÓN 31-ago-2026.** Esta lista se escribió cuando el canal iba a
> salir del buzón del cliente. Desde el 29-ago **el cliente y su dominio están
> fuera del programa**: los envíos salen de los tres buzones aislados en
> dominios de Teckel. Los pasos 1, 2 y 6 ya no aplican tal como estaban.

1. ~~Entrar a Google Admin del Workspace de ENNCO~~ → **Ya no aplica.** El
   Workspace relevante es el nuevo, en dominios de Teckel, admin
   `francisco@enncoenergia.com`.
2. ~~Generar DKIM de `ennco.com.mx`~~ → **Ya hecho donde importa.** DKIM 2048
   publicado y respondiendo en `enncoindustrial.com` y `enncoenergia.com`,
   verificado por DNS. El DKIM del dominio del cliente salió del alcance.
3. Crear proyecto Google Cloud, pantalla de consentimiento interna, cliente
   OAuth web y callback exacto. **Parcialmente hecho:** el proyecto
   `august-beaker-478801-t3` existe y `GOOGLE_OAUTH_CLIENT_ID` está en Vercel;
   falta el client secret, que **no existe hoy en el ambiente** (verificado).
4. Crear key ring y CryptoKey KMS, luego conceder sólo
   `cloudkms.cryptoKeyEncrypterDecrypter` al runtime autorizado. **Bloqueado
   por facturación:** el proyecto no tiene cuenta de facturación vinculada.
5. Configurar variables en Vercel y mantener `ENNCO_GMAIL_OAUTH_RELEASED=false`
   hasta una revisión final.
6. ~~Consentimiento de `contacto@ennco.com.mx`~~ → **Ya no aplica.** El
   consentimiento va sobre los tres buzones aislados, y ocurre después del
   calentamiento, no antes.

Los pasos 3 y 4 cambian cuentas y seguridad externas. Requieren la sesión
correcta y confirmación en el momento de ejecutarlos.
