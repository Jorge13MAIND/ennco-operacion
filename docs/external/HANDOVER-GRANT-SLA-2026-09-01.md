---
title: Handover — SLA de respuesta ENNCO
para: Grant Keegan (CTO, Teckel AI) · grantkeegan@teckel-ai.com
de: Teckel · corte 1-sep-2026
alcance: Operar el SLA de respuesta a prospectos del programa ENNCO desde la VPS
base: HEAD 04d4dbd · repo Jorge13MAIND/ennco-revenue-platform (privado)
honestidad: Lo que no verifiqué contra el sistema vivo va marcado [HUECO]. Ningún secreto viaja en este documento, por diseño.
---

# Handover — SLA de respuesta ENNCO

## 0. Qué recibes y qué NO viene aquí

Recibes la operación del **SLA de respuesta a prospectos**: qué pasa cuando alguien
contesta uno de los correos del programa, en cuánto tiempo hay que responderle,
quién responde, y qué se rompe si nadie lo hace.

**Ningún secreto viaja en este documento.** Ni tokens, ni contraseñas, ni client
secrets, ni llaves. Es regla del repo (`AGENTS.md`: *"No guardar secretos ni datos
personales en logs, fixtures o commits"*) y del programa. Lo que sí encuentras es
**dónde vive cada secreto y cómo pedir el acceso**. Todo lo que necesites en claro
se te dicta en sesión con Jorge y va directo a Vercel.

Los valores reales viven en exactamente dos lugares: **el ambiente de Vercel** del
proyecto `ennco-operacion` y la tabla privada `app.private_runtime_config` en
Supabase. Si alguna vez ves un secreto de ENNCO en un chat, un commit o un archivo,
está mal puesto y hay que rotarlo.

---

## 1. El SLA en una página

El programa entero existe para producir respuestas de prospectos. Una respuesta
positiva que se enfría es el fracaso más caro posible: ya costó dominio,
calentamiento, copy y envío.

En este motor además tiene castigo automático: **una respuesta positiva vencida
abre un incidente P1, y con un P1 abierto el sistema congela TODO el outbound**
(`isControlCadenceReleaseAllowed` exige `open_p1 === 0`, y el trigger
`messages_operations_send_health` lanza `OPERATIONS_INCIDENT_SEND_HOLD`).
Responder a tiempo es lo que mantiene la máquina encendida.

| Llega | Compromiso |
|---|---|
| Cualquier respuesta | Clasificarla el mismo día hábil (meta < 2 h) |
| Positiva o referido | Responder antes de las **18:00 CDMX del mismo día hábil** |
| Positiva después de 18:00 o en inhábil | Siguiente día hábil antes de las 12:00 |
| Neutral que pide algo | 1 día hábil |
| Negativa / baja | Registro; la baja se confirma el mismo día, sin pitch |

La política completa: **`docs/external/sla-de-respuesta.md`**. Los textos de cada
respuesta ya están escritos en `data/campaigns/response-playbook-v1.json` (9
intents) y la sección "Segunda vuelta" de `docs/external/secuencia-ennco-copy.md`
(referidos). Ninguna respuesta improvisa garantías, descuentos, precios ni fechas.

**Clasificar es manual y siempre lo será por diseño.** No hay clasificador
automático. Una respuesta entra a la base como `UNREVIEWED`; un humano la marca
Positiva / Neutral / Negativa desde el Control Room, y **sólo la positiva crea un
lead**. El runbook operativo es `docs/runbooks/gmail-reply-sync.md`.

---

## 2. La VPS: qué es y qué NO es

Jorge indicó que trabajarás esto desde la VPS. Hay que ser explícito porque se
presta a confusión:

**ENNCO no corre en la VPS.** Corre en Vercel (app + 5 crons) y Supabase (base).
La VPS sería tu **estación de trabajo**: clonar el repo, correr los gates, editar
código. Nada del runtime de ENNCO vive ahí ni debe vivir ahí.

**Advertencia que te toca decidir a ti como CTO.** La VPS que existe hoy
(`ssh atlas`, Hostinger `srv1636308` / 177.7.58.35) es **root de producción de
Atlas con clientes que pagan** (D'Group, Trasmuro, más el worker interno). Meter
ahí el repo de ENNCO mezcla dos superficies que hoy están separadas, y `AGENTS.md`
pide justo lo contrario: *"No reutilizar tablas, bots, tokens o proyectos de otros
clientes."*

Mi recomendación, en orden:

1. **Usuario no-root dedicado** (`useradd -m ennco`), repo bajo su `$HOME`, nunca
   en `/root`. Trabajar ENNCO como root en la caja que corre Atlas es un accidente
   esperando.
2. **Cero secretos de producción de ENNCO en la VPS.** No los necesitas: los gates
   corren contra PostgreSQL efímero (ver §6), no contra Supabase. Si en algún
   momento necesitas leer producción, hazlo desde la consola de Supabase.
3. Si vas a tocar Atlas y ENNCO el mismo día, sepáralo por usuario y por
   directorio, y no compartas ni el `~/.ssh` ni el `~/.config`.

---

## 3. Accesos: qué necesitas, quién te lo da

Ninguno de estos accesos te lo puedo otorgar yo, y ninguno viaja por escrito.
Todos los concede Jorge (`A` en el RACI para credenciales y DNS). La columna
"para qué" te dice si de verdad lo necesitas para el SLA o es sólo para
contexto.

| Acceso | Quién lo da | Cómo | ¿Lo necesitas para el SLA? |
|---|---|---|---|
| **GitHub** `Jorge13MAIND/ennco-revenue-platform` (privado) | Jorge | Invitación de colaborador | **Sí.** Es lo primero |
| **Control Room** `ennco-operacion.vercel.app` | Jorge (crea el usuario) | Ver §5 | **Sí.** Es donde se clasifican las respuestas |
| **Supabase** proyecto `isnzaoifdjtwnugupidj` | Jorge | Invitación a la org | **Sí**, para el SQL del §5 y para diagnosticar |
| **Vercel** proyecto `ennco-operacion` (`prj_La0jTQsknyvaZFNKZXNdZZkVwTA2`, team `team_JoaghS7icWqY4idA8dg961Bg`) | Jorge | Invitación al equipo | Sí, para leer envs y logs de cron. **El deploy sigue necesitando su go** |
| **Google Workspace** de ENNCO (admin `francisco@enncoenergia.com`) | Jorge | Cuenta propia de admin, no compartir la existente | Sólo si vas a operar buzones |
| **Google Cloud** `august-beaker-478801-t3` | Jorge | IAM del proyecto | No para el SLA. Sí para OAuth/KMS |
| **Telegram** bot de alertas | Jorge | Ver §7 | Sí: es como te enteras |
| **Apollo** | Jorge | Cuenta Teckel | No para el SLA |

**Lo que nunca se comparte, ni conmigo ni contigo:** contraseñas de cuentas,
client secrets, llaves privadas, cookies de sesión, códigos MFA. Si necesitas un
valor nuevo (por ejemplo el token del bot de Telegram), el procedimiento es:
Jorge lo genera, lo dicta en sesión, se carga en Vercel, y no queda escrito en
ningún otro lado.

---

## 4. Identidades de correo (esto sí puede ir por escrito)

Son direcciones, no credenciales.

### Personas

| Correo | Quién | Papel |
|---|---|---|
| `george@teckel-ai.com` | Jorge Rojas | **Dueño del SLA.** Operador único hoy. `teckel_admin` en la base. Aprueba deploy, envío y compras |
| `grantkeegan@teckel-ai.com` | **Tú** | Respaldo designado del SLA. Hoy **VACANTE** en el sistema (§5) |
| `francisco.cuellar@ennco.com.mx` | Francisco Cuellar | **Cliente. Fuera del programa desde el 29-ago** por decisión de Jorge. Si un documento te pide esperar su firma o su visto bueno, ese documento está superado |

### Buzones del programa (identidades de marca, no personas)

Los correos salen firmados "Francisco Cuellar, CEO" porque es la voz del cliente,
pero **las cuentas son de Teckel**, en dominios de Teckel.

| Buzón | Papel | Estado |
|---|---|---|
| `francisco@enncoindustrial.com` | **Remitente del programa** | En la base (M037), credencial `UNKNOWN`, warmup 0/42 |
| `fcuellar@enncoindustrial.com` | Secundario | Igual |
| `francisco@enncoenergia.com` | Secundario **y admin del Workspace** | Igual |
| `fcuellar@enncoenergia.com` | Reserva | Creado en Workspace, **fuera del allowlist a propósito** (DEC-100) |
| `contacto@ennco.com.mx` | Buzón del cliente | **Fuera del canal** (M038). Sus marcadores en rojo ya no son bloqueadores |

> **Ojo con el "4" del tablero.** El handover general dice "4 buzones dados de
> alta". Son 3 del Workspace nuevo **más** `contacto@ennco.com.mx`, que estaba
> dado de alta desde antes y hoy está fuera del canal. Los "4 del Workspace" y
> los "4 de la base" **no son el mismo conjunto**. Al contar, cuenta 3 útiles.

### Dominios

| Dominio | Registrador / DNS | DKIM | Nota |
|---|---|---|---|
| `enncoindustrial.com` | Vercel Registrar, **Teckel** | Publicado, 2048 | Comprado 26-ago. Cumple 30 días el **25-sep** |
| `enncoenergia.com` | Vercel Registrar, **Teckel** | Publicado, 2048 | Igual |
| `ennco.com.mx` | Hostinger, **ENNCO** | Vacío | Del cliente, fuera del plan |

---

## 5. Activarte como respaldo — aquí hay una trampa, léela completa

Hoy el sistema tiene a Jorge como **operador único**: la fila de
`operational_assignments` está `ACTIVE`, `coverage_mode = 'SINGLE_TECKEL_OPERATOR'`,
`backup_user_id` en NULL (verificado en producción el 1-sep). Mientras siga así,
si Jorge no puede responder un día, no hay quien lo cubra, y la regla de la
política es **pausar la cadencia antes de la ausencia** en vez de dejar positivas
venciendo.

Para activarte:

**Paso 1 — usuario.** Crear tu usuario en el proyecto de Supabase y darte de alta
en `organization_users` con `role = 'teckel_operator'` (o `teckel_admin`) y
`active = true`, en la organización `e0000000-0000-4000-8000-000000000001`.

**Paso 2 — buzón.** Delegación del buzón del programa en Google Workspace, para
que puedas responder desde la identidad correcta.

**Paso 3 — la asignación.** Aquí está la trampa:

> **No existe ninguna RPC que configure el modo `PRIMARY_BACKUP`.** Verificado
> contra producción el 1-sep. La única función que hay,
> `configure_single_teckel_operator`, tiene firma
> `(organization_id, primary_user_id, source_reference, idempotency_key)` — **no
> recibe respaldo** — y su cuerpo hace explícitamente `backup_user_id = null` y
> `coverage_mode = 'SINGLE_TECKEL_OPERATOR'`. Es decir: sirve para declarar
> operador único, exactamente lo contrario de nombrar respaldo.
>
> Una versión anterior de `sla-de-respuesta.md` (escrita ayer) daba un comando de
> esa función con cuatro argumentos incluyendo tu UUID. **Ese comando no existe y
> habría fallado.** Ya está corregido en esa hoja, pero si lo viste, ignóralo.

Quedan dos caminos, y te toca elegir:

**(a) SQL directo**, respetando los invariantes que exige
`app.operations_assignment_is_active` (migración M026, líneas 51-81):

- `status = 'ACTIVE'` y `coverage_mode = 'PRIMARY_BACKUP'`
- `backup_user_id` no nulo y **distinto** del primario (constraint de tabla)
- **ambos** miembros activos en `organization_users` con rol en
  (`ennco_admin`, `ennco_operator`, `teckel_admin`, `teckel_operator`)

```sql
update public.operational_assignments
set coverage_mode = 'PRIMARY_BACKUP',
    backup_user_id = (select id from auth.users where email = 'grantkeegan@teckel-ai.com'),
    source_reference = 'sla-de-respuesta.md v1 · handover 2026-09-01',
    updated_at = now()
where organization_id = 'e0000000-0000-4000-8000-000000000001';

-- comprobar que quedó realmente activa (si esto da false, el motor te ignora):
select app.operations_assignment_is_active('e0000000-0000-4000-8000-000000000001');
```

**(b) Construir la RPC que falta** — `configure_primary_backup_operators`, con
audit log e idempotencia como sus hermanas. **Es lo que yo recomiendo** si el
respaldo va a rotar alguna vez, porque deja rastro y no depende de que alguien
escriba el UPDATE bien. Es media hora de trabajo con su gate.

Si la asignación queda inactiva o mal formada, el modo de falla es silencioso y
feo: `review_reply_and_route` **no truena**, asigna dueño NULL y abre un caso P1
que después nadie puede cerrar (`complete_operational_task_v2` exige
`TASK_OWNER_REQUIRED`). Por eso el watchdog vigila esto en modo live.

---

## 6. Montar el entorno en la VPS

```bash
# como usuario dedicado, no root
git clone git@github.com:Jorge13MAIND/ennco-revenue-platform.git
cd ennco-revenue-platform
npm ci
```

**Requisitos que no son obvios y truenan si faltan:**

- **Node >= 22** (`package.json` lo exige; varios scripts usan
  `--experimental-strip-types` sobre `.mts`). No hay `.nvmrc`.
- **PostgreSQL 17 con binarios de servidor**, no sólo cliente: los gates levantan
  su propio Postgres desechable con `initdb` / `pg_ctl` / `createdb`.
  `apt install postgresql-17 postgresql-client-17` y `/usr/lib/postgresql/17/bin`
  en el PATH (o exportar `ENNCO_PG_BIN`).
- **`LC_ALL=C`** para los gates de base, si no fallan al arrancar el Postgres.
- **Playwright con deps del sistema**: `npx playwright install --with-deps chromium`.
  El `--with-deps` es imprescindible en Linux headless.
- **k6 v1.6.1** sólo si vas a correr `verify:m23:frontend` (y por tanto `verify:m9`).

**La buena noticia:** los ~30 gates `*-db` **no necesitan credenciales de
Supabase**. Cada uno levanta un Postgres efímero, aplica las migraciones, corre su
test SQL y borra todo. Puedes verificar el sistema completo en la VPS sin un solo
secreto de producción.

Batería recomendada (correr los comandos **por separado**, ver §9):

```bash
npm run verify            # lint + typecheck + unitarias + build
LC_ALL=C npm run verify:operations-sla-db
npx playwright test --workers=2
```

Fallas conocidas que **no** son tuyas: `verify:cadence-db` sólo pasa los días 1-28
del mes (usa hora local), y `verify:operations-sla-db` está rojo por podredumbre
de fecha en su propio sembrado sintético — no afecta producción.

---

## 7. Cómo te enteras de una respuesta

Antes del 1-sep no había forma: el operador tenía que abrir el Control Room por su
cuenta. Ahora hay tres capas, y **las tres están en el código pero no en producción
todavía** (el deploy espera el go de Jorge):

1. **Alerta inmediata** — el cron de `gmail-sync` (cada 5 min, L-V) manda Telegram
   en cuanto ingesta respuestas humanas: *"N respuesta(s) de prospecto sin
   clasificar"*, con el plazo y la liga. Los auto-reply no disparan SLA.
2. **Red de las 2 horas** — el watchdog (cada 30 min) grita CRITICAL si hay
   respuestas sin clasificar más viejas que 2 h, y en modo live también si la
   asignación de responsable no está activa.
3. **Snapshot diario** — 09:45 y 18:30 CDMX.

> **Las alertas salen mudas hasta que existan `TELEGRAM_BOT_TOKEN` y
> `TELEGRAM_CHAT_ID` en Vercel.** `sendDispatchAlert` regresa `false` en silencio
> si no están configuradas — por diseño, para que una alerta caída no tumbe un
> tick, pero significa que hoy nadie recibe nada. Es un pendiente de Jorge de 2
> minutos y es el que más rinde de toda esta entrega.

Del lado de la base, `read_dispatch_health` ya expone `reply_operations`
(respuestas sin clasificar, antigüedad de la más vieja, casos abiertos, si hay
responsable activo). Esa migración (M040) **sí está aplicada en producción**, con
su rollback probado de ida y vuelta.

---

## 8. Estado: qué está vivo y qué no

| Pieza | Estado |
|---|---|
| Plazo 18:00 + caso P1 al clasificar positiva | **Vivo** desde M020 |
| Calendario de días hábiles 2026-2027 | **Vivo** (M034). Estuvo vacío y mataba el ruteo de positivas; ya sembrado |
| `reply_operations` en el informe de salud | **Vivo en producción** (M040, 1-sep) |
| Asignación de responsable | **Viva**: Jorge primario, modo operador único, sin respaldo |
| Alerta de Telegram + reglas nuevas del watchdog | **Código en `main`, NO desplegado.** Espera go de Jorge |
| Envs de Telegram | **Faltan.** Sin ellos, mudo |
| Tú como respaldo | **Vacante.** §5 |

**El motor está en modo sombra y no ha salido un solo correo.** El SLA todavía no
tiene con qué dispararse; lo estamos dejando listo antes de que haga falta. El
primer correo real no sale antes de octubre porque el calentamiento de buzones
(42 días) no ha arrancado.

---

## 9. Trampas que ya costaron tiempo

- **El candado de deploy mata el comando entero.** Un comando que contenga
  `vercel --prod`, `git push main` o `supabase db push` se bloquea aunque venga
  encadenado detrás de `&&`. Corre las pruebas solas, luego el deploy solo. (Es un
  hook local de la máquina de Jorge, `~/.claude/hooks/deploy-gate.js`; **en tu VPS
  no va a existir** salvo que lo repliques. Eso significa que del lado tuyo el
  único freno es la regla escrita: deploy y envío externo requieren go de Jorge.)
- **`npm run typecheck` local puede pasar y `next build` fallar.** Corre el build
  después de tocar pruebas, no sólo vitest.
- **Un bucle de incidentes congeló el canal dos veces** (2,522 incidentes P1 el
  26-27 ago). Tuvo dos causas distintas: eventos del outbox abandonados sin
  marcar, y `runGmailSync` rindiéndose antes de drenar cuando faltaban credenciales
  de Gmail. Ambas arregladas, con prueba que fija el invariante. **Si vuelven a
  aparecer incidentes con clave `outbox:`, mira ahí primero.**
- **Valores de DNS y tokens siempre del DOM o del portapapeles, jamás de OCR de
  una captura.** Un `0` leído como `O` costó dos horas de "Unable to verify".
- **Documentos marcados OBSOLETOS que NO debes ejecutar:**
  `runbook-activacion-jorge-2026-08-26.md` y `paquete-junta-francisco-2026-08-27.md`.
  La fuente vigente de bloqueadores es `docs/external/bloqueadores-2026-08-29.md`.

---

## 10. Lo que NO verifiqué — huecos honestos

- **[HUECO]** No sé si ya tienes cuenta en Supabase, Vercel o el Workspace de
  ENNCO. Asumí que no y por eso el §3 lista todo desde cero.
- **[HUECO]** El RACI (`docs/02-raci.md`) es del 11-ago y quedó desactualizado: las
  filas donde Francisco es aprobador están superadas por la decisión del 29-ago.
  No lo actualicé porque cambiar autoridad formal es decisión de Jorge, no mía.
- **[HUECO]** `docs/external/ennco-google-admin-handoff.md` tiene un paso 2 (DKIM
  de `ennco.com.mx`) que salió del alcance el 29-ago, pero **no lleva banner de
  obsolescencia** como sus hermanos. Vale ponérselo antes de que alguien lo ejecute.
- **[HUECO]** `.env.example` declara `RESEND_API_KEY`, `SENTRY_DSN` y
  `GOOGLE_CLOUD_PROJECT` que ningún código lee, y omite `APOLLO_EXPECTED_ADMIN_EMAIL`,
  `APOLLO_EXPECTED_TEAM_ID` y `APOLLO_PRIMARY_MAILBOX` que los scripts sí leen.
  Reconciliarlo es media hora y evita confusión al aprovisionar.
- **[HUECO]** El defecto M041 está documentado pero no arreglado: una respuesta
  observada después de las 18:00 **nace vencida** (`BREACHED`) porque el deadline
  usa offset 0 a las 18:00. Fix propuesto en `sla-de-respuesta.md`; conviene
  juntarlo con cualquier otra visita a la base.

---

## 11. Por dónde empezar (orden sugerido)

1. Pide a Jorge los accesos del §3, empezando por GitHub.
2. Clona y monta el entorno (§6). Corre `npm run verify` — si pasa, tu caja está bien.
3. Lee `docs/external/sla-de-respuesta.md` completo y
   `docs/runbooks/gmail-reply-sync.md`. Son 15 minutos y es el 80% del trabajo.
4. Decide el camino del §5 (SQL directo o construir la RPC) y actívate como respaldo.
5. Empuja los dos envs de Telegram con Jorge. Sin eso, todo lo demás es teatro.
6. Cuando Jorge dé el go, despliega el código del SLA que está en `main` sin desplegar.

Cualquier cosa que encuentres mal escrita en este documento, corrígela en el repo:
vive en `docs/external/` y viaja con `git pull`, que es justamente para lo que lo
puse ahí en vez de mandártelo por correo.
