# Bill of Materials

Snapshot: 11 de agosto de 2026. Ninguna fila autoriza compra o conexión. Los costos son `UNKNOWN` hasta cotización oficial inmediata al checkpoint.

| Capacidad | Default | Estado | Cuenta | Costo vigente | Región | DPA y retención | Límite y exportación | Gate | Fallback |
|---|---|---|---|---|---|---|---|---|---|
| Aplicación | Vercel | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Export de código y builds por validar | Compra y producción | Hosting equivalente con previews y rollback |
| Base, Auth y Storage | Supabase con PITR | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Export SQL y objetos por validar | Compra y M2 | PostgreSQL administrado con RLS y PITR |
| Correo comercial | Google Workspace y Gmail API | BLOCKED | ENNCO | UNKNOWN | Cuenta ENNCO por crear | UNKNOWN | Cuatro buzones previstos, export mediante API | Dominios, credenciales y M6 | Proveedor aprobado con API y reply ingest |
| Pub/Sub de respuestas | Google Cloud Pub/Sub | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Cuotas y replay por validar | Compra y M4 | Polling Gmail controlado |
| Cifrado OAuth | Google Cloud KMS | UNKNOWN | ENNCO | UNKNOWN | Misma región que datos sensibles | UNKNOWN | Rotación y export no aplicable | Compra y M2 | KMS administrado equivalente |
| Notificaciones | Resend | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Límite y export de eventos por validar | Compra y M4 | SMTP transaccional dedicado |
| Errores y trazas | Sentry | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | PII prohibida, términos por validar | Export de eventos por validar | Compra y M2 | OpenTelemetry a backend aprobado |
| Pruebas sintéticas | Checkly | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | Sin PII, términos por validar | Límite y export por validar | Compra y M4 | Monitor externo equivalente |
| Alertas internas | Telegram bot dedicado | BLOCKED | ENNCO | UNKNOWN | Global | No enviar PII, términos por validar | Cuotas por validar, export vía ledger propio | Credenciales | Correo de guardia |
| Vault humano | 1Password Teams | UNKNOWN | ENNCO | UNKNOWN | Por seleccionar | UNKNOWN | Export y offboarding por validar | Compra | Vault corporativo equivalente |
| Enriquecimiento | Apollo | UNKNOWN | ENNCO | Incluido según fuente contractual, acceso no verificado | Proveedor SaaS | DPA y retención por validar | Créditos y export por validar | Acceso y M2 | Investigación oficial manual |
| Observabilidad de correo | Google Postmaster Tools | BLOCKED | ENNCO | Sin costo esperado, no verificado | Cuenta Google | Métricas agregadas | Disponibilidad depende de volumen y dominio | DNS y M6 | Seeds y métricas del proveedor |
| Dominio de diagnóstico | Subdominio ENNCO | BLOCKED | ENNCO | UNKNOWN | DNS ENNCO | No aplica | No aplica | Aprobación, DNS y producción | URL temporal interna no compartida |
| Dominios de contacto | Dos candidatos separados | BLOCKED | ENNCO | UNKNOWN | Registrador por seleccionar | WHOIS y privacidad por validar | Renovación y transferencia por validar | Compra, marca y DNS | Equivalentes `.com.mx` aprobados |

## Gate de compra

Antes de presentar una orden se completa, por fila: precio y fecha, moneda e impuestos, región, DPA, subprocesadores, retención, cuotas, exportación, baja, responsable financiero, responsable técnico y evidencia de propiedad ENNCO. Si una capacidad puede operar localmente sin proveedor, permanece en modo sintético hasta el checkpoint.
