# Estimación optimizada de proveedores ENNCO

Fecha de corte: 20 de agosto de 2026.

Estado: `APPROVAL_READY`, sin compras ejecutadas.

Tipo de cambio presupuestal: 18 MXN por USD. Todas las cifras son antes de IVA, comisiones, variación cambiaria y consumo extraordinario. El checkout de cada proveedor prevalece sobre esta estimación.

## Baseline mensual

| Componente | Construcción MXN | Producción MXN | Estado |
|---|---:|---:|---|
| Apollo Professional mensual, 1 asiento | 1,782 | 1,782 | Precio exacto pendiente de checkout |
| Google Workspace Starter, 4 usuarios | 504 a 605 | 504 a 605 | Pendiente de compra |
| Dos dominios independientes, prorrateo | 50 a 125 | 50 a 125 | Candidatos no verificados ni comprados |
| Vercel Pro | 360 | 360 | Proyecto actual es preview personal, migración ENNCO pendiente |
| Supabase Pro | 450 | 450 | Cuenta ENNCO pendiente |
| Supabase PITR | 0 | 1,800 | Se activa antes de datos reales |
| Google Cloud | 0 a 200 | 0 a 200 | Proyecto ENNCO pendiente |
| Resend, Sentry, Checkly y Postmaster | 0 inicial | 0 inicial | Free tiers sujetos a límites vigentes |
| Total estimado | **3,146 a 3,522** | **4,946 a 5,322** | Antes de impuestos |

## Decisión Apollo

Professional reemplaza el baseline Basic. La razón no es una preferencia: Basic admite un buzón por usuario, mientras Professional admite múltiples buzones Google Workspace bajo el mismo usuario. Se contratará mensual y se evaluará anual después de 90 días de adopción verificada.

El precio de MXN 1,782 supone 99 USD. La página pública actual no entrega el precio estático en el HTML auditado, por lo que el gate de compra exige capturar el checkout exacto y su renovación antes de pagar.

## Protección de presupuesto

- Cap Apollo de 500 créditos mensuales para ENNCO.
- Cero compras de teléfono.
- Cero créditos Apollo para dominios o buzones.
- Cero plan anual antes de 90 días.
- Cero IP dedicada durante el piloto.
- Cero Instantly, Smartlead, HubSpot o segundo secuenciador antes de 100 entregas válidas.
- PITR sólo antes de importar datos reales a producción.
- Un segundo asiento Apollo requiere evidencia de que el acceso colaborador seguro no es posible.
- Cada proveedor necesita owner, hard cap, renovación, alerta y evidencia de exportación.

## Escenario de reutilización

La reutilización de Apollo Teckel no forma parte del presupuesto. Sólo puede descontar aproximadamente MXN 1,782 mensuales si Apollo autoriza por escrito el uso administrado exacto para investigación y warmup de ENNCO. Una respuesta ambigua, negativa o ausente después de dos días hábiles conserva la compra de la cuenta nueva.

## Límites

- Esto no es una cotización ni autorización de gasto.
- No se verificó disponibilidad ni precio de los cuatro dominios candidatos.
- No se creó ninguna cuenta de proveedor.
- No se ejecutó checkout.
- No se modificó DNS.
- No se enviaron mensajes.

## Fuentes oficiales

- [Apollo Terms](https://www.apollo.io/terms)
- [Apollo mailbox limits](https://knowledge.apollo.io/hc/en-us/articles/4409127806093-Link-Your-Mailbox-to-Apollo)
- [Apollo domains, mailboxes and warmup](https://knowledge.apollo.io/hc/en-us/articles/33476090833549-Generate-a-Domain-and-Mailbox-to-Reach-Prospects)
- [Google Workspace México](https://workspace.google.com/intl/es-419_mx/)
- [Vercel pricing](https://vercel.com/pricing)
- [Supabase pricing](https://supabase.com/pricing)
- [Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing)
