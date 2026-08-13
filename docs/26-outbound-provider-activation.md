# Activacion de proveedores para operacion comercial

Fecha de decision: 2026-08-13.

Este documento congela la arquitectura recomendada. No autoriza compras, altas, DNS, credenciales, despliegue o envios.

## Decision ejecutiva

No se reinicia el proyecto. La plataforma propia de ENNCO permanece como sistema de verdad y Control Room. Los proveedores se conectan como piezas acotadas, sin entregarles el pipeline, la supresion, la atribucion o la autorizacion de release.

| Funcion | Herramienta | Decision | Uso permitido | No se usa para |
|---|---|---|---|---|
| Salida de correo comercial | Google Workspace y Gmail API | REQUIRED | Enviar desde los cuatro buzones aprobados, obtener message ID y conservar threading | Marketing masivo, compra de listas o envio sin campaign manifest |
| Respuestas y cambios de buzon | Gmail API, Google Cloud Pub/Sub e History API | REQUIRED | Watch por buzon, cursor, reconciliacion y fallback por historial | Tratar una notificacion push como mensaje completo |
| Datos de empresas y contactos | Apollo | OPTIONAL_RECOMMENDED | Enriquecer empresas, cargos y correos; importar resultados con fuente, fecha y confianza | CRM canonico, secuencias, supresion, atribucion o autorizacion de envio |
| Alertas transaccionales | Resend | OPTIONAL_TRANSACTIONAL_ONLY | Avisos operativos a usuarios conocidos de ENNCO y Teckel | Cold outreach, listas compradas, datos scrapeados o prospectos sin opt-in |
| Base, Auth, Storage y RLS | Supabase con PITR | REQUIRED_LIVE | Sistema de verdad operativo, documentos privados, audit log, outbox y restore | Compartir base o secretos con otros clientes |
| Aplicacion y portal | Vercel | REQUIRED_LIVE | Portal, landing, APIs y rollback | Publicar antes de gates, privacidad y aprobacion |
| DNS y reputacion | Proveedor DNS, SPF, DKIM, DMARC y Google Postmaster | REQUIRED | Autenticar dominios, observar reputacion y bloquear deriva | Declarar verde cuando Postmaster no tenga datos |
| Cifrado de OAuth | Google Cloud KMS | REQUIRED_LIVE | Cifrar tokens de Gmail y rotar llaves | Guardar tokens en codigo o variables compartidas |
| Errores y pruebas externas | Sentry y Checkly | RECOMMENDED | Trazas sin PII, pruebas sinteticas y alertas de disponibilidad | Sustituir logs comerciales o evidencia de leads |
| Alerta interna | Telegram bot dedicado y correo de respaldo | RECOMMENDED | Incidentes Teckel sin PII | Canal del cliente o fuente de verdad |

## Por que no Apollo como sender

Apollo puede ejecutar secuencias y detener o pausar contactos con sus propias reglas. Si tambien enviara, existirian dos motores de estado, dos reglas de detencion y dos historiales de actividad. Eso debilitaria la supresion transaccional, la idempotencia, el kill switch y la atribucion ya implementados.

Apollo se trata como fuente de entrada. Cada dato vuelve al Workbench con URL o proveedor, fecha, confianza y resultado de verificacion. Ningun contacto de Apollo queda automaticamente elegible para outreach.

## Por que no Resend para cold outbound

La politica vigente de Resend prohibe mensajes no solicitados, cold outreach, listas compradas y contactos scrapeados. Por eso Resend no puede ser el motor comercial de ENNCO. Si se aprueba, queda aislado para notificaciones transaccionales dirigidas a operadores y administradores conocidos.

## Lo que Codex puede cerrar sin checkpoint externo

1. Mantener y mejorar el Control Room local con datos sinteticos y estados reales de bloqueo.
2. Preparar adaptadores Gmail, Pub/Sub, KMS, Apollo y Resend contra interfaces mock, sin credenciales ni red real.
3. Completar importaciones, deduplicacion, lineage, supresion fail closed y QA adversarial.
4. Investigar hasta 75 empresas con fuentes publicas y mantenerlas en `RESEARCH_ONLY_HOLD`.
5. Preparar hasta 150 candidatos a contacto. La verificacion de correo permanece parcial hasta contar con Apollo o una fuente aprobada.
6. Congelar copy, secuencia, campaign manifest, dry runs y seed-test plan sin enviar.
7. Producir runbooks de alta, DNS, OAuth, rotacion, incidentes, restore y primer lote.
8. Mantener build, pruebas, evidencia y roadmap del portal.

