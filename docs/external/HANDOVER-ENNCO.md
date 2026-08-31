# ENNCO — Handover

**Para:** Grant · **De:** Teckel · **Corte:** 31-ago-2026
**Estado verificado contra producción, DNS y APIs. No contra memoria.**

| | |
|---|---|
| Repo | `~/dev/ennco-revenue-platform` (remoto privado en GitHub) |
| Producción | `ennco-operacion.vercel.app` |
| Base | Supabase `isnzaoifdjtwnugupidj` |
| HEAD | `28791f9` |
| Fuente vigente de bloqueadores | `docs/external/bloqueadores-2026-08-29.md` |

---

## 1. Tablero

| Métrica | Hoy |
|---|---:|
| Correos enviados | **0** |
| Empresas en base | **0** |
| Empresas listas sin cargar | 1,831 |
| Correos redactados | 32 |
| Buzones dados de alta | 4 |
| Días de calentamiento acumulados | **0** |
| Migraciones | 38 |
| Compuertas de verificación | 72 |

La plataforma está construida y el motor corre solo en modo sombra. Lo que no
existe todavía es un solo correo enviado ni un solo contacto en la base.

### Lo primero que tienes que entender

El compromiso contractual son **10 leads calificados al mes**, y el conteo
arranca en el primer mes calendario completo con campañas operando. Hoy no hay
campañas operando, así que el reloj contractual no ha empezado.

Pero los pagos sí corren: **segunda exhibición 14-sep, tercera 14-oct**. Con el
calentamiento sin arrancar, el primer correo real no sale antes del **12-oct**.
El cliente va a pagar las tres exhibiciones antes de ver un correo salir.

---

## 2. El contrato

Firmado por ambas partes el **10-ago** en BoldSign (`4c7ae099-8753-4443-a282-5641bb81ca33`).
$100,000 MXN + IVA en tres exhibiciones decrecientes, más **2% de comisión**
sobre contratos cerrados, ventana de atribución 12 meses.

Un lead calificado exige cinco condiciones simultáneas: perfil industrial >100 kWp
en los estados objetivo, no estar en el Anexo A, contacto con nombre y cargo del
área que decide, manifestación expresa de interés, y evidencia documentada. En
duda razonable no cuenta.

Único remedio si falla dos meses seguidos: el cliente termina sin penalización y
sin cubrir exhibiciones pendientes. Sin multas ni reembolsos.

### Contexto de relación

**El cliente dejó de responder.** Jorge decidió el 29-ago que el proyecto sigue
sin depender de él. Todo lo que requería su firma, su buzón o su dominio salió
del plan.

> Si encuentras en el repo "junta con Francisco" o "que Francisco apruebe", ese
> documento está marcado OBSOLETO. El runbook y el paquete de junta llevan aviso
> al inicio. La fuente vigente es `bloqueadores-2026-08-29.md`.

---

## 3. Lo que ya funciona

**Motor de despacho.** Vercel Cron → rutas internas → RPC públicas con prueba
HMAC, sin service-role en Vercel. Corre L-V en ventana 09:30-13:30 CDMX, un
correo por tick de 5 min (dispersión natural). Está en **modo sombra**: hace
todo menos enviar.

**Copy.** 32 correos: 8 toques × 4 perfiles (dirección, mantenimiento,
seguridad e higiene, compras). Anclados en un caso real confirmado por el
cliente: una planta perdió **$2,180,000 en un día por un apagón**. Entre 37 y 81
palabras, sin ligas en el toque 1, con baja explícita en el 8.
Fuente: `docs/external/secuencia-ennco-copy.md`

**Infraestructura de envío.** Dos dominios comprados por Teckel en Vercel
Registrar, DNS bajo nuestros nameservers. Verificado con `dig`: MX en Google,
DKIM publicado y respondiendo en ambos. Tres buzones dados de alta con la ruta
del carril aislado.

