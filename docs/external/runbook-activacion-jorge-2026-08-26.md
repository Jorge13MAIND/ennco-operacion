> # ⚠️ DOCUMENTO OBSOLETO — NO EJECUTAR
>
> **29-ago-2026: Francisco quedó fuera del programa por decisión de Jorge.**
> Todo lo que este archivo pide de él, de su buzón `contacto@ennco.com.mx` o de
> su dominio `ennco.com.mx` **ya no aplica**. El canal corre en buzones de
> dominios de Teckel con DNS propio.
>
> **Fuente vigente: `docs/external/bloqueadores-2026-08-29.md`.**
> Si estás leyendo esto en una sesión nueva, abre ese archivo y ignora éste.

# Runbook de activación — acciones humanas (Jorge)

Fecha: 2026-08-26. Complemento del plan aprobado de la máquina de correos.
Todo lo de este documento requiere manos humanas (pagos, consolas con MFA).
Claude prepara, verifica y opera todo lo demás; estas son las llaves que solo
tú puedes girar. Tiempo total estimado: **45-60 minutos repartidos en 2 días**.

Regla de oro: ninguna contraseña ni secreto se pega en chats. Los secretos
nuevos van directo a su destino (Vercel) o se dictan en sesión en vivo.

---

## HOY (martes 26) o mañana temprano — 25 minutos

### 1. Comprar los 2 dominios (~10 min, ~$25-30 USD/año, tarjeta Teckel)

Disponibilidad verificada hoy 26-ago: los dos están LIBRES.

1. Entra a **Cloudflare Registrar** (precio de costo, ~$10.44 USD/año cada uno)
   o Namecheap si prefieres.
2. Compra exactamente: `enncoindustrial.com` y `enncoenergia.com`
   (la plataforma los tiene grabados con ese nombre exacto; otro nombre
   requiere cambio de código).
3. Datos del registrante: **ENNCO / Francisco Javier Cuellar Orozco**,
   correo `francisco.cuellar@ennco.com.mx` (propiedad del cliente desde el
   día uno; el pago lo absorbe Teckel las 12 semanas, como marca el contrato).
4. Activa renovación automática y candado de transferencia.

### 2. Google Workspace para los buzones nuevos (~15 min, ~$18 USD/mes)

1. `workspace.google.com` → contratar **Business Starter** con
   `enncoindustrial.com` como dominio principal.
2. Agregar `enncoenergia.com` como dominio secundario
   (Admin → Cuenta → Dominios → Agregar dominio).
3. Crear 3 usuarios (nombre visible **Francisco Cuellar** en los tres):
   - `francisco@enncoindustrial.com`
   - `fcuellar@enncoindustrial.com`
   - `francisco@enncoenergia.com`
4. Verificación de dominio: Google te da un registro TXT; se publica en el
   DNS del registrador del paso 1 (si compraste en Cloudflare, el DNS ya
   queda ahí mismo). Si te aparece cualquier pantalla dudosa, me la lees y
   te digo exactamente qué va.
5. Avísame al terminar: yo configuro SPF/DKIM/DMARC de los dominios nuevos,
   los conecto a Apollo para warmup y **arranca el reloj de 42 días**.

---

## Sesión de 20 minutos conmigo (hoy o mañana) — consolas de ENNCO

Traes abiertas las dos consolas; yo te dicto cada click y verifico el
resultado en vivo. Antes de entrar con la cuenta admin de ENNCO
(`contacto@ennco.com.mx`): **cámbiale la contraseña** (la actual viajó por
WhatsApp y el programa la considera comprometida; DEC-021).

### 2b. Tu acceso de operador a la plataforma (~2 min) — desbloquea la carga de leads

Toda la carga de datos al Research Workbench exige sesión de operador, y
**ningún usuario de producción había entrado nunca**. Sin esto, las 1,831
empresas del sourcing (batches ya preparados y verificados) no pueden entrar.

Por decisión tuya del 27-ago (DEC-106) el acceso ya **no pide segundo
factor**: usuario, contraseña y recuperación, nada más. Ya está desplegado
y verificado en producción.

1. `ennco-operacion.vercel.app/ingreso` → "¿Olvidaste tu contraseña?" con
   `george@teckel-ai.com` → te llega el enlace de recuperación al correo.
