---
title: Handover — operación comercial ENNCO (SLA de respuesta, ICP, copy y Control Room)
para: Grant Keegan (CTO, Teckel AI) · grantkeegan@teckel-ai.com
de: Teckel · corte 1-sep-2026
alcance: Todo lo necesario para operar las respuestas de prospectos: a quién escribimos, qué les decimos, dónde se trabaja y en cuánto tiempo hay que contestar
base: repo Jorge13MAIND/ennco-revenue-platform (privado)
honestidad: Lo que no verifiqué contra el sistema vivo va marcado [HUECO]. Ningún secreto viaja en este documento, por diseño.
---

# Handover — operación comercial ENNCO

## 0. Qué recibes y qué NO viene aquí

Recibes la operación del **SLA de respuesta a prospectos**, y con él lo que hace
falta para entenderlo: a quién le escribimos (§2), qué le decimos (§3), dónde se
trabaja (§4) y en cuánto hay que contestar (§1).

**Ningún secreto viaja en este documento.** Ni tokens, ni contraseñas, ni client
secrets, ni llaves. Es regla del repo (`AGENTS.md`: *"No guardar secretos ni datos
personales en logs, fixtures o commits"*). Lo que sí encuentras es **dónde vive
cada secreto y cómo pedir el acceso** (§6). Lo que necesites en claro se te dicta
en sesión con Jorge y va directo a Vercel.

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
| Negativa | Registro; no se insiste |
| **Baja** | Registrar el mismo día y confirmar **sin pitch** — es LFPDPPP, no cortesía |

Política completa: **`docs/external/sla-de-respuesta.md`**. Runbook técnico de la
ingesta: `docs/runbooks/gmail-reply-sync.md`.

**Clasificar es manual y siempre lo será por diseño.** No hay clasificador
automático. Una respuesta entra a la base como `UNREVIEWED`; un humano la marca
Positiva / Neutral / Negativa en el Control Room, y **sólo la positiva crea un
lead**. El paso a paso está en §4.

---

## 2. A quién le escribimos — el ICP

### La definición que manda es contractual, no de marketing

Cláusula 06 del contrato firmado: un **lead calificado** cumple **las cinco
condiciones simultáneamente**. Si falta una, no cuenta, y *"en caso de duda
razonable, el registro no se cuenta"*.

1. Empresa industrial con consumo compatible con un proyecto **> 100 kWp**, en
   Guanajuato, Querétaro, Jalisco o Michoacán
2. **No** figura en el Anexo A
3. Contacto identificado con **nombre, cargo y medio verificado**, de dirección
   general, mantenimiento, compras o el área que decide inversiones de energía
4. **Interés expreso**: respondió pidiendo información, cotización o reunión, o
   completó una precotización con gasto eléctrico declarado **> $20,000/mes**
5. Queda documentado con fecha, canal de origen y evidencia

Eso está traducido literalmente al código en `src/lib/domain/qualification.ts`
(`isContractualLead`) y blindado en la base por `app.qualify_lead_strict`, que
además rechaza cualquier lead cuya cuenta, correo o dominio esté suprimido
(`STRICT_LEAD_SUPPRESSED`). **El compromiso es de 10 leads al mes**, y el reloj
arranca en el primer mes calendario completo con campañas operando.

### El perfil operativo de cuenta

| Dimensión | Criterio real |
|---|---|
| Tamaño | DENUE 101-250 y **251+ empleados**. Ojo: el tamaño es *proxy* de >100 kWp, no confirmación — no existe padrón público de grandes consumidores de CFE |
| Giro | Manufactura (SCIAN 31-33). Priorizados los intensivos en energía: 322 papel, 325 química, 326 plástico, 327 minerales no metálicos, 331 metálicas básicas, **336 autopartes** |
| Geografía ejecutada | **Corredor León–Querétaro**: León, Querétaro, El Marqués, Silao, Irapuato, Celaya, Apaseo el Grande, Salamanca, Colón, Apaseo el Alto |
| Señal de calidad | Certificado **PROFEPA-PNAA** vigente (Industria Limpia) |
| Parques | PIQ, Guanajuato Puerto Interior, Castro del Río, El Marqués, Bernardo Quintana, Colinas de León, FIPASI |

### El universo: 1,831 empresas listas, **0 cargadas**

Todo de fuentes públicas oficiales, con URL de origen y checksum, en
`data/imports/raw/sourcing-2026-08-26/` (crudo) y
`data/imports/research/sourcing-2026-08-26/` (6 lotes listos para cargar):

| Lote | Filas | Fuente |
|---|---:|---|
| Tier 1 top 50 | 50 | Cruce de padrones (ver abajo) |
| PROFEPA Gto+Qro | 65 | datos.gob.mx, CC-BY-4.0 (84 menos 19 subestaciones de CFE) |
| Parques industriales | 422 | Directorios oficiales de los 7 parques |
| DENUE manufactura (3 partes) | 1,294 | INEGI, descarga masiva (1,297 menos 3 excluidas) |
| **Total** | **1,831** | |

Las exclusiones **nunca son silenciosas**: cada fila sacada lleva marcador
conciliado (`EXCLUIDO_PARAESTATAL_CFE` ×19, `EXCLUIDO_ANEXO_A` ×2,
`EXCLUIDO_SIN_RAZON_SOCIAL` ×1).

**Tier 1** es la intersección de dos padrones públicos independientes: certificado
PROFEPA vigente **+** 251+ empleados en DENUE **+** dentro del corredor. Score
sobre 7: PROFEPA +4, SCIAN intensivo +2, parque identificado +1. Sólo 10 de las 50
tienen certificado, y son el top 10: Steeringmex, Ventramex, CIMA, P&G Mariscala,
Autoliv, Lear León, Kirchhoff, Troqueladora Batesville, Eaton/Bussmann e Industria
Envasadora de Querétaro.

Apollo resolvió 10/10 de esas cuentas y devolvió 32 candidatos, 21 con correo
(**2.1 contactos con correo por cuenta**). Para el gate de 150 contactos hacen
falta ~71 cuentas, y hay 1,831.

### Anexo A — las 3 empresas intocables

`data/suppression/anexo-a-2026-08-13.json`: **POSCO MPPC**, **MPE Plastic** y
**Laproba El Águila (Tejas El Águila)** — 3 razones sociales, 12 alias, 6 dominios.
Son los clientes y prospectos vivos de ENNCO: quedan fuera del cálculo de la
comisión del 2% aunque el sistema los contacte. Se aplica en cuatro capas
(snapshot con SHA256 verificado, `suppression_entries` en la base, filtro en el
sourcing y gate de release).

> **No está firmado.** El borrador existe (`docs/external/anexo-a-firma-2026-08.html`),
> el envío por BoldSign nunca se hizo, y tras la salida de Francisco quedó como
> **riesgo de comisión asumido por Jorge**.

### Supresiones y LFPDPPP

Seis tipos de supresión: `ANNEX_A`, `CURRENT_CLIENT`, `UNSUBSCRIBE`,
`HARD_BOUNCE`, `DNC`, `MANUAL`. La lista se guarda con **HMAC, sin correo crudo**.
Reglas duras de campaña: reply, rebote duro, baja, DNC o intervención manual
**detienen la secuencia**; ningún contacto en dos secuencias activas; sin píxel de
apertura; **WhatsApp frío prohibido**, LinkedIn sólo manual.

> **Bloqueo legal vivo:** el aviso de privacidad está en
> `AWAITING_ENNCO_AND_LEGAL_REVIEW` y falta **definir la base jurídica para
> prospección B2B antes de cualquier contacto real** (riesgo `P0-LEGAL-001`). No
> es tuyo resolverlo, pero conviene que sepas que existe antes de que alguien
> proponga "mandar unos correos de prueba".

---

## 3. Qué les decimos — el copy

**Teckel es dueño del copy.** Se redacta, ajusta y optimiza sin consultar al
cliente; lo único que espera visto bueno es el **primer envío**, por la cláusula
07 del contrato. Jorge asume ese riesgo desde el 29-ago.

### La secuencia: 8 toques × 4 variantes = 32 correos

Fuente: **`docs/external/secuencia-ennco-copy.md`**. Días 0, 3, 7, 14, 28, 42, 60 y 75.

| Variante | Su miedo | Su CTA |
|---|---|---|
| Dirección general | El número y no tener el dato | Que te dirija con su gente |
| Mantenimiento / planta | Que truene en su turno | Fecha concreta |
| Seguridad e higiene | El arco y el acta | Que quede documentado |
| Compras | Que le echen la culpa por el barato | Una herramienta antes de pedirle nada |

**El ancla es un caso real**: un cliente de ENNCO perdió **$2,180,000 MXN en un
día por un apagón** (confirmado por Francisco el 28-ago). Se usa sin nombrar a la
empresa afectada. Estructura fija de cada correo: golpe con la cifra → el
mecanismo → **una** pregunta fácil → USP en una línea. Entre 37 y 81 palabras,
tope duro de 100. Sin ligas en el toque 1. Baja explícita en el toque 8.

**El CTA es "levantamiento", no "auditoría"** — sigue el proceso real de ENNCO: la
segunda visita es un levantamiento de planta donde se muestran las observaciones,
y el presupuesto viene **después**. Por eso los correos dicen que los números van
al final: baja muchísimo la fricción del sí.

**Prohibido, aunque alguien lo escriba:** garantías, descuentos, precios finales,
fechas de instalación comprometidas, ahorros prometidos en pesos o porcentaje, y
resultados de clientes sin autorización.

### Segunda vuelta: cuando contestan "habla con Juan"

El CTA de dirección pide precisamente eso, así que es el resultado **bueno**.
Al final de `secuencia-ennco-copy.md`: correo al referido (hilo nuevo con asunto
propio, 78 palabras), acuse al referidor, y variante para cuando dan el cargo sin
el correo. El referido **no entra a la secuencia automática**: se maneja manual.

### Respuestas a cada objeción

`data/campaigns/response-playbook-v1.json` — 9 intents con su texto listo:
`POSITIVE`, `REFERRAL`, `NOT_NOW`, `WHAT_IS_THIS`, `PRICE_OBJECTION`,
`CHEAPER_VENDOR`, `INTERNAL_ALIGNMENT`, `COMMERCIAL_COMMITMENT`, `UNSUBSCRIBE`.
Reglas: una sola pregunta de calificación por mensaje, detener la secuencia antes
de responder, nunca confirmar garantías/descuentos/precio/fecha, y una baja se
confirma sin agregar otro pitch.

### Lo que se adjunta cuando dicen "sí, mándamelo"

En `docs/external/materiales-prospectos/`, marca ENNCO, sin precios:

- **`Formato-Reporte-Levantamiento-ENNCO.pdf`** — el formato del reporte que
  promete el toque 4: hallazgos con ubicación, lectura térmica y prioridad, con
  las termografías FLIR reales de ENNCO (70.5 °C crítico vs 40.6 °C sano).
- **`Alcance-Minimo-Poliza-ENNCO.pdf`** — lo que promete el toque de compras: los
  tres mínimos de cualquier póliza, checklist de comparación imprimible y el
  argumento fiscal (LISR 34-XIII: la deducción del 100% exige 5 años de operación,
  y el mantenimiento es lo que la sostiene).

El HTML editable de ambos está al lado del PDF. **Cero JavaScript**: se imprimen
con Cmd+P.

---

## 4. El Control Room: cómo entrar y cómo trabajar

`https://ennco-operacion.vercel.app` · toda la interfaz está en español de México.

### 4.1 Tu primer acceso

**No hay auto-registro.** El alta es manual y en este orden:

1. **Jorge** crea tu usuario en Supabase Auth.
2. **Jorge** te da de alta en `organization_users` con rol `teckel_operator` (o
   `teckel_admin`) y `active = true`, en la organización
   `e0000000-0000-4000-8000-000000000001`.
3. **Tú** vas a `/ingreso/recuperar` ("Activa tu acceso"), pones tu correo, recibes
   un enlace de un solo uso, y **ahí creas tu contraseña** (mínimo 12 caracteres,
   exclusiva — no reuses la de Google Workspace).
4. Entras a `/operacion`.

> **Trampa que te va a pasar si el paso 1 no se hizo:** la pantalla de recuperación
> dice *"Revisa tu correo. Si la cuenta está autorizada, recibirás un enlace…"*
> **exactamente igual exista o no el usuario** (es anti-enumeración deliberada). Si
> no llega nada, no es el correo: es que el usuario no existe todavía.

**Hoy no hay segundo factor** (`ENNCO_REQUIRE_MFA=false`, decisión DEC-106 del
27-ago). Entras con correo y contraseña. Volver a exigirlo es cambiar una fila y
una variable de ambiente.

Si entras sin rol verás: *"La cuenta no tiene acceso activo a esta organización."*

### 4.2 La pantalla "Hoy"

El orden es obligatorio y está pensado para que entiendas en menos de diez
segundos si el sistema puede operar:

1. **Autorización efectiva** — `HABILITADO` o `BLOQUEADO`, kill switch, estado del
   reply sync y "Riesgo abierto: N P0 · N P1"
2. **Siguientes acciones** — ordenadas por vencimiento y severidad, con atajos
   (Atender incidente · Responder interés · Calificar lead · Actualizar
   oportunidad · Revisar infraestructura)
3. **Resultado comercial** — 8 métricas, incluida **"Respuestas pendientes"**
4. Infraestructura y gates (colapsado)
5. **Bandeja de respuestas** — la misma que en `/operacion/respuestas`, embebida
   abajo: puedes clasificar sin salir de Hoy

Sidebar: **Control** (Hoy, Alertas, Cadencia, Infraestructura) · **Comercial**
(Respuestas, Leads, Empresas, Precotizaciones, Campañas, Pipeline) · **Gobierno**
(Aprobaciones, Roadmap, Reportes, Exportaciones, Entrega).

### 4.3 Clasificar una respuesta — el paso a paso

1. Mira **"Respuestas pendientes"** en Hoy. Ese número son las que esperan.
2. Baja a **"Bandeja de respuestas"**. Cada renglón: Cuenta · Contacto ·
   Clasificación · Siguiente acción ("Recibida 3 sep. Re: …") · Estado · Acción.
3. El widget de clasificar sólo aparece si la fila es *reviewable*: **respuesta
   humana real** (no auto-reply ni rebote) **y** nadie la ha clasificado.
4. Eliges en el select **Positiva / Neutral / Negativa** y presionas **"Guardar"**.

> ### ⚠️ Lo más peligroso de toda la operación
>
> **El select viene con "Positiva" preseleccionada.** Si das click en "Guardar"
> sin tocarlo, marcas POSITIVE. Y clasificar es **irreversible**: un segundo
> intento con otra opción falla con `REPLY_REVIEW_ALREADY_FINAL`.
>
> Marcar POSITIVE por accidente crea un lead, una tarea con vencimiento a las
> 18:00 y **un caso SLA P1**. Si ese caso vence, congela todo el outbound hasta
> que alguien recorra a mano el ciclo del incidente (seis transiciones).
>
> **Regla: toca el select siempre, aunque la respuesta sí sea positiva.**

Qué hace cada opción:

| Opción | Efecto real |
|---|---|
| **Positiva** | Crea lead `CAPTURED` (sin calificar aún) + asigna la tarea de seguimiento con dueño y suplente + abre caso SLA **P1** con vencimiento 18:00 CDMX. Si ya pasaron las 18:00, **nace vencido** (defecto M041) |
| **Neutral** | Sólo registra. Cero leads, cero tareas, cero casos. El plazo de 1 día hábil es política escrita, no automática |
| **Negativa** | Sólo registra. No se insiste |

**La secuencia ya se detuvo sola** cuando entró la respuesta (`REPLIED` /
`HUMAN_REPLY`). Clasificar no la detiene: ya estaba detenida.

### 4.4 Las demás acciones

Todas llevan clave de idempotencia (un doble click no duplica) y sólo aparecen con
datos reales, nunca en modo demo. El feedback es "Guardando…" → "Guardado" o
**"Rechazado por gate"**.

| Acción | Dónde | Qué exige |
|---|---|---|
| Asignar tarea / Marcar hecha | Siguientes acciones | Completar exige **SHA256 de evidencia** y que la tarea tenga dueño |
| Aplicar transición (incidente) | Alertas | Ciclo estricto `OPEN→ACKNOWLEDGED→CONTAINED→RECOVERING→MONITORING→RESOLVED`. Resolver pide checkbox de prueba de recuperación |
| Guardar evidencia / Aplicar gate estricto | Leads | El gate exige las cinco condiciones del §2. Sin evidencias ligadas, no califica |
| Crear oportunidad · Guardar transición · Programar · Registrar resultado · Registrar pago · Reservar mes | Leads y Pipeline | El pago sólo se acepta en `CLOSED_WON`; la capacidad son 2 proyectos al mes |
| Registrar decisión | Aprobaciones | Aprobar/Rechazar con justificación obligatoria |
| Descargar CSV | Exportaciones | Empresas y contactos · pipeline y atribución |

### 4.5 Leer los estados

Un badge se pinta **rojo** si contiene BLOCK, HOLD, REJECT, ZERO, QUARANTIN,
UNKNOWN, DEGRADED, INCOMPLETE o BREACH, o si es P0/P1. Regla de diseño: **UNKNOWN
jamás se muestra en verde** — "sin evidencia" no es "bien".

Los importantes: `HOLD` "En espera" (decisión de control, no falla) · `UNKNOWN`
"Sin evidencia" · `BREACHED` "Incumplido" (SLA vencido, dispara P1) · `LIVE`
"Datos reales" (que **no** significa autorización de envío) · `FULL` "Sin
capacidad" (mes lleno).

### 4.6 Practicar sin romper nada

Con `ENNCO_DEMO_MODE=true` en local entras sin login a un ambiente sintético con
**todas las mutaciones deshabilitadas**. Es el lugar para recorrer la pantalla.
El guion de capacitación (`docs/runbooks/m9-operator-training.md`, 90 min + 9
ejercicios) está escrito y **nunca se ha impartido**. Los escenarios UAT-02 y
UAT-03 de `docs/runbooks/m4-operator-uat.md` son exactamente el flujo de clasificar.

---

## 5. La VPS: qué es y qué NO es

Jorge indicó que trabajarás esto desde la VPS. Hay que ser explícito:

**ENNCO no corre en la VPS.** Corre en Vercel (app + 5 crons) y Supabase (base).
La VPS sería tu **estación de trabajo**: clonar el repo, correr gates, editar
código. Nada del runtime de ENNCO vive ahí ni debe vivir ahí.

**Advertencia que te toca decidir a ti como CTO.** La VPS que existe hoy
(`ssh atlas`, Hostinger `srv1636308` / 177.7.58.35) es **root de producción de
Atlas con clientes que pagan** (D'Group, Trasmuro, más el worker interno). Meter
ahí el repo de ENNCO mezcla dos superficies hoy separadas, y `AGENTS.md` pide lo
contrario: *"No reutilizar tablas, bots, tokens o proyectos de otros clientes."*

Recomendación, en orden:

1. **Usuario no-root dedicado**, repo bajo su `$HOME`, nunca en `/root`.
2. **Cero secretos de producción de ENNCO en la VPS.** No los necesitas: los gates
   corren contra PostgreSQL efímero (§9). Para leer producción, usa la consola de
   Supabase.
3. Si tocas Atlas y ENNCO el mismo día, sepáralo por usuario y directorio.

---

## 6. Accesos: qué necesitas, quién te lo da

Ninguno viaja por escrito; todos los concede Jorge.

| Acceso | Cómo | ¿Para el SLA? |
|---|---|---|
| **GitHub** `Jorge13MAIND/ennco-revenue-platform` | Invitación de colaborador | **Sí.** Lo primero |
| **Control Room** | §4.1 | **Sí.** Es donde trabajas |
| **Supabase** `isnzaoifdjtwnugupidj` | Invitación a la org | **Sí**, para el SQL del §8 y diagnosticar |
| **Vercel** `ennco-operacion` (`prj_La0jTQsknyvaZFNKZXNdZZkVwTA2`, team `team_JoaghS7icWqY4idA8dg961Bg`) | Invitación al equipo | Sí, para envs y logs. **El deploy sigue necesitando el go de Jorge** |
| **Google Workspace** de ENNCO | Cuenta propia de admin | Sólo si operas buzones |
| **Google Cloud** `august-beaker-478801-t3` | IAM del proyecto | No para el SLA. Sí para OAuth/KMS |
| **Telegram** bot de alertas | §10 | Sí: es como te enteras |
| **Apollo** | Cuenta Teckel | No para el SLA |

**Nunca se comparte:** contraseñas, client secrets, llaves privadas, cookies de
sesión, códigos MFA. Un valor nuevo se genera, se dicta en sesión, se carga en
Vercel, y no queda escrito en ningún otro lado.

---

## 7. Identidades de correo

### Personas

| Correo | Quién | Papel |
|---|---|---|
| `george@teckel-ai.com` | Jorge Rojas | **Dueño del SLA.** Operador único hoy. Aprueba deploy, envío y compras |
| `grantkeegan@teckel-ai.com` | **Tú** | Respaldo designado. Hoy **VACANTE** en el sistema (§8) |
| `francisco.cuellar@ennco.com.mx` | Francisco Cuellar | **Cliente. Fuera del programa desde el 29-ago.** Si un documento te pide esperar su firma, está superado |

### Buzones del programa

Los correos van firmados "Francisco Cuellar, CEO" porque es la voz del cliente,
pero **las cuentas son de Teckel**, en dominios de Teckel.

| Buzón | Papel | Estado |
|---|---|---|
| `francisco@enncoindustrial.com` | **Remitente del programa** | En la base, credencial pendiente, warmup 0/42 |
| `fcuellar@enncoindustrial.com` | Secundario | Igual |
| `francisco@enncoenergia.com` | Secundario **y admin del Workspace** | Igual |
| `fcuellar@enncoenergia.com` | Reserva | Fuera del allowlist a propósito |
| `contacto@ennco.com.mx` | Buzón del cliente | **Fuera del canal.** Sus marcadores en rojo ya no son bloqueadores |

> **Ojo con el "4" del tablero.** El handover general dice "4 buzones dados de
> alta": son 3 del Workspace **más** `contacto@ennco.com.mx`, que está fuera del
> canal. Los "4 del Workspace" y los "4 de la base" no son el mismo conjunto.
> Útiles: **3**.

### Dominios

| Dominio | Registrador / DNS | DKIM | Nota |
|---|---|---|---|
| `enncoindustrial.com` | Vercel Registrar, **Teckel** | Publicado 2048 | Cumple 30 días el **25-sep** |
| `enncoenergia.com` | Vercel Registrar, **Teckel** | Publicado 2048 | Igual |
| `ennco.com.mx` | Hostinger, **ENNCO** | Vacío | Del cliente, fuera del plan |

---

## 8. Activarte como respaldo — aquí hay una trampa

Hoy Jorge es **operador único**: `operational_assignments` está `ACTIVE`,
`coverage_mode = 'SINGLE_TECKEL_OPERATOR'`, `backup_user_id` en NULL (verificado
en producción el 1-sep). Mientras siga así, si Jorge no puede responder un día no
hay quien lo cubra, y la política obliga a **pausar la cadencia antes de la
ausencia** en vez de dejar positivas venciendo.

**Paso 1 — usuario.** El alta del §4.1, con rol `teckel_operator` y `active = true`.

**Paso 2 — buzón.** Delegación del buzón del programa en Google Workspace.

**Paso 3 — la asignación.** Aquí está la trampa:

> **No existe ninguna RPC que configure el modo `PRIMARY_BACKUP`.** Verificado
> contra producción el 1-sep. La única función que hay,
> `configure_single_teckel_operator`, tiene firma
> `(organization_id, primary_user_id, source_reference, idempotency_key)` — **no
> recibe respaldo** — y su cuerpo hace explícitamente `backup_user_id = null` y
> `coverage_mode = 'SINGLE_TECKEL_OPERATOR'`. Sirve para declarar operador único,
> exactamente lo contrario de nombrar respaldo.
>
> Una versión anterior de `sla-de-respuesta.md` daba un comando de esa función con
> cuatro argumentos incluyendo tu UUID. **Ese comando no existe y habría fallado.**
> Ya está corregido; si lo viste, ignóralo.

Dos caminos, y eliges tú:

**(a) SQL directo**, respetando lo que exige `app.operations_assignment_is_active`:
`status='ACTIVE'`, `coverage_mode='PRIMARY_BACKUP'`, `backup_user_id` no nulo y
distinto del primario, y **ambos** miembros activos con rol en (`ennco_admin`,
`ennco_operator`, `teckel_admin`, `teckel_operator`).

```sql
update public.operational_assignments
set coverage_mode = 'PRIMARY_BACKUP',
    backup_user_id = (select id from auth.users where email = 'grantkeegan@teckel-ai.com'),
    source_reference = 'sla-de-respuesta.md v1 · handover 2026-09-01',
    updated_at = now()
where organization_id = 'e0000000-0000-4000-8000-000000000001';

-- comprobar que quedó activa (si da false, el motor te ignora):
select app.operations_assignment_is_active('e0000000-0000-4000-8000-000000000001');
```

**(b) Construir la RPC que falta** — `configure_primary_backup_operators`, con
audit log e idempotencia como sus hermanas. **Es lo que recomiendo** si el respaldo
va a rotar: deja rastro y no depende de que alguien escriba el UPDATE bien.

Si la asignación queda inactiva o mal formada, el modo de falla es silencioso:
`review_reply_and_route` **no truena**, asigna dueño NULL y abre un P1 que después
nadie puede cerrar. Por eso el watchdog lo vigila en modo live.

---

## 9. Montar el entorno en la VPS

```bash
# como usuario dedicado, no root
git clone git@github.com:Jorge13MAIND/ennco-revenue-platform.git
cd ennco-revenue-platform
npm ci
```

Requisitos que truenan si faltan:

- **Node >= 22** (varios scripts usan `--experimental-strip-types` sobre `.mts`).
  No hay `.nvmrc`.
- **PostgreSQL 17 con binarios de servidor**, no sólo cliente: los gates levantan
  su propio Postgres con `initdb`/`pg_ctl`/`createdb`.
  `apt install postgresql-17 postgresql-client-17`, y el `bin` en el PATH.
- **`LC_ALL=C`** para los gates de base.
- **Playwright con deps**: `npx playwright install --with-deps chromium`.
- **k6 v1.6.1** sólo si corres `verify:m23:frontend` (y por tanto `verify:m9`).

**La buena noticia:** los ~30 gates `*-db` **no necesitan credenciales de
Supabase**. Cada uno levanta un Postgres efímero, aplica migraciones, corre su test
y borra todo. Puedes verificar el sistema completo sin un secreto de producción.

```bash
npm run verify            # lint + typecheck + unitarias + build
LC_ALL=C npm run verify:operations-sla-db
npx playwright test --workers=2
```

Fallas conocidas que **no** son tuyas: `verify:cadence-db` sólo pasa los días 1-28
del mes, y `verify:operations-sla-db` está rojo por podredumbre de fecha en su
propio sembrado sintético.

---

## 10. Cómo te enteras de una respuesta

Antes del 1-sep no había forma: había que abrir el Control Room por cuenta propia.
Ahora hay tres capas, **en el código pero aún sin desplegar** (espera el go de Jorge):

1. **Alerta inmediata** — el cron de `gmail-sync` (cada 5 min, L-V) manda Telegram
   en cuanto ingesta respuestas humanas, con el plazo y la liga. Los auto-reply no
   disparan SLA.
2. **Red de las 2 horas** — el watchdog (cada 30 min) grita si hay respuestas sin
   clasificar de más de 2 h, y en live también si no hay responsable activo.
3. **Snapshot diario** — 09:45 y 18:30 CDMX.

> **Las alertas salen mudas hasta que existan `TELEGRAM_BOT_TOKEN` y
> `TELEGRAM_CHAT_ID` en Vercel.** Sin ellas el notificador regresa `false` en
> silencio, por diseño. Es un pendiente de Jorge de 2 minutos y el que más rinde.

Del lado de la base, `read_dispatch_health` ya expone `reply_operations`
(pendientes, antigüedad, casos abiertos, responsable activo). Esa migración (M040)
**sí está aplicada en producción**, con rollback probado de ida y vuelta.

---

## 11. Estado: qué está vivo y qué no

| Pieza | Estado |
|---|---|
| Plazo 18:00 + caso P1 al clasificar positiva | **Vivo** |
| Calendario de días hábiles 2026-2027 | **Vivo**. Estuvo vacío y mataba el ruteo de positivas |
| `reply_operations` en el informe de salud | **Vivo en producción** (1-sep) |
| Asignación de responsable | **Viva**: Jorge primario, sin respaldo |
| Copy (32 correos + segunda vuelta + 2 PDFs) | **Escrito y verificado** |
| 1,831 empresas | **Listas, 0 cargadas** — bloqueadas por el primer acceso de Jorge |
| Alerta de Telegram + watchdog nuevo | **Código en `main`, NO desplegado** |
| Envs de Telegram | **Faltan.** Sin ellos, mudo |
| Tú como respaldo | **Vacante** |
| Correos enviados | **0.** El motor está en sombra |

El primer correo real no sale antes de octubre: el calentamiento de buzones son 42
días fijos y **no ha arrancado**. Las tres exhibiciones del contrato corren antes
(segunda 14-sep, tercera 14-oct).

---

## 12. Trampas que ya costaron tiempo

- **El candado de deploy mata el comando entero.** Un comando con `vercel --prod`,
  `git push main` o `supabase db push` se bloquea aunque venga detrás de `&&`.
  Pruebas solas, luego deploy solo. (Es un hook local de la máquina de Jorge; **en
  tu VPS no existirá**, así que del lado tuyo el único freno es la regla escrita.)
- **`npm run typecheck` puede pasar y `next build` fallar.** Corre el build después
  de tocar pruebas.
- **Un bucle de incidentes congeló el canal dos veces** (2,522 P1 el 26-27 ago),
  por dos causas distintas: eventos del outbox abandonados sin marcar, y el sync
  rindiéndose antes de drenar cuando faltaban credenciales. Ambas arregladas con
  prueba. **Si vuelven a aparecer incidentes con clave `outbox:`, mira ahí primero.**
- **Valores de DNS y tokens del DOM o del portapapeles, jamás por OCR de captura.**
  Un `0` leído como `O` costó dos horas.
- **Documentos OBSOLETOS que NO debes ejecutar:**
  `runbook-activacion-jorge-2026-08-26.md` y `paquete-junta-francisco-2026-08-27.md`.
  La fuente vigente de bloqueadores es `docs/external/bloqueadores-2026-08-29.md`.

---

## 13. Lo que NO verifiqué — huecos honestos

- **[HUECO] El contrato dice cuatro estados; el código admite dos.** La cláusula
  01 incluye **Jalisco y Michoacán**, pero `src/lib/research/contracts.ts` sólo
  acepta `GUANAJUATO` y `QUERETARO`, y la verificación de cuentas los descarta.
  Hay **176 filas de PROFEPA de Jalisco y Michoacán ya descargadas** que nunca
  entraron a un lote. Es mercado contractual sin explotar y a la vez un riesgo de
  incumplimiento silencioso.
- **[HUECO] "Seguridad e higiene" no existe como categoría de rol en el sistema.**
  El copy tiene 4 variantes, pero el clasificador de cargos sólo conoce CEO,
  PLANT_DIRECTOR, MAINTENANCE y PROCUREMENT. Un "Coordinador de Seguridad e
  Higiene" cae en `OTHER`, **no cuenta para el gate de 150 contactos y no puede
  ser el contacto de un lead calificado**. La variante que más responde al miedo
  es la que el sistema no sabe reconocer.
- **[HUECO]** No sé si ya tienes cuenta en Supabase, Vercel o el Workspace. Asumí
  que no; por eso el §6 lista todo desde cero.
- **[HUECO]** El RACI (`docs/02-raci.md`) es del 11-ago y quedó desactualizado: las
  filas donde Francisco es aprobador están superadas. No lo actualicé porque
  cambiar autoridad formal es decisión de Jorge.
- **[HUECO]** `docs/external/ennco-google-admin-handoff.md` tiene un paso (DKIM de
  `ennco.com.mx`) que salió del alcance el 29-ago pero **no lleva banner de
  obsolescencia** como sus hermanos.
- **[HUECO] Defecto M041 documentado y sin arreglar:** una respuesta observada
  después de las 18:00 **nace vencida**, porque el deadline usa el corte del mismo
  día. Fix propuesto en `sla-de-respuesta.md`.
- **[HUECO] El select de clasificar tiene "Positiva" por defecto** (§4.3). Es un
  defecto de interfaz con consecuencias irreversibles. El fix es agregar una opción
  vacía obligatoria; no lo hice porque no estaba en el alcance de este handover.

---

## 14. Por dónde empezar

1. Pide a Jorge los accesos del §6, empezando por GitHub.
2. Clona y monta el entorno (§9). Corre `npm run verify` — si pasa, tu caja está bien.
3. Lee, en este orden: este documento, `docs/external/sla-de-respuesta.md` y
   `docs/runbooks/gmail-reply-sync.md`. Son 25 minutos y es el 80% del trabajo.
4. Recorre el Control Room en modo demo (§4.6) antes de tocar datos reales.
5. Decide el camino del §8 y actívate como respaldo.
6. Empuja los dos envs de Telegram con Jorge. Sin eso, todo lo demás es teatro.
7. Cuando Jorge dé el go, despliega el código del SLA que está en `main`.

Cualquier cosa que encuentres mal escrita aquí, corrígela en el repo: este archivo
vive en `docs/external/` y viaja con `git pull`, que es justamente para lo que lo
puse ahí en vez de mandártelo por correo.