**Datos.** 1,831 empresas de fuentes públicas oficiales (PROFEPA, DENUE,
directorios de parques) en 6 lotes listos, cada uno con URL de origen y
checksum. Prueba de Apollo sobre las 10 cuentas Tier 1: resolvió 10/10 y
devolvió 32 candidatos, 21 con correo.

> **Dato para dimensionar:** 2.1 contactos con correo por cuenta. Para el gate
> de 150 contactos hacen falta ~71 cuentas y hay 1,831. Pero ojo con los cargos
> que devolvió: casi todo mantenimiento e ingeniería, 3 de dirección y **cero de
> compras**. La variante de compras casi no se va a usar como está buscando hoy.

---

## 4. Lo que falta, en orden de dependencia

| Qué | Quién | Estado | Destraba |
|---|---|---|---|
| **Herramienta de calentamiento** | Decisión de Jorge | Sin resolver | El reloj de 42 días |
| **Tarjeta del trial de Workspace** | Jorge | **Vence 9-sep** | Que no se caigan los buzones |
| **Primer acceso de operador** | Jorge, 2 min | Nadie ha entrado nunca | Cargar las 1,831 empresas |
| Facturación de Google Cloud | Jorge, 3 min | Pendiente | Cifrado KMS de credenciales |
| Rotar 2 secretos OAuth | Jorge, 5 min | Comprometidos | Conexión de buzones |
| Verificación de contactos | Teckel | Bloqueado por acceso | Gate de 75 cuentas / 150 contactos |
| Entregables que el copy promete | Teckel | **No existen** | Que la respuesta convierta |
| Proceso de respuesta | Teckel | Sin definir | Que un "sí" no se caiga |

### Los dos huecos que más preocupan

**Los correos ofrecen cosas que no existen.** El toque 4 promete "el formato del
reporte" y el de compras "el alcance mínimo que debería traer cualquier póliza".
Si alguien contesta "sí, mándamelo", no hay qué mandar. Se cae la conversión en
el momento más valioso.

**Nadie definió qué pasa cuando responden.** El CTA principal pide que te dirijan
con mantenimiento. Cuando contesten "habla con Juan", hay que escribirle a Juan,
y ese correo no está escrito. Tampoco hay SLA de respuesta ni segundo
responsable.

---

## 5. Minas — errores ya cometidos

*Esta sección vale más que las demás. Son cosas que costaron tiempo real.*

### Se listaron seis bloqueadores del cliente; cinco eran nuestros

Se asumió que el cliente controlaba dominios, DNS y cuentas. Al correr `dig`,
los dominios estaban en el registrador de Teckel, el DNS bajo nuestros
nameservers, el DKIM ya publicado, y la cuenta "admin" con el nombre del cliente
era un buzón en nuestro propio dominio.

> **Regla:** antes de decir "esto lo bloquea X", correr `dig NS`, `dig MX` y
> `dig TXT google._domainkey`. Diez segundos.

### Se dio por hecho que Apollo hace calentamiento

El plan aprobado decía "conectar los buzones a Apollo para warmup". Apollo
**discontinuó esa función en 2024** por incumplir políticas de Gmail. De haber
seguido, se habría descubierto en octubre que el reloj nunca arrancó. Apollo sí
acepta buzones externos por OAuth y reconoce el calentamiento hecho en otra
herramienta.

> **Regla:** verificar que una capacidad existe antes de construir un plan encima.

### Un bucle exponencial de incidentes impedía todo envío

El consumidor del outbox reclamaba eventos y los que no entendía los abandonaba
sin marcarlos. Quedaban pendientes para siempre, el vigilante los veía detenidos
y abría un incidente, que generaba otro evento. Llegó a 2,522 creciendo en cada
corrida. Y como el código exige `open_p1 === 0` para permitir envíos externos,
**el primer correo habría fallado sin explicación**. Arreglado y verificado.

> **Regla:** todo evento reclamado de una cola sale del limbo: completado o fallado.

### La tabla de días hábiles estaba vacía en producción

