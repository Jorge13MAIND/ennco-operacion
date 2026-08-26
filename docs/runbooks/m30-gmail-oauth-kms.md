# Runbook M30. Gmail OAuth y KMS

## Preparación

1. Confirmar `ENNCO_ALLOW_EXTERNAL_SEND=false` y `ENNCO_GLOBAL_KILL_SWITCH=true`.
2. Confirmar que M30 está aplicado y `evaluate_gmail_oauth_readiness` devuelve `UNKNOWN`.
3. Crear el cliente OAuth web con callback exacto del ambiente.
4. Confirmar que el client secret definitivo nunca apareció en conversación, logs, capturas o evidencia. Si apareció, deshabilitarlo y rotarlo antes de continuar.
5. Crear la clave KMS y permisos mínimos para el runtime.
6. Configurar secretos sin pegarlos en tickets, logs o documentación.
7. Verificar que `GOOGLE_OAUTH_CLIENT_SECRET` sólo exista en el proveedor de secretos del runtime y nunca en Supabase, Git o archivos locales.
8. Mantener `ENNCO_GMAIL_OAUTH_RELEASED=false` hasta desplegar y probar el endpoint cerrado.

## Enlace

1. Activar `ENNCO_GMAIL_OAUTH_RELEASED=true` sólo en el ambiente aprobado.
2. Iniciar el flujo desde una sesión live con MFA.
3. Elegir exactamente `contacto@ennco.com.mx` en Google.
4. Rechazar si Google muestra otra identidad o scopes distintos.
5. Confirmar que el callback termina en `gmail_oauth=connected`.
6. Confirmar readiness `READY`, ciphertext presente sólo en la bóveda y legacy token `NULL`.

## Prueba posterior

1. Ejecutar una seed controlada, nunca un prospecto.
2. Verificar `From`, `Reply-To`, SPF, DKIM, DMARC y TLS en headers externos.
3. Confirmar Gmail push, history sync y latencia menor a cinco minutos.
4. Registrar evidencia live mediante los RPCs de M29.
5. Mantener envío externo y kill switch cerrados hasta el manifiesto exacto de cinco empresas.

## Incidente

Ante identidad incorrecta, scopes inesperados, token ausente, KMS inaccesible o drift de Supabase:

1. Desactivar `ENNCO_GMAIL_OAUTH_RELEASED`.
2. Mantener kill switch encendido.
3. Revocar el grant OAuth desde Google.
4. Marcar la credencial como revocada mediante una migración o RPC de incidente aprobado.
5. Rotar client secret, state secret o clave KMS según el componente afectado.
6. No borrar el ledger ni el audit trail.
