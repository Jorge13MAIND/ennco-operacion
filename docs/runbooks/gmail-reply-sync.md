# Runbook de Gmail Reply Sync

## Estado

Implementado y probado en local con transporte sintetico. No configurado contra Gmail real.

## Precondiciones

1. Cuenta Google Cloud propiedad de ENNCO.
2. Buzon Workspace propiedad de ENNCO.
3. OAuth consent y scopes aprobados.
4. Refresh token cifrado con KMS.
5. Topic y subscription Pub/Sub dedicados.
6. Push auth service account dedicada.
7. Audience exacto del webhook.
8. Secretos del runtime y base coinciden.
9. Supabase dedicado con migraciones aplicadas.
10. `ENNCO_GMAIL_WEBHOOK_RELEASED=false` hasta terminar el canary.

## Alta de watch

1. Ejecutar `users.watch` con el topic aprobado y label `INBOX`.
2. Registrar `historyId` y `expiration` en `mailbox_sync_cursors`.
3. Renovar antes de la fecha de expiracion.
4. Confirmar que la notificacion inicial llega una sola vez al ledger.
5. Mantener el mailbox en `HOLD` hasta comprobar sync y alertas.

## Procesamiento

1. Validar JWT OIDC de Pub/Sub.
2. Validar `aud`, `email`, `email_verified`, issuer y subscription exacta.
3. Decodificar base64url y validar solo `emailAddress` y `historyId`.
4. Persistir notificacion con idempotencia.
5. Tomar el cursor anterior, nunca el `historyId` entrante como punto de inicio.
6. Recorrer todas las paginas de `history.list`.
7. Deduplicar message IDs.
8. Recuperar cada mensaje.
9. Aplicar evento en una transaccion.
10. Adelantar cursor solo cuando toda la unidad queda reconciliada.

## Cursor vencido

Gmail puede devolver HTTP 404 si `startHistoryId` es invalido o viejo.

1. Cambiar cursor a `ERROR`.
2. Crear incidente P1 y dead letter sin cuerpo del mensaje.
3. Mantener secuencias pausadas.
4. Ejecutar full sync acotado con ventana, checksum y reconciliacion.
5. Revisar diferencias antes de aceptar un cursor nuevo.
6. No ignorar el hueco ni marcar la notificacion como procesada.

## Clasificacion

- `REPLY`: `In-Reply-To` o `References` verificable y contacto resuelto.
- `AUTO_REPLY`: `Auto-Submitted` distinto de `no` o precedencia automatica.
- `HARD_BOUNCE`: solo despues de resolver el DSN y comprobar status permanente.
- `UNKNOWN`: cualquier identidad o metadata ambigua.

Una respuesta entra como `UNREVIEWED`. El operador decide positiva, neutral o negativa. Solo una decision positiva crea un lead `CAPTURED`. La calificacion contractual se ejecuta despues y por separado.

## Reconciliacion diaria

Comparar por mailbox:

- `historyId` actual.
- Ultimo sync.
- Push recibidos.
- Provider events procesados.
- Mensajes inbound.
- Respuestas sin revisar.
- Dead letters.
- Enrollments que siguen activos despues de respuesta.

Cualquier diferencia desconocida mantiene el gate en `EXTEND`.

## Kill switch

Una falla de reply sync no pierde el mensaje. Si aumenta el lag o existe hueco de cursor:

1. Mantener webhook recibiendo si es seguro.
2. Pausar nuevos envios con kill switch global o de mailbox.
3. Procesar backlog idempotente.
4. Reconciliar antes de reanudar.

## Rollback

El rollback de migracion elimina tablas y funciones M4, pero no debe ejecutarse despues de almacenar datos live sin export, backup y aprobacion de cambio. La suite local prueba rollback y reapply sobre datos sinteticos desechables.