## Estado implementado al corte

| Pieza | Estado local | Falta para live |
|---|---|---|
| Control Room | `PASS_LOCAL`, visible en `synthetic_demo` | Auth y datos de Supabase administrado; UAT ENNCO |
| Campaign manifest, suppression, idempotencia y kill switch | `PASS_LOCAL` | Anexo A, dominios, buzones y gates live |
| Gmail inbound | Parser Pub/Sub, proof, persistencia, History API y clasificacion probados localmente | Proyecto Google Cloud, OAuth, watch por buzon y canary real |
| Gmail outbound | Cola y controles transaccionales construidos | Transport Gmail API, OAuth real, seeds y primer lote aprobado |
| Workbench de investigacion | 27 semillas, 21 investigables, 6 en cuarentena, 0 contactos verificados | 75 empresas, 150 contactos y fuente aprobada de verificacion |
| Apollo | Contrato de uso decidido | Cuenta, creditos y adapter/import auditado |
| Resend | Contrato de uso transaccional decidido | Cuenta opcional, dominio, adapter y destinos conocidos |
| Produccion | `HOLD` | Proveedores ENNCO, DNS, credenciales, restore, CI remoto, staging y aprobaciones |

## Checkpoints humanos y externos

Jorge o ENNCO deben autorizar o entregar:

1. Anexo A vigente y copia ejecutada del contrato con certificado BoldSign.
2. Presupuesto y alta de cuentas ENNCO para Supabase, Vercel, Google Workspace y Google Cloud.
3. Compra de dos dominios y creacion de cuatro buzones, con MFA y owner ENNCO.
4. Acceso o compra de creditos Apollo si se usa para la meta de 150 contactos.
5. DNS, OAuth, secretos, staging compartido, publicacion y cualquier envio real.
6. Validacion de Paco para modelo, rangos, garantias, descuentos y compromisos tecnicos.
7. Aprobacion exacta de copy, manifiesto y primer lote de cinco cuentas.

## Orden recomendado desde este punto

### Frente A. Continúa ya, sin gasto

- Panel local visible.
- Workbench de empresas y candidatos.
- Adaptadores en mock y contratos de proveedor.
- Paquete de alta y runbooks.
- Campana en `HOLD` con dry run.

### Frente B. Checkpoint de activacion

- Aprobar Bill of Materials y propietarios.
- Crear cuentas ENNCO.
- Comprar dominios y buzones.
- Configurar Supabase, Vercel, Google Cloud y OAuth.
- Decidir si Apollo se aprueba como fuente de enriquecimiento.

### Frente C. Staging aislado

- Migraciones reales.
- OAuth Gmail.
- Pub/Sub y History API.
- Alertas transaccionales.
- Restore administrado.
- Seeds, bounces, replies, unsubscribes y kill switch.

### Frente D. Reputacion y primer lote

- SPF, DKIM, DMARC y TLS.
- Cinco semanas de trafico gradual real, sin redes artificiales de warmup.
- Treinta gates live.
- Cinco cuentas exactas.
- Aprobacion explicita de Jorge.
- Envio y monitoreo en vivo.

## Criterio de avance

El siguiente milestone no es comprar todas las herramientas. Es entregar un `Activation Pack` que permita crear y conectar las cuentas correctas una sola vez. Mientras se decide y provisiona, investigacion, panel, QA, datos y dry runs siguen avanzando. Ningun estado local o sintetico autoriza trafico real.

## Fuentes oficiales consultadas

- Gmail API, crear y enviar mensajes: <https://developers.google.com/workspace/gmail/api/guides/sending>
- Gmail API, notificaciones push con Google Cloud Pub/Sub: <https://developers.google.com/workspace/gmail/api/guides/push>
- Apollo, secuencias: <https://knowledge.apollo.io/hc/en-us/articles/4409237165837-Sequences-Overview>
- Apollo, enriquecimiento CSV: <https://knowledge.apollo.io/hc/en-us/articles/4409226361229-Use-CSV-Enrichment>
- Resend, politica de uso aceptable: <https://resend.com/legal/acceptable-use>
