# Estimacion de proveedores ENNCO

Fecha de consulta: 2026-08-13.

Esto es una estimacion para decidir. No es una cotizacion ni autoriza compras. Para servicios publicados en USD se usa un escenario redondo de `18 MXN/USD`, antes de impuestos y posibles comisiones bancarias.

## Presupuesto minimo de staging

| Componente | Supuesto | Estimado mensual MXN |
|---|---|---:|
| Google Workspace Starter | 4 buzones a 126-168 MXN por usuario al mes | 504-672 |
| Supabase Pro sin PITR | 25 USD al mes | 450 |
| Vercel Pro | 20 USD al mes | 360 |
| Google Cloud Pub/Sub y KMS | Volumen inicial bajo; Pub/Sub dentro de primera banda gratuita y pocas operaciones KMS | 0-100 |
| Dos dominios | Reserva anual estimada de 600-1,500 MXN prorrateada | 50-125 |
| Total staging obligatorio | Sin Apollo ni herramientas opcionales | **1,364-1,707** |

## Presupuesto de produccion con recuperacion

| Componente | Supuesto | Estimado mensual MXN |
|---|---|---:|
| Staging obligatorio anterior | Mismo conjunto | 1,364-1,707 |
| Supabase PITR | Add-on de 100 USD al mes, sustituyendo el costo sin PITR para calcular el total | +1,800 |
| Total produccion obligatorio | Incluye PITR, antes de impuestos | **3,164-3,507** |

El RPO de 15 minutos depende de PITR. Podemos construir staging con Supabase Pro, pero no declarar continuidad productiva hasta activar y probar PITR.

## Estimacion Apollo

### Creditos necesarios

- Meta operativa: 150 contactos verificados.
- Escenario de planeacion: 70% a 80% de candidatos investigados terminan con rol correcto y dato utilizable.
- Candidatos requeridos: `150 / 0.80 = 188` a `150 / 0.70 = 215`.
- Reserva de sustitucion de 15%: 216 a 247.
- Recomendacion de compra o disponibilidad: **250 a 300 creditos de email verificado**.

Apollo publica que un email verificado consume un credito por contacto y que no cobra cuando no consigue verificarlo. El plan gratuito publica 900 creditos al ano, entregados mensualmente, equivalente a 75 al mes. Alcanzaria para probar calidad, pero no para producir 150 contactos con reserva durante un solo mes.

### Opciones

| Opcion | Uso | Estimado |
|---|---|---:|
| Free | Piloto de cobertura y calidad, hasta la asignacion mensual disponible | 0 MXN |
| Basic, 1 asiento | Filtros, CSV y API de enriquecimiento; 49 USD al mes con facturacion anual | 882 MXN equivalentes al mes |
| Compromiso Basic anual | 49 USD por 12 meses | 10,584 MXN antes de impuestos |
| Add-on de 250-300 creditos | Preferible si Apollo lo cotiza sin exigir un plan sobredimensionado | UNKNOWN hasta entrar a billing |

Recomendacion: ejecutar primero un piloto de 25 a 50 contactos con Free o trial. Comprar Basic sólo si la cobertura, cargo y empresa coinciden con el Workbench y si necesitamos CSV o API. No usar sus secuencias.

## Herramientas opcionales

| Herramienta | Inicio recomendado | Plan pagado estimado |
|---|---|---:|
| Sentry | Developer gratuito durante staging | Team 26 USD, 468 MXN al mes |
| Checkly | Hobby gratuito durante staging | Starter 24 USD, 432 MXN al mes |
| Resend transaccional | Free para alertas internas de bajo volumen | Pro 20 USD, 360 MXN al mes |
| Telegram | Bot dedicado sin PII | 0 MXN esperado |

Con Apollo Basic y sin opciones pagadas, el costo productivo equivalente queda en **4,046-4,389 MXN al mes**, pero Apollo se cobra anualmente bajo el precio citado. Si además se contratan Sentry Team, Checkly Starter y Resend Pro, el equivalente sube a **5,306-5,649 MXN al mes**.

## Fuentes oficiales

- Google Workspace México: <https://workspace.google.com/intl/es-419_mx/>
- Supabase: <https://supabase.com/pricing>
- Vercel: <https://vercel.com/pricing>
- Google Cloud Pub/Sub: <https://cloud.google.com/pubsub/pricing>
- Google Cloud KMS: <https://cloud.google.com/kms/pricing>
- Apollo: <https://www.apollo.io/pricing>
- Créditos Apollo: <https://www.apollo.io/pricing/about-credits>
- Sentry: <https://sentry.io/pricing/>
- Checkly: <https://www.checklyhq.com/pricing/>
- Resend: <https://resend.com/docs/knowledge-base/what-is-resend-pricing>
