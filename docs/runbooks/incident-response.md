# Runbook de respuesta a incidentes

Snapshot: 11 de agosto de 2026, America/Mexico_City.

Estado: `EVIDENCE_READY` para desarrollo local. Operación de producción: `BLOCKED_EXTERNAL` hasta designar on-call, contactos ENNCO, canal seguro, proveedor de alertas y obligaciones legales.

## Regla principal

Primero se protege a las personas, los datos y la reputación de envío. Después se recupera el servicio. Ningún objetivo comercial justifica continuar un proceso inseguro.

No incluir PII, secretos, recibos, cuerpos de mensajes, Anexo A o datos bancarios en Telegram, email de alerta, ticket o screenshot. Usar incident ID, organization ID, correlation ID y referencias internas.

## Severidad y objetivos

| Nivel | Ejemplos | Acción automática | Acuse objetivo | Operación |
|---|---|---|---:|---|
| P0 | Supresión ignorada, doble envío real, credencial comprometida, pérdida o exposición de datos, cross-tenant, campaña no autorizada | Kill switch global, pausa de workers y preservación de evidencia | 15 minutos | Comando continuo hasta contener; Jorge acepta producción, AVA acepta local |
| P1 | Formulario live caído, reply sync detenido, rebotes anormales, DLQ crítica, restore fallido, upload inseguro | Pausar componente o mailbox afectado | 1 hora para iniciar mitigación | Actualización cada hora hasta estable |
| P2 | Inventario bajo, fuente incompleta, tarea vencida, degradación sin pérdida | Limitar función y crear tarea | Mismo día hábil | Resumen diario |
| P3 | Mejora, reporte, deuda sin riesgo inmediato | Ninguna | Siguiente revisión | Resumen semanal |

Los tiempos son objetivos de política, no SLO validados en producción.

## Autoridad

- Desarrollo local y staging aislado a 0%: Product Engineering ejecuta, AVA acepta, QA revisa y Jorge es informado.
- Producción: Product Engineering contiene, Jorge acepta decisiones de release, AVA y QA asesoran, ENNCO es informado por el canal aprobado.
- Incidente de privacidad: responsable legal y de privacidad `UNKNOWN`. Ninguna notificación regulatoria o a titulares se envía sin revisión y autorización.
- Seguridad física, amenaza personal o delito en curso: escalar a autoridades y especialistas según decisión humana. El sistema no toma esa decisión.

## Flujo obligatorio

1. Detectar y crear incident ID.
2. Clasificar severidad por impacto posible, no sólo observado. Unknown se clasifica al nivel mayor razonable hasta descartarlo.
3. Contener con kill switch global, de mailbox, feature flag, revocación de token o aislamiento de componente.
4. Preservar evidencia con timestamp, hash, actor, correlation ID, versión y alcance. No alterar originales.
5. Determinar datos, organizaciones, destinatarios y ventanas afectadas.
6. Erradicar la causa: código, credencial, configuración, dato o proveedor.
7. Recuperar desde una ruta conocida y probar synthetic transaction.
8. Reconciliar base, outbox, proveedor y portal. Ningún evento queda en estado desconocido.
9. Obtener aceptación del rol correspondiente antes de reabrir tráfico.
10. Cerrar con causa raíz, impacto verificado, acciones, propietario y fecha.
11. Ejecutar post-incident review para P0 y P1 en máximo cinco días hábiles.

## Evidencia mínima

- Incident ID, severidad y estado.
- Inicio, detección, acuse, contención, recuperación y cierre.
- Detector y primer respondiente.
- Versiones, commits, migraciones y proveedores implicados.
- Correlation IDs y hashes de artefactos.
- Universo potencial y universo confirmado.
- Acciones ejecutadas con resultado.
- Decisiones de gate y aprobador.
- Comunicaciones enviadas, sin contenido sensible.
- Causa raíz y controles preventivos.

Estados del incidente:

`OPEN > ACKNOWLEDGED > CONTAINED > RECOVERING > MONITORING > RESOLVED > REVIEWED`

No usar `RESOLVED` si sólo desapareció la alerta.

## Playbooks

### P0: supresión ignorada o doble envío

1. Activar kill switch global y por mailbox.
2. Detener claim de outbox y revocar cualquier lote pendiente.
3. Congelar manifest, lista, Anexo A, sequence hash y logs de proveedor.
4. Reconciliar destinatarios únicos contra mensajes, provider IDs y supresión al timestamp de envío.
5. Clasificar envíos intentados, aceptados, entregados y duplicados. No usar aperturas como entrega.
6. Corregir transacción, idempotencia o snapshot y agregar prueba adversarial.
7. Reanudar sólo con dry run idéntico, QA y aprobación de release.

