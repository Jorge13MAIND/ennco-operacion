# Política de retención y eliminación

Snapshot: 11 de agosto de 2026, America/Mexico_City.

Estado: `DRAFT_CONTROLLED`. Los plazos siguientes son defaults operativos del plan aprobado, no conclusiones sobre obligaciones legales. La política de producción permanece `BLOCKED_EXTERNAL` hasta revisión legal, aviso de privacidad, DPA y configuración de proveedores.

## Estados

- `VERIFIED`: el default está documentado en el plan o existe un control local verificable.
- `UNKNOWN`: falta definición o evidencia suficiente.
- `BLOCKED_EXTERNAL`: requiere revisión legal, aprobación ENNCO o configuración de proveedor.

## Principios

1. Conservar sólo lo necesario para una finalidad documentada.
2. El reloj de retención debe tener un evento inicial explícito.
3. Un legal hold válido pausa la eliminación del alcance afectado, no de todo el sistema.
4. El borrado debe propagarse a base, objetos, índices, exportaciones y proveedores.
5. La supresión mínima puede sobrevivir al borrado comercial únicamente para prevenir recontacto, con datos reducidos y revisión legal.
6. Ningún backup se considera borrado hasta documentar su expiración o procedimiento de restauración con re-aplicación de tombstones.
7. Toda ejecución deja evidencia sin copiar el dato eliminado.

## Defaults por categoría

| Categoría | Inicio del reloj | Default | Acción al vencer | Estado | Condición de producción |
|---|---|---:|---|---|---|
| Recibos CFE y archivos de precotización | Última actividad o cierre, lo que ocurra después | 90 días | Borrar objeto y metadatos no necesarios; conservar folio y evidencia mínima si procede | VERIFIED como default | Revisión legal, job probado, Storage y backup aprobados |
| Datos de outreach e investigación de contacto | Última actividad sustantiva | 12 meses | Eliminar o anonimizar contacto y mensajes; conservar supresión mínima cuando aplique | VERIFIED como default | Aviso, base jurídica, DPA y prueba de propagación |
| Evidencia de atribución | Primer contacto registrado | 12 meses | Cerrar ventana y eliminar PII no requerida por otra obligación | VERIFIED por contrato y plan | Revisión legal y reconciliación con cierres y pagos |
| Audit log e incidentes | Creación o cierre del incidente | 24 meses | Eliminar o anonimizar según clase; preservar sólo métricas agregadas | VERIFIED como default | Minimizar audit log antes de live y resolver legal hold |
| Supresiones | Fecha efectiva | UNKNOWN | Retener hash o identificador mínimo para evitar recontacto; eliminar contenido y razón sensible cuando ya no sean necesarios | UNKNOWN | Dictamen legal sobre duración y oposición |
| Usuarios, roles y sesiones | Baja o desactivación | UNKNOWN | Desactivar de inmediato y eliminar metadatos después del periodo aprobado | UNKNOWN | Política de offboarding y Auth real |
| Pipeline, propuestas, contratos y pagos | Cierre o última obligación | UNKNOWN | Conservar sólo el periodo legal y fiscal aprobado | BLOCKED_EXTERNAL | Revisión legal, fiscal y contractual |
| Datos del asistente | Último mensaje | UNKNOWN | Borrar conversación y cualquier copia del proveedor | BLOCKED_EXTERNAL | Proveedor, DPA, región y retención cero o aprobada |
| Logs técnicos y trazas | Evento | UNKNOWN | Rotación automática y eliminación | BLOCKED_EXTERNAL | Sentry, Checkly y configuración sin PII |
| Backups de base y Storage | Creación del backup | UNKNOWN | Expirar criptográficamente o borrar según política aprobada | BLOCKED_EXTERNAL | PITR, backup externo, región y llaves definidos |
| Datos sintéticos | Fin del ciclo de prueba | 30 días como máximo interno | Borrar fixture temporal y reportes con IDs efímeros | VERIFIED como regla interna | No aplica a datos reales |

