# SLA de respuesta a prospectos — ENNCO outbound

Versión: 1-sep-2026. Gobierna la política `ENNCO-CLIENT-SLA-2026-08-12-V1` que el
motor ya estampa en cada tarea de seguimiento; hasta hoy esa política vivía solo
como un literal en una migración (`202608120020:470`) y nadie la tenía escrita.
Esta hoja la documenta, la completa y define quién responde.

## Por qué importa más que casi todo lo demás

El programa entero existe para producir respuestas. Una positiva que se enfría
es el fracaso más caro posible: costó dominio, calentamiento, copy y envío. Y en
este motor además tiene un castigo automático: **un caso de respuesta positiva
vencido abre un incidente P1, y con un P1 abierto el sistema congela TODO el
outbound** (`isControlCadenceReleaseAllowed` exige `open_p1 === 0`). Responder a
tiempo no es cortesía: es lo que mantiene la máquina encendida.

## Los plazos

| Llega | Compromiso | De dónde sale |
|---|---|---|
| Cualquier respuesta | **Clasificarla el mismo día hábil** (meta: < 2 h) | Un click en `/operacion`; el watchdog grita a las 2 h |
| Positiva o referido | **Responder antes de las 18:00 CDMX del mismo día hábil** (meta: < 4 h) | Regla viva del motor; la tarea nace con vencimiento a 4 h |
| Positiva después de las 18:00 o en día inhábil | Siguiente día hábil **antes de las 12:00** | Compromiso operativo (ver defecto conocido abajo) |
| Neutral que pide algo | 1 día hábil | Esta política |
| Neutral sin petición | Solo registro, sin correo | Esta política |
| Negativa | Registro; no se insiste | Playbook de respuestas |
| Baja | Registrar la baja el mismo día, confirmar sin pitch | LFPDPPP + regla del playbook |

Los textos de cada respuesta ya existen: `data/campaigns/response-playbook-v1.json`
(9 intents) y la sección "Segunda vuelta" de `secuencia-ennco-copy.md` para los
referidos. Ninguna respuesta improvisa garantías, descuentos, precios ni fechas.

## Quién responde

| Rol | Quién | Estado |
|---|---|---|
| **Dueño** | Jorge (`george@teckel-ai.com`) | **ACTIVO en la base desde el 20-ago** (`operational_assignments`, modo `SINGLE_TECKEL_OPERATOR`, verificado en producción el 1-sep) |
| **Respaldo** | **VACANTE** — designado: Grant (destinatario del traspaso) | `backup_user_id` es NULL; se activa con los 3 pasos de abajo |

Mientras el respaldo no exista, el sistema opera en modo `SINGLE_TECKEL_OPERATOR`
(contemplado por M026) y aplica la **regla de pausa**: si el dueño no va a poder
responder durante un día hábil o más (viaje, junta larga, enfermedad), se pausa
la cadencia con el kill switch ANTES de la ausencia. Es mejor no generar
respuestas que dejar positivas vencidas: cada vencida quema al prospecto y
congela el canal por P1.

### Activar al respaldo (cuando Grant acepte)

1. Crear su usuario del Control Room y darlo de alta en `organization_users` con
   rol `teckel_operator` y `active = true`.
2. Darle acceso al buzón del programa (delegación en Google Workspace).
3. Pasar la asignación a modo `PRIMARY_BACKUP`.

**Corrección 1-sep:** una versión anterior de esta hoja daba aquí un comando
`configure_single_teckel_operator(...)` con cuatro argumentos incluyendo el
respaldo. **Ese comando no existe.** La firma real es
`(organization_id, primary_user_id, source_reference, idempotency_key)` y su
cuerpo fuerza `backup_user_id = null` y `coverage_mode = 'SINGLE_TECKEL_OPERATOR'`:
sirve para declarar operador único, es decir lo contrario de nombrar respaldo.
**No hay ninguna RPC que configure el modo `PRIMARY_BACKUP`** (verificado contra
producción el 1-sep). El paso 3 se hace por SQL directo, respetando los
invariantes que `app.operations_assignment_is_active` exige, o construyendo antes
la RPC que falta (recomendado si el respaldo va a rotar). Detalle del SQL y de
los invariantes: `docs/external/HANDOVER-GRANT-SLA-2026-09-01.md` §5.

## Cómo se entera el operador (sin vivir en el Control Room)

1. **Alerta inmediata**: el cron de gmail-sync manda Telegram cuando ingesta
   respuestas nuevas ("N respuesta(s) de prospecto sin clasificar", con el plazo
   y la liga). Cableado el 1-sep-2026.
2. **Red de las 2 horas**: el watchdog (cada 30 min) grita CRITICAL si hay
   respuestas sin clasificar con más de 2 h.
3. **Snapshot diario** (09:45 y 18:30 CDMX) ya existente.

**Requisito pendiente (Jorge, 2 min)**: las alertas salen mudas hasta que
`TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` existan en Vercel. Crear el bot con
BotFather (o decidir reusar uno existente de Teckel) y pasarme los 2 valores en
sesión; los cargo en Vercel y en ningún otro lado.

## Qué pasa si se vence

Caso vencido → incidente **P1 automático** (watchdog SQL, cada 5 min) → tarea de
reconocimiento a 60 min → **outbound congelado** hasta resolver el incidente por
su ciclo (`OPEN→ACKNOWLEDGED→CONTAINED→RECOVERING→MONITORING→RESOLVED`, ver
`docs/runbooks/incident-response.md`). Esto es por diseño y se queda así: el
castigo desproporcionado es el candado que garantiza que una positiva jamás se
quede tirada.

## Estado en el sistema (qué está cableado y qué falta)

| Pieza | Estado |
|---|---|
| Deadline 18:00 día hábil + caso P1 al clasificar POSITIVE | **Vivo** (M020) |
| Calendario hábil 2026-2027 | **Vivo** (M034) |
| Alerta Telegram de respuesta nueva (cron gmail-sync) | Código listo 1-sep; **muda sin los 2 env de Telegram**; visible en prod tras el próximo deploy |
| Watchdog: respuestas >2 h sin clasificar y assignment faltante en live | Ídem (M040 + watchdog.ts) |
| `reply_operations` en `read_dispatch_health` | **Vivo** (M040 aplicada a producción el 1-sep, verificada con las subconsultas del parche) |
| Fila de `operational_assignments` | **Vive desde el 20-ago**: primario Jorge, modo `SINGLE_TECKEL_OPERATOR`, backup NULL. El repo no la siembra (se configuró por RPC); si algún día se desactiva, cada positiva abriría un caso P1 sin dueño — por eso el watchdog en live la vigila |

## Defecto conocido, con fix propuesto (pendiente técnico M041)

`operations_business_deadline` usa offset 0 a las 18:00: una respuesta observada
**después de las 18:00 nace BREACHED** (vencida al nacer, sin que nadie haya
podido incumplir nada). Fix propuesto para la próxima ventana de base de datos:
en `review_reply_and_route`, si la hora CDMX de `observed_at` es ≥ 18:00, usar
offset 1 con corte 12:00 (alineado con la fila 3 de la tabla de plazos). Va
junto con la siembra del assignment para tocar la base una sola vez.
