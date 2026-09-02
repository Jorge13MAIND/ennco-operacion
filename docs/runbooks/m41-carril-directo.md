# Runbook M41 · Encender el carril directo

**Corte:** 2-sep-2026. Pasos en orden de dependencia. Los marcados 👤 los hace
una persona con acceso a consolas externas; el repositorio no puede hacerlos.

## 0. Antes de tocar producción

```bash
npm run verify:direct-lane-sequence
LC_ALL=C npm run verify:direct-lane-db
npm run verify   # lint + typecheck + unitarias + build
```

## 1. 👤 Cliente OAuth de Google (5 minutos, Jorge o Grant)

Proyecto `august-beaker-478801-t3` → APIs y servicios → Credenciales → cliente
"ENNCO Operacion Production":

1. Eliminar los client secrets existentes (comprometidos). Crear uno nuevo.
2. Confirmar que la URI de redirección autorizada incluye exactamente
   `https://ennco-operacion.vercel.app/api/v1/operations/infrastructure/gmail/oauth/callback`.
3. Pantalla de consentimiento: tipo **Interno** si el proyecto pertenece al
   Workspace de los buzones; si es Externo, agregar cada buzón como usuario de
   prueba (incluido `contacto@ennco.com.mx`).
4. Dictar el secret en sesión; va a Vercel y a ningún otro lado.

No necesita facturación ni KMS.

## 2. 👤 Variables en Vercel (proyecto `ennco-operacion`, Production)

```
ENNCO_DIRECT_LANE_RELEASED=true
ENNCO_DIRECT_LANE_MODE=shadow
ENNCO_DIRECT_LANE_VAULT_KEY=<openssl rand -base64 32>   (sensitive)
GOOGLE_OAUTH_CLIENT_SECRET=<nuevo>                       (sensitive)
```

`GOOGLE_OAUTH_CLIENT_ID` y `GOOGLE_OAUTH_REDIRECT_URI` ya existen. Guardar la
llave de la bóveda también en el gestor de secretos de Teckel: si se pierde,
hay que reconectar todos los buzones.

## 3. Aplicar M041 y desplegar

```bash
supabase db push        # o el flujo de migraciones acordado con Jorge
vercel --prod           # con el go de Jorge
```

Verificar en Supabase que `public.read_direct_lane_health` existe y que
`public.mailboxes` tiene `direct_lane_status`.

## 4. Conectar los buzones propios

En `/operacion/correos`, por cada buzón (`francisco@enncoindustrial.com`,
`fcuellar@enncoindustrial.com`, `francisco@enncoenergia.com`):

1. **Generar liga de conexión**. Copiarla: se muestra una sola vez.
2. Abrirla en una ventana de incógnito, iniciar sesión en Google como ese buzón
   (contraseña del Workspace) y aceptar.
3. La fila cambia a **Conectado**. Si dice *identidad*, se entró con otra cuenta.

## 5. Sombra primero

Con `ENNCO_DIRECT_LANE_MODE=shadow`:

1. Crear la campaña (borrador). `teckel_admin` la aprueba.
2. Verificar que el Anexo A esté aplicado (Infraestructura → Anexo A). Sin él,
   el claim en live responde `ANNEX_A_NOT_READY` y la inscripción marca
   SUPPRESSED lo que corresponda.
3. Inscribir una tanda pequeña (5). En el siguiente tick aparecen toques en
   **Sombra** en Actividad. Confirmar: variante correcta por cargo, render sin
   `{{…}}`, remitente = buzón conectado.
4. Revisar que `correos-sync` haya escrito el cursor de cada buzón (columna
   Respuestas muestra "Sync hh:mm").

## 6. Live

1. `ENNCO_DIRECT_LANE_MODE=live` y redeploy.
2. `runtime_controls`: `global_kill_switch=false`, `external_send_allowed=true`
   (la misma decisión que cualquier envío externo; exige `ENNCO_UNSUBSCRIBE_RELEASED`).
3. Primer tick en ventana: un correo por buzón. Verificar en el buzón enviado
   que el Message-ID es `<msg-<uuid>@<dominio>>` y que hay Telegram si algo falla.
4. Responder desde otro buzón a ese correo y confirmar que en ≤10 minutos
   aparece en Respuestas y en Correos, con la secuencia detenida.

## 7. El siguiente buzón: `contacto@ennco.com.mx`

Ya está en la base con techo 20/día. Cuando Paco esté listo:

1. Generar liga de conexión en su fila y enviársela.
2. Paco la abre, entra como `contacto@ennco.com.mx` y acepta. No da contraseña,
   no cambia DNS, no mueve su correo.
3. Inscribir sólo cuentas Tier 1 en ese buzón (selector de buzón al inscribir).

Requisito de entregabilidad que sigue siendo suyo: publicar el DKIM de
`ennco.com.mx` (runbook del 1-sep).

## Trampas

- El callback exige la cookie del carril; si el navegador la bloquea
  (tercero/incógnito con restricciones), regresa *rechazada*. Reintentar en
  una ventana normal.
- Un `SENDING` de más de 15 minutos se marca `FAILED` solo; tres fallos del
  mismo toque pausan esa inscripción con `DISPATCH_FAILED_<código>`.
- Las respuestas sin `In-Reply-To` a un `msg-<uuid>` no se procesan: correos
  fríos entrantes no son respuestas.
- `PACING_HOLD` y `BUDGET_EXHAUSTED` en Actividad son ritmo y tope, no fallas.
