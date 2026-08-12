# M4 Portal y Operacion

Snapshot: 11 de agosto de 2026, America/Mexico_City.

## Veredicto

- Arquitectura local con datos sinteticos: `PASS`.
- M4 global con cuentas y datos reales: `EXTEND`.
- Envio externo: `BLOQUEADO`.
- Gmail webhook: `BLOQUEADO`.
- Actividad comercial real: `0`.
- Leads contractuales reales: `0`.
- Pipeline estricto real: `0`.
- Revenue atribuido: `0 MXN`.

## Superficie del operador

El portal incluye:

- Hoy.
- Respuestas.
- Leads.
- Empresas.
- Precotizaciones.
- Campanas.
- Pipeline.
- Roadmap.
- Aprobaciones.
- Reportes.
- Exportaciones.

La vista Hoy separa ocho resultados reales de los ejemplos sinteticos. Un registro de ejemplo lleva la etiqueta `SIMULACION`. En modo live, una falla de base muestra error y no sustituye datos reales con fixtures.

## Flujo de respuesta

```text
Gmail watch
  -> Pub/Sub push con OIDC
  -> validacion de firma, audience, email y subscription
  -> notificacion idempotente
  -> outbox de history sync
  -> Gmail history.list desde cursor conocido
  -> mensaje nuevo
  -> clasificacion determinista o cuarentena
  -> detener enrollment
  -> revision humana de respuesta
  -> lead CAPTURED si la respuesta es positiva
  -> calificacion contractual separada
  -> tarea y alerta
```

Gmail envia un `historyId`, no el mensaje completo. El worker debe consultar `users.history.list`. Un cursor vencido que produzca HTTP 404 exige full sync controlado. No se adelanta el cursor hasta recuperar y persistir todos los mensajes de la pagina.

Fuentes oficiales:

- Gmail push: https://developers.google.com/workspace/gmail/api/guides/push
- Gmail history.list: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- Pub/Sub push autenticado: https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions

## Reglas duras

1. Una notificacion duplicada no crea otro outbox event.
2. Un provider event duplicado no crea otro mensaje, lead o tarea.
3. Una respuesta humana detiene la secuencia antes de cualquier seguimiento.
4. La clasificacion positiva requiere revision humana.
5. Una respuesta positiva crea un lead `CAPTURED`, nunca un lead contractual automatico.
6. El lead contractual requiere cinco criterios y evidencia UUID.
7. Una oportunidad no puede saltar etapas.
8. `QUALIFIED` requiere lead contractual, comprador, dolor, impacto, plazo, valor y siguiente accion.
9. Una reunion realizada exige hora, asistencia verificada y notas.
10. Un hard bounce suprime solo el correo exacto. La metadata DSN ambigua entra en cuarentena.
11. El cuerpo y asunto de mensajes no se copian al audit log.
12. Los operadores no pueden escribir directamente mensajes, eventos de proveedor o mailboxes.

## Interfaces

Lectura:

- `/operacion`
- `/operacion/{modulo}`

Mutacion autenticada:

- `POST /api/v1/operations/provider-events/{id}/review`
- `POST /api/v1/operations/leads/{id}/qualify`
- `POST /api/v1/operations/tasks/{id}/complete`
- `POST /api/v1/operations/meetings/{id}/outcome`
- `POST /api/v1/operations/opportunities/{id}/transition`

Integracion:

- `POST /api/v1/webhooks/gmail`
- `GET /api/v1/exports/companies-contacts`
- `GET /api/v1/exports/pipeline-attribution`

Las mutaciones devuelven `SYNTHETIC_MUTATION_DISABLED` en demo. Los CSV sinteticos estan vacios, llevan `X-Evidence-Class: synthetic_demo`, checksum SHA256 y `private, no-store`.

## Datos y seguridad

La migracion `202608110006_gmail_operations.sql` agrega:

- `gmail_push_notifications`.
- `mailbox_sync_cursors`.
- `export_runs`.
- Tipos de evento y clasificacion.
- Prueba de ingesta HMAC.
- RPC de provider events.
- RPC de revision humana.
- RPC de calificacion, tareas, reuniones, transiciones y export audit.
- Triggers de etapas estrictas y audit allowlist.

La app web usa una publishable key y la sesion del usuario. El webhook valida OIDC y usa una RPC publica con prueba HMAC. El worker futuro usa service role en un proceso separado. Ninguna llave service role entra al browser o al repositorio.

## Blockers globales

1. Proyecto Supabase ENNCO aislado.
2. Google Workspace y cuatro buzones autorizados.
3. Google Cloud project, Pub/Sub, service account y audience.
4. OAuth, KMS y rotacion de credenciales.
5. Watch real y renovacion antes de expiry.
6. Staging aislado con RLS, MFA y canary.
7. Operador ENNCO y suplente designados.
8. UAT real de respuesta, rebote, baja y reunion.

Ninguno de esos blockers autoriza compras, DNS, credenciales, produccion o contacto externo.
