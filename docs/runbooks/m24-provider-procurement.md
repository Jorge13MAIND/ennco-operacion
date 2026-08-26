# Runbook M24. Procurement y activación de proveedores

Estado: Apollo `IN_PROGRESS_EXTERNAL` por Paco. Las demás compras y conexiones permanecen en `HOLD`.

## Antes del checkout

1. Confirmar aprobación de gasto y método de pago.
2. Confirmar que ENNCO será titular, billing owner y recovery owner.
3. Confirmar un asiento Apollo Professional mensual.
4. Verificar precio, impuestos, renovación y fecha límite de cancelación en checkout.
5. Guardar captura o PDF del checkout y su SHA256 antes de pagar.
6. Rechazar add-ons, teléfonos, dominios y buzones vendidos por Apollo.

## Después del checkout

1. Activar MFA sin compartir credenciales.
2. Configurar recuperación independiente de Teckel.
3. Fijar el perfil como `Francisco Cuellar`.
4. Fijar cap interno de 500 créditos.
5. Registrar owner, asiento, renovación, costo y evidencia en el Control Room.
6. No conectar ningún buzón hasta verificar que pertenece a ENNCO.

## Entrega de API a Teckel

1. Crear una llave con los scopes mínimos para perfil, lista de buzones y búsqueda de contactos guardados.
2. No enviar la llave por correo, WhatsApp, issue, documento o chat. Cargarla directamente como secreto de entorno controlado.
3. Ejecutar `npm run capture:apollo-api-readiness`.
4. Confirmar que el usuario efectivo es Francisco Cuellar. Apollo atribuye una API key al administrador activo más antiguo del workspace, no necesariamente a quien creó la llave.
5. Confirmar cap de 500 créditos y que los teléfonos no forman parte del flujo.
6. Mantener `ENNCO_ALLOW_EXTERNAL_SEND=false` y `ENNCO_GLOBAL_KILL_SWITCH=true`.
7. Si falta un buzón, un scope, la identidad o el dato de créditos, conservar `HOLD` y corregir en Apollo.

El preflight no puede crear contactos, editar secuencias ni enviar. La búsqueda exacta usa únicamente registros ya guardados y no confía en contadores agregados.

## Dominios

1. Revisar los cuatro candidatos en orden.
2. Verificar disponibilidad, marca, historial, blocklists y costo.
3. Comprar los primeros dos que pasen.
4. Mantener el registrador separado de Apollo.
5. No tocar `ennco.com.mx` para cold outreach.

## Buzones

Crear dos identidades por dominio:

- `francisco@<dominio>`
- `fcuellar@<dominio>`

Cada buzón requiere MFA u OAuth, identidad visible, SPF, DKIM, DMARC, TLS, Postmaster, seeds Gmail, Outlook y Yahoo, baja, reply sync y 42 días completos.

## Evidencia requerida

- Propietario y billing ENNCO.
- Cero contraseñas compartidas.
- Captura del plan y renovación.
- IDs externos almacenados sólo como SHA256.
- DNS observado desde resolución pública.
- Headers de seeds recibidos.
- Salud por buzón observada dentro de 24 horas.
- Cero envíos reales antes del gate.

## Abort conditions

- Checkout cambia a anual o agrega activos no solicitados.
- La cuenta queda bajo Teckel.
- El nombre visible no es Francisco Cuellar.
- Un buzón aparece ligado a otra organización Apollo.
- Apollo intenta usar el dominio principal ENNCO.
- Cualquier estado desconocido.