La función que calcula plazos revienta sin calendario, y de ella dependen
solicitar aprobaciones operativas y rutear respuestas positivas. El sistema
habría lanzado un error justo cuando un prospecto contestara que sí. Ya se
sembró 2026-2027 y el vigilante avisa bajo 90 días hábiles.

> **Regla:** un dato operativo con horizonte necesita vigilancia en producción,
> no una prueba local.

### Cuatro versiones del copy rechazadas

Se rechazaron: lista de capacidades, carta de despacho, advertencia abstracta, y
una sin CTA. Funcionó el molde que dictó Jorge: golpe con consecuencia y cifra
real → el mecanismo por el que pasa → una sola pregunta fácil → diferenciador en
una línea.

> **Regla:** cuando el cliente da un ejemplo de lo que quiere, ese ejemplo es la
> especificación. Copiar su estructura antes de "mejorarla".

### Trampas de operación diarias

- El candado de despliegue **mata el comando entero** si contiene `vercel --prod`
  o `git push main`, aunque venga después de `&&`. Correr pruebas solas, luego
  desplegar solo.
- Los gates de base necesitan `LC_ALL=C` para arrancar su Postgres efímero.
- Con la Mac cargada: `playwright test --workers=2` evita 17 fallos que son
  contención, no regresiones.
- Valores de DNS y tokens **siempre del DOM**, nunca de una captura. Confundir un
  cero con una O costó dos horas.
- El gate de cadencia (`verify:cadence-db`) sólo corre los días 1-28 del mes.
  Documentado en el propio archivo, hay tarea abierta para darle reloj propio.

---

## 6. Dónde vive cada cosa

| Pieza | Dónde | Quién controla |
|---|---|---|
| Código | `~/dev/ennco-revenue-platform` | Teckel |
| Base | Supabase `isnzaoifdjtwnugupidj` | Teckel |
| Aplicación | Vercel, proyecto `ennco-operacion` | Teckel |
| Dominios de envío | Vercel Registrar, DNS en `vercel-dns.com` | Teckel |
| Buzones | Workspace nuevo, admin `francisco@enncoenergia.com` | Teckel |
| Datos y verificación | Apollo, cuenta Teckel, 4,000 créditos | Teckel |
| Cifrado de credenciales | GCloud `august-beaker-478801-t3` | Teckel, **sin facturación** |
| Buzón del cliente | `contacto@ennco.com.mx`, DNS en Hostinger | ENNCO, **fuera del plan** |

Los secretos viven en el ambiente de Vercel y en una tabla privada de la base.
Nunca en el repo ni en chats. Compuerta: `npm run verify:secrets`.

---

## 7. Qué haría yo el primer día

1. Leer `docs/external/bloqueadores-2026-08-29.md` y la memoria del proyecto.
   Ignorar runbook y paquete de junta: marcados obsoletos por una razón.
2. Correr la batería: `npm run test`, los gates con `LC_ALL=C`, y
   `npx playwright test --workers=2`. Salvo el gate de cadencia, todo pasa.
3. **Resolver la herramienta de calentamiento y arrancarla el mismo día.** Es lo
   único que no se puede acelerar después.
4. Empujar los tres pendientes de Jorge que son de minutos: su primer acceso,
   facturación de GCloud, y la tarjeta del trial antes del 9-sep.
5. Con su sesión viva, cargar las 1,831 empresas y arrancar la verificación de
   contactos hacia el gate de 75/150.
6. Escribir los dos entregables que el copy promete y el correo de segunda
   vuelta. Sin eso, las respuestas buenas se caen.

### Lo que decide el calendario

Todo lo demás se puede paralelizar. **El calentamiento no.** Son 42 días fijos
por buzón y no arrancan hasta conectarlos a una herramienta que los caliente.

- Si arrancan **hoy** → el canal abre el **12 de octubre**
- Si se van a mediados de septiembre → abre en noviembre, y noviembre era el
  primer mes con capacidad para cumplir el compromiso de leads