## Eventos de retención

- `last_substantive_activity_at`: respuesta humana, reunión realizada, visita, propuesta, decisión o pago. Aperturas y clics no reinician el reloj.
- `closed_at`: cierre ganado, cierre perdido o descalificación final con evidencia.
- `first_contact_at`: evento de atribución canónico.
- `incident_closed_at`: cierre aprobado después de recuperación y revisión.
- `user_deactivated_at`: baja efectiva del acceso.

Si el evento requerido es `NULL`, el registro entra en reporte de excepción. No se conserva indefinidamente por accidente.

## Flujo de eliminación

1. Generar lote con `deletion_batch_id`, categoría, criterio, conteo y checksum de IDs.
2. Verificar legal hold, investigación de incidente, obligación contractual y supresión.
3. Separar registros elegibles de excepciones y obtener aprobación del rol definido.
4. Borrar primero objetos privados y enlaces temporales.
5. Borrar o anonimizar datos relacionales en una transacción controlada.
6. Enviar solicitudes de borrado a proveedores aprobados.
7. Registrar confirmación por proveedor sin PII.
8. Mantener tombstone mínimo para re-aplicar el borrado después de un restore.
9. Verificar por consulta, checksum y muestreo que el dato ya no sea accesible.
10. Cerrar el lote con evidencia o abrir incidente si hay residuo.

La migración 003 implementa y prueba localmente el registro de legal holds, lotes, evaluación, doble aprobación, anonimización transaccional y tombstones. No existe todavía un scheduler de producción, propagación confirmada a proveedores ni re-aplicación de tombstones después de un restore administrado.

## Legal hold

Un hold debe contener:

- ID único.
- Alcance exacto por organización, sujeto, categoría o rango de fechas.
- Motivo y autoridad que lo ordena.
- Fecha de inicio, revisión y expiración.
- Custodio y aprobador.
- Evidencia asociada.

Reglas:

- Un hold no autoriza acceso adicional.
- Sólo pausa eliminación dentro de su alcance.
- Toda consulta o export durante el hold queda auditada.
- Un hold sin expiración se revisa al menos cada 90 días.
- Liberarlo requiere aprobación registrada y reanuda el reloj original, no uno nuevo.

Responsable legal, formato y autoridad de hold: `BLOCKED_EXTERNAL`.

## Solicitudes sobre datos

El sistema debe poder localizar información por organización, correo normalizado, cuenta, folio y correlation ID. Antes de responder una solicitud se valida identidad y autoridad. Acceso, rectificación, oposición, portabilidad o eliminación se atienden conforme a la revisión legal aplicable. Los plazos regulatorios y el canal formal permanecen `UNKNOWN`.

## Backups y restore

- RPO de 15 minutos sólo existe con PITR aprobado.
- RTO de cuatro horas sólo cuenta después de un drill exitoso.
- Un restore a ambiente separado debe re-aplicar tombstones y bajas posteriores al punto restaurado.
- Storage necesita backup independiente y prueba de borrado.
- Región, cifrado, llave, ciclo de vida y destrucción de copias permanecen `BLOCKED_EXTERNAL`.

## Evidencia requerida por ejecución

- Política y versión aplicada.
- Query o criterio del lote.
- Conteo antes, elegible, excluido y eliminado.
- Hash de IDs, nunca el contenido sensible.
- Aprobador y operador.
- Confirmaciones de Storage y proveedores.
- Resultado de verificación y excepciones.
- Correlation ID e incidente relacionado, si existe.

## Gate

Defaults documentales: `PASS`.

Eliminación local sintética: `PASS`. La suite prueba legal hold, cuatro ojos, aislamiento por organización, ejecución técnica, anonimización, tombstone sin PII, rollback irreversible y audit log minimizado.

Retención de producción: `EXTEND` y `BLOCKED_EXTERNAL` hasta revisión legal, DPA, regiones, backups y pruebas de borrado end-to-end.
