# Activacion de proveedores para operacion comercial

> **⚠ CORRECCIÓN 31-ago-2026 (DEC-107).** Donde este documento diga que Apollo
> hace el **calentamiento de buzones**, está equivocado: Apollo discontinuó esa
> función en 2024 por incumplir las políticas de Gmail, y en 2025 la relanzó
> revendida por un tercero. Los 42 días siguen siendo el requisito, pero se
> ejecutan con una herramienta dedicada y el reloj arranca el día que los buzones
> se conectan a ella. Apollo queda para investigación, verificación y secuencias.
> Todo lo demás de este documento sigue vigente.

Fecha de decision: 2026-08-13.

Actualizacion 20-ago-2026: el baseline final es Apollo Professional mensual, un asiento, propiedad de ENNCO. Los dominios y cuatro buzones se compran fuera de Apollo. La arquitectura vigente esta en `docs/32-m24-provider-infrastructure.md`. Este documento no autoriza compra.

Este documento congela la arquitectura recomendada. No autoriza compras, altas, DNS, credenciales, despliegue o envios.

## Decision ejecutiva

No se reinicia el proyecto. La plataforma propia de ENNCO permanece como sistema de verdad y Control Room. Los proveedores se conectan como piezas acotadas, sin entregarles el pipeline, la supresion, la atribucion o la autorizacion de release.

| Funcion | Herramienta | Decision | Uso permitido | No se usa para |
|---|---|---|---|---|
| Salida de correo comercial | Apollo Sequences sobre cuatro buzones aprobados | REQUIRED_CONTRACTUAL | Ejecutar la secuencia congelada, rotar buzones y conservar provider IDs | Enviar sin manifest, supresion, aprobacion o kill switch ENNCO |
| Respuestas y cambios de buzon | Apollo mas Gmail API, IMAP o proveedor de buzon | REQUIRED | Detectar reply y bounce, reconciliar contra el buzon real y detener secuencia | Usar el dashboard Apollo como unica evidencia |
| Datos de empresas y contactos | Apollo | REQUIRED_CONTRACTUAL | Investigar y verificar empresas, cargos y correos; importar resultados con fuente, fecha y confianza | CRM canonico, supresion, atribucion o autorizacion de envio |
| Alertas transaccionales | Resend | OPTIONAL_TRANSACTIONAL_ONLY | Avisos operativos a usuarios conocidos de ENNCO y Teckel | Cold outreach, listas compradas, datos scrapeados o prospectos sin opt-in |
| Base, Auth, Storage y RLS | Supabase con PITR | REQUIRED_LIVE | Sistema de verdad operativo, documentos privados, audit log, outbox y restore | Compartir base o secretos con otros clientes |
| Aplicacion y portal | Vercel | REQUIRED_LIVE | Portal, landing, APIs y rollback | Publicar antes de gates, privacidad y aprobacion |
| DNS y reputacion | Proveedor DNS, SPF, DKIM, DMARC y Google Postmaster | REQUIRED | Autenticar dominios, observar reputacion y bloquear deriva | Declarar verde cuando Postmaster no tenga datos |
| Cifrado de OAuth | Google Cloud KMS | REQUIRED_LIVE | Cifrar tokens de Gmail y rotar llaves | Guardar tokens en codigo o variables compartidas |
| Errores y pruebas externas | Sentry y Checkly | RECOMMENDED | Trazas sin PII, pruebas sinteticas y alertas de disponibilidad | Sustituir logs comerciales o evidencia de leads |
| Alerta interna | Telegram bot dedicado y correo de respaldo | RECOMMENDED | Incidentes Teckel sin PII | Canal del cliente o fuente de verdad |

## Por que Apollo no es el sistema canonico

**CORRECCIÓN 31-ago-2026 (DEC-107): Apollo NO ejecuta el warmup** — discontinuó esa función en 2024. El calentamiento se contrata aparte y, por decisión de arquitectura, **quien envía es el motor propio, no la herramienta**: el rastro de evidencia que sostiene la comisión del 2% vive en nuestra base con auditoría, y cada correo pasa por supresión, manifiesto con hash, rampa y kill switch antes de salir. Apollo queda para investigación y verificación. La plataforma ENNCO conserva el estado comercial y los gates. Antes de inscribir un contacto, ENNCO debe validar Anexo A, cliente actual, baja, rebote, campaign manifest, aprobacion y kill switch. Despues del envio, ENNCO reconcilia provider ID, reply, bounce, baja y siguiente accion.

Esto evita que un cambio manual en Apollo cree destinatarios, reactive un contacto suprimido o convierta una metrica de actividad en resultado comercial. Ningun contacto de Apollo queda automaticamente elegible para outreach.

## Por que no Resend para cold outbound

