# Bloqueadores para el primer envío — instrucciones exactas

Corte: 29 de agosto de 2026, verificado contra producción, BoldSign y Apollo.
Cada bloqueador dice quién lo hace, los pasos literales, cuánto tarda y qué
destraba. Orden por dependencia: el bloque A no necesita a nadie, el B te toma
2 minutos, el C es una sesión conmigo y el D es con Francisco.

Regla que no cambia: ninguna contraseña ni secreto se escribe en un chat. Los
secretos nuevos se dictan en sesión y van directo a Vercel.

---

## A. Lo que hago yo, sin ti (arranca hoy)

### A1. Cortar el bucle de 2,522 incidentes P1 — CRÍTICO

Hay 2,522 incidentes P1 abiertos, todos "SLA operativo vencido: INCIDENT_ACK",
autogenerados el 26 y 27 de agosto. Un incidente abre un caso de SLA, nadie lo
reconoce, el caso vence y eso abre otro incidente.

**Por qué importa:** `isControlCadenceReleaseAllowed` exige `open_p1 === 0`
para permitir cualquier envío externo. Con esos incidentes abiertos **el canary
no habría salido**, aunque todo lo demás estuviera aprobado.

Corto la retroalimentación en su origen, cierro los 2,522 y dejo un gate que
falle si el bucle se reabre.

### A2. Los dos entregables que el copy promete

Los correos ofrecen "el formato del reporte" (toque 4) y "el alcance mínimo que
debería traer cualquier póliza" (toques 2 y 3 de compras). **No existen.** Si un
prospecto contesta "sí, mándamelo", no hay qué mandar y se cae la conversión en
el momento más valioso. Los escribo.

### A3. El correo de segunda vuelta

El CTA principal es "¿me puedes dirigir con quien lleva mantenimiento?". Cuando
contesten "habla con Juan", hay que escribirle a Juan. Ese correo no existe.

### A4. Anexo A cargado en BoldSign como borrador

Verificado hoy: el Anexo A **no está en BoldSign**. Lo dejo como borrador con
los dos firmantes puestos, para que tú solo des Send.

---

## B. Tuyo, hoy, 2 minutos

### B1. Tu acceso de operador

Sin esto no entra ni una de las 1,831 empresas. Ya no pide segundo factor.

1. Abre `ennco-operacion.vercel.app/ingreso/recuperar`
2. Escribe `george@teckel-ai.com` y envía
3. Avísame. Yo confirmo en la base, en segundos, si el correo salió de verdad.
   Si salió y no te llega, es spam. Si no salió, es configuración y la arreglo.
4. Abre el enlace del correo y crea una contraseña sólo para el Control Room
5. Entras directo a `/operacion`

**Destraba:** cargo las 1,831 empresas y arranco la verificación de contactos.

---

## C. Tuyo, sesión de 20 minutos conmigo

Traes abiertas dos consolas. Yo te dicto cada click y verifico en vivo.

### C1. DKIM de `ennco.com.mx` (8 min)

Hoy el buzón primario tiene `auth_dkim = false`. Sin DKIM, los correos de
`contacto@ennco.com.mx` entran a spam.

1. `admin.google.com` con el admin de ENNCO
2. Apps → Google Workspace → Gmail → **Autenticar correo electrónico**
3. Dominio `ennco.com.mx` → **Generar registro nuevo**, 2048 bits
4. Copiar el TXT **del DOM, no de una captura** (el typo de un cero por una O
   nos costó dos horas el 26-ago)
5. Publicarlo en el DNS de `ennco.com.mx`
6. Volver y pulsar **Iniciar autenticación**

Propaga en 24-48 h. Yo la monitoreo.

### C2. Rotar los 2 secretos OAuth comprometidos (5 min)

1. `console.cloud.google.com`, proyecto `august-beaker-478801-t3`
2. APIs y servicios → Credenciales → cliente "ENNCO Operacion Production"
3. **Eliminar los 2 client secrets existentes.** Nadie los usa, borrar no rompe
4. **Agregar secreto nuevo** → me lo dictas → lo cargo en Vercel y en ningún
   otro lado

### C3. Facturación de Google Cloud (3 min, centavos al mes)

