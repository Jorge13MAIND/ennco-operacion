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

## C. Tuyo, sesión corta conmigo — 10 minutos

Sólo quedan dos, y las dos son de consolas de **Teckel**, no de ENNCO.
El DKIM de `ennco.com.mx` y Postmaster de ese dominio SE ELIMINARON del plan:
eran del buzón de Francisco.

### C1. Rotar los 2 secretos OAuth comprometidos (5 min)

1. `console.cloud.google.com`, proyecto `august-beaker-478801-t3`
2. APIs y servicios → Credenciales → cliente "ENNCO Operacion Production"
3. **Eliminar los 2 client secrets existentes.** Nadie los usa, borrar no rompe
4. **Agregar secreto nuevo** → me lo dictas → lo cargo en Vercel y en ningún
   otro lado

### C2. Facturación de Google Cloud (3 min, centavos al mes)

Mismo proyecto → Facturación → **Vincular cuenta de facturación**, tarjeta
Teckel. Es sólo para el cifrado KMS de las credenciales de los buzones.

**Destraba:** creo la llave KMS y hago el redeploy. Sin esto ningún buzón puede
guardar su credencial cifrada, ni los nuestros.

## D. FRANCISCO ESTÁ FUERA — el canal es nuestro

**Decisión de Jorge, 29-ago: ya no contamos con Francisco.** Esta sección
existe para que ninguna sesión futura vuelva a listar dependencias suyas.

### Lo que se verificó contra el DNS real, no contra suposiciones

| | `enncoindustrial.com` · `enncoenergia.com` | `ennco.com.mx` |
|---|---|---|
| Nameservers | `ns1/ns2.vercel-dns.com` (**Teckel**) | `dns-parking.com` (Hostinger, ENNCO) |
| Registrador | Vercel Registrar, equipo Teckel | ENNCO |
| MX | Google | Google |
| DKIM | **publicado y respondiendo** | **vacío** |

La cuenta "admin" del Workspace nuevo es `francisco@enncoenergia.com`: **es un
buzón en nuestro propio dominio**. Lleva su nombre por continuidad de marca,
pero la cuenta la creamos nosotros y el control es de Teckel.

**Conclusión: el canal de 4 buzones no depende de Francisco en absoluto.**

### Lo que se cae del plan, definitivamente

- DKIM de `ennco.com.mx` — era para SU buzón
- Consentimiento OAuth de `contacto@ennco.com.mx` — su buzón
- Enviar instrucciones de acceso — la cuenta es nuestra
- Visto bueno del copy — Jorge asume el riesgo de la cláusula 07 (DEC-107)
- Firma del Anexo A — queda como riesgo de comisión asumido por Jorge
- Postmaster Tools de `ennco.com.mx` — su dominio; se hace de los nuestros

### Lo que cuesta soltarlo

El carril rápido existía para no esperar el calentamiento. Sin él, el primer
correo sale al terminar los 42 días de los buzones propios: **10 de octubre si
se conectan el 29-ago**. No se puede comprar velocidad aquí.

### El remitente cambia

Los correos salen de `francisco@enncoindustrial.com` (dominio registrado a
nombre de ENNCO, operado por Teckel) en lugar de `contacto@ennco.com.mx`.
Requiere reescribir la ruta del motor: hoy el único buzón dado de alta en la
base es el de Francisco, con `eligibility_route = EXISTING_PRIMARY_GMAIL_RAMP`.

## E. Pendiente chico con fecha

Tarjeta del trial de Google Workspace: son 14 días desde el 26-ago, así que
vence alrededor del **9 de septiembre**. Si no se pone tarjeta, se caen los
cuatro buzones y con ellos el calentamiento.

---

## El buzón que importa ahora

`contacto@ennco.com.mx` **queda fuera del programa**. Sus nueve marcadores en
rojo dejan de ser bloqueadores: no vamos a usar ese buzón.

Los cuatro buzones que sí importan viven en dominios de Teckel con DNS propio y
DKIM ya autenticando. Lo que les falta es entrar a la base con la ruta correcta,
recibir su credencial cifrada (depende de C2) y conectarse al calentamiento.

Estado real de los dominios propios, verificado por DNS el 29-ago:

| Comprobación | Resultado |
|---|---|
| Nameservers | `vercel-dns.com`, control de Teckel |
| MX | `smtp.google.com`, buzones activos |
| DKIM | publicado y respondiendo en ambos dominios |
| SPF | `include:_spf.google.com` |
| DMARC | `p=none` con reporte |
