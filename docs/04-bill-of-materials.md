# Bill of Materials

Snapshot: 14 de agosto de 2026. Ninguna fila autoriza compra o conexión. Los costos son `UNKNOWN` hasta cotización oficial inmediata al checkpoint. Durante las doce semanas, las herramientas, licencias, creditos y servicios comprendidos en el alcance son costo interno de Teckel y no se trasladan como cargo adicional a ENNCO.

| Capacidad | Default | Estado | Cuenta | Costo vigente | Región | DPA y retención | Límite y exportación | Gate | Fallback |
|---|---|---|---|---|---|---|---|---|---|
| Aplicación | Vercel | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Export de código y builds por validar | Compra y producción | Hosting equivalente con previews y rollback |
| Base, Auth y Storage | Supabase con PITR | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Export SQL y objetos por validar | Compra y M2 | PostgreSQL administrado con RLS y PITR |
| Datos, secuencias y reputacion comercial | Apollo Professional mensual, 1 asiento | REQUIRED_CONTRACTUAL_BLOCKED | ENNCO con administracion Teckel | 99 USD mensuales como baseline presupuestal; checkout e impuestos por verificar | Proveedor SaaS | DPA, subprocesadores y retencion por validar | 500 creditos mensuales de cap interno; export, reply sync, bajas y continuidad por validar | Compra, propiedad, MFA, credenciales y M6 | Gmail ENNCO como continuidad; reutilizacion Teckel solo con autorizacion escrita Apollo |
| Buzones comerciales | Un buzón existente Gmail más tres buzones Apollo Shared SMTP | REQUIRED_CONTRACTUAL_BLOCKED | Teckel administra para ENNCO | Costo exacto pendiente de checkout y créditos disponibles | Cuenta Apollo ENNCO administrada por Teckel | UNKNOWN | Gmail API, reenvío, export y baja obligatorios | M29, DNS, OAuth, 42 días aislados y canary | Cuarto buzón sólo después de 100 entregas si los datos lo justifican |
| Pub/Sub de respuestas | Google Cloud Pub/Sub | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Cuotas y replay por validar | Compra y M4 | Polling Gmail controlado |
| Cifrado OAuth | Google Cloud KMS | UNKNOWN | ENNCO | UNKNOWN | Misma región que datos sensibles | UNKNOWN | Rotación y export no aplicable | Compra y M2 | KMS administrado equivalente |
| Notificaciones transaccionales | Resend | OPTIONAL | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Sólo usuarios conocidos y opt-in; límite y export por validar | Compra y M4 | Gmail operativo o SMTP transaccional aprobado |
| Errores y trazas | Sentry | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | PII prohibida, términos por validar | Export de eventos por validar | Compra y M2 | OpenTelemetry a backend aprobado |
| Pruebas sintéticas | Checkly | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | Sin PII, términos por validar | Límite y export por validar | Compra y M4 | Monitor externo equivalente |
| Alertas internas | Telegram bot dedicado | BLOCKED | ENNCO | UNKNOWN | Global | No enviar PII, términos por validar | Cuotas por validar, export vía ledger propio | Credenciales | Correo de guardia |
| Vault humano | 1Password Teams | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Export y offboarding por validar | Compra | Vault corporativo equivalente |
| Enriquecimiento | Apollo | REQUIRED_CONTRACTUAL_BLOCKED | ENNCO con administracion Teckel y pago Teckel durante el contrato | Incluido en el plan Apollo seleccionado; 30,000 creditos anuales publicados en Basic | Proveedor SaaS | DPA y retención por validar | Créditos, API y export por validar | Acceso y Workbench | Investigación oficial manual; nunca ledger canonico de supresion o atribucion |
| Observabilidad de correo | Google Postmaster Tools | BLOCKED | ENNCO | Sin costo esperado, no verificado | Cuenta Google | Métricas agregadas | Disponibilidad depende de volumen y dominio | DNS y M6 | Seeds y métricas del proveedor |
| Dominio de diagnóstico | Subdominio ENNCO | BLOCKED | ENNCO | UNKNOWN | DNS ENNCO | No aplica | No aplica | Aprobación, DNS y producción | URL temporal interna no compartida |
| Dominios de contacto | `enncoindustrial.com` y `enncoenergia.com` | REQUIRED_CONTRACTUAL_BLOCKED | Teckel administra para ENNCO | Costo exacto pendiente de checkout y créditos disponibles | Apollo o registrador según costo total y portabilidad observada | WHOIS, privacidad y continuidad por validar | Acceso, renovación, export y transferencia deben documentarse | Compra, marca, historial, blocklists, DNS y M29 | Mantener el dominio principal sólo para Tier 1 de bajo volumen |

## Gate de compra

Antes de presentar una orden se completa, por fila: precio y fecha, moneda e impuestos, región, DPA, subprocesadores, retención, cuotas, exportación, baja, responsable financiero, responsable técnico y evidencia de propiedad ENNCO. Si una capacidad puede operar localmente sin proveedor, permanece en modo sintético hasta el checkpoint.

## Restricciones de canal

- Apollo es el proveedor baseline para datos, secuencias, calentamiento y entregabilidad. Instantly y Smartlead quedan fuera salvo falla documentada de Apollo en un control obligatorio.
- La plataforma ENNCO conserva la supresion, aprobacion, campaign manifest, atribucion, lead estricto, alertas y kill switch como contratos canonicos.
- Resend sólo puede entregar notificaciones transaccionales a usuarios conocidos. Su política prohíbe cold outreach.
- No se compra otro secuenciador ni otra herramienta de warmup mientras Apollo cubra la operacion aprobada.
- No se compran dominios ni buzones dentro de Apollo. Se usa registrador independiente y Google Workspace bajo ENNCO.
