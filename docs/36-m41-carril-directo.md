# M41. Carril directo

Fecha del control local: 2 de septiembre de 2026.

Estado: `IMPLEMENTED_LOCAL`. Migración, motor, sync, módulo del Control Room y
gates pasan en local. Producción exige: aplicar M041, cargar cuatro variables
en Vercel, rotar el client secret de Google y conectar los buzones por
invitación. Ninguno de esos pasos lo hace este repositorio solo.

## Por qué existe

El 2-sep-2026 el sistema llevaba **cero correos enviados**. Verificado contra
el código, no contra memoria:

- `src/lib/gmail/outbound-client.ts:11-12` sólo aceptaba `contacto@ennco.com.mx`
  como remitente, y `cron/dispatch/route.ts:86-87` lo tenía fijo. El motor no
  podía enviar desde los tres buzones que Teckel sí controla.
- El sobre KMS (M030) exigía facturación de Google Cloud que nunca se vinculó,
  y un client secret que estaba comprometido.
- Cada envío exigía un release híbrido con 30 compuertas, un canary y 42 días
  de warmup medidos por la plataforma.

Decisiones de Grant (2-sep-2026, DEC-111): carril nuevo reusando tablas y
candados; OAuth por buzón con llave de aplicación en lugar de KMS; sin gate de
warmup en la plataforma porque SmartLead ya lo ejecuta; aprobación por
campaña con toques automáticos y respuestas manuales.

## Qué conserva y qué no

| Conserva | Ya no exige |
|---|---|
| `mailboxes`, `campaigns`, `sequence_*`, `campaign_enrollments`, `messages`, `provider_events` | Release híbrido (M029) |
| Supresión: Anexo A, baja, rebote duro, DNC, manual (`app.is_suppressed`) | Lote de primer envío y olas (M008/M009) |
| Kill switch global y `external_send_allowed` (`runtime_controls`) | Canary y `shadow_canary_decision = PASS` |
| Texto plano, tope de 100 palabras, sin ligas en el toque 1 | Watchdog fresco y sin P0/P1 (M020) |
| Audit log, atribución automática del primer contacto (M016) | Cadencia del Control Room (M022) |
| Máquina canónica de respuestas (`apply_mailbox_provider_event`) | Sobre KMS y broker PKCE con AAL2 (M030) |
| Prueba HMAC del motor (`app.verify_dispatch_proof`, M032) | 42 días de warmup medidos por la plataforma |

Los cuatro triggers híbridos sobre `public.messages` reciben un bypass
explícito cuando `lane = 'DIRECT'` (parche textual sobre la definición viva,
reversible). El carril tiene su propio trigger `messages_aaa_m041_direct_lane`.

## Contrato de base (M041)

- `messages.lane`, `provider_thread_id`, `rfc_message_id`, `cc_emails`, `reply_to_provider_event_id`.
- `campaigns.lane`, `direct_lane_state` (`DRAFT → RUNNING ⇄ PAUSED → COMPLETED`). El candado del canary no se toca: el carril nunca pone `status = ACTIVE`.
- `mailboxes.direct_lane_status` (`DISCONNECTED / CONNECTED / PAUSED / KILLED`), rampa y tope.
- `direct_lane_credentials`: ciphertext AES-256-GCM, `key_id`, hash. Sin acceso directo para ningún rol.
- `direct_lane_authorizations`: invitaciones (hash del token, estado armado, consumo).
- `direct_lane_commands`: idempotencia de las mutaciones de sesión.
- `direct_lane_ticks`: bitácora del motor (claim, settle, sync, auth).

## Rampa

`AUTO` sigue la instrucción de Jorge por semanas desde el primer envío real
del buzón: 5 → 10 → 20 → 40. `FIXED` usa el valor del operador. Ambos
respetan `direct_lane_cap_max`. El buzón del cliente (`contacto@ennco.com.mx`)
tiene techo 20 y la RPC rechaza subirlo.

Un correo por buzón por tick, con 4 a 7 minutos entre envíos del mismo buzón
(jitter determinista). Ventana: lunes a viernes 09:30-13:30 CDMX, la misma del
motor híbrido.

## Consentimiento por invitación

1. El operador genera la liga desde Correos. La base guarda `sha256(token)`; la liga se muestra una sola vez y vence en 7 días.
2. Quien tiene el buzón la abre en `/correos/conectar?t=…` (sin sesión) y presiona Conectar.
3. `POST /api/v1/public/correos/oauth/start` arma el estado, sella la cookie (PKCE + estado) y redirige a Google con `login_hint`.
4. Google regresa a `GOOGLE_OAUTH_REDIRECT_URI` (la misma del broker M030). El callback detecta la cookie del carril, canjea el código, exige que la identidad de Google sea **exactamente** el buzón invitado, cifra el refresh token y lo persiste con prueba HMAC.

Sirve igual para los buzones propios (los abre Grant o Jorge con la contraseña del Workspace) y para el de Paco.

## Respuestas

`correos-sync` sondea el history de Gmail de cada buzón conectado o en pausa
cada 5 minutos, clasifica (REPLY / AUTO_REPLY / HARD_BOUNCE) y aplica con la
máquina canónica. Una respuesta detiene la secuencia (`REPLIED`), crea la tarea
de seguimiento y dispara el aviso de Telegram. El operador clasifica en
Respuestas y contesta en Correos: la respuesta sale en el hilo original y, si
la campaña lo indica, con copia a `francisco.cuellar@ennco.com.mx`. Es el
"segundo correo" de la junta del 1-sep, nunca el primero.

## Variables de ambiente

| Variable | Valor | Efecto |
|---|---|---|
| `ENNCO_DIRECT_LANE_RELEASED` | `true` | Habilita crons y conexión de buzones. Exige Supabase dedicado, `ENNCO_DISPATCH_SECRET` y `CRON_SECRET` |
| `ENNCO_DIRECT_LANE_MODE` | `shadow` \| `live` | Sombra: reclama y deja `DRY_RUN`. Live: envía |
| `ENNCO_DIRECT_LANE_VAULT_KEY` | 32 bytes en base64 (`openssl rand -base64 32`) | Llave de la bóveda. Sensible. Perderla = reconectar todos los buzones |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | Del cliente OAuth de Google | Ya existían para M030; el secret debe rotarse |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Del bot de alertas | Sin ellos las alertas salen mudas |

## Verificación

```bash
npm run verify:direct-lane-sequence
npm test -- --run src/lib/correos src/lib/gmail/history.test.ts
LC_ALL=C npm run verify:direct-lane-db
npm run typecheck && npm run lint && npm run build
npx playwright test tests/e2e/correos.spec.ts --workers=2
```

El gate de base prueba: consentimiento con identidad exacta y bóveda
inalcanzable; aprobación sólo por `teckel_admin`; inscripción por cargo;
sombra con todo cerrado; kill switch y Anexo A en live; claim/settle con
avance de secuencia, ritmo y tope; respuesta del operador en hilo con copia;
texto plano y sin ligas; y que un mensaje híbrido sigue exigiendo su release.

## Lo que NO demuestra un PASS local

Ni que el cliente OAuth acepte la URI de callback, ni que Gmail entregue, ni
que las respuestas lleguen. Eso lo demuestra el primer buzón conectado en modo
sombra y luego el primer envío real. Runbook: `docs/runbooks/m41-carril-directo.md`.