2. Crea una contraseña SOLO para el Control Room (no reutilices ninguna).
3. Listo, entras directo. Ya no hay pantalla de código.
4. Con tu sesión viva, yo ejecuto los 7 POST de ingest desde tu navegador
   (extensión) — tú solo miras. Cero contraseñas por chat, como siempre.

### 3. DKIM del dominio principal `ennco.com.mx` (~8 min)

En `admin.google.com` (admin de ENNCO):
Apps → Google Workspace → Gmail → **Autenticar correo electrónico** →
dominio `ennco.com.mx` → **Generar registro nuevo** (2048 bits) → copiar el
TXT → publicarlo en el DNS de `ennco.com.mx` (el panel donde vive el DNS del
sitio; si no sabes cuál es, lo averiguamos en la sesión) → volver y pulsar
**Iniciar autenticación**. Propaga en 24-48 h; yo lo monitoreo.

### 4. Rotar los secretos OAuth comprometidos (~5 min)

En `console.cloud.google.com`, proyecto `august-beaker-478801-t3`
(APIs y servicios → Credenciales → cliente "ENNCO Operacion Production"):
1. **Eliminar los 2 client secrets existentes** (quedaron expuestos al
   configurarse; nadie los usa todavía, borrar no rompe nada).
2. **Agregar secreto nuevo** → me lo dictas en la sesión → yo lo cargo
   directo en Vercel como `GOOGLE_OAUTH_CLIENT_SECRET` y en ningún otro lado.

### 5. Facturación de Google Cloud (~3 min, centavos al mes)

Mismo proyecto → Facturación → **Vincular cuenta de facturación** (tarjeta
Teckel; es solo para el cifrado KMS de las credenciales, cuesta centavos).
Con esto yo creo la llave KMS y hago el redeploy final.

### 6. Postmaster Tools (~2 min)

`postmaster.google.com` → Agregar dominio `ennco.com.mx` → TXT de
verificación al DNS (mismo panel del paso 3). Es el tablero de reputación
que la rampa necesita revisar a diario.

---

## Junta con Francisco (idealmente miércoles 27) — checklist

Yo te preparo el paquete completo antes de la junta. Llevas 4 cosas:

1. **Copy de la secuencia** (los 8 toques + la variante corta de 3 del
   arranque). El contrato le da 3 días hábiles y el visto bueno se pide UNA
   sola vez. Si lo aprueba en la junta, mejor.
2. **Aviso de privacidad**: el pack tiene las 8 decisiones pre-masticadas
   (`docs/31-privacy-approval-pack.md`); sesión guiada de 30 min. Sin esto
   no sale ni el primer correo — es EL critical path.
3. **Anexo A por BoldSign**: las 3 empresas confirmadas (POSCO MPPC, MPE
   Plastic, Tejas El Águila) en documento firmado por ambos. El WhatsApp no
   cumple la cláusula 05.2, y sin Anexo A firmado la comisión del 2% queda
   expuesta a disputa.
4. **Consentimiento OAuth de `contacto@ennco.com.mx`**: un click de
   Francisco en la pantalla de Google (o ratifica que lo ejecute Teckel con
   la autorización del 20-ago). 2 minutos.

Extra si fluye: confirmar que el DNS de `ennco.com.mx` (paso 3) está donde
creemos, y mencionar que las campañas arrancan con 5 correos diarios de su
propio buzón, firmados por él, con todo el sistema de frenos activo.

---

## Qué pasa después de cada llave

| Llave girada | Lo que Claude hace inmediatamente |
|---|---|
| Dominios + Workspace | SPF/DKIM/DMARC nuevos, conexión a Apollo, warmup día 1 (termina ~9-oct) |
| DKIM ennco.com.mx | Monitoreo de propagación; seed tests al pasar |
| Secreto OAuth nuevo | Carga en Vercel + redeploy + callback verificado |
| Billing GCloud | CryptoKey KMS + permisos mínimos + redeploy |
| OAuth de contacto@ | Conexión del buzón, seeds Gmail/Outlook/Yahoo, reply sync |
| Copy aprobado | Manifiesto del canary con hashes congelados |
| Privacidad aprobada | Flag de release + verificación |
| Anexo A firmado | Aplicación transaccional en la base (binding) |

Cuando las 8 llaves estén giradas: canary de 5 correos reales con tu
aprobación explícita del lote (~2-8 de septiembre).
