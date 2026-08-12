# Risk Register

| ID | Prioridad | Riesgo | Trigger | Mitigación | Dueño | Estado |
|---|---|---|---|---|---|---|
| R-001 | P0 | Anexo A incompleto o tardío | No existe archivo aceptado y hasheado | Bloquear cualquier envío y desplazar reloj | Revenue Operations | OPEN |
| R-002 | P0 | Credenciales expuestas en WhatsApp | Credencial no rotada | Rotar, invalidar, guardar en vault y registrar evidencia | Product Engineering | OPEN |
| R-003 | P0 | Supresión incompleta | Fuente no reconciliada o consulta falla | Fail closed dentro de la transacción de envío | Product Engineering | OPEN |
| R-004 | P0 | Doble envío | Retry sin idempotencia verificable | Unique idempotency key, lock y kill switch | Product Engineering | MITIGATED_LOCAL |
| R-005 | P0 | Pérdida silenciosa de lead | API responde éxito sin persistencia | Commit antes de responder y outbox transaccional | Product Engineering | MITIGATED_LOCAL |
| R-006 | P0 | Precotización incorrecta | Fuente vencida o backtest fuera de tolerancia | Rango, versión, expiry y apagado | Paco | OPEN |
| R-007 | P1 | Mala reputación de dominio | Auth, Postmaster o seeds fuera de gate | Extender ramp, bajar volumen, no enviar | Revenue Operations | OPEN |
| R-008 | P1 | Respuesta tardía de ENNCO | Lead sin acción el mismo día hábil | Alertas, escalamiento y SLA visible | Operador ENNCO | OPEN |
| R-009 | P1 | Dependencia de proveedor | Provider outage o pérdida de cuenta | Outbox, exportación, backup y fallback | Product Engineering | MITIGATING |
| R-010 | P1 | Sobreconstrucción | Feature sin requisito o gate | Golden path, WIP 2 y Parking Lot | Jorge | MITIGATING |
| R-011 | P1 | Datos comerciales falsos o incompletos | Dato sin URL, fecha o confianza | Cuarentena y prohibición de contacto | Revenue Operations | OPEN |
| R-012 | P1 | Restore no funcional | Drill falla | Corregir antes de M2 PASS | Product Engineering | VERIFIED_LOCAL |
| R-013 | P0 | Contrato ejecutado no archivado | El PDF local conserva placeholders y no existe certificado | Mantener el hecho como no verificado y bloquear inicio contractual hasta archivar PDF y certificado con hash | Jorge | BLOCKED_EXTERNAL |
| R-014 | P0 | RTM sin cobertura integral | Requisito del checklist o plan no tiene fila, prueba o evidencia | Reconciliar los 47 puntos y validar el CSV automáticamente | Product Engineering | VERIFIED |
| R-015 | P1 | Repositorio sin baseline inmutable | `git rev-parse HEAD` falla | Crear commit y tag local después de integrar y verificar M0 y M1 | Product Engineering | VERIFIED |
| R-016 | P0 | Inicio contractual declarado con evidencia incompleta | Faltan firma ejecutada, pago o insumos de cláusula 7 | Registrar cada condición por separado y no iniciar reloj hasta evidencia acumulativa | Jorge | BLOCKED_EXTERNAL |
| R-017 | P1 | Fuente histórica contradice auditoría posterior | Handover declara un estado que no coincide con evidencia actual | Conservar fuente, registrar supersesión y aplicar jerarquía del Decision Register | Product Engineering | MITIGATING |
| R-018 | P1 | Pruebas WebKit incompatibles con runtime local | Playwright falla antes de crear página con `PushAPIEnabled` | Cubrir cinco viewports en Chromium y exigir Safari real o CI actualizado antes de release público | QA independiente | OPEN |
| R-019 | P0 | Audit log duplica PII | Snapshot contiene cuerpo, correo, asunto o razón | Allowlist por tabla, saneamiento histórico y pruebas centinela | Product Engineering | MITIGATED_LOCAL |
| R-020 | P0 | Archivo malicioso llega a operación | Objeto se libera sin escaneo limpio y checksum | Magic bytes, cuarentena, motor antivirus y release service-only | Product Engineering | OPEN_EXTERNAL |
| R-021 | P0 | Proveedor trata datos sin aprobación | DPA, región, subprocesadores o borrado desconocidos | BOM, revisión legal y gate antes de datos reales | Jorge y ENNCO | BLOCKED_EXTERNAL |
| R-022 | P0 | Configuración de despliegue degrada seguridad | Producción arranca como demo o sin MFA | Inferencia de plataforma, config completa y pruebas fail closed | Product Engineering | MITIGATED_LOCAL |
| R-023 | P0 | Borrado o legal hold no se ejecutan conforme a evidencia | Estado técnico falsificado, hold ignorado o PII queda en relaciones | Cuatro ojos, transición service-only, lock, anonimización, tombstone y pruebas adversariales | Product Engineering | MITIGATED_LOCAL |
