# Alineacion contractual y tecnica de Apollo

Fecha: 14 de agosto de 2026.

Estado: `SUPERSEDED_BY_M24`. La decisión final vive en `docs/32-m24-provider-infrastructure.md`. Este documento conserva el razonamiento histórico y no autoriza compra, DNS, credenciales, envío o contacto externo.

## Correccion ejecutiva

Apollo deja de ser opcional. El contrato no menciona la marca, pero si incluye una plataforma de datos con creditos, un orquestador de envio, dominios de correo y calentamiento. Jorge confirmo que Apollo es la herramienta prevista para cumplir esas capacidades.

La consecuencia es directa:

1. Apollo sustituye la combinacion Apollo mas Instantly o Smartlead mas una herramienta de warmup.
2. Resend no participa en prospeccion fria. Solo queda como opcion para alertas transaccionales.
3. La operación y el presupuesto los administra Teckel durante el contrato, pero los activos y cuentas deben quedar bajo propiedad ENNCO.
4. La plataforma ENNCO sigue siendo el sistema de verdad. Apollo es la capa de datos y ejecucion.

## Arquitectura vigente

### Apollo opera según la decisión final

- Busqueda y verificacion de contactos.
- Listas de trabajo y secuencias.
- Rotacion de buzones.
- Enlace de dominios y buzones propiedad de ENNCO. No se comprarán dentro de Apollo.
- Warmup y health de entregabilidad.
- Envios, rebotes y señales de respuesta.

### La plataforma ENNCO controla

- Anexo A, clientes actuales, bajas y rebotes.
- Elegibilidad fail closed antes de inscribir un contacto.
- Campaign manifest y aprobacion exacta de cada release.
- Kill switch global, por campaña y por buzon.
- Identidad de empresa, deduplicacion y lineage.
- Reply, lead estricto, siguiente accion y SLA.
- Atribucion, pagos, comisiones y reportes.
- Audit log, outbox, incidentes y exportacion.

Apollo nunca convierte automaticamente una busqueda, apertura, clic o respuesta en lead contractual.

## Plan y costo recomendado, superseded

Apollo Basic dejó de ser baseline porque permite un solo buzón por usuario. La decisión final es Professional mensual:

- Un asiento bajo ENNCO.
- Cuatro buzones Google Workspace conectados al mismo usuario.
- Presupuesto de referencia de 99 USD al mes, sujeto a checkout.
- Cap interno de 500 créditos mensuales.
- Revisión para anual sólo después de 90 días.

El checkout exacto debe capturarse antes de pagar. Dominios, buzones y warmup no consumirán créditos de infraestructura de Apollo.

## Dominios y propiedad

Apollo puede registrar dominios, autenticar SPF, DKIM y DMARC, provisionar buzones SMTP, Google Workspace o Microsoft 365 y entregar credenciales. Sin embargo, su documentacion tambien indica que el acceso puede desactivarse si termina el plan o faltan creditos.

Eso no demuestra por si solo el requisito contractual de propiedad ENNCO y ausencia de dependencia. El orden de decision es:

1. Verificar en checkout o por escrito el registrante legal, la transferencia a otro registrador, la renovacion y el acceso DNS fuera de Apollo.
2. Si cumple, registrar con datos ENNCO y Teckel como administrador.
3. Si no cumple, comprar los dos dominios en un registrador independiente a nombre de ENNCO, crear cuatro buzones Google Workspace y enlazarlos a Apollo.

La segunda ruta es el fallback recomendado porque conserva portabilidad y permite continuar aunque Apollo se cancele.

## Calendario realista

Apollo recomienda:

- Esperar 30 dias antes de crear buzones sobre un dominio generado dentro de Apollo.
- Mantener email warmup durante un minimo de seis semanas antes de cold outreach.

Por eficiencia, no conviene esperar 30 dias para despues empezar seis semanas adicionales. La ruta mas corta sin degradar controles es adquirir dominios ENNCO, crear los cuatro buzones de inmediato, enlazarlos a Apollo y comenzar el warmup el mismo dia.

El warmup no es un pase de produccion. El primer canary de cinco mensajes exige ademas autenticacion completa, seeds, Anexo A reconciliado, lista verificada, campaign manifest, aprobacion exacta, reply sync, alertas, idempotencia y kill switch.

## Cambios de implementacion

1. Reemplazar el adapter de Apollo solo enriquecimiento por un adapter de datos, secuencias y eventos.
2. Añadir un enrollment gate que consulte supresion y approval antes de permitir la inscripcion en Apollo.
3. Sincronizar estados Apollo a PostgreSQL con idempotencia y evidencia de proveedor.
4. Reconciliar replies y bounces contra el buzon real, no solo contra el dashboard Apollo.
5. Congelar el sequence hash y compararlo contra el campaign manifest antes de release.
6. Importar diariamente actividad y detener si Apollo y el ledger ENNCO divergen.
7. Probar export completo y continuidad sin Apollo antes de aceptación final.

## Bloqueos restantes

- Plan Apollo exacto y checkout de creditos.
- Evidencia de propiedad y transferencia de dominios generados en Apollo.
- Dos nombres de dominio aprobados y disponibles.
- Cuatro identidades de buzon definitivas.
- Cuenta ENNCO, owner, MFA y facturacion Teckel durante el contrato.
- Credenciales API o mecanismo de polling disponible en el plan.
- Copia local del contrato ejecutado y certificado de firma.
- Aprobacion exacta del primer lote.

## Fuentes oficiales

- Apollo pricing: <https://www.apollo.io/pricing>
- Apollo credits: <https://knowledge.apollo.io/hc/en-us/articles/9527776320781-What-Are-Credits>
- Apollo domains and mailboxes: <https://knowledge.apollo.io/hc/en-us/articles/33476090833549-Generate-a-Domain-and-Mailbox-to-Reach-Prospects>
- Apollo warmup: <https://knowledge.apollo.io/hc/en-us/articles/26772718460045-Use-Email-Warmup-to-Improve-Deliverability>
- Apollo sequences: <https://knowledge.apollo.io/hc/en-us/articles/4409237165837-Sequences-Overview>