La politica vigente de Resend prohibe mensajes no solicitados, cold outreach, listas compradas y contactos scrapeados. Por eso Resend no puede ser el motor comercial de ENNCO. Si se aprueba, queda aislado para notificaciones transaccionales dirigidas a operadores y administradores conocidos.

## Lo que Codex puede cerrar sin checkpoint externo

1. Mantener y mejorar el Control Room local con datos sinteticos y estados reales de bloqueo.
2. Preparar el adapter Apollo de datos, secuencias y eventos, mas el fallback Gmail o IMAP, contra interfaces mock y sin credenciales ni red real.
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
| Campaign manifest, suppression, idempotencia y kill switch | `PASS_LOCAL` | Aplicar Anexo A ya congelado en Supabase ENNCO; dominios, buzones y gates live |
| Reply y bounce | Parser Gmail y contratos de reconciliacion probados localmente | Tipo de buzon Apollo, credenciales, API o polling y canary real |
| Outbound | Cola, enrollment gate Anexo A y reconciliación Apollo exacta construidos | Credenciales Apollo, API live, seeds y primer lote aprobado |
| Workbench de investigacion | 27 semillas, 21 investigables, 6 en cuarentena, 0 contactos verificados | 75 empresas, 150 contactos y fuente aprobada de verificacion |
| Apollo | `PASS_LOCAL` para contrato, read model y gate M24 | Compra Professional mensual bajo ENNCO, checkout, MFA, credenciales y adapter live |
| Resend | Contrato de uso transaccional decidido | Cuenta opcional, dominio, adapter y destinos conocidos |
| Produccion | `HOLD` | Proveedores ENNCO, DNS, credenciales, restore, CI remoto, staging y aprobaciones |

## Checkpoints humanos y externos

Jorge o ENNCO deben autorizar o entregar:

1. Copia ejecutada del contrato con certificado BoldSign. El Anexo A ya esta congelado y no se vuelve a pedir.
2. Alta de cuenta Apollo a nombre de ENNCO, administrada por Teckel y pagada por Teckel durante las doce semanas.
3. Checkout y compra de dos dominios y cuatro buzones, con MFA, owner ENNCO y evidencia de transferencia o registrador independiente.
4. Compra de Apollo Professional mensual, un asiento, solo si el checkout conserva owner ENNCO y el presupuesto aprobado.
5. DNS, OAuth, secretos, staging compartido, publicacion y cualquier envio real.
6. La validacion de Paco ya esta archivada. No se vuelve a pedir.
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
- Comprar Apollo, dominios y buzones bajo el contrato y con propiedad ENNCO comprobada.
- Configurar Supabase, Vercel, Google Cloud y OAuth.
- Registrar Professional mensual, un asiento y cuatro buzones Google Workspace. El portal debe mostrar owner, presupuesto y salud sin inferir autorizacion.

### Frente C. Staging aislado

- Migraciones reales.
- OAuth Gmail.
- Pub/Sub y History API.
- Alertas transaccionales.
- Restore administrado.
- Seeds, bounces, replies, unsubscribes y kill switch.

### Frente D. Reputacion y primer lote

- SPF, DKIM, DMARC y TLS.
- Mínimo seis semanas de warmup por buzón **con herramienta dedicada, no con Apollo** (DEC-107), más seeds y tráfico real controlado.
- Treinta gates live.
- Cinco cuentas exactas.
- Aprobacion explicita de Jorge.
- Envio y monitoreo en vivo.

## Criterio de avance

El siguiente milestone es cerrar el `Apollo Activation Pack`: plan, cuenta, propiedad, dominios, buzones, creditos, adapter y gates. Mientras se compra y provisiona, investigacion, panel, QA, datos y dry runs siguen avanzando. Ningun estado local, sintetico o score de warmup autoriza trafico real.

## Fuentes oficiales consultadas

- Gmail API, crear y enviar mensajes: <https://developers.google.com/workspace/gmail/api/guides/sending>
- Gmail API, notificaciones push con Google Cloud Pub/Sub: <https://developers.google.com/workspace/gmail/api/guides/push>
- Apollo, secuencias: <https://knowledge.apollo.io/hc/en-us/articles/4409237165837-Sequences-Overview>
- Apollo, enriquecimiento CSV: <https://knowledge.apollo.io/hc/en-us/articles/4409226361229-Use-CSV-Enrichment>
- Apollo, precios: <https://www.apollo.io/pricing>
- Apollo, dominios y buzones: <https://knowledge.apollo.io/hc/en-us/articles/33476090833549-Generate-a-Domain-and-Mailbox-to-Reach-Prospects>
- Apollo, warmup: <https://knowledge.apollo.io/hc/en-us/articles/26772718460045-Use-Email-Warmup-to-Improve-Deliverability>
- Resend, politica de uso aceptable: <https://resend.com/legal/acceptable-use>
