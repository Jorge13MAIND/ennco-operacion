# Baseline de activacion y opciones de envio

Fecha de corte: 20 de agosto de 2026.

Estado: `SUPERSEDED_BY_M24`. Este documento conserva la comparación histórica. La decisión vigente está en `docs/32-m24-provider-infrastructure.md`. No autoriza compra, alta, DNS, credenciales, publicación o envío.

## Confirmaciones recibidas

- Anexo A al corte: POSCO MPPC, MPE PLASTIC y TEJAS EL AGUILA.
- Razones sociales, 12 alias y seis dominios verificados con fuentes oficiales. Falta binding contra cuentas en la base aislada.
- Snapshot local: `8e986eff74dee10d3f619f7562ee6b7d18207c3c5e080cd82656cc0e88d46af1`.
- Contrato: Jorge confirma que esta firmado. El PDF ejecutado y el certificado BoldSign siguen sin archivarse localmente.
- Operador: Jorge proporciono `francisco.cuellar@ennco.com.mx`, horario de 07:00 a 20:00 y aceptacion de SLA.
- Identidad canónica final: Francisco Cuellar.
- Suplente: no proporcionado.
- Paquete técnico: Paco respondió y Jorge autorizó implementación el 20 de agosto. Modelo `ENNCO-PREQ-2026-08-PACO-01` en estado `APPROVED`.
- Administracion: Teckel operara la infraestructura. La recomendacion de continuidad es que ENNCO conserve owner y facturacion.

## Aclaracion de costos

El presupuesto anterior no era el precio de cuatro dominios. El diseno usa dos dominios y cuatro buzones. El total incluia tambien portal, base, autenticacion, storage, despliegue y recuperacion.

Para comparar se usa un escenario de 18 MXN por USD, antes de impuestos.

### Escenario A. Propiedad ENNCO y sender propio

- Dos dominios propios: 50 a 125 MXN mensuales prorrateados.
- Cuatro buzones Google Workspace Starter: 560 MXN mensuales con anualidad o 672 MXN flexibles.
- Motor Gmail API ya construido: sin licencia adicional de secuenciador.
- Costo de la capa de correo: 610 a 797 MXN mensuales.
- Supabase y Vercel se activan por separado cuando el portal pase a staging administrado.

Ventaja: menor costo recurrente, propiedad y exportacion completas, una sola fuente de verdad.

Costo: exige terminar OAuth, Pub/Sub, reply sync y operacion de reputacion.

### Escenario B. Instantly Growth con infraestructura DFY

- Outreach Growth: 47 USD, 846 MXN mensuales.
- Cuatro buzones Google DFY: 20 USD, 360 MXN mensuales.
- Dos dominios DFY: 30 USD anuales, 45 MXN mensuales prorrateados.
- Total aproximado: 1,251 MXN mensuales.

API V2 esta disponible en Growth, pero los webhooks requieren Hyper Growth de 97 USD. Growth tendria que integrarse por polling. Hyper Growth con cuatro buzones y dos dominios sube a aproximadamente 2,151 MXN mensuales.

Riesgo material: Instantly conserva propiedad del dominio y acceso administrativo de su oferta DFY y no permite transferirlos. Por eso DFY no cumple por si solo la entrega enterprise a ENNCO.

### Escenario C. Smartlead

- Base: 39 USD, 702 MXN mensuales.
- Cuatro buzones Google con admin access: 18 USD, 324 MXN mensuales.
- Dos dominios: 26 USD anuales, 39 MXN mensuales prorrateados.
- Total Base: aproximadamente 1,065 MXN mensuales.

Base no incluye API ni webhooks. Pro cuesta 94 USD y es el primer plan integrado. Con cuatro buzones y dos dominios, Pro queda en aproximadamente 2,055 MXN mensuales antes de verificacion adicional.

Base puede servir para un piloto manual. No puede mantener el Control Room sincronizado E2E sin trabajo manual.

### Escenario D. Resend

Descartado para prospeccion fria. Su politica prohibe mensajes no solicitados, cold outreach, listas compradas y datos scrapeados. Se puede usar unicamente para alertas transaccionales a usuarios conocidos.

### Escenario E. Apollo contractual, decisión final