Mismo proyecto → Facturación → **Vincular cuenta de facturación**, tarjeta
Teckel. Es sólo para el cifrado KMS de las credenciales.

**Destraba:** creo la llave KMS y hago el redeploy. Sin esto el buzón no puede
guardar su credencial cifrada.

### C4. Postmaster Tools (2 min)

`postmaster.google.com` → Agregar dominio `ennco.com.mx` → TXT al mismo DNS del
paso C1. Es el tablero de reputación que la rampa revisa a diario.

---

## D. Con Francisco

### D1. Visto bueno del copy (30 min)

Le muestras la pieza de aprobación. El contrato (cláusula 07) pide este visto
bueno **una sola vez** y da 3 días hábiles. Aprobar en la junta arranca el reloj
ese día.

**Destraba:** congelo los textos con huella digital y armo el manifiesto del
canary.

### D2. Aviso de privacidad (20 min) — EL CRITICAL PATH

Sin esto no sale ni un correo, por más que todo lo demás esté listo.

- Texto en vivo: `ennco-operacion.vercel.app/privacidad`
- Versión `2026-08-11-v1`, SHA256 `d4a24f2335…1fc718e`

Son 8 confirmaciones, todas pre-resueltas en la pieza. La aprobación se registra
contra esa versión y ese hash: si el texto cambia después, hay que re-aprobar.

### D3. Anexo A firmado (5 min)

Yo lo dejo como borrador en BoldSign (A4). Tú das Send, firman los dos.

**Ojo:** hay 6 documentos viejos en InProgress con correos de prueba
(`george+ennco@teckel-ai.com`, `pendiente@ennco.com.mx`). Si BoldSign manda
recordatorio, le llega a Francisco y se ve mal. Hay que revocarlos.

El contrato principal **ya está firmado por ambos** desde el 10-ago
(`4c7ae099-8753-4443-a282-5641bb81ca33`). Ese no se toca.

### D4. Instrucciones de acceso a los 3 buzones — MANDA EL CALENDARIO

Los buzones existen, los dominios están verificados y el DKIM autentica. Lo
único que falta es que Francisco reciba sus accesos y los conectemos al
calentamiento.

1. `admin.google.com` de la organización nueva (admin `francisco@enncoenergia.com`)
2. Directorio → Usuarios
3. Por cada uno de los tres, botón **Enviar instrucciones de acceso** a
   `francisco.cuellar@ennco.com.mx`

**Destraba: arranca el reloj de 42 días.** Si sale hoy, el canal completo abre
el 10 de octubre. Cada día que se recorra, se recorre noviembre uno a uno, y
noviembre es el primer mes con capacidad para el compromiso de leads.

### D5. Consentimiento OAuth de `contacto@ennco.com.mx` (2 min)

Un click de Francisco en la pantalla de Google, o ratifica que lo ejecute Teckel
con la autorización escrita del 20-ago.

### D6. Una pregunta de alcance (1 min)

El Anexo A excluye a POSCO MPPC (Celaya). Existe POSCO MVWPC (Villagrán), del
mismo grupo. ¿La exclusión alcanza a todo el grupo o sólo a MPPC?

---

## E. Pendiente chico con fecha

Tarjeta del trial de Google Workspace: son 14 días desde el 26-ago, así que
vence alrededor del **9 de septiembre**. Si no se pone tarjeta, se caen los
cuatro buzones y con ellos el calentamiento.

---

## Los nueve marcadores del buzón primario

Estado verificado hoy de `contacto@ennco.com.mx`:

| Marcador | Hoy | Lo destraba |
|---|---|---|
| DKIM | falso | C1 |
| Credencial | desconocida | C2 + C3 + D5 |
| Semilla Gmail | falsa | yo, tras D5 |
| Semilla Outlook | falsa | yo, tras D5 |
| Semilla Yahoo | falsa | yo, tras D5 |
| Reply sync | falso | yo, tras D5 |
| Baja en un click | falso | yo, tras D5 |
| Blocklist | desconocida | yo, tras C4 |
| Límite diario | 0 | se abre solo al pasar los anteriores |

SPF y DMARC ya están en verde.