### P0: credencial o token comprometido

1. Revocar o rotar el secreto desde el proveedor autorizado.
2. Deshabilitar integración y sesiones asociadas.
3. Buscar uso desde la última rotación sin imprimir el secreto.
4. Identificar alcance, permisos y datos accesibles.
5. Mover el reemplazo a vault y aplicar menor privilegio.
6. Probar que el secreto anterior falla y el nuevo funciona sólo donde corresponde.
7. Revisar chats, repositorio, CI, logs y screenshots por copias.

Las credenciales ya expuestas en WhatsApp se consideran comprometidas hasta rotación comprobada.

### P0: pérdida, exposición o acceso cross-tenant

1. Aislar API, service role y exportaciones.
2. Preservar audit log, auth events, queries, object access y deploy version.
3. Determinar categorías, sujetos, organizaciones y periodo.
4. Invalidar signed URLs y sesiones.
5. Corregir RLS, claim o referencia cruzada y ejecutar pruebas por rol.
6. Restaurar sólo en ambiente separado y reconciliar checksums.
7. Escalar revisión legal antes de comunicación externa.

### P1: formulario o precotizador caído

1. Ejecutar health y synthetic transaction.
2. Confirmar si las solicitudes recibieron éxito sin commit.
3. Activar página segura de indisponibilidad sin recolectar datos alternos.
4. Revisar DB, Storage, modelo vigente, rate limit y outbox.
5. Recuperar y reconciliar todas las solicitudes durante la ventana.

### P1: reply sync, rebotes o bajas detenidos

1. Pausar nuevos toques de mailboxes afectados.
2. Medir lag por provider event y último cursor confirmado.
3. Renovar watch o token sólo desde cuenta autorizada.
4. Reprocesar con event ID único e idempotencia.
5. Aplicar bajas y rebotes antes de reanudar.

### P1: DLQ o proveedor caído

1. Identificar evento, intentos, siguiente retry y dependencia.
2. Confirmar que el registro canónico existe antes de reintentar.
3. Mantener backoff y límite de intentos. No hacer retry manual ciego.
4. Usar fallback sólo si está aprobado y conserva idempotencia.
5. Reconciliar `event_outbox`, `notification_deliveries` y `dead_letters`.

### P1: archivo malicioso o upload inseguro

1. Deshabilitar uploads sin apagar captación de texto cuando sea seguro.
2. Poner el objeto en cuarentena y revocar URLs.
3. No abrirlo en estación de trabajo.
4. Registrar checksum, tipo detectado, tamaño y scanner.
5. Borrar conforme a política después de preservar evidencia permitida.

Antivirus y cuarentena reales están `BLOCKED_EXTERNAL`, por lo que uploads live permanecen bloqueados.

### P1: migración o restore fallido

1. Detener writes y deploy.
2. Preservar versión de esquema, backup y logs.
3. Restaurar en ambiente separado. Nunca probar recuperación sobre el único origen.
4. Ejecutar conteos, constraints, RLS, checksums y golden path.
5. Aplicar tombstones y bajas posteriores al punto restaurado.
6. Cambiar tráfico sólo después de QA y aceptación.

## Comunicación

Plantilla interna:

```text
[INC-AAAA-NNN] [P0-P3] [ACKNOWLEDGED|CONTAINED|RECOVERING]
Impacto confirmado: <hechos>
Impacto potencial: <universo y límite>
Contención: <acción>
Siguiente actualización: <hora y zona>
Decisión requerida: <si aplica>
```

No afirmar `sin impacto` mientras el universo sea desconocido. No compartir nombres, correos, cuerpos o documentos por el canal de alerta.

Canales de producción, lista on-call, suplente, contacto legal y destinatarios ENNCO: `BLOCKED_EXTERNAL`.

## Recuperación y reapertura

Para reabrir un componente P0 o P1 deben existir:

- Causa contenida.
- Prueba que falla antes del fix y pasa después.
- Reconciliación sin estado desconocido.
- Synthetic transaction recibida.
- Kill switch probado.
- Rollback documentado.
- Evidencia de QA independiente.
- Aprobación del rol correspondiente.

## Drills

- Local: supresión, doble webhook, retry, dead letter, token vencido y kill switch. `VERIFIED` en suite PostgreSQL y E2E sintético.
- M2: upload malicioso, RLS con Auth real, borrado y restore con tombstones. `UNKNOWN`.
- Producción: proveedor caído, backup completo, canal on-call y comunicación ENNCO. `BLOCKED_EXTERNAL`.

## Gate

Runbook local: `PASS`.

Readiness de incidentes en producción: `EXTEND` hasta cerrar contactos, proveedores, legal, backups, uploads y drills M2.
