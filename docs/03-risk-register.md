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
| R-024 | P0 | Banda industrial parece precio observado | Resultado de 100 kWp o más no revela extrapolación | Rango amplio, etiqueta explícita, modelo draft y aprobación de Paco | Paco | MITIGATED_LOCAL |
| R-025 | P0 | Captura real opera con aviso incompleto | Aviso draft o versión de consentimiento ausente | Runtime fail closed, versión persistida y revisión legal antes de release | ENNCO | BLOCKED_EXTERNAL |
| R-026 | P1 | Analítica almacena PII | Propiedad arbitraria o valor con correo llega a base | Allowlist estricta, regex, HMAC, RLS y pruebas centinela | Product Engineering | MITIGATED_LOCAL |
| R-027 | P0 | Recibo se carga sin antivirus real | Input de archivo se habilita antes del scanner | Input deshabilitado y gate de cuarentena hasta proveedor aprobado | Product Engineering | BLOCKED_EXTERNAL |
| R-028 | P0 | Webhook Gmail falsificado o repetido | JWT, audience, subscription o message ID no se validan | OIDC, HMAC, replay nonce, unique key y pruebas adversariales | Product Engineering | MITIGATED_LOCAL |
| R-029 | P0 | Respuesta positiva se cuenta como lead contractual | Clasificador crea qualification sin revisión | Toda respuesta inicia UNREVIEWED, revisión humana crea CAPTURED y gate estricto califica aparte | Product Engineering | MITIGATED_LOCAL |
| R-030 | P0 | Operador altera mensaje o provider event directo | RLS genérica permite escritura fuera de RPC | Revocar DML y exigir RPC con audit allowlist | Product Engineering | MITIGATED_LOCAL |
| R-031 | P1 | Cursor Gmail vencido deja un hueco silencioso | `history.list` devuelve 404 | Error explícito, pausa, dead letter y full sync reconciliado | Product Engineering | MITIGATED_LOCAL |
| R-032 | P0 | Portal sustituye falla live con datos sintéticos | Consulta live falla y carga fixtures | Error boundary fail closed y demo permitido sólo fuera de producción | Product Engineering | MITIGATED_LOCAL |
| R-033 | P0 | Canary sintético se reporta como liberación real | Harness acelerado aparece verde y alguien lo convierte en PASS | Evidencia etiquetada, realElapsedDays cero, constraint SQL y gate que sólo permite PASS live en staging | QA independiente | MITIGATED_LOCAL |
| R-034 | P0 | Copy promete precio resultado o fecha no autorizados | Mensaje cambia fuera del paquete aprobado | Hash de secuencia, lint de compromisos, manifest HOLD y nueva aprobación ante cualquier cambio | Revenue Operations | MITIGATED_LOCAL |
| R-035 | P0 | Assistant inventa respuesta comercial o técnica | Pregunta fuera de grounding recibe una conclusión | Intenciones allowlist, handoff, prompt injection refusal, 22 evals dobles y release false | Product Engineering | MITIGATED_LOCAL |
| R-036 | P1 | Caso anónimo se presenta como éxito sin resultado | Registro histórico o propuesta se publica con lenguaje de outcome | Etiqueta NOT_CASE_STUDY, outcome false y publish false hasta evidencia y autorización | Product Engineering | MITIGATED_LOCAL |
| R-037 | P0 | Operador forja un día o decisión del canary | DML directo sobre runs days u observaciones | DML revocado, RLS read only, finalización service-only, audit allowlist y hash por día | Product Engineering | MITIGATED_LOCAL |
