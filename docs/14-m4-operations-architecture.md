# M4 Portal y Operacion

Snapshot: 12 de agosto de 2026, America/Mexico_City.

## Veredicto

- Arquitectura local con datos sinteticos: `PASS`.
- Control operativo M020 local: `PASS`.
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
- Alertas e incidentes.
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
13. Los operadores no pueden escribir directamente aprobaciones, incidentes, tareas, reuniones, eventos de proveedor o roadmap.
14. Toda decisión o transición M020 exige AAL2, idempotencia SHA256, actor de sesión y respuesta RPC estricta.
15. `UNKNOWN` nunca se convierte en verde si falta watchdog, inventario operativo o una consulta parcial.

## SLA, incidentes y watchdog M020

La migracion `202608120020_operations_sla_control.sql` agrega:

- Solicitudes de aprobación separadas del ledger terminal.
- Cuatro ojos y hash exacto para decidir una solicitud.
- Snapshot canónico calculado por servidor para solicitar y consumir una aprobación de `CLOSED_WON`.
- Calendario laboral para el plazo de tres días hábiles.
- Casos SLA para respuesta positiva, aprobación, resultado de reunión, acuse y contención.
- Operador principal y suplente activos con rol operativo. Cualquier ausencia, baja o rol incorrecto produce `UNKNOWN`.
- Tareas que no pueden cerrarse sin dueño, actor y evidencia SHA256.
- Resultado de reunión `HELD`, `NO_SHOW`, `CANCELLED` o `RESCHEDULED` dentro de una sola transacción.
- Ciclo `OPEN > ACKNOWLEDGED > CONTAINED > RECOVERING > MONITORING > RESOLVED > REVIEWED`.
- Watchdog idempotente para cursor vencido, outbox detenido, dead letter, SLA vencido, reunión sin resultado y alerta P0 sin entrega.
- Kill switch automático al abrir un P0. A los quince minutos sin acuse se registra además el incumplimiento.
- Nuevo occurrence, SLA y outbox para cada recurrencia de un incidente ya resuelto.
- Matriz de entrega crítica separada para cliente por email y Teckel por Telegram. Sin destino configurado no cuenta como entregada.
- Gate de envío que exige watchdog `HEALTHY`, heartbeat fresco, asignación activa y cero P0 o P1 abiertos.
- Salud `HEALTHY`, `DEGRADED` o `UNKNOWN`, con heartbeat de cinco minutos.

El gate local ejecuta forward, concurrencia, rollback fail closed y reapply. También prueba AAL1, tenant, DML directo, cuatro ojos, drift canónico, expiración, SLA histórico, evidencia de tarea, recurrencia y saltos de incidente, replay, watchdog, matriz de alerta crítica y kill switch. Esto no prueba scheduler, Telegram, correo, portal live ni tiempos de proveedor.

## Interfaces

Lectura:

- `/operacion`
- `/operacion/{modulo}`

Mutacion autenticada:

- `POST /api/v1/operations/provider-events/{id}/review`
- `POST /api/v1/operations/leads/{id}/qualify`
- `POST /api/v1/operations/tasks/{id}/complete`
- `POST /api/v1/operations/tasks/{id}/assign`
- `POST /api/v1/operations/meetings/{id}/outcome`
- `POST /api/v1/operations/approvals/{id}/decision`
- `POST /api/v1/operations/opportunities/{id}/approval`
- `POST /api/v1/operations/opportunities/{id}/meetings`
- `POST /api/v1/operations/incidents/{id}/transition`
- `POST /api/v1/operations/opportunities/{id}/transition`

Integracion:

- `POST /api/v1/webhooks/gmail`
- `GET /api/v1/exports/companies-contacts`
- `GET /api/v1/exports/pipeline-attribution`

Las mutaciones devuelven `SYNTHETIC_MUTATION_DISABLED` en demo. Los CSV sinteticos estan vacios, llevan `X-Evidence-Class: synthetic_demo`, checksum SHA256 y `private, no-store`.

## Datos y seguridad

Las migraciones `202608110006_gmail_operations.sql` y `202608120020_operations_sla_control.sql` agregan:

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
9. Scheduler con identidad de workload para el watchdog.
10. Canales de alerta aprobados y prueba cronometrada live.

Ninguno de esos blockers autoriza compras, DNS, credenciales, produccion o contacto externo.