- Professional mensual: 99 USD como supuesto presupuestal, sujeto a checkout.
- Un asiento con perfil Francisco Cuellar y hasta cuatro buzones Google Workspace.
- Cap interno de 500 créditos mensuales.
- Dominios y buzones comprados fuera de Apollo para conservar propiedad y evitar consumo de créditos.
- Apollo recomienda warmup por un mínimo de seis semanas.

Ventaja: sustituye Apollo mas Instantly o Smartlead mas una herramienta separada de warmup. Centraliza investigacion, verificacion, secuencias y salud de correo.

Riesgo: la cuenta Teckel está limitada a sus fines internos. La reutilización requiere autorización escrita específica. El baseline de presupuesto sigue siendo una cuenta nueva ENNCO.

## Recomendacion de eficiencia

1. Mantener dos dominios y cuatro buzones, no cuatro dominios.
2. Contratar Apollo Professional mensual, un asiento, propiedad ENNCO, y usarlo para datos, verificación, secuencias, warmup y deliverability.
3. No contratar Instantly, Smartlead ni otra herramienta de warmup salvo brecha documentada de Apollo.
4. Mantener en ENNCO la supresion, la aprobacion de release, la atribucion, el lead estricto, el historial auditable y el kill switch.
5. Registrar dominios y buzones fuera de Apollo bajo propiedad ENNCO, con Teckel como administrador autorizado.
6. Usar Gmail API o IMAP como segunda fuente para replies y continuidad, segun el tipo de buzon seleccionado.
7. Mantener Supabase y Vercel local o free durante investigacion; activar planes pagados al abrir staging administrado.
8. Respetar el minimo oficial de seis semanas de warmup por buzon. Para evitar sumar primero 30 dias de dominio y luego seis semanas de buzon, preferir dominios propios creados de inmediato con buzones enlazados, siempre que reputacion, autenticacion y seeds pasen.
9. El primer canary sigue bloqueado hasta cargar y conciliar el Anexo A en la base, aprobar el campaign manifest y validar SPF, DKIM, DMARC, seeds, reply sync, alertas y kill switch.

## Identidades bloqueadas del Anexo A

| Nombre recibido | Razón social verificada | Dominios bloqueados | Estado pendiente |
|---|---|---|---|
| POSCO MPPC | POSCO MPPC, S.A. DE C.V. | `poscomppc.com.mx`, `poscomppc.com` | Binding de cuenta y carga transaccional |
| MPE PLASTIC | MATERIAS PLASTICAS Y ELASTOMEROS DE MEXICO, S.A. DE C.V. | `mpeplastics.com` | Binding de cuenta y carga transaccional |
| TEJAS EL AGUILA | LAPROBA EL AGUILA SA DE CV | `tejaselaguila.com`, `tejaselaguila.mx`, `tejaselaguila.net` | Binding de cuenta y carga transaccional |

Fuentes primarias: avisos y sitios oficiales de las tres empresas. La resolución pública no autoriza contacto ni sustituye la conciliación en la base.

## Fuentes oficiales

- Google Workspace Mexico: <https://workspace.google.com/intl/es-419_mx/>
- Instantly pricing: <https://instantly.ai/pricing>
- Instantly plans: <https://help.instantly.ai/en/articles/10273259-instantly-plans-overview>
- Instantly API V2: <https://help.instantly.ai/en/articles/10432807-api-v2>
- Instantly webhooks: <https://help.instantly.ai/en/articles/6261906-webhooks>
- Instantly DFY Google: <https://help.instantly.ai/en/articles/9361043-done-for-you-google-email-setup>
- Smartlead pricing: <https://www.smartlead.ai/pricing>
- Smartlead machine-readable pricing: <https://www.smartlead.ai/pricing.md>
- Resend acceptable use: <https://resend.com/legal/acceptable-use>
- Apollo pricing: <https://www.apollo.io/pricing>
- Apollo domains and mailboxes: <https://knowledge.apollo.io/hc/en-us/articles/33476090833549-Generate-a-Domain-and-Mailbox-to-Reach-Prospects>
- Apollo warmup: <https://knowledge.apollo.io/hc/en-us/articles/26772718460045-Use-Email-Warmup-to-Improve-Deliverability>
